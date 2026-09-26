/**
 * Crear los hitos que faltan: la pantalla que señalaba el problema sin dar salida.
 *
 * `/medidas` tiene un bloque entero —«¿a qué renglones se les olvidó crear los
 * hitos?»— y hasta ahora era una lista de enlaces y nada más. La función que los crea
 * existía desde el principio, y la llamaba UN sitio: el alta de un contrato. Un
 * renglón llegado por otro camino se quedaba sin hitos para siempre: avance cero,
 * indistinguible de uno que no ha empezado. Octava vez que aparece la misma forma.
 *
 * Lo que más se vigila aquí no es el botón: es que `crear_hitos_desde_plantilla()` es
 * `security definer` —se salta las políticas de fila— y el identificador del renglón
 * llega de un formulario. La comprobación de a quién pertenece está en el dominio, y
 * hay una prueba que la rompe a propósito para ver que sabe fallar.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { crearHitos } from '../src/dominio/medidas.ts'
import { t } from '../src/i18n/t.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'
import { testigoAnti } from '../src/servidor/csrf.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'dd000000-0000-0000-0000-0000000000a1'
const OTRA_GPS = 'dd000000-0000-0000-0000-0000000000a2'
const OP = 'dd000000-0000-0000-0000-0000000000a3'
const YO = 'dd000000-0000-0000-0000-0000000000a4'
const AJENO = 'dd000000-0000-0000-0000-0000000000a5'
const TASA = 'dd000000-0000-0000-0000-0000000000a6'
const CTR = 'dd000000-0000-0000-0000-0000000000a7'
const CTR_AJENO = 'dd000000-0000-0000-0000-0000000000a8'
const RG = 'dd000000-0000-0000-0000-0000000000b1'
const RG_CON = 'dd000000-0000-0000-0000-0000000000b2'
const RG_AJENO = 'dd000000-0000-0000-0000-0000000000b3'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLAVE = 'una clave razonable'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

const comoMi = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

/** Como la persona de la OTRA GPS: para ella, el contrato ajeno sí es visible. */
const comoLaOtra = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: AJENO }, 'nexus_interno', f)

const pedir = (p: Partial<Peticion>) => resolver({
  metodo: 'GET', ruta: '/', campos: {}, cookie: null, idioma: 'es', archivo: null,
  origen: `o-${Math.random().toString(36).slice(2)}`, ...p,
}, YO, false)

async function entrar(correo: string): Promise<string> {
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const p1 = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
    campos: { correo, clave: CLAVE },
  }, YO, false)
  const desafio = /name="desafio" value="([^"]+)"/.exec(p1.cuerpo!)![1]!
  const p2 = await resolver({
    metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: codigoEnPaso(desdeBase32(SECRETO), pasoDe(new Date())) },
  }, YO, false)
  return new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(p2.cabeceras!['Set-Cookie']!)![1]!
}

let yo = ''

before(async () => {
  conectar(DESTINO)
  const hash = await cifrarClave(CLAVE)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Hitos','J-906400000-0'),
        ('${OTRA_GPS}','gps','Otra GPS Hitos','J-906500000-0'),
        ('${OP}','operadora','Operadora Hitos','J-906600000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto) values
              (${YO}, ${G},'crearhitos@prueba.test','Interno','clave_2fa', ${hash}, ${SECRETO}),
              (${AJENO}, ${OTRA_GPS},'crearhitos-otra@prueba.test','De otra','clave_2fa',
               ${hash}, ${SECRETO})
            on conflict (id) do update set clave_hash = excluded.clave_hash, activa = true`
    // La mesa limpia al empezar: lo que apunta a otra cosa se borra ANTES.
    await q`delete from hito where renglon_id in (${RG}, ${RG_CON}, ${RG_AJENO})`
    await q`delete from renglon where id in (${RG}, ${RG_CON}, ${RG_AJENO})`
    await q`delete from contrato where id in (${CTR}, ${CTR_AJENO})`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2027-08-03', 70.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es,
                            titulo_en, estado, moneda, monto, tasa_id, creado_por,
                            inicio, fin_previsto)
        values ('${CTR}','${G}','${OP}','HIT-1','procura','Con hitos que faltan',
                'Missing milestones','vigente','VES', 500000.00,'${TASA}','${YO}',
                '2027-08-03','2027-11-03'),
               ('${CTR_AJENO}','${OTRA_GPS}','${OP}','HIT-2','procura','De la otra',
                'Of the other one','vigente','VES', 400000.00,'${TASA}','${AJENO}',
                '2027-08-03','2027-11-03')
        on conflict (id) do update set codigo = excluded.codigo;
    `)
    await q`insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                                 unidad, cantidad, precio_unitario) values
              (${RG}, ${CTR}, 1,'Sin hitos','No milestones','und', 10, 20000.00),
              (${RG_CON}, ${CTR}, 2,'Ya con hitos','Already has','und', 5, 10000.00),
              (${RG_AJENO}, ${CTR_AJENO}, 1,'De la otra','Of the other one','und', 4, 10000.00)
            on conflict (id) do update set cantidad = excluded.cantidad`
    await q`select crear_hitos_desde_plantilla(${RG_CON}::uuid)`
  })
  yo = await entrar('crearhitos@prueba.test')
})
after(async () => { await cerrar() })

