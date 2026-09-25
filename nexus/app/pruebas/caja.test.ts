/**
 * La caja chica.
 *
 * Lo que se comprueba aquí no es que las cuentas sumen: eso lo sujeta el disparador
 * de cuadre. Lo que se comprueba son los seis **supuestos declarados**, porque un
 * supuesto sin prueba es una intención.
 *
 * El más importante es el segundo: un vale sin papel baja el efectivo —el dinero
 * salió igual— pero no entra en la reposición. Es la misma tesis que el resto del
 * sistema: sin evidencia no hay avance. Aquí, sin evidencia no se devuelve el dinero.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar as cerrarConexion, comoPersona } from '../src/db/conexion.ts'
import {
  cajas, cuentasDeGasto, contratosAbiertos, porContrato,
  abrirCaja, anotarVale, reponer, cerrar,
} from '../src/dominio/caja.ts'
import { pintarCaja } from '../src/pantallas/caja.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '1c2d3e4f-1000-0000-0000-00000000000a'
const OP = '1c2d3e4f-1000-0000-0000-00000000000b'
const YO = '1c2d3e4f-1000-0000-0000-00000000000d'
const ING = '1c2d3e4f-1000-0000-0000-00000000000e'
const TASA = '1c2d3e4f-1100-0000-0000-00000000000a'
const CTR = '1c2d3e4f-2200-0000-0000-00000000000a'

const MARZO = '2027-03-10'
const ABRIL = '2027-04-10'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

/** Cuántas líneas de libro tiene GPS ahora mismo. El supuesto 1 vive en este número. */
async function lineasDeLibro(): Promise<number> {
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from partida where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>
  return n!.n
}

