/**
 * Pagar una factura de proveedor.
 *
 * Estaban la tabla `pago` y el generador `asentar_pago`, y no había forma de llegar
 * a ellos desde ninguna pantalla: entraban facturas y no salía nunca un pago, así
 * que el saldo de proveedores crecía para siempre y no era el de nadie.
 *
 * Lo que se comprueba aquí es el ciclo entero: que el saldo baja, que no se puede
 * pagar de más, que pagar en divisas trae su IGTF sin que nadie lo teclee, y que
 * cuando la factura queda saldada desaparece de la lista sola.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { porPagar, registrarPago, mediosTraducidos } from '../src/dominio/pagar.ts'
import { pintarPagar } from '../src/pantallas/pagar.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '2d3e4f5a-1000-0000-0000-00000000000a'
const PR = '2d3e4f5a-1000-0000-0000-00000000000b'
const OP = '2d3e4f5a-1000-0000-0000-00000000000c'
const YO = '2d3e4f5a-1000-0000-0000-00000000000d'
const ING = '2d3e4f5a-1000-0000-0000-00000000000e'
const TASA = '2d3e4f5a-1100-0000-0000-00000000000a'
const IVA = '2d3e4f5a-1100-0000-0000-00000000000b'

const DIA = '2027-04-10'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

/** Una factura recibida, sin retenciones: 1.000.000 + 16% = 1.160.000 por pagar. */
async function factura(base = 1000000): Promise<string> {
  const id = randomUUID()
  const numero = String(Date.now() % 100000000).padStart(8, '0') + Math.floor(Math.random() * 99)
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`
      insert into documento_fiscal (id, organizacion_id, sentido, tipo, numero, numero_control,
                                    contraparte_id, fecha, base_ves, base_usd,
                                    alicuota_iva_id, iva_ves, iva_usd, tasa_id, registrado_por)
      values (${id}::uuid, ${G}::uuid,'recibido','factura', ${numero},'01-00099999',
              ${PR}::uuid, ${DIA}::date, ${base}, ${base / 50}, ${IVA}::uuid,
              ${base * 0.16}, ${(base * 0.16) / 50}, ${TASA}::uuid, ${YO}::uuid)`
  })
  return id
}

