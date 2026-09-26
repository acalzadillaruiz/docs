/**
 * El ciclo de vida de un contrato: que un contrato que terminó pueda terminarse.
 *
 * `estado_contrato` declara cinco estados desde el primer día y la aplicación sabía llegar
 * a DOS. Lo encontró un barrido nuevo —columnas que ni la aplicación ni el esquema
 * nombran— por `contrato.fin_real`, que no escribía nadie. En uso real: un contrato
 * terminado se quedaba vigente para siempre, «¿terminamos tarde?» no tenía respuesta, y dos
 * pantallas ya consultaban `estado in ('vigente','suspendido')` contando con una suspensión
 * que no existía.
 *
 * Lo que se vigila aquí, por orden de lo que costaría equivocarse:
 *
 *   1. Que NO se liquide un contrato al que se le debe dinero. Eso no es criterio de
 *      nadie: es una resta, y firmar un finiquito con dinero por medio se paga.
 *   2. Que cerrar EXIJA la fecha real de fin, que es el dato por el que existe el trozo.
 *   3. Que los pasos que no existen no se puedan dar, aunque alguien los mande a mano.
 *   4. Que cada cambio deje motivo escrito, quién y cuándo.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { situacion, cambiarEstado, PASOS } from '../src/dominio/ciclo.ts'
import { pintarCiclo } from '../src/pantallas/ciclo.ts'
import { t, type Clave } from '../src/i18n/t.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'c1c10000-0000-0000-0000-0000000000a1'
const OTRA = 'c1c10000-0000-0000-0000-0000000000a2'
const C = 'c1c10000-0000-0000-0000-0000000000a3'
const YO = 'c1c10000-0000-0000-0000-0000000000a4'
const ING = 'c1c10000-0000-0000-0000-0000000000a5'
const AJENO = 'c1c10000-0000-0000-0000-0000000000a6'
const TASA = 'c1c10000-0000-0000-0000-0000000000a7'
const CTR = 'c1c10000-0000-0000-0000-0000000000b1'
const CTR_AJENO = 'c1c10000-0000-0000-0000-0000000000b2'
const RG = 'c1c10000-0000-0000-0000-0000000000c1'
const IVA = 'c1c10000-0000-0000-0000-0000000000d1'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)
const comoLaOtra = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: AJENO }, 'nexus_interno', f)
const comoCliente = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: ING }, 'nexus_cliente', f)

/**
 * Deja el contrato de prueba vigente, sin historia y sin nada pendiente de cobro.
 *
 * La valuación se borra AQUÍ y no al final de la prueba que la crea: una prueba que se
 * muere a mitad no llega nunca a su limpieza, y entonces las cuatro siguientes fallan
 * porque el contrato tiene dinero por medio. Ya pasó.
 */
