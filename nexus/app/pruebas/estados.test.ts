/**
 * Los estados contables.
 *
 * Cuatro informes que estaban construidos y probados y no los enseñaba ninguna
 * pantalla: balance general, balance de comprobación, antigüedad de la cartera y lo
 * que hay por pagar. El primero es literalmente el documento que pide un banco.
 *
 * La aritmética ya la prueban `08-estados.sql`, `09-cobros.sql` y `14-pagos.sql`.
 * Aquí se comprueba lo que decide esta capa: que un balance que no balancea se avise
 * ANTES de enseñar nada, que la antigüedad se vea de un vistazo, y que lo que nos
 * deben y lo que debemos vayan juntos.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { estados } from '../src/dominio/estados.ts'
import { pintarEstados } from '../src/pantallas/estados.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'd3e4f5a6-0000-0000-0000-00000000000a'
const C = 'd3e4f5a6-0000-0000-0000-00000000000b'
const YO = 'd3e4f5a6-0000-0000-0000-00000000000d'
const TASA = 'd3e4f5a6-1111-0000-0000-00000000000a'
const ASI = 'd3e4f5a6-2222-0000-0000-00000000000a'
// Un mes aparte para el balance CON resultado. No en el mismo que el aporte: las pruebas
// de arriba cuentan el activo y el patrimonio exactos de noviembre, y meterles una venta
// dentro las haría fallar por algo que no es el fallo.
const VTA = 'd3e4f5a6-2222-0000-0000-00000000000b'
const CST = 'd3e4f5a6-2222-0000-0000-00000000000c'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Estados','J-903200000-0'),
        ('${C}','operadora','Operadora Estados','J-903300000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'estados@prueba.test','Contador','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-11-02', 50.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      select instalar_plan_cuentas('${G}');
      insert into periodo (organizacion_id, anio, mes) values ('${G}', 2026, 11)
        on conflict do nothing;
      insert into periodo (organizacion_id, anio, mes) values ('${G}', 2026, 12)
        on conflict do nothing;
    `)
    const [hay] = (await q`
      select count(*)::int as n from asiento asi
       where asi.organizacion_id = ${G}::uuid and asi.reversa_a is null
         and not exists (select 1 from asiento rev where rev.reversa_a = asi.id)
    `) as unknown as Array<{ n: number }>
    if (Number(hay?.n ?? 0) === 0) {
      // Un aporte de capital: 2.000.000 al banco contra patrimonio. Con esto el
      // balance tiene activo y patrimonio y TIENE que balancear.
      await q.unsafe(`
        insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                             descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
          values ('${ASI}','${G}', siguiente_asiento('${G}'),'2026-11-02', 2026, 11,
                  'Aporte','Contribution','aporte','${ASI}','${YO}');
        insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves,
                             monto_usd, tasa_id) values
          ('${ASI}', 1,'${G}','1.1.01.02', 2000000.00, 40000.00,'${TASA}'),
          ('${ASI}', 2,'${G}','3.1.01', -2000000.00, -40000.00,'${TASA}');
      `)
    }
    // Y en DICIEMBRE, una venta y un costo. Esto es lo que le faltaba a este archivo: con
    // solo el aporte de capital, el balance balanceaba sin necesitar el resultado del
    // ejercicio, y la comprobación de que balancea pasaba sin poder fallar. Con ganancia
    // dentro, el activo NO iguala al pasivo más el patrimonio salvo que el balance incluya
    // el resultado — que es exactamente lo que no incluía.
    const [dic] = (await q`
      select count(*)::int as n from asiento where id = ${VTA}::uuid
    `) as unknown as Array<{ n: number }>
    if (Number(dic?.n ?? 0) === 0) {
      await q.unsafe(`
        insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                             descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
          values ('${VTA}','${G}', siguiente_asiento('${G}'),'2026-12-10', 2026, 12,
                  'Venta','Sale','prueba','${VTA}','${YO}');
        insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves,
                             monto_usd, tasa_id) values
          ('${VTA}', 1,'${G}','1.1.02.01', 1000000.00, 20000.00,'${TASA}'),
          ('${VTA}', 2,'${G}','4.1.02',   -1000000.00,-20000.00,'${TASA}');
        insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                             descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
          values ('${CST}','${G}', siguiente_asiento('${G}'),'2026-12-11', 2026, 12,
                  'Costo','Cost','prueba','${CST}','${YO}');
        insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves,
                             monto_usd, tasa_id) values
          ('${CST}', 1,'${G}','5.2.01',     300000.00,  6000.00,'${TASA}'),
          ('${CST}', 2,'${G}','2.1.01.01', -300000.00, -6000.00,'${TASA}');
      `)
    }
  })
})
after(async () => { await cerrar() })

test('CON GANANCIA DENTRO el balance sigue balanceando. Antes no', async () => {
  // El aviso «el balance no balancea por X» salía en la instantánea publicada, con X igual
  // a la ganancia del periodo, sobre un libro que cuadraba exacto. Acusaba de un asiento a
  // medias a un libro impecable — y un aviso que salta sin que pase nada deja de leerse.
  const e = await dentro((q) => estados(q, G, 'es', '2026-12-31'))
  assert.equal(e.cuadra, true, `descuadre de ${e.descuadre}`)
  const activo = e.secciones.find((s) => s.cual === 'activo')!
  const pasivo = e.secciones.find((s) => s.cual === 'pasivo')!
  const patrim = e.secciones.find((s) => s.cual === 'patrimonio')!
  // Banco 2.000.000 + clientes 1.000.000 = 3.000.000 de activo.
  // Proveedores 300.000 de pasivo. Capital 2.000.000 + ganancia 700.000 de patrimonio.
  assert.equal(activo.totalCrudo, 3000000)
  assert.equal(pasivo.totalCrudo, 300000)
  assert.equal(patrim.totalCrudo, 2700000)
})

test('y el resultado del ejercicio sale como una línea del patrimonio', async () => {
  const e = await dentro((q) => estados(q, G, 'es', '2026-12-31'))
  const patrim = e.secciones.find((s) => s.cual === 'patrimonio')!
  const res = patrim.lineas.find((l) => l.codigo === '3.1.04')
  assert.ok(res, 'el resultado del ejercicio no aparece en el patrimonio')
  // Ingresos 1.000.000 menos gastos 300.000. La misma cifra que da la pantalla de gerencia:
  // si estas dos no coinciden, hay dos verdades sobre la ganancia del mes.
  assert.match(res!.monto, /700\.000,00/, `salió ${res!.monto}`)
})

test('y la pantalla dice que esa línea es calculada, no asentada', async () => {
  // Si no lo dijera, alguien abriría el mayor de esa cuenta, lo encontraría vacío, y a
  // partir de ahí no se creería ninguna de las dos cosas.
  const e = await dentro((q) => estados(q, G, 'es', '2026-12-31'))
  const h = pintarEstados(e, 'es', 'af')
  assert.match(h, /no está asentado/, 'no se avisa de que el resultado es calculado')
  const en = pintarEstados(await dentro((q) => estados(q, G, 'en', '2026-12-31')), 'en', 'af')
  assert.match(en, /is not posted/, 'y en inglés tampoco')
})

test('el balance BALANCEA: activo igual a pasivo más patrimonio', async () => {
  // Es la comprobación que da sentido a todas las demás.
  const e = await dentro((q) => estados(q, G, 'es', '2026-11-30'))
  assert.equal(e.cuadra, true, `descuadre de ${e.descuadre}`)
  const activo = e.secciones.find((s) => s.cual === 'activo')!
  const patrim = e.secciones.find((s) => s.cual === 'patrimonio')!
  assert.equal(activo.totalCrudo, 2000000)
  assert.equal(patrim.totalCrudo, 2000000)
})

test('si no balancea se avisa ARRIBA, antes de ninguna cifra', async () => {
  // Enseñar un balance descuadrado sin avisar es peor que no enseñarlo.
  const e = await dentro((q) => estados(q, G, 'es', '2026-11-30'))
  const falso = { ...e, cuadra: false, descuadre: '1.000,00 Bs' }
  const h = pintarEstados(falso, 'es', 'af')
  assert.match(h, /class="aviso"/)
  assert.ok(h.indexOf('class="aviso"') < h.indexOf('Balance general'))
  assert.doesNotMatch(pintarEstados(e, 'es', 'af'), /class="aviso"/)
})

test('el balance de comprobación enseña el debe y el haber de cada cuenta', async () => {
  const e = await dentro((q) => estados(q, G, 'es', '2026-11-30'))
  assert.ok(e.comprobacion.length >= 2, 'faltan cuentas en la comprobación')
  const banco = e.comprobacion.find((c) => c.codigo === '1.1.01.02')
  assert.ok(banco, 'no aparece la cuenta del banco')
  assert.match(banco!.debe, /2\.000\.000,00/)
})

test('la antigüedad se marca por tramos, no por número de días', async () => {
  // 120 días no es lo mismo que 20 aunque el importe sea igual, y leyendo números
  // eso no salta a la vista.
  const e = await dentro((q) => estados(q, G, 'es', '2026-11-30'))
  const conTramos = {
    ...e,
    cobrar: [
      { quien: 'A', referencia: 'X', contrato: null, desde: '2026-11-01', dias: 10,
        saldo: '10,00', saldoCrudo: 10, tramo: '0-30' as const },
      { quien: 'B', referencia: 'Y', contrato: null, desde: '2026-06-01', dias: 150,
        saldo: '20,00', saldoCrudo: 20, tramo: '90+' as const },
    ],
  }
  const h = pintarEstados(conTramos, 'es', 'af')
  assert.match(h, /class="tr ok"/, 'falta el tramo reciente')
  assert.match(h, /class="tr mal"/, 'falta el tramo de más de 90 días')
})

test('lo que nos deben y lo que debemos salen JUNTOS', async () => {
  // Mirar solo el cobro es como se decide gastar un dinero ya comprometido.
  const e = await dentro((q) => estados(q, G, 'es', '2026-11-30'))
  const h = pintarEstados(e, 'es', 'af')
  assert.match(h, /Lo que nos deben/)
  assert.match(h, /Lo que debemos/)
  assert.match(h, /class="dos"/)
})

test('una fecha sin nada lo dice, y no enseña un balance vacío', async () => {
  const e = await dentro((q) => estados(q, G, 'es', '2019-01-01'))
  const h = pintarEstados(e, 'es', 'af')
  assert.match(h, /No hay ningún asiento a esa fecha/)
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const e = await dentro((q) => estados(q, G, 'en', '2026-11-30'))
  const h = pintarEstados(e, 'en', 'af')
  assert.match(h, /Balance sheet/)
  assert.match(h, /Trial balance/)
  assert.doesNotMatch(h, /Balance general/)
  assert.doesNotMatch(h, /undefined/)
})
