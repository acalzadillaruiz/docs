/**
 * Registrar un cobro.
 *
 * Cierra el ciclo. Lo que se comprueba aquí es que la cuenta por cobrar baje SOLA,
 * que no se pueda cobrar de más, y que un cobro registrado nunca se quede sin
 * asentar — parecería que cuenta y no contaría.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { estadoDeCobro, registrarCobro, NoCobrable } from '../src/dominio/cobrar.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '5c6d7e8f-0000-0000-0000-00000000000a'
const C = '5c6d7e8f-0000-0000-0000-00000000000b'
const YO = '5c6d7e8f-0000-0000-0000-00000000000d'
const ING = '5c6d7e8f-0000-0000-0000-00000000000e'
const TASA = '5c6d7e8f-1111-0000-0000-00000000000a'
const IVA = '5c6d7e8f-1111-0000-0000-00000000000b'
const CTR = '5c6d7e8f-2222-0000-0000-00000000000a'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

let n = 0
/**
 * Una valuación aprobada de 100.000, sin retenciones, lista para cobrar.
 *
 * Cada una es NUEVA, con identificador al azar. No se reutiliza ninguna ni se
 * limpia lo anterior, y no por pereza: un asiento no se modifica ni se borra —lo
 * impide la base de datos, y con razón— así que una prueba que quisiera reutilizar
 * una valuación ya asentada tendría que borrar su asiento, que es justo lo que no
 * se puede hacer. Este es el caso raro en que lo correcto es no limpiar.
 */
