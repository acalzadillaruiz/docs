/**
 * Dar de alta un contrato.
 *
 * Era el agujero más grande: todo lo construido —el avance, la evidencia, las
 * valuaciones, las medidas— funcionaba sobre contratos que solo podían entrar
 * tocando la base de datos a mano.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { crearContrato, clientes, type ContratoNuevo } from '../src/dominio/alta.ts'
import { pintarAlta } from '../src/pantallas/alta.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '1e2f3a4b-0000-0000-0000-00000000000a'
const C = '1e2f3a4b-0000-0000-0000-00000000000b'
const YO = '1e2f3a4b-0000-0000-0000-00000000000d'
const ING = '1e2f3a4b-0000-0000-0000-00000000000e'
const TASA = '1e2f3a4b-1111-0000-0000-00000000000a'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

let n = 0
const base = (cambios: Partial<ContratoNuevo> = {}): ContratoNuevo => ({
  clienteId: C,
  codigo: `ALTA-${String(++n).padStart(3, '0')}-${Date.now() % 100000}`,
  tipo: 'procura',
  tituloEs: 'Cabezales de pozo',
  tituloEn: 'Wellheads',
  moneda: 'USD',
  firmadoEl: '2026-02-01',
  inicio: '2026-03-01',
  finPrevisto: '2026-11-30',
  anticipoPct: 20,
  amortizaPct: 20,
  garantiaPct: 5,
  renglones: [{
    descripcionEs: 'Cabezal 11" 5M', descripcionEn: '11" 5M wellhead',
    cantidad: 4, unidad: 'unidad', norma: 'API 6A PSL-3', especificacion: 'Material AA',
    precioUnitario: 120000, costoUnitario: 74500,
  }],
  ...cambios,
})

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Alta','J-980000000-0'),
        ('${C}','operadora','Petrolera del Lago','J-981111111-1')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'alta@prueba.test','Interno','clave_2fa','(h)','(s)'),
                   (${ING}, ${C},'alta-cli@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}', current_date, 36.50,'carga_manual')
        on conflict (id) do update set vigente_el = current_date;
    `)
  })
})
after(async () => { await cerrar() })

const crear = (c: ContratoNuevo) =>
  dentro((q) => crearContrato(q, c, YO, G, 'es'))

test('un contrato nuevo nace CON sus hitos, en la misma transacción', async () => {
  // Un contrato sin hitos tiene avance cero, el mismo cero que uno que no ha
  // empezado. Dejar el paso para después es dejar que se olvide.
  const r = await crear(base())
  assert.equal(r.hecho, true)
  assert.equal(r.hecho && r.hitos, 5, 'procura lleva cinco hitos')

  const filas = (await dentro((q) => q`
    select h.clave, h.peso::text, h.planificada from hito h
      join renglon rg on rg.id = h.renglon_id
     where rg.contrato_id = ${(r as { contratoId: string }).contratoId}::uuid
     order by h.orden
  `)) as unknown as Array<{ clave: string; peso: string; planificada: Date | null }>
  assert.deepEqual(filas.map((f) => f.clave),
    ['orden', 'fabricado', 'embarcado', 'nacionalizado', 'recibido'])
  assert.equal(filas.reduce((s, f) => s + Number(f.peso), 0), 100)
  assert.ok(filas.every((f) => f.planificada !== null), 'con sus fechas repartidas')
})

test('el monto SALE de los renglones, no se teclea', async () => {
  // Un monto tecleado aparte empieza cuadrando y deja de cuadrar el día que alguien
  // corrige un renglón. Entonces hay dos verdades sobre cuánto vale el contrato.
  const r = await crear(base({ renglones: [
    { descripcionEs: 'A', descripcionEn: 'A', cantidad: 3, unidad: 'u',
      norma: null, especificacion: null, precioUnitario: 1000, costoUnitario: 600 },
    { descripcionEs: 'B', descripcionEn: 'B', cantidad: 2, unidad: 'u',
      norma: null, especificacion: null, precioUnitario: 250.5, costoUnitario: null },
  ] }))
  assert.equal(r.hecho, true)
  const [c] = (await dentro((q) => q`
    select monto::text from contrato where id = ${(r as { contratoId: string }).contratoId}::uuid
  `)) as unknown as Array<{ monto: string }>
  assert.equal(c!.monto, '3501.00')   // 3×1000 + 2×250,50
})

test('nace en BORRADOR: el cliente no lo ve hasta que alguien lo ponga vigente', async () => {
  // Un contrato que naciera vigente sería visible para el cliente en el mismo
  // instante en que alguien pulsa «crear», erratas incluidas.
  const r = await crear(base())
  const id = (r as { contratoId: string }).contratoId
  const [c] = (await dentro((q) => q`
    select estado::text from contrato where id = ${id}::uuid
  `)) as unknown as Array<{ estado: string }>
  assert.equal(c!.estado, 'borrador')

  const suyos = await comoPersona({ id: ING }, 'nexus_cliente', (q) => q`
    select id from contrato where id = ${id}::uuid
  `)
  assert.equal(suyos.length, 0, 'el cliente no ve un borrador')
})

test('los errores salen TODOS juntos, no uno a uno', async () => {
  // Seis viajes de ida y vuelta es cuando se abandona y se vuelve a Excel.
  const r = await crear(base({
    clienteId: '', codigo: '', renglones: [],
    inicio: '2026-06-01', finPrevisto: '2026-01-01',
  }))
  assert.equal(r.hecho, false)
  const errores = (r as { errores: readonly string[] }).errores
  assert.ok(errores.length >= 3, `salieron ${errores.length}: ${errores.join(' / ')}`)
  assert.ok(errores.some((e) => /cliente/i.test(e)))
  assert.ok(errores.some((e) => /renglones/i.test(e)))
  assert.ok(errores.some((e) => /fin/i.test(e)))
})

test('un código repetido se dice en castellano, antes de chocar con la base de datos', async () => {
  const c = base()
  await crear(c)
  const otra = await crear({ ...c, codigo: c.codigo })
  assert.equal(otra.hecho, false)
  assert.match((otra as { errores: readonly string[] }).errores[0]!, /Ya existe un contrato con ese código/)
})

test('un anticipo sin ritmo de amortización no pasa', async () => {
  // Es dinero recibido que no se descuenta de ninguna valuación: se queda cobrado
  // dos veces hasta que alguien lo note.
  const r = await crear(base({ anticipoPct: 30, amortizaPct: 0 }))
  assert.equal(r.hecho, false)
  assert.match((r as { errores: readonly string[] }).errores.join(' '), /amortiza/i)
})

test('un contrato sin renglones no se crea: no se podría valuar ni medir', async () => {
  const r = await crear(base({ renglones: [] }))
  assert.equal(r.hecho, false)
})

test('si algo falla, NO queda un contrato a medias', async () => {
  const antes = (await dentro((q) => q`
    select count(*)::int as n from contrato where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>
  await crear(base({ codigo: '' }))
  const despues = (await dentro((q) => q`
    select count(*)::int as n from contrato where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(despues[0]!.n, antes[0]!.n)
})

test('el precio de compra se guarda y el cliente sigue sin poder leerlo', async () => {
  const r = await crear(base())
  const id = (r as { contratoId: string }).contratoId
  await dentro((q) => q`update contrato set estado = 'vigente' where id = ${id}::uuid`)

  const [mio] = (await dentro((q) => q`
    select costo_unitario::text from renglon where contrato_id = ${id}::uuid
  `)) as unknown as Array<{ costo_unitario: string }>
  assert.equal(mio!.costo_unitario, '74500.0000')

  await assert.rejects(
    comoPersona({ id: ING }, 'nexus_cliente', (q) => q`
      select costo_unitario from renglon where contrato_id = ${id}::uuid
    `),
    /permission denied/,
  )
})

test('un renglón sin precio de compra se acepta: no siempre se sabe al firmar', async () => {
  const r = await crear(base({ renglones: [{
    descripcionEs: 'Servicio', descripcionEn: 'Service', cantidad: 1, unidad: 'mes',
    norma: null, especificacion: null, precioUnitario: 50000, costoUnitario: null,
  }] }))
  assert.equal(r.hecho, true)
})

test('la lista de clientes son operadoras, nunca GPS ni un proveedor', async () => {
  const lista = await dentro((q) => clientes(q))
  assert.ok(lista.some((c) => c.id === C))
  assert.equal(lista.some((c) => c.id === G), false)
})

test('el formulario devuelve escrito lo que se escribió', () => {
  // Un formulario que se vacía al fallar es la forma más rápida de que nadie lo
  // vuelva a usar.
  const h = pintarAlta([{ id: C, nombre: 'Petrolera', rif: 'J-1' }], 'es', 'af', ['Algo falló'], {
    campos: { codigo: 'GPS-2026-099', titulo_es: 'Cabezales', cliente: C, moneda: 'VES' },
    renglones: [{ desc_es: 'Cabezal', cantidad: '4', precio: '120000', costo: '74500' }],
  })
  assert.match(h, /value="GPS-2026-099"/)
  assert.match(h, /value="Cabezales"/)
  assert.match(h, /value="4"/)
  assert.match(h, /Algo falló/)
  assert.match(h, new RegExp(`value="${C}" selected`))
  assert.match(h, /value="VES" selected/)
})

test('el formulario no lleva ni una línea de JavaScript', () => {
  // La política de seguridad es `default-src 'none'`: un script no se ejecutaría, y
  // relajarla para poder clonar una fila sería pagar con la defensa más fuerte que
  // hay contra el código inyectado a cambio de una comodidad.
  const h = pintarAlta([], 'es', 'af')
  assert.equal(h.includes('<script'), false)
  assert.equal(h.includes('onclick'), false)
  // Y para más filas hay un botón que vuelve al servidor.
  assert.match(h, /name="accion" value="mas"/)
})

test('la columna del precio de compra va marcada también para quien la teclea', () => {
  // Que se note al escribirlo es lo que evita que acabe pegado en un correo.
  const h = pintarAlta([], 'es', 'af')
  assert.match(h, /class="c int"/)
  assert.match(h, /El cliente nunca ve esta columna/)
})

test('el formulario sale entero en los dos idiomas', () => {
  const en = pintarAlta([], 'en', 'af')
  assert.match(en, /Purchase price/)
  assert.match(en, /It starts as a draft/)
  assert.equal(en.includes('‹falta:'), false)
})
