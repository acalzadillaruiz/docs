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
  })
})
after(async () => { await cerrar() })

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
