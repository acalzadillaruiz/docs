/**
 * El libro diario.
 *
 * Es la pantalla donde termina de abrirse cualquier cifra del sistema. Todas las
 * demás enseñan algo derivado; debajo de un asiento no hay nada más.
 *
 * Lo que se comprueba aquí: que el mes cuadre de verdad, que se vea lo que en otros
 * sitios no se ve —cuánto tardó el hecho en llegar y si el asiento fue reversado—, y
 * que el debe y el haber salgan en columnas distintas aunque por dentro sean un solo
 * campo con signo.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { diario } from '../src/dominio/diario.ts'
import { pintarDiario } from '../src/pantallas/diario.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'e4f5a6b7-0000-0000-0000-00000000000a'
const YO = 'e4f5a6b7-0000-0000-0000-00000000000d'
const TASA = 'e4f5a6b7-1111-0000-0000-00000000000a'
const A1 = 'e4f5a6b7-2222-0000-0000-00000000000a'
const A2 = 'e4f5a6b7-2222-0000-0000-00000000000b'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif)
        values ('${G}','gps','GPS Diario','J-903400000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'diario@prueba.test','Contador','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-12-01', 55.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      select instalar_plan_cuentas('${G}');
      insert into periodo (organizacion_id, anio, mes) values ('${G}', 2026, 12)
        on conflict do nothing;
    `)
    const [hay] = (await q`
      select count(*)::int as n from asiento where organizacion_id = ${G}::uuid
    `) as unknown as Array<{ n: number }>
    if (Number(hay?.n ?? 0) === 0) {
      await q.unsafe(`
        insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                             descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
          values ('${A1}','${G}', siguiente_asiento('${G}'),'2026-12-03', 2026, 12,
                  'Aporte de capital','Capital contribution','aporte','${A1}','${YO}');
        insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves,
                             monto_usd, tasa_id) values
          ('${A1}', 1,'${G}','1.1.01.02', 3000000.00, 54545.45,'${TASA}'),
          ('${A1}', 2,'${G}','3.1.01', -3000000.00, -54545.45,'${TASA}');
        -- Un segundo asiento que despues se reversa, para ver las dos marcas.
        insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                             descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
          values ('${A2}','${G}', siguiente_asiento('${G}'),'2026-12-10', 2026, 12,
                  'Gasto mal imputado','Misposted expense','aporte','${A2}','${YO}');
        insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves,
                             monto_usd, tasa_id) values
          ('${A2}', 1,'${G}','5.2.01', 100000.00, 1818.18,'${TASA}'),
          ('${A2}', 2,'${G}','1.1.01.02', -100000.00, -1818.18,'${TASA}');
        select reversar_asiento('${A2}','${YO}','estaba en la cuenta equivocada');
      `)
    }
  })
})
after(async () => { await cerrar() })

test('el mes CUADRA: todas las líneas suman cero', async () => {
  // Es la comprobación que da sentido a las demás. Si no cuadra, hay un asiento a
  // medias y ninguna cifra del sistema se sostiene.
  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  assert.equal(d.cuadra, true, `descuadre de ${d.descuadre}`)
  assert.ok(d.apuntes.length >= 3, 'faltan asientos: el aporte, el gasto y su reverso')
})

test('el debe y el haber salen en columnas distintas', async () => {
  // Por dentro es un solo campo con signo —no se pueden tener las dos cosas—, pero
  // un contador lee dos columnas.
  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  const aporte = d.apuntes.find((a) => a.descripcion.includes('Aporte'))!
  const debe = aporte.lineas.filter((l) => l.debe !== '')
  const haber = aporte.lineas.filter((l) => l.haber !== '')
  assert.equal(debe.length, 1)
  assert.equal(haber.length, 1)
  // Y el haber se enseña en positivo: «-3.000.000» en una columna llamada «Haber»
  // es leer dos veces el mismo signo.
  assert.doesNotMatch(haber[0]!.haber, /-/)
})

test('un asiento reversado y su reverso salen los DOS, marcados', async () => {
  // Un asiento no se borra ni se edita: se contrapone. Los dos se quedan en el libro,
  // y quien mire dentro de dos años tiene que poder ver cuál es cuál.
  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  assert.ok(d.apuntes.some((a) => a.reversado), 'no se marca el asiento anulado')
  assert.ok(d.apuntes.some((a) => a.esReverso), 'no se marca el reverso')
  const h = pintarDiario(d, 'es', 'af')
  assert.match(h, /Es un reverso/)
  assert.match(h, /class="as anulado"/)
})

test('se ve cuándo ocurrió y cuándo se supo, que son dos fechas', async () => {
  // La diferencia entre las dos es la medida de «tiempo hasta la verdad».
  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  const a = d.apuntes[0]!
  assert.ok(a.ocurrido.length > 0 && a.registrado.length > 0)
  assert.ok(a.tardanza >= 0, 'la tardanza nunca es negativa')
  const h = pintarDiario(d, 'es', 'af')
  assert.match(h, /Ocurrió/)
  assert.match(h, /Se supo/)
})

test('cada asiento sale ENTERO, con sus líneas, sin tener que pinchar', async () => {
  // Un contador no busca un asiento: los recorre. Obligarle a abrir treinta
  // pantallas para leer un mes es lo que hace que acabe pidiendo una exportación.
  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  for (const a of d.apuntes) {
    assert.ok(a.lineas.length >= 2, `el asiento #${a.numero} salió sin sus líneas`)
  }
  const h = pintarDiario(d, 'es', 'af')
  assert.doesNotMatch(h, /href="\/asientos\//, 'no debería hacer falta pinchar')
})

test('un mes sin asientos lo dice', async () => {
  const d = await dentro((q) => diario(q, G, 2019, 5, 'es'))
  assert.equal(d.apuntes.length, 0)
  assert.match(pintarDiario(d, 'es', 'af'), /No hay ningún asiento en ese mes/)
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const d = await dentro((q) => diario(q, G, 2026, 12, 'en'))
  const h = pintarDiario(d, 'en', 'af')
  assert.match(h, /General journal/)
  assert.match(h, /Recorded/)
  assert.doesNotMatch(h, /Libro diario/)
  assert.doesNotMatch(h, /undefined/)
})