test('la pantalla lo señala Y da el botón que lo arregla', async () => {
  const r = await pedir({ ruta: '/medidas', cookie: yo })
  assert.equal(r.codigo, 200)
  assert.match(r.cuerpo ?? '', /Sin hitos/, 'el renglón sin hitos no aparece')
  assert.match(r.cuerpo ?? '', new RegExp(`name="renglon" value="${RG}"`),
    'lo señala y no ofrece forma de arreglarlo')
})

test('el botón crea los hitos, y el renglón desaparece de la lista en el acto', async () => {
  const r = await pedir({
    metodo: 'POST', ruta: '/medidas', cookie: yo,
    campos: { af: testigoAnti(yo), renglon: RG },
  })
  assert.equal(r.codigo, 200)
  assert.match(r.cuerpo ?? '', /hito\(s\) creado\(s\)/, 'no dijo qué hizo')

  const [n] = (await dentro((q) => q`
    select count(*)::int as n from hito where renglon_id = ${RG}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.ok(n!.n > 0, 'no creó ningún hito')

  // La respuesta trae la lista ya rehecha: el renglón arreglado ya no está.
  assert.doesNotMatch(r.cuerpo ?? '', new RegExp(`name="renglon" value="${RG}"`),
    'sigue en la lista de renglones sin hitos después de arreglarlo')
})

test('y las fechas planificadas salen repartidas, no todas el mismo día', async () => {
  // Una fecha estimada avisa de un retraso; una fecha vacía no avisa de nada.
  const filas = (await dentro((q) => q`
    select planificada from hito where renglon_id = ${RG}::uuid order by orden
  `)) as unknown as Array<{ planificada: Date | null }>
  assert.ok(filas.length > 1)
  const fechas = filas.map((f) => f.planificada?.toISOString().slice(0, 10) ?? null)
  assert.ok(fechas.every((f) => f !== null), 'hay hitos sin fecha planificada')
  assert.ok(new Set(fechas).size > 1, 'todos los hitos caen el mismo día')
})

test('pedirlo dos veces NO rehace nada: borraría las fechas reales', async () => {
  const antes = (await dentro((q) => q`
    select count(*)::int as n from hito where renglon_id = ${RG_CON}::uuid
  `)) as unknown as Array<{ n: number }>
  const r = await pedir({
    metodo: 'POST', ruta: '/medidas', cookie: yo,
    campos: { af: testigoAnti(yo), renglon: RG_CON },
  })
  assert.equal(r.codigo, 400)
  assert.match(r.cuerpo ?? '', /class="mal/, 'rechazó sin decir por qué')
  const despues = (await dentro((q) => q`
    select count(*)::int as n from hito where renglon_id = ${RG_CON}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(despues[0]!.n, antes[0]!.n, 'rehizo los hitos de un renglón que ya los tenía')
})

test('la política de fila ya tapa el contrato de otra organización', async () => {
  // Esta prueba comprueba la PRIMERA cerradura, y conviene decir cuál es: preguntando
  // como alguien de esta GPS, la fila del contrato ajeno no existe, así que el
  // dominio no llega ni a comparar nada. Quitar la comprobación del dominio no la
  // hace fallar —se comprobó quitándola—, y por eso hay una segunda prueba debajo.
  const r = await comoMi((q) => crearHitos(q, RG_AJENO, G, 'es'))
  assert.equal(r.hecho, false)
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from hito where renglon_id = ${RG_AJENO}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 0, 'creó hitos en el contrato de otra organización')
})

test('y si la fila SÍ se ve, la comprobación del dominio la para igual', async () => {
  // Aquí se pregunta como la persona de la otra GPS: para ella el renglón ajeno es
  // suyo y la política de fila lo deja pasar. Lo único que queda entre un campo de
  // formulario y el contrato de otro es la comparación con la organización de quien
  // pide — y hace falta, porque `crear_hitos_desde_plantilla()` es `security definer`
  // y ESCRIBE saltándose las políticas de fila.
  //
  // Es la prueba que la versión anterior no tenía: unía con la tabla protegida y por
  // eso pasaba con la valla quitada.
  const r = await comoLaOtra((q) => crearHitos(q, RG_AJENO, G, 'es'))
  assert.equal(r.hecho, false,
    'la comprobación de a quién pertenece el renglón no está sujetando nada')
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from hito where renglon_id = ${RG_AJENO}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 0, 'escribió en el contrato de otra organización')
})

