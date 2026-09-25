/**
 * El mayor de una cuenta.
 *
 * El diario recorre el TIEMPO; el mayor recorre una CUENTA. Contestan preguntas
 * distintas, y la del mayor —«¿por qué el banco tiene exactamente este saldo?»— es la
 * que se hace cuando algo no cuadra. Hasta ahora no tenía dónde contestarse: había
 * que pedirle a alguien que mirara la base de datos.
 *
 * Lo que se comprueba: que el saldo arrastrado sea el de la base de datos y no uno
 * sumado aquí, que solo se ofrezcan cuentas con movimiento, y que una cuenta
 * inventada por la dirección no rompa nada.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { mayor, cuentasConMovimiento } from '../src/dominio/mayor.ts'
import { pintarMayor } from '../src/pantallas/mayor.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'f5a6b7c8-0000-0000-0000-00000000000a'
const YO = 'f5a6b7c8-0000-0000-0000-00000000000d'
const TASA = 'f5a6b7c8-1111-0000-0000-00000000000a'
const A1 = 'f5a6b7c8-2222-0000-0000-00000000000a'
const A2 = 'f5a6b7c8-2222-0000-0000-00000000000b'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif)
        values ('${G}','gps','GPS Mayor','J-903500000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'mayor@prueba.test','Contador','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2027-01-04', 60.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      select instalar_plan_cuentas('${G}');
      insert into periodo (organizacion_id, anio, mes) values ('${G}', 2027, 1)
        on conflict do nothing;
    `)
    const [hay] = (await q`
      select count(*)::int as n from asiento where organizacion_id = ${G}::uuid
    `) as unknown as Array<{ n: number }>
    if (Number(hay?.n ?? 0) === 0) {
      // Entran 5.000.000 y salen 2.000.000: el banco queda en 3.000.000. Tres cifras
      // que se pueden seguir con el dedo.
      await q.unsafe(`
        insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                             descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
          values ('${A1}','${G}', siguiente_asiento('${G}'),'2027-01-05', 2027, 1,
                  'Aporte','Contribution','aporte','${A1}','${YO}'),
                 ('${A2}','${G}', siguiente_asiento('${G}') + 1,'2027-01-20', 2027, 1,
                  'Pago de sueldos','Payroll','aporte','${A2}','${YO}');
        insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves,
                             monto_usd, tasa_id) values
          ('${A1}', 1,'${G}','1.1.01.02', 5000000.00, 83333.33,'${TASA}'),
          ('${A1}', 2,'${G}','3.1.01', -5000000.00, -83333.33,'${TASA}'),
          ('${A2}', 1,'${G}','5.2.01', 2000000.00, 33333.33,'${TASA}'),
          ('${A2}', 2,'${G}','1.1.01.02', -2000000.00, -33333.33,'${TASA}');
      `)
    }
  })
})
after(async () => { await cerrar() })

test('el saldo se arrastra línea a línea y acaba donde debe', async () => {
  // 5.000.000 entran, 2.000.000 salen: quedan 3.000.000. Es la pregunta entera.
  const m = await dentro((q) => mayor(q, G, '1.1.01.02', '2027-01-01', '2027-01-31', 'es'))
  assert.equal(m.movimientos.length, 2)
  assert.equal(m.movimientos[0]!.saldoCrudo, 5000000)
  assert.equal(m.movimientos[1]!.saldoCrudo, 3000000)
  assert.equal(m.saldoFinalCrudo, 3000000)
})

test('el debe y el haber van en columnas, y la que no toca va VACÍA', async () => {
  // Un cero en una columna de importes se lee como un importe.
  const m = await dentro((q) => mayor(q, G, '1.1.01.02', '2027-01-01', '2027-01-31', 'es'))
  assert.equal(m.movimientos[0]!.haber, '')
  assert.equal(m.movimientos[1]!.debe, '')
  assert.match(m.movimientos[0]!.debe, /5\.000\.000,00/)
  assert.match(m.movimientos[1]!.haber, /2\.000\.000,00/)
})

test('solo se ofrecen las cuentas que tienen movimiento', async () => {
  // El plan tiene ochenta. Ofrecerlas todas obliga a buscar entre setenta a cero.
  const cuentas = await dentro((q) => cuentasConMovimiento(q, G, 'es'))
  assert.ok(cuentas.some((c) => c.codigo === '1.1.01.02'))
  assert.ok(!cuentas.some((c) => c.codigo === '1.2.01.04'), 'se coló una cuenta sin movimiento')
  assert.ok(cuentas.length < 20, `se ofrecen ${cuentas.length} cuentas: son demasiadas`)
})

test('una cuenta que no existe no rompe: se pide elegir una', async () => {
  // El código llega por la dirección, así que puede venir cualquier cosa.
  const m = await dentro((q) => mayor(q, G, '9.9.99', '2027-01-01', '2027-01-31', 'es'))
  assert.equal(m.cuenta, null)
  assert.equal(m.movimientos.length, 0)
  assert.match(pintarMayor(m, 'es', 'af'), /Elige una cuenta/)
})

test('un rango sin movimiento lo dice, y no enseña una tabla vacía', async () => {
  const m = await dentro((q) => mayor(q, G, '1.1.01.02', '2027-03-01', '2027-03-31', 'es'))
  assert.equal(m.movimientos.length, 0)
  const h = pintarMayor(m, 'es', 'af')
  assert.match(h, /no tuvo ningún movimiento/)
  assert.doesNotMatch(h, /<tbody>\s*<\/tbody>/)
})

test('el rango se respeta: lo de fuera no entra ni cambia el saldo', async () => {
  // Del 1 al 10 solo está el aporte: el saldo tiene que ser 5.000.000, no 3.000.000.
  const m = await dentro((q) => mayor(q, G, '1.1.01.02', '2027-01-01', '2027-01-10', 'es'))
  assert.equal(m.movimientos.length, 1)
  assert.equal(m.saldoFinalCrudo, 5000000)
})

test('un saldo negativo se ve en rojo: no es lo mismo deber que tener', async () => {
  const m = await dentro((q) => mayor(q, G, '3.1.01', '2027-01-01', '2027-01-31', 'es'))
  assert.ok(m.saldoFinalCrudo < 0, 'el patrimonio tiene saldo acreedor')
  assert.match(pintarMayor(m, 'es', 'af'), /class="n sal neg"/)
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const m = await dentro((q) => mayor(q, G, '1.1.01.02', '2027-01-01', '2027-01-31', 'en'))
  const h = pintarMayor(m, 'en', 'af')
  assert.match(h, /Account ledger/)
  assert.match(h, /Closing balance/)
  assert.doesNotMatch(h, /Mayor de una cuenta/)
  assert.doesNotMatch(h, /undefined/)
})
