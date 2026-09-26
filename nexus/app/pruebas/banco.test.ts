/**
 * Conciliación bancaria.
 *
 * La máquina propone; casar lo hace una persona. Una conciliación automática que se
 * equivoca una vez al mes es peor que ninguna: se deja de revisar y el error se
 * descubre en la auditoría.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { conciliacion, casar, aceptarConNota } from '../src/dominio/banco.ts'
import { pintarBanco } from '../src/pantallas/banco.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '9a0b1c2d-0000-0000-0000-00000000000a'
const C = '9a0b1c2d-0000-0000-0000-00000000000b'
const YO = '9a0b1c2d-0000-0000-0000-00000000000d'
const ING = '9a0b1c2d-0000-0000-0000-00000000000e'
const TASA = '9a0b1c2d-1111-0000-0000-00000000000a'
const IVA = '9a0b1c2d-1111-0000-0000-00000000000b'
const CTR = '9a0b1c2d-2222-0000-0000-00000000000a'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

const DESDE = '2026-04-01'
const HASTA = '2026-04-30'

/** Un cobro suelto, del importe y la fecha que se pidan. */
async function cobro(monto: number, fecha: string): Promise<string> {
  const id = randomUUID()
  const val = randomUUID()
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`
      insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde,
        periodo_hasta, obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
        concepto_islr, ret_iva_pct, estado, aprobada_el, aprobada_por, creada_por)
      values (${val}::uuid, ${G}::uuid, ${CTR}::uuid, ${Math.floor(Math.random() * 1000000)},
        ${DESDE}::date, ${HASTA}::date, ${monto}, 'VES', ${TASA}::uuid, 0, 0, ${IVA}::uuid,
        'SERV-PJ', 0,'aprobada', ${fecha}::date, ${ING}::uuid, ${YO}::uuid)`
    await q`
      insert into cobro (id, organizacion_id, valuacion_id, fecha, medio, moneda, monto,
                         tasa_id, referencia, registrado_por)
      values (${id}::uuid, ${G}::uuid, ${val}::uuid, ${fecha}::date,'transferencia','VES',
              ${monto}, ${TASA}::uuid,'REF-' || ${String(monto)}, ${YO}::uuid)`
  })
  return id
}