async function aprobada(): Promise<string> {
  const id = randomUUID()
  n++
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`
      insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde,
        periodo_hasta, obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
        concepto_islr, ret_iva_pct, estado, aprobada_el, aprobada_por, creada_por)
      values (${id}::uuid, ${G}::uuid, ${CTR}::uuid, ${n + Math.floor(Math.random() * 100000)},
        '2026-04-01','2026-04-30', 100000.00,'VES', ${TASA}::uuid, 0, 0, ${IVA}::uuid,
        'SERV-PJ', 0,'aprobada','2026-04-30', ${ING}::uuid, ${YO}::uuid)`
  })
  await dentro((q) => q`select asentar_valuacion(${id}::uuid, ${YO}::uuid)`)
  return id
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Cobrar','J-900600000-0'),
        ('${C}','operadora','Operadora Cobrar','J-900700000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'cob@prueba.test','Interno','clave_2fa','(h)','(s)'),
                   (${ING}, ${C},'cob-cli@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-04-04', 40.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2018-01-09') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00)
        on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut,
                                 minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01')
        on conflict do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR}','${G}','${C}','COB-001','servicio','Servicio','Service',
                'vigente','VES', 5000000.00,'${TASA}','${YO}')
        on conflict (id) do update set codigo = excluded.codigo;
      select instalar_plan_cuentas('${G}');
      insert into periodo (organizacion_id, anio, mes) values ('${G}', 2026, 4)
        on conflict do nothing;
    `)
  })
})
after(async () => { await cerrar() })

test('la cuenta por cobrar baja SOLA: nadie la marca a mano', async () => {
  const v = await aprobada()
  const antes = await dentro((q) => estadoDeCobro(q, v, 'es'))
  // 100.000 de obra + 16.000 de IVA − 4.962,50 de ISLR (5% con sustraendo).
  assert.equal(antes.saldoCrudo, 111037.5)
  assert.equal(antes.cobrada, false)

  const r = await dentro((q) => registrarCobro(q, {
    valuacionId: v, fecha: '2026-04-20', medio: 'transferencia',
    monto: 111037.5, referencia: 'TRF-9912',
  }, YO, G, 'es'))
  assert.equal(r.hecho, true)
  assert.equal(r.hecho && r.saldo, 0)

  const despues = await dentro((q) => estadoDeCobro(q, v, 'es'))
  assert.equal(despues.cobrada, true)
  const [est] = (await dentro((q) => q`
    select estado::text from valuacion where id = ${v}::uuid
  `)) as unknown as Array<{ estado: string }>
  assert.equal(est!.estado, 'cobrada')
})

test('un cobro parcial deja el saldo justo, restando y no guardando', async () => {
  const v = await aprobada()
  await dentro((q) => registrarCobro(q, {
    valuacionId: v, fecha: '2026-04-15', medio: 'transferencia',
    monto: 40000, referencia: '',
  }, YO, G, 'es'))
  const e = await dentro((q) => estadoDeCobro(q, v, 'es'))
  // Un saldo guardado es un saldo que algún día dejará de ser cierto.
  assert.equal(e.saldoCrudo, 71037.5)
  assert.equal(e.cobrada, false)
  assert.equal(e.cobros.length, 1)
})

test('no se cobra de más: un saldo negativo no significa nada en un libro', async () => {
  const v = await aprobada()
  const r = await dentro((q) => registrarCobro(q, {
    valuacionId: v, fecha: '2026-04-20', medio: 'transferencia',
    monto: 200000, referencia: '',
  }, YO, G, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { errores: readonly string[] }).errores.join(' '), /pasa de lo que queda/)
})

test('el cobro queda ASENTADO, no solo registrado', async () => {
  const v = await aprobada()
  const r = await dentro((q) => registrarCobro(q, {
    valuacionId: v, fecha: '2026-04-20', medio: 'transferencia',
    monto: 50000, referencia: '',
  }, YO, G, 'es'))
  const [c] = (await dentro((q) => q`
    select asiento_id from cobro where id = ${(r as { cobroId: string }).cobroId}::uuid
  `)) as unknown as Array<{ asiento_id: string | null }>
  // Un cobro registrado y sin asentar parece que cuenta y no cuenta.
  assert.notEqual(c!.asiento_id, null)

  const [cuadre] = (await dentro((q) => q`
    select sum(monto_ves)::text as d from partida
     where asiento_id = ${c!.asiento_id}::uuid
  `)) as unknown as Array<{ d: string }>
  assert.equal(Number(cuadre!.d), 0, 'el asiento del cobro cuadra')
})

test('una valuación que todavía no está aprobada no se cobra', async () => {
  const v = await aprobada()
  await dentro((q) => q`update valuacion set estado = 'presentada' where id = ${v}::uuid`)
  const r = await dentro((q) => registrarCobro(q, {
    valuacionId: v, fecha: '2026-04-20', medio: 'transferencia', monto: 100, referencia: '',
  }, YO, G, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { errores: readonly string[] }).errores.join(' '), /aprobada o facturada/)
})

test('un cobro en un mes sin periodo abierto no entra', async () => {
  const v = await aprobada()
  // Mayo no está abierto en esta organización.
  const r = await dentro((q) => registrarCobro(q, {
    valuacionId: v, fecha: '2026-05-10', medio: 'transferencia', monto: 1000, referencia: '',
  }, YO, G, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { errores: readonly string[] }).errores.join(' '), /periodo contable/)
})

test('un importe de cero o negativo no es un cobro', async () => {
  const v = await aprobada()
  for (const monto of [0, -500]) {
    const r = await dentro((q) => registrarCobro(q, {
      valuacionId: v, fecha: '2026-04-20', medio: 'transferencia', monto, referencia: '',
    }, YO, G, 'es'))
    assert.equal(r.hecho, false)
  }
})

test('el cliente NO ve la caja de quien le factura', async () => {
  const v = await aprobada()
  // Ve su valuación, no los cobros que GPS lleva de ella.
  await assert.rejects(
    comoPersona({ id: ING }, 'nexus_cliente', (q) => estadoDeCobro(q, v, 'es')),
    NoCobrable,
  )
})

test('una valuación que no existe da el mismo error que una que no te toca', async () => {
  await assert.rejects(
    dentro((q) => estadoDeCobro(q, '00000000-0000-0000-0000-0000000000cb', 'es')),
    NoCobrable,
  )
})