const deudaDe = async (doc: string) =>
  (await dentro((q) => porPagar(q, G, 'es', '2027-04-30'))).find((d) => d.documento === doc)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Pagos','J-905900000-0'),
        ('${PR}','proveedor','Suministros del Centro','J-30717171-7'),
        ('${OP}','operadora','Operadora Pagos','J-906000000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'pagar@prueba.test','Interno','clave_2fa','(h)','(s)'),
                   (${ING}, ${OP},'pagar-cli@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2027-04-01', 50.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2026-01-01') on conflict do nothing;
      insert into alicuota_igtf (porcentaje, vigente_desde) values (3.00,'2026-01-01')
        on conflict do nothing;
      select instalar_plan_cuentas('${G}');
      insert into periodo (organizacion_id, anio, mes) values ('${G}', 2027, 4)
        on conflict do nothing;
    `)
  })
})
after(async () => { await cerrar() })

test('una factura recibida aparece en lo que toca pagar, por su saldo entero', async () => {
  const f = await factura()
  const d = await deudaDe(f)
  assert.ok(d, 'la factura tiene que estar en la lista')
  assert.equal(d!.saldoCrudo, 1160000)
  assert.equal(d!.proveedor, 'Suministros del Centro')
  assert.equal(d!.pagos.length, 0)
})

test('un pago parcial baja el saldo y queda a la vista debajo de la deuda', async () => {
  // Un pago que no se ve es un pago que se hace dos veces.
  const f = await factura()
  const r = await dentro((q) => registrarPago(q, {
    documento: f, fecha: DIA, medio: 'transferencia', moneda: 'VES',
    monto: 400000, referencia: 'TRF-9001',
  }, YO, 'es'))
  assert.equal(r.hecho, true)

  const d = await deudaDe(f)
  assert.equal(d!.saldoCrudo, 760000)
  assert.equal(d!.pagos.length, 1)
  assert.equal(d!.pagos[0]!.referencia, 'TRF-9001')
  assert.notEqual(d!.pagos[0]!.asiento, null, 'el pago tiene que haber generado su asiento')
})

test('no se puede pagar más de lo que se debe', async () => {
  const f = await factura()
  const r = await dentro((q) => registrarPago(q, {
    documento: f, fecha: DIA, medio: 'transferencia', moneda: 'VES',
    monto: 2000000, referencia: null,
  }, YO, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { motivo: string }).motivo, /excede/)
})

test('un pago en dólares se mide contra el saldo pasando por la tasa, no a ojo', async () => {
  // 30.000 USD a 50 son 1.500.000 Bs: más que los 1.160.000 que se deben. Sin la
  // conversión, un importe pequeño en dólares parecería caber siempre.
  const f = await factura()
  const malo = await dentro((q) => registrarPago(q, {
    documento: f, fecha: DIA, medio: 'transferencia', moneda: 'USD',
    monto: 30000, referencia: null,
  }, YO, 'es'))
  assert.equal(malo.hecho, false)

  const bueno = await dentro((q) => registrarPago(q, {
    documento: f, fecha: DIA, medio: 'transferencia', moneda: 'USD',
    monto: 10000, referencia: 'ZELLE-1',
  }, YO, 'es'))
  assert.equal(bueno.hecho, true)
  const d = await deudaDe(f)
  assert.equal(d!.saldoCrudo, 660000, '1.160.000 menos 10.000 × 50')
})

test('pagar en divisas trae su IGTF sin que nadie lo teclee', async () => {
  // El 3% de pagar en divisa es un gasto con cuenta propia. Dejarlo a criterio de
  // quien teclea garantiza que la mitad de los pagos lo lleven y la otra mitad no.
  const f = await factura()
  const r = await dentro((q) => registrarPago(q, {
    documento: f, fecha: DIA, medio: 'divisa_efectivo', moneda: 'USD',
    monto: 1000, referencia: null,
  }, YO, 'es'))
  assert.equal(r.hecho, true)

  const [p] = (await dentro((q) => q`
    select coalesce(sum(pa.monto_ves) filter (where pa.cuenta = '5.2.09'), 0)::text as igtf,
           coalesce(sum(pa.monto_ves), 0)::text as cuadre
      from partida pa
      join pago pg on pg.asiento_id = pa.asiento_id
     where pg.id = ${(r as { id: string }).id}::uuid
  `)) as unknown as Array<{ igtf: string; cuadre: string }>
  // 1.000 USD son 50.000 Bs; el 3% son 1.500.
  assert.equal(Number(p!.igtf), 1500)
  assert.equal(Number(p!.cuadre), 0, 'el asiento cuadra con el IGTF dentro')
})

test('una factura saldada desaparece de la lista sola, sin marcarla nadie', async () => {
  const f = await factura()
  const r = await dentro((q) => registrarPago(q, {
    documento: f, fecha: DIA, medio: 'transferencia', moneda: 'VES',
    monto: 1160000, referencia: 'TRF-FINAL',
  }, YO, 'es'))
  assert.equal(r.hecho, true)
  assert.equal(await deudaDe(f), undefined)
})

test('un mes sin periodo contable abierto lo dice, no revienta', async () => {
  const f = await factura()
  const r = await dentro((q) => registrarPago(q, {
    documento: f, fecha: '2027-05-10', medio: 'transferencia', moneda: 'VES',
    monto: 1000, referencia: null,
  }, YO, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { motivo: string }).motivo, /periodo contable/)
})

test('lo que no se entiende se rechaza sin llegar a la base de datos', async () => {
  const f = await factura()
  const casos: Array<[string, Record<string, unknown>]> = [
    ['fecha', { fecha: '31 de febrero' }],
    ['medio', { medio: 'maletín' }],
    ['monto', { monto: Number('hola') }],
    ['monto', { monto: 0 }],
    ['factura', { documento: 'esto-no-es-un-id' }],
  ]
  for (const [, cambio] of casos) {
    const r = await dentro((q) => registrarPago(q, {
      documento: f, fecha: DIA, medio: 'transferencia', moneda: 'VES',
      monto: 1000, referencia: null, ...cambio,
    } as Parameters<typeof registrarPago>[1], YO, 'es'))
    assert.equal(r.hecho, false, `${JSON.stringify(cambio)} no puede pasar`)
  }
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const deudas = await dentro((q) => porPagar(q, G, 'en', '2027-04-30'))
  assert.ok(deudas.length > 0, 'sin deudas esta prueba no comprobaría nada')
  const en = pintarPagar({ deudas, medios: mediosTraducidos('en'), hoy: DIA }, 'en', 'af')
  assert.equal(en.includes('‹falta:'), false)
  assert.match(en, /Bank transfer/)
  assert.match(en, /Suministros del Centro/)

  const es = pintarPagar({ deudas, medios: mediosTraducidos('es'), hoy: DIA }, 'es', 'af')
  assert.equal(es.includes('‹falta:'), false)
  assert.match(es, /Transferencia/)
})

test('el cliente no ve NADA de lo que GPS debe, ni la lista ni los pagos', async () => {
  // Aquí la valla no salta con un error, y hay que decirlo como es: `por_pagar` es
  // una función normal y el cliente puede llamarla. Lo que le devuelve es cero filas,
  // porque la política de fila de los documentos solo le enseña los suyos. Esperaba
  // un «permission denied» y no lo hay: la prueba dice lo que pasa de verdad.
  const suyas = await comoPersona({ id: ING }, 'nexus_cliente', (q) => porPagar(q, G, 'es'))
  assert.equal(suyas.length, 0)

  // Y de dentro sí hay deudas: sin esto, el cero de arriba no demostraría nada.
  const nuestras = await dentro((q) => porPagar(q, G, 'es', '2027-04-30'))
  assert.ok(nuestras.length > 0)

  // La tabla de pagos, además, no se le concede. Son dos vallas distintas.
  await assert.rejects(
    comoPersona({ id: ING }, 'nexus_cliente', (q) => q`select count(*) from pago`),
    /permission denied/,
  )
})

test('la ruta es la tercera valla: al cliente le contesta 404', async () => {
  // Las otras dos —permisos y políticas de fila— las comprueba la prueba de arriba.
  // Esta es la que se olvida al añadir una pantalla, y por eso el barrido de
  // aislamiento saca la lista de rutas del código fuente.
  const fuente = await readFile(new URL('../src/servidor/rutas.ts', import.meta.url), 'utf8')
  const i = fuente.indexOf(`p.ruta === '/pagar'`)
  assert.notEqual(i, -1)
  assert.match(fuente.slice(i, i + 700), /esCliente\) return noEncontrado/)
})