async function laCaja() {
  const lista = await dentro((q) => cajas(q, G, 'es'))
  return lista.find((c) => c.nombre === 'Caja de campo')!
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Caja','J-905700000-0'),
        ('${OP}','operadora','Operadora Caja','J-905800000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'caja@prueba.test','Interno','clave_2fa','(h)','(s)'),
                   (${ING}, ${OP},'caja-cli@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2027-03-01', 40.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      select instalar_plan_cuentas('${G}');
      -- Marzo abierto y abril SIN periodo: la prueba del periodo necesita un mes que
      -- de verdad no exista, no uno cerrado a mano.
      insert into periodo (organizacion_id, anio, mes) values ('${G}', 2027, 3)
        on conflict do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR}','${G}','${OP}','CJ-001','servicio','Mantenimiento','Maintenance',
                'vigente','VES', 5000000.00,'${TASA}','${YO}')
        on conflict (id) do update set codigo = excluded.codigo;
      delete from vale where organizacion_id = '${G}';
      delete from reposicion where organizacion_id = '${G}';
      delete from caja_chica where organizacion_id = '${G}';
    `)
  })
})
after(async () => { await cerrarConexion() })

test('abrir la caja saca el fondo del banco y lo mete en caja chica', async () => {
  const r = await dentro((q) => abrirCaja(q, G, 'Caja de campo', 'VES', 200000, YO, MARZO, YO, 'es'))
  assert.equal(r.hecho, true)
  const caja = (r as { id: string }).id

  // Las sumas se miran sobre EL asiento de esta apertura, no sobre todo lo que tenga
  // la organizacion: un asiento no se borra nunca, asi que una suma global crece con
  // cada corrida y la prueba empieza a fallar sola el segundo dia.
  const [p] = (await dentro((q) => q`
    select coalesce(sum(monto_ves) filter (where cuenta = '1.1.01.01'), 0)::text as caja,
           coalesce(sum(monto_ves) filter (where cuenta = '1.1.01.02'), 0)::text as banco
      from partida
     where asiento_id = (select id from asiento
                          where origen_tipo = 'caja_apertura' and origen_id = ${caja}::uuid)
  `)) as unknown as Array<{ caja: string; banco: string }>
  assert.equal(Number(p!.caja), 200000)
  assert.equal(Number(p!.banco), -200000)
})

test('SUPUESTO 1 · anotar un vale NO toca el libro', async () => {
  // El fondo es fijo: el gasto entra cuando se repone, no cuando ocurre. Es lo que
  // permite auditar la caja contando el efectivo una sola vez, sin mirar el libro.
  const antes = await lineasDeLibro()
  const c = await laCaja()
  const r = await dentro((q) => anotarVale(q, {
    cajaId: c.id, fecha: MARZO, concepto: 'Taxi al pozo', monto: 30000,
    cuenta: '5.1.04', contratoId: CTR, beneficiario: 'Transporte Díaz', soporte: 'h-recibo-1',
  }, YO, 'es'))
  assert.equal(r.hecho, true)
  assert.equal(await lineasDeLibro(), antes, 'el vale no puede haber escrito en el libro')

  const d = await laCaja()
  assert.equal(d.efectivoPct, 85)
  assert.match(d.efectivo, /170\.000,00/)
})

test('SUPUESTO 2 · sin papel baja el efectivo pero no entra en la reposición', async () => {
  const c = await laCaja()
  const r = await dentro((q) => anotarVale(q, {
    cajaId: c.id, fecha: MARZO, concepto: 'Soldadura de urgencia', monto: 20000,
    cuenta: '5.1.01', contratoId: CTR, beneficiario: null, soporte: null,
  }, YO, 'es'))
  assert.equal(r.hecho, true)

  const d = await laCaja()
  // El dinero salió: el efectivo baja los 20.000.
  assert.match(d.efectivo, /150\.000,00/)
  // Pero no se devuelve: por reponer siguen siendo solo los 30.000 con papel.
  assert.equal(d.porReponerCrudo, 30000)
  assert.equal(d.sinSoporteCrudo, 20000)
})

test('un vale que no cabe en el efectivo se rechaza y lo dice', async () => {
  const c = await laCaja()
  const r = await dentro((q) => anotarVale(q, {
    cajaId: c.id, fecha: MARZO, concepto: 'Una bomba entera', monto: 500000,
    cuenta: '5.1.01', contratoId: null, beneficiario: null, soporte: 'h-x',
  }, YO, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { motivo: string }).motivo, /efectivo/)
})

test('un importe de cero o negativo no es un vale', async () => {
  const c = await laCaja()
  for (const monto of [0, -5]) {
    const r = await dentro((q) => anotarVale(q, {
      cajaId: c.id, fecha: MARZO, concepto: 'Nada', monto,
      cuenta: '5.1.01', contratoId: null, beneficiario: null, soporte: 'h-y',
    }, YO, 'es'))
    assert.equal(r.hecho, false, `un vale de ${monto} no puede entrar`)
  }
})

test('reponer en un mes sin periodo contable lo explica, no revienta', async () => {
  const c = await laCaja()
  const r = await dentro((q) => reponer(q, c.id, ABRIL, YO, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { motivo: string }).motivo, /periodo contable/)
})

test('reponer genera UN asiento, cuadrado, y con el gasto imputado al contrato', async () => {
  const c = await laCaja()
  const r = await dentro((q) => reponer(q, c.id, MARZO, YO, 'es'))
  assert.equal(r.hecho, true)

  const [a] = (await dentro((q) => q`
    select a.id,
           (select count(*)::int from partida where asiento_id = a.id) as lineas,
           (select coalesce(sum(monto_ves),0)::text from partida where asiento_id = a.id) as cuadre,
           (select count(*)::int from partida
             where asiento_id = a.id and contrato_id = ${CTR}::uuid) as imputadas
      from asiento a
     where a.organizacion_id = ${G}::uuid and a.origen_tipo = 'caja_reposicion'
  `)) as unknown as Array<{ id: string; lineas: number; cuadre: string; imputadas: number }>
  assert.equal(a!.lineas, 2, 'un gasto agrupado y su banco')
  assert.equal(Number(a!.cuadre), 0)
  assert.equal(a!.imputadas, 1, 'el gasto tiene que quedar pegado a su contrato')
})

test('lo ya repuesto no se repone dos veces', async () => {
  const c = await laCaja()
  assert.equal(c.porReponerCrudo, 0)
  // Y el efectivo vuelve a subir: el fondo es fijo, menos lo que sigue pendiente.
  assert.match(c.efectivo, /180\.000,00/)

  const r = await dentro((q) => reponer(q, c.id, MARZO, YO, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { motivo: string }).motivo, /soporte|papel/)
})

test('lo que se ha ido por contrato sale con la moneda de su caja', async () => {
  const filas = await dentro((q) => porContrato(q, G, '2027-01-01', '2027-12-31', 'es'))
  const f = filas.find((x) => x.contrato === 'CJ-001')!
  assert.equal(f.moneda, 'VES')
  assert.equal(f.vales, 2)
  assert.equal(f.sinPapelCrudo, 20000)
})

test('la pantalla sale entera en los dos idiomas, con sus seis supuestos', async () => {
  const datos = await dentro(async (q) => ({
    cajas: await cajas(q, G, 'en'),
    cuentas: await cuentasDeGasto(q, G, 'en'),
    contratos: await contratosAbiertos(q, G),
    porContrato: await porContrato(q, G, '2027-01-01', '2027-12-31', 'en'),
    hoy: MARZO,
  }))
  const h = pintarCaja(datos, 'en', 'af')
  assert.equal(h.includes('‹falta:'), false)
  assert.match(h, /Petty cash/)
  // Los seis supuestos, numerados, en la pantalla. Si dejan de estar, alguien tomó
  // seis decisiones a escondidas.
  assert.equal((h.match(/<li>/g) ?? []).length, 6)
  // Y lo gastado sin papel, señalado.
  assert.match(h, /No receipt/)

  const es = pintarCaja({ ...datos, cajas: await dentro((q) => cajas(q, G, 'es')) }, 'es', 'af')
  assert.equal(es.includes('‹falta:'), false)
  assert.match(es, /Sin papel/)
})

test('cerrar la caja lleva lo que no tiene papel a Faltantes de caja, no lo esconde', async () => {
  const c = await laCaja()
  const r = await dentro((q) => cerrar(q, c.id, MARZO, YO, 'es'))
  assert.equal(r.hecho, true)
  const asiento = (r as { id: string }).id

  const [p] = (await dentro((q) => q`
    select coalesce(sum(monto_ves) filter (where cuenta = '5.2.12'), 0)::text as faltante,
           coalesce(sum(monto_ves) filter (where cuenta = '1.1.01.01'), 0)::text as caja,
           coalesce(sum(monto_ves) filter (where cuenta = '1.1.01.02'), 0)::text as banco,
           coalesce(sum(monto_ves), 0)::text as cuadre
      from partida where asiento_id = ${asiento}::uuid
  `)) as unknown as Array<{ faltante: string; caja: string; banco: string; cuadre: string }>
  assert.equal(Number(p!.faltante), 20000, 'los 20.000 sin papel van a su cuenta, no al olvido')
  assert.equal(Number(p!.caja), -200000, 'el fondo entero sale de caja chica')
  assert.equal(Number(p!.banco), 180000, 'y el efectivo que quedaba vuelve al banco')
  assert.equal(Number(p!.cuadre), 0)

  const d = await laCaja()
  assert.equal(d.cerrada, true)
})

test('el cliente no llega a la caja chica', async () => {
  await assert.rejects(
    comoPersona({ id: ING }, 'nexus_cliente', (q) => cajas(q, G, 'es')),
    /permission denied|no existe|does not exist/,
  )
})