test('y por HTTP tampoco, que es por donde llega de verdad', async () => {
  const r = await pedir({
    metodo: 'POST', ruta: '/medidas', cookie: yo,
    campos: { af: testigoAnti(yo), renglon: RG_AJENO },
  })
  assert.equal(r.codigo, 400)
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from hito where renglon_id = ${RG_AJENO}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 0, 'un formulario escribió en el contrato de otra organización')
})

test('un renglón que no existe da el MISMO error que uno que no te toca', async () => {
  const inventado = await comoMi((q) => crearHitos(
    q, '00000000-0000-0000-0000-000000000000', G, 'es'))
  const ajeno = await comoMi((q) => crearHitos(q, RG_AJENO, G, 'es'))
  assert.equal(inventado.hecho, false)
  assert.equal(ajeno.hecho, false)
  assert.equal(
    inventado.hecho === false ? inventado.motivo : '',
    ajeno.hecho === false ? ajeno.motivo : 'x',
    'la diferencia ya dice que existe un renglón que no es tuyo')
})

test('sin el testigo antifalsificación no pasa, y no escribe nada', async () => {
  const [antes] = (await dentro((q) => q`
    select count(*)::int as n from hito where renglon_id = ${RG_AJENO}::uuid
  `)) as unknown as Array<{ n: number }>
  const r = await pedir({
    metodo: 'POST', ruta: '/medidas', cookie: yo, campos: { renglon: RG },
  })
  assert.equal(r.codigo, 403)
  const [despues] = (await dentro((q) => q`
    select count(*)::int as n from hito where renglon_id = ${RG_AJENO}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(despues!.n, antes!.n)
})

test('un tipo de contrato sin plantilla lo DICE, y lo dice por ESO', async () => {
  // Esta prueba llevaba dos vidas sin comprobar nada.
  //
  // La primera buscaba un tipo de contrato sin plantilla y, al no encontrar ninguno —los
  // cinco la tienen desde el primer día—, afirmaba `true` y salía. La segunda vaciaba la
  // plantilla a propósito, que era lo que faltaba, pero se la pedía a un renglón que YA
  // tenía hitos: `crearHitos` lo rechazaba por eso, y la prueba pasaba igual con el
  // borrado desactivado. Comprobado desactivándolo.
  //
  // De ahí las dos cosas que hace ahora: el renglón es el que no tiene hitos, y lo que se
  // afirma es CUÁL de los cinco rechazos vuelve. Un `hecho === false` no dice nada cuando
  // hay cinco maneras distintas de ser falso.
  //
  // Y todo dentro de una transacción que se deshace: `plantilla_hito` es la misma tabla
  // para todos los archivos de prueba, que corren a la vez.
  class Deshacer extends Error {}
  try {
    await dentro(async (q) => {
      await q`update contrato set tipo = 'alquiler'::tipo_contrato
               where id = ${CTR}::uuid`
      await q`delete from plantilla_hito where tipo = 'alquiler'::tipo_contrato`
      // Un renglón nuevo, y no uno de los de arriba: las pruebas de este archivo corren
      // en orden y les han ido saliendo hitos, así que `RG` tampoco estaba limpio a
      // estas alturas. Nace aquí dentro y se va con la transacción.
      const [nuevo] = (await q`
        insert into renglon (contrato_id, numero, descripcion_es, descripcion_en,
                             unidad, cantidad, precio_unitario)
        values (${CTR}::uuid, 99,'Recién nacido','Newborn','und', 1, 1000.00)
        returning id`) as unknown as Array<{ id: string }>
      const r = await crearHitos(q, nuevo!.id, G, 'es')
      assert.equal(r.hecho, false, 'creó hitos sin plantilla de la que sacarlos')
      assert.equal((r as { motivo: string }).motivo, t('es', 'plantilla.error.sin_plantilla'),
        'lo rechazó, pero por otra cosa: la prueba no está comprobando la plantilla')
      throw new Deshacer()
    })
  } catch (e) {
    if (!(e instanceof Deshacer)) throw e
  }
})