async function reiniciar(): Promise<void> {
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`delete from contrato_estado where contrato_id = ${CTR}::uuid`
    await q`delete from valuacion where contrato_id = ${CTR}::uuid`
    await q`update contrato set estado = 'vigente', fin_real = null
             where id = ${CTR}::uuid`
  })
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Ciclo','J-907700000-0'),
        ('${OTRA}','gps','Otra GPS Ciclo','J-907800000-0'),
        ('${C}','operadora','Operadora Ciclo','J-907900000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto) values
              (${YO}, ${G},'ciclo@prueba.test','Interno','clave_2fa','(h)','(s)'),
              (${AJENO}, ${OTRA},'ciclo-otra@prueba.test','De la otra','clave_2fa','(h)','(s)'),
              (${ING}, ${C},'ciclo-cli@prueba.test','De la operadora','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2019-11-04', 42.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      -- Con su propia fecha de vigencia: el indice unico de (clase, vigente_desde) no deja
      -- que dos archivos de prueba siembren la suya para el mismo dia, que es lo que
      -- hacian los diecisiete anteriores.
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2018-01-18') on conflict do nothing;
      -- La UT hace falta para el sustraendo del ISLR de la valuacion: sin ella,
      -- neto_valuacion levanta excepcion y esta prueba se cae por otra cosa.
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2018-01-18', 9.00)
        on conflict (vigente_desde) do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje,
                                 factor_ut, minimo_ut, vigente_desde)
        values ('CIC-SERV','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,
                '2018-01-18')
        on conflict (codigo) do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es,
                            titulo_en, estado, moneda, monto, tasa_id, creado_por,
                            inicio, fin_previsto) values
        ('${CTR}','${G}','${C}','CIC-001','servicio','Servicio de prueba',
         'Test service','vigente','VES', 900000.00,'${TASA}','${YO}',
         '2026-03-02','2026-09-02'),
        ('${CTR_AJENO}','${OTRA}','${C}','CIC-002','servicio','De la otra GPS',
         'Of the other GPS','vigente','VES', 500000.00,'${TASA}','${AJENO}',
         '2026-03-02','2026-09-02')
        on conflict (id) do update set estado = 'vigente';
      insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                           unidad, cantidad, precio_unitario)
        values ('${RG}','${CTR}', 1,'Uno','One','und', 1, 900000.00)
        on conflict (id) do update set cantidad = excluded.cantidad;
    `)
  })
})

after(async () => { await reiniciar(); await cerrar() })

// ---------------------------------------------------------------- los pasos

test('los pasos del dominio y los de la base de datos son LOS MISMOS', async () => {
  // Dos listas de pasos que se copian a mano se separan en cuanto alguien toca una, y
  // entonces la pantalla ofrece un botón que la base rechaza. Se comparan las dos.
  for (const de of Object.keys(PASOS) as Array<keyof typeof PASOS>) {
    const [r] = (await dentro((q) => q`
      select pasos_de_contrato(${de}::estado_contrato)::text[] as pasos
    `)) as unknown as Array<{ pasos: string[] }>
    assert.deepEqual([...(r!.pasos ?? [])].sort(), [...PASOS[de]].sort(),
      `desde ${de} el dominio y la base no dicen lo mismo`)
  }
})

test('se puede suspender un contrato vigente, y volver a ponerlo en marcha', async () => {
  await reiniciar()
  const a = await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'suspendido', motivo: 'La operadora paró la obra por lluvias',
    finReal: '',
  }, YO, G, 'es'))
  assert.equal(a.hecho, true, (a as { errores?: string[] }).errores?.join(' · '))

  const s = await dentro((q) => situacion(q, CTR, G, 'es'))
  assert.equal(s!.estado, 'suspendido')
  assert.deepEqual([...s!.pasos].sort(), ['cerrado', 'vigente'])
  assert.equal(s!.historia.length, 1)
  assert.equal(s!.historia[0]!.motivo, 'La operadora paró la obra por lluvias')
  assert.equal(s!.historia[0]!.quien, 'Interno', 'no dejó dicho quién lo hizo')

  const b = await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'vigente', motivo: 'Se reanudó', finReal: '',
  }, YO, G, 'es'))
  assert.equal(b.hecho, true)
  assert.equal((await dentro((q) => situacion(q, CTR, G, 'es')))!.estado, 'vigente')
  await reiniciar()
})

test('un paso que no existe se niega, y el mensaje dice a dónde SÍ se puede ir', async () => {
  await reiniciar()
  // De vigente no se salta a liquidado: primero se cierra. Un mensaje que solo dijera «no
  // se puede» dejaría a alguien buscando; este dice por dónde.
  const r = await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'liquidado', motivo: 'Quiero liquidarlo ya', finReal: '',
  }, YO, G, 'es'))
  assert.equal(r.hecho, false, 'saltó de vigente a liquidado')
  const dicho = (r as { errores: readonly string[] }).errores.join(' ')
  assert.match(dicho, /Suspendido|Cerrado/i, `no dijo a dónde se puede ir: «${dicho}»`)

  // Y un estado inventado tampoco, ni revienta pidiendo una traducción que no existe.
  const inventado = await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'archivado', motivo: 'Un estado que no existe', finReal: '',
  }, YO, G, 'es'))
  assert.equal(inventado.hecho, false)
  assert.equal((inventado as { errores: readonly string[] }).errores
    .some((e) => e.includes('‹falta:')), false, 'pidió una clave que no existe')
  await reiniciar()
})

test('la base de datos lo impide aunque se llame a la función directamente', async () => {
  // La comprobación del dominio existe para dar una frase legible. La que no se puede
  // saltar es ésta, y la tiene que pasar cualquier camino que alguien añada mañana.
  await reiniciar()
  await assert.rejects(
    dentro((q) => q`
      select cambiar_estado_contrato(${CTR}::uuid, 'liquidado'::estado_contrato,
        null, 'por la puerta de atrás', ${YO}::uuid)`),
    /no puede pasar a/,
  )
  assert.equal((await dentro((q) => situacion(q, CTR, G, 'es')))!.estado, 'vigente')
  await reiniciar()
})

// ---------------------------------------------------------------- cerrar

test('cerrar EXIGE la fecha real de fin, y cada fecha mala se niega POR SU MOTIVO', async () => {
  // Esta prueba pasaba en vano y lo comprobé apagando la exigencia en las dos capas: seguía
  // verde. El motivo es el de siempre — un `hecho === false` no dice nada cuando hay varias
  // maneras de ser falso. Aquí eran tres: sin fecha, fecha imposible y fecha anterior al
  // inicio caían TODAS en la comparación con el inicio del contrato, porque una cadena
  // vacía es menor que cualquier fecha. Así que ahora se afirma CUÁL de los tres mensajes
  // vuelve, y apagar la comprobación de la fecha pone la prueba roja.
  await reiniciar()
  const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const casos = [
    ['', 'fin_real'], ['2026-02-31', 'fin_real'], ['2026/09/10', 'fin_real'],
    ['2026-03-01', 'fin_antes'], [manana, 'fin_futuro'],
  ] as const

  for (const [fin, clave] of casos) {
    const r = await dentro((q) => cambiarEstado(q, {
      contratoId: CTR, a: 'cerrado', motivo: 'Terminó la obra', finReal: fin,
    }, YO, G, 'es'))
    assert.equal(r.hecho, false, `cerró con la fecha «${fin}»`)
    const dicho = (r as { errores: readonly string[] }).errores.join(' | ')
    // El mensaje se compara con el del diccionario, no con un trozo escrito a mano aquí:
    // si mañana se reescribe la frase, la prueba sigue valiendo.
    const esperado = t('es', `ciclo.error.${clave}` as Clave).split('{')[0]!.trim()
    assert.ok(dicho.includes(esperado),
      `con «${fin}» esperaba «${clave}» y dijo: ${dicho}`)
  }
  assert.equal((await dentro((q) => situacion(q, CTR, G, 'es')))!.estado, 'vigente')
  await reiniciar()
})

test('cerrado guarda la fecha real, y la pantalla dice cuántos días tarde', async () => {
  // Es el dato por el que existe este trozo: `fin_real` no lo escribía nadie, así que
  // «¿terminamos tarde?» no se podía contestar en un producto que mide ejecución.
  await reiniciar()
  const r = await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'cerrado', motivo: 'Terminó la obra y se recibió',
    finReal: '2026-09-20',
  }, YO, G, 'es'))
  assert.equal(r.hecho, true, (r as { errores?: string[] }).errores?.join(' · '))

  const s = await dentro((q) => situacion(q, CTR, G, 'es'))
  assert.equal(s!.estado, 'cerrado')
  assert.equal(s!.finReal, '2026-09-20')
  assert.equal(s!.finPrevisto, '2026-09-02')
  assert.equal(s!.historia[0]!.finReal, '2026-09-20',
    'el histórico no guardó la fecha que se fijó')

  // 18 días más tarde de lo previsto, y la pantalla lo dice en rojo.
  const h = pintarCiclo(s!, 'CIC-001', CTR, 'es', 'af')
  assert.match(h, /class="pu tarde"/, 'no marcó que terminó tarde')
  assert.match(h, /<b>18<\/b>/, 'no dijo cuántos días')
  await reiniciar()
})

test('reabrir un contrato cerrado BORRA la fecha real de fin', async () => {
  // Un contrato que vuelve a estar en marcha no terminó. Dejarle la fecha puesta sería un
  // contrato vivo con fecha de muerte, y de ahí salen los informes que nadie entiende.
  await reiniciar()
  await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'cerrado', motivo: 'Terminó', finReal: '2026-09-10',
  }, YO, G, 'es'))
  const r = await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'vigente', motivo: 'Adenda: se amplía el alcance', finReal: '',
  }, YO, G, 'es'))
  assert.equal(r.hecho, true, (r as { errores?: string[] }).errores?.join(' · '))

  const s = await dentro((q) => situacion(q, CTR, G, 'es'))
  assert.equal(s!.estado, 'vigente')
  assert.equal(s!.finReal, null, 'dejó puesta la fecha de fin de un contrato vigente')
  // Y el histórico sí conserva la fecha que se puso entonces: el pasado no se borra.
  assert.equal(s!.historia.find((c) => c.a === 'cerrado')!.finReal, '2026-09-10')
  await reiniciar()
})

// ---------------------------------------------------------------- liquidar

test('NO se liquida un contrato al que se le debe dinero, y se dice cuánto', async () => {
  // La comprobación que de verdad importa. No es criterio de nadie: es una resta, y firmar
  // un finiquito con dinero por medio se paga.
  await reiniciar()
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    // Una valuación aprobada y sin cobrar: lo que impide liquidar.
    await q`
      insert into valuacion (organizacion_id, contrato_id, numero, periodo_desde,
                             periodo_hasta, obra, origen_obra, moneda, tasa_id,
                             amortiza_pct, garantia_pct, ret_iva_pct, alicuota_iva_id,
                             concepto_islr, estado, creada_por,
                             aprobada_el, aprobada_por)
      values (${G}, ${CTR}::uuid, 90,'2026-04-01','2026-04-30', 300000.00,
              'hitos_evidenciados','VES', ${TASA}, 0, 0, 0, ${IVA},'CIC-SERV',
              'aprobada', ${YO},'2026-05-04', ${ING})`
  })

  const s = await dentro((q) => situacion(q, CTR, G, 'es'))
  assert.ok(s!.faltaLiquidar.length > 0, 'no vio que falta cobrar')
  assert.match(s!.faltaLiquidar.join(' '), /300|cobrar/i)

  await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'cerrado', motivo: 'Terminó la obra', finReal: '2026-09-05',
  }, YO, G, 'es'))
  const r = await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'liquidado', motivo: 'Finiquito firmado', finReal: '',
  }, YO, G, 'es'))
  assert.equal(r.hecho, false, 'liquidó un contrato con una valuación sin cobrar')
  assert.match((r as { errores: readonly string[] }).errores.join(' '), /cobrar/i)

  // Y la base tampoco, llamada a mano: es la cerradura, no el aviso.
  await assert.rejects(
    dentro((q) => q`
      select cambiar_estado_contrato(${CTR}::uuid, 'liquidado'::estado_contrato,
        null,'por la puerta de atrás', ${YO}::uuid)`),
    /no se puede liquidar/,
  )

  await reiniciar()
})

test('sin nada pendiente sí se liquida, y de liquidado no se vuelve', async () => {
  // La otra mitad: una cerradura que no se abre nunca no es una cerradura, es una pared.
  await reiniciar()
  const s0 = await dentro((q) => situacion(q, CTR, G, 'es'))
  assert.deepEqual(s0!.faltaLiquidar, [], 'este contrato debería estar limpio')

  await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'cerrado', motivo: 'Terminó la obra', finReal: '2026-09-02',
  }, YO, G, 'es'))
  const r = await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'liquidado', motivo: 'Finiquito firmado y garantía liberada',
    finReal: '',
  }, YO, G, 'es'))
  assert.equal(r.hecho, true, (r as { errores?: string[] }).errores?.join(' · '))

  const s = await dentro((q) => situacion(q, CTR, G, 'es'))
  assert.equal(s!.estado, 'liquidado')
  assert.deepEqual(s!.pasos, [], 'de liquidado se podía salir')
  // Y la pantalla no ofrece ningún formulario, porque no hay nada que ofrecer.
  assert.equal(/name="a"/.test(pintarCiclo(s!, 'CIC-001', CTR, 'es', 'af')), false,
    'ofreció cambiar el estado de un contrato liquidado')

  const vuelta = await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'vigente', motivo: 'Me arrepentí', finReal: '',
  }, YO, G, 'es'))
  assert.equal(vuelta.hecho, false, 'salió de liquidado')
  await reiniciar()
})

// ---------------------------------------------------------------- motivo y aislamiento

test('sin motivo escrito no se cambia nada: un formulario en blanco no suspende', async () => {
  // El mismo fallo que ya salió dos veces —dar de baja a una persona, quitar un paso de una
  // plantilla—: un botón con el identificador ya puesto en un campo escondido.
  await reiniciar()
  for (const motivo of ['', '   ', 'ok']) {
    const r = await dentro((q) => cambiarEstado(q, {
      contratoId: CTR, a: 'suspendido', motivo, finReal: '',
    }, YO, G, 'es'))
    assert.equal(r.hecho, false, `cambió el estado con el motivo «${motivo}»`)
  }
  assert.equal((await dentro((q) => situacion(q, CTR, G, 'es')))!.estado, 'vigente')

  // Y la base de datos también lo exige, no solo la pantalla.
  await assert.rejects(
    dentro((q) => q`
      select cambiar_estado_contrato(${CTR}::uuid, 'suspendido'::estado_contrato,
        null,'  ', ${YO}::uuid)`),
    /por que|por qué/i,
  )
  await reiniciar()
})

test('el contrato de OTRA GPS no se toca, y contesta lo mismo que si no existiera', async () => {
  await reiniciar()
  const r = await dentro((q) => cambiarEstado(q, {
    contratoId: CTR_AJENO, a: 'suspendido', motivo: 'No es mío', finReal: '',
  }, YO, G, 'es'))
  assert.equal(r.hecho, false, 'cambió el estado de un contrato de otra GPS')

  const inventado = await dentro((q) => cambiarEstado(q, {
    contratoId: '00000000-0000-0000-0000-000000000000', a: 'suspendido',
    motivo: 'No existe', finReal: '',
  }, YO, G, 'es'))
  assert.deepEqual((r as { errores: readonly string[] }).errores,
    (inventado as { errores: readonly string[] }).errores,
    'distingue «no es tuyo» de «no existe», y eso dice que existe')

  // Y la de la otra GPS sí puede con el suyo: si no, la prueba anterior pasaría con la
  // comprobación de organización puesta al revés.
  const suyo = await comoLaOtra((q) => cambiarEstado(q, {
    contratoId: CTR_AJENO, a: 'suspendido', motivo: 'Este sí es mío', finReal: '',
  }, AJENO, OTRA, 'es'))
  assert.equal(suyo.hecho, true, (suyo as { errores?: string[] }).errores?.join(' · '))
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`delete from contrato_estado where contrato_id = ${CTR_AJENO}::uuid`
    await q`update contrato set estado = 'vigente' where id = ${CTR_AJENO}::uuid`
  })
  await reiniciar()
})

test('el cliente VE el histórico de su contrato pero no puede escribirlo', async () => {
  // Que un contrato se suspendió o se cerró no es información interna: es justo lo que el
  // cliente necesita saber, y se lo dijo GPS. Lo que no puede es decidirlo.
  //
  // Y de dónde viene esa negativa, dicho con precisión: del permiso de tabla, porque al
  // cliente no se le concede `insert` sobre `contrato_estado`. La política de fila es la
  // segunda cerradura. Comprobado abriéndola del todo: esta prueba seguía verde, así que no
  // es ella la que está midiendo. Lo que esta prueba afirma —y es lo que importa— es que el
  // cliente no puede escribir aquí de ninguna manera.
  await reiniciar()
  await dentro((q) => cambiarEstado(q, {
    contratoId: CTR, a: 'suspendido', motivo: 'Parada por lluvias', finReal: '',
  }, YO, G, 'es'))

  const visto = (await comoCliente((q) => q`
    select motivo from contrato_estado where contrato_id = ${CTR}::uuid
  `)) as unknown as Array<{ motivo: string }>
  assert.equal(visto.length, 1, 'el cliente no ve el histórico de su propio contrato')
  assert.equal(visto[0]!.motivo, 'Parada por lluvias')

  await assert.rejects(
    comoCliente((q) => q`
      insert into contrato_estado (contrato_id, de, a, motivo, por)
      values (${CTR}::uuid,'suspendido','vigente','me lo reactivo yo', ${ING}::uuid)`),
    /permission denied|row-level|política|policy/i,
  )
  await reiniciar()
})

test('el histórico de OTRO cliente no se ve: la comprobación está escrita, no delegada', async () => {
  // La política de esta tabla comprueba la organización ella misma en vez de apoyarse en el
  // RLS de `contrato`. Esta prueba pregunta por una fila que existe y que el cliente no
  // debe ver, y pasaría en vano si la tabla no tuviera política propia — ya ocurrió una vez.
  await reiniciar()
  await comoLaOtra((q) => cambiarEstado(q, {
    contratoId: CTR_AJENO, a: 'suspendido', motivo: 'De la otra GPS', finReal: '',
  }, AJENO, OTRA, 'es'))

  // El cliente de este contrato ES el mismo cliente del ajeno, así que lo ve: eso es
  // correcto, es su contrato con otra GPS. Lo que no puede verlo es la OTRA GPS... al
  // contrario: lo que no puede es verlo GPS Ciclo, que no es dueña de ese contrato.
  const desdeAqui = (await dentro((q) => q`
    select count(*)::int as n from contrato_estado where contrato_id = ${CTR_AJENO}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(desdeAqui[0]!.n, 0,
    'una GPS ve el histórico de un contrato de otra GPS')

  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`delete from contrato_estado where contrato_id = ${CTR_AJENO}::uuid`
    await q`update contrato set estado = 'vigente' where id = ${CTR_AJENO}::uuid`
  })
  await reiniciar()
})

test('la pantalla sale entera en los dos idiomas', async () => {
  await reiniciar()
  const s = await dentro((q) => situacion(q, CTR, G, 'es'))
  for (const idioma of ['es', 'en'] as const) {
    const h = pintarCiclo(s!, 'CIC-001', CTR, idioma, 'af')
    assert.equal(h.includes('‹falta:'), false, `${idioma} tiene una clave sin traducir`)
    assert.match(h, /name="motivo"/, `${idioma}: falta el campo del motivo`)
    assert.match(h, /name="fin_real"/, `${idioma}: falta la fecha real de fin`)
  }
  await reiniciar()
})