/** Un movimiento del extracto, tal como viene del banco. */
async function movimiento(monto: number, fecha: string, desc: string): Promise<string> {
  const id = randomUUID()
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`
      insert into movimiento_banco (id, organizacion_id, cuenta, fecha, monto, moneda,
                                    descripcion, referencia)
      values (${id}::uuid, ${G}::uuid,'0102-0000', ${fecha}::date,
              ${monto},'VES', ${desc},'X')`
  })
  return id
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Banco','J-901600000-0'),
        ('${C}','operadora','Operadora Banco','J-901700000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'banco@prueba.test','Interno','clave_2fa','(h)','(s)'),
                   (${ING}, ${C},'banco-cli@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-04-06', 40.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2018-01-05') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00)
        on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut,
                                 minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01')
        on conflict do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR}','${G}','${C}','BAN-001','servicio','Servicio','Service',
                'vigente','VES', 50000000.00,'${TASA}','${YO}')
        on conflict (id) do update set codigo = excluded.codigo;
      delete from movimiento_banco where organizacion_id = '${G}';
    `)
  })
})
after(async () => { await cerrar() })

test('la máquina PROPONE: mismo importe y a pocos días', async () => {
  await cobro(123456.78, '2026-04-10')
  const m = await movimiento(123456.78, '2026-04-12', 'TRANSF RECIBIDA')

  const c = await dentro((q) => conciliacion(q, G, DESDE, HASTA, 'es'))
  const p = c.propuestas.find((x) => x.movimiento === m)
  assert.ok(p, 'tenía que proponerlo')
  assert.equal(p!.casaCon, 'cobro')
  // Un casamiento del mismo día es casi seguro; uno de cuatro merece una mirada, y
  // sin ese dato los dos se ven igual.
  assert.equal(p!.dias, 2)
})

test('pero NO casa nada sola: hasta que alguien pulsa, sigue descuadrado', async () => {
  await cobro(222333.44, '2026-04-10')
  const m = await movimiento(222333.44, '2026-04-10', 'OTRA TRANSF')

  const c = await dentro((q) => conciliacion(q, G, DESDE, HASTA, 'es'))
  assert.ok(c.propuestas.some((x) => x.movimiento === m))
  // Dos movimientos del mismo importe el mismo día son más frecuentes de lo que
  // parece: casar es de un humano.
  assert.ok(c.descuadres.some((d) => d.id === m && d.esDelBanco))
})

test('casar lo quita de los dos lados', async () => {
  const co = await cobro(555666.77, '2026-04-15')
  const m = await movimiento(555666.77, '2026-04-15', 'TRANSF')

  assert.deepEqual(await dentro((q) => casar(q, m, 'cobro', co, YO, 'es')), { hecho: true })

  const c = await dentro((q) => conciliacion(q, G, DESDE, HASTA, 'es'))
  assert.equal(c.descuadres.some((d) => d.id === m), false)
  assert.equal(c.descuadres.some((d) => d.id === co), false)
})

test('no se casa dos veces el mismo movimiento', async () => {
  const co = await cobro(777888.99, '2026-04-16')
  const m = await movimiento(777888.99, '2026-04-16', 'TRANSF')
  await dentro((q) => casar(q, m, 'cobro', co, YO, 'es'))
  const otra = await dentro((q) => casar(q, m, 'cobro', co, YO, 'es'))
  assert.equal(otra.hecho, false)
  assert.match((otra as { motivo: string }).motivo, /ya está conciliado/)
})

test('un cobro ya casado no se puede casar con otro movimiento', async () => {
  const co = await cobro(111222.33, '2026-04-17')
  const uno = await movimiento(111222.33, '2026-04-17', 'TRANSF A')
  const dos = await movimiento(111222.33, '2026-04-17', 'TRANSF B')
  await dentro((q) => casar(q, uno, 'cobro', co, YO, 'es'))

  const r = await dentro((q) => casar(q, dos, 'cobro', co, YO, 'es'))
  assert.equal(r.hecho, false)
  // Decir solo «no se pudo» deja a alguien mirando la pantalla sin saber qué hacer.
  assert.match((r as { motivo: string }).motivo, /ya está casado con otro/)
})

test('lo que no casa NO SE ESCONDE, a los dos lados', async () => {
  await cobro(999111.22, '2026-04-20')                       // solo en la contabilidad
  const m = await movimiento(-45000, '2026-04-21', 'COMISION BANCARIA')  // solo en el banco

  const c = await dentro((q) => conciliacion(q, G, DESDE, HASTA, 'es'))
  const soloBanco = c.descuadres.filter((d) => d.esDelBanco)
  const soloLibro = c.descuadres.filter((d) => !d.esDelBanco)
  assert.ok(soloBanco.some((d) => d.id === m))
  assert.ok(soloLibro.length > 0)
})

test('aceptar sin casar EXIGE decir por qué, por escrito', async () => {
  const m = await movimiento(-1234.56, '2026-04-22', 'COMISION')
  const sin = await dentro((q) => aceptarConNota(q, m, '   ', YO, 'es'))
  assert.equal(sin.hecho, false)
  assert.match((sin as { motivo: string }).motivo, /por qué/)

  const con = await dentro((q) => aceptarConNota(q, m, 'Comisión mensual del banco', YO, 'es'))
  assert.equal(con.hecho, true)

  const [g] = (await dentro((q) => q`
    select nota, conciliado_en from movimiento_banco where id = ${m}::uuid
  `)) as unknown as Array<{ nota: string; conciliado_en: Date | null }>
  // Un movimiento aceptado sin explicación es un descuadre que desaparece de la
  // pantalla sin haberse resuelto.
  assert.equal(g!.nota, 'Comisión mensual del banco')
  assert.notEqual(g!.conciliado_en, null)
})

test('la pantalla pone los descuadres DESPUÉS de las propuestas, y los distingue', async () => {
  const c = await dentro((q) => conciliacion(q, G, DESDE, HASTA, 'es'))
  const h = pintarBanco(c, 'es', 'af-prueba')
  // Primero lo que se despacha rápido; después lo que nadie quiere mirar.
  assert.ok(h.indexOf('banco.propuestas') < 0)
  assert.match(h, /class="mv banco"|class="mv libro"/)
  assert.match(h, /la parte que nadie quiere mirar/)
})

test('solo los movimientos del banco ofrecen la nota; los del libro no', async () => {
  const c = await dentro((q) => conciliacion(q, G, DESDE, HASTA, 'es'))
  const h = pintarBanco(c, 'es', 'af')
  const notas = (h.match(/name="accion" value="nota"/g) ?? []).length
  const delBanco = c.descuadres.filter((d) => d.esDelBanco).length
  // Un cobro que el banco no tiene no se arregla con una nota: se arregla mirando
  // por qué se registró un cobro que nunca entró.
  assert.equal(notas, delBanco)
})

test('el cliente no llega a la conciliación', async () => {
  await assert.rejects(
    comoPersona({ id: ING }, 'nexus_cliente', (q) => conciliacion(q, G, DESDE, HASTA, 'es')),
    /permission denied|no existe/,
  )
})

// ===========================================================================
// «Todo cuadra» dicho sobre nada.
//
// Sin extracto traído, las dos listas salen vacías y la pantalla decía **«Todo cuadra
// en este periodo»**. No cuadraba: es que nadie había mirado. Es la misma confusión
// que este sistema entero existe para no cometer —dar por hallazgo la ausencia de
// uno—, cometida en su propia pantalla de contabilidad.
//
// Y el arreglo tiene dos mitades, porque una sin la otra no sirve: decirlo, y dar el
// camino para traerlo. El texto del enlace («Traer el extracto») llevaba escrito en
// los dos idiomas desde el primer día sin que ninguna pantalla lo usara.

/** Un mes en el que no se ha traído nada. Se elige lejos de lo que siembra el resto. */
const VACIO_DESDE = '2026-09-01'
const VACIO_HASTA = '2026-09-30'

test('un periodo SIN extracto no dice que cuadra: dice que no se ha mirado', async () => {
  const c = await dentro((q) => conciliacion(q, G, VACIO_DESDE, VACIO_HASTA, 'es'))
  assert.equal(c.movimientos, 0, 'el mes de prueba no estaba vacío')
  assert.equal(c.descuadres.length, 0)

  const h = pintarBanco(c, 'es', 'af')
  assert.doesNotMatch(h, /Todo cuadra/,
    'dice que cuadra un periodo del que no se ha traído nada')
  assert.match(h, /no se ha traído ningún extracto/)
})

test('y da el camino para traerlo, que sin eso el aviso no sirve de nada', async () => {
  const c = await dentro((q) => conciliacion(q, G, VACIO_DESDE, VACIO_HASTA, 'es'))
  const h = pintarBanco(c, 'es', 'af')
  assert.match(h, /href="\/importar"/,
    'avisa de que falta el extracto y no dice por dónde se trae')
  assert.match(h, /Traer el extracto/)
})

test('en inglés lo dice igual de claro', async () => {
  const c = await dentro((q) => conciliacion(q, G, VACIO_DESDE, VACIO_HASTA, 'en'))
  const h = pintarBanco(c, 'en', 'af')
  assert.match(h, /No statement has been imported/)
  assert.match(h, /Import the statement/)
  assert.doesNotMatch(h, /Everything matches/)
})

test('con extracto traído y todo casado, entonces SÍ dice que cuadra', async () => {
  // La otra mitad de la afirmación: si la pantalla nunca dijera «cuadra», el aviso
  // de arriba no distinguiría nada. Lo que se arregló es que diga cada cosa cuando
  // toca, no que deje de decir una de las dos.
  const c = await dentro((q) => conciliacion(q, G, DESDE, HASTA, 'es'))
  assert.ok(c.movimientos > 0, 'el periodo sembrado no tiene movimientos del banco')

  const sinDescuadres = { ...c, descuadres: [], propuestas: [] }
  const h = pintarBanco(sinDescuadres, 'es', 'af')
  assert.match(h, /Todo cuadra/)
  assert.doesNotMatch(h, /no se ha traído ningún extracto/)
})

test('y dice cuántos movimientos hay y cuántos van conciliados', async () => {
  // Un número pequeño que cambia la lectura entera: cuatro movimientos y uno casado
  // no es lo mismo que cuatro y cuatro, y sin el dato las dos pantallas se ven igual.
  const c = await dentro((q) => conciliacion(q, G, DESDE, HASTA, 'es'))
  const h = pintarBanco(c, 'es', 'af')
  assert.match(h, new RegExp(`${c.movimientos} movimiento`))
  assert.match(h, new RegExp(`${c.conciliados} ya conciliado`))
  assert.ok(c.conciliados <= c.movimientos)
})
