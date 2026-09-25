/**
 * Los meses contables.
 *
 * La pantalla más aburrida del sistema y una de las que más bloquean: el día 1, sin
 * el mes nuevo abierto, no entra ni una factura ni un cobro.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { meses, abrirMes, cerrarMes } from '../src/dominio/periodos.ts'
import { pintarPeriodos } from '../src/pantallas/periodos.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '6d7e8f9a-0000-0000-0000-00000000000a'
const YO = '6d7e8f9a-0000-0000-0000-00000000000d'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Periodos','J-900800000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'per@prueba.test','Interno','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q`delete from periodo where organizacion_id = ${G}::uuid`
  })
})
after(async () => { await cerrar() })

async function limpio(): Promise<void> {
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`delete from periodo where organizacion_id = ${G}::uuid`
  })
}

test('sin ningún mes, se ofrece abrir el mes en curso', async () => {
  await limpio()
  const m = await dentro((q) => meses(q, G, 'es'))
  const hoy = new Date()
  assert.equal(m.lista.length, 0)
  assert.equal(m.siguiente!.anio, hoy.getUTCFullYear())
  assert.equal(m.siguiente!.mes, hoy.getUTCMonth() + 1)
})

test('abrir un mes lo abre, y abrirlo dos veces lo dice', async () => {
  await limpio()
  assert.deepEqual(await dentro((q) => abrirMes(q, G, 2026, 3, 'es')), { hecho: true })
  const otra = await dentro((q) => abrirMes(q, G, 2026, 3, 'es'))
  assert.equal(otra.hecho, false)
  assert.match((otra as { motivo: string }).motivo, /ya estaba/)
})

test('el siguiente por abrir es el que viene detrás del último', async () => {
  await limpio()
  await dentro((q) => abrirMes(q, G, 2026, 3, 'es'))
  const m = await dentro((q) => meses(q, G, 'es'))
  assert.equal(m.siguiente!.anio, 2026)
  assert.equal(m.siguiente!.mes, 4)
})

test('de diciembre se pasa a enero del año siguiente', async () => {
  await limpio()
  await dentro((q) => abrirMes(q, G, 2026, 12, 'es'))
  const m = await dentro((q) => meses(q, G, 'es'))
  assert.equal(m.siguiente!.anio, 2027)
  assert.equal(m.siguiente!.mes, 1)
})

test('un mes inventado no se abre', async () => {
  await limpio()
  for (const [a, mm] of [[2026, 0], [2026, 13], [1800, 5], [3000, 5]]) {
    assert.equal((await dentro((q) => abrirMes(q, G, a!, mm!, 'es'))).hecho, false)
  }
})

test('solo se puede cerrar el mes abierto más antiguo', async () => {
  await limpio()
  await dentro((q) => abrirMes(q, G, 2026, 2, 'es'))
  await dentro((q) => abrirMes(q, G, 2026, 3, 'es'))
  const m = await dentro((q) => meses(q, G, 'es'))

  const febrero = m.lista.find((p) => p.mes === 2)!
  const marzo = m.lista.find((p) => p.mes === 3)!
  // Cerrar marzo dejando febrero abierto deja un agujero por el que entran asientos
  // a un mes que ya se declaró.
  assert.equal(febrero.puedeCerrar, true)
  assert.equal(marzo.puedeCerrar, false)

  const r = await dentro((q) => cerrarMes(q, G, 2026, 3, YO, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { motivo: string }).motivo, /anterior todavía abierto/)
})

test('cerrado el anterior, el siguiente ya se puede cerrar', async () => {
  await limpio()
  await dentro((q) => abrirMes(q, G, 2026, 2, 'es'))
  await dentro((q) => abrirMes(q, G, 2026, 3, 'es'))
  assert.deepEqual(await dentro((q) => cerrarMes(q, G, 2026, 2, YO, 'es')), { hecho: true })
  assert.deepEqual(await dentro((q) => cerrarMes(q, G, 2026, 3, YO, 'es')), { hecho: true })

  const m = await dentro((q) => meses(q, G, 'es'))
  assert.equal(m.lista.every((p) => !p.abierto), true)
})

test('un mes cerrado no admite un asiento más', async () => {
  await limpio()
  await dentro((q) => abrirMes(q, G, 2026, 2, 'es'))
  await dentro((q) => cerrarMes(q, G, 2026, 2, YO, 'es'))

  await assert.rejects(dentro((q) => q`
    insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                         descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
    values (${randomUUID()}::uuid, ${G}::uuid, siguiente_asiento(${G}::uuid),
            '2026-02-15', 2026, 2,'Prueba','Test','prueba', ${randomUUID()}::uuid, ${YO}::uuid)
  `), /cerrad/i)
})

test('la lista dice cuántos asientos lleva cada mes y si cuadra', async () => {
  await limpio()
  await dentro((q) => abrirMes(q, G, 2026, 2, 'es'))
  const m = await dentro((q) => meses(q, G, 'es'))
  const febrero = m.lista[0]!
  assert.equal(febrero.asientos, 0)
  assert.equal(febrero.cuadra, true)
  // El nombre lo da el propio sistema, no una lista de doce cadenas escrita a mano.
  assert.match(febrero.nombre.toLowerCase(), /febrero/)
})

test('la pantalla ofrece abrir el siguiente con su nombre ya escrito', async () => {
  await limpio()
  await dentro((q) => abrirMes(q, G, 2026, 3, 'es'))
  const m = await dentro((q) => meses(q, G, 'es'))
  const h = pintarPeriodos(m, 'es', 'af-prueba')
  // Buscar el mes en un desplegable es un paso más entre alguien y lo que ha venido
  // a hacer.
  assert.match(h, /name="mes" value="4"/)
  assert.match(h, /abril/i)
  assert.equal(h.includes('<select'), false)
  assert.match(h, /name="af" value="af-prueba"/)
})

test('solo sale un botón de cerrar, el del mes más antiguo abierto', async () => {
  await limpio()
  await dentro((q) => abrirMes(q, G, 2026, 2, 'es'))
  await dentro((q) => abrirMes(q, G, 2026, 3, 'es'))
  const h = pintarPeriodos(await dentro((q) => meses(q, G, 'es')), 'es', 'af')
  assert.equal((h.match(/value="cerrar"/g) ?? []).length, 1)
})

test('se dice que un mes cerrado NO se reabre, y qué hacer en su lugar', async () => {
  await limpio()
  const h = pintarPeriodos(await dentro((q) => meses(q, G, 'es')), 'es', 'af')
  // Reabrir un mes ya declarado al SENIAT es como se acaba con dos versiones de la
  // misma declaración.
  assert.match(h, /No se puede reabrir/)
  assert.match(h, /asiento de reverso en el mes siguiente/)
})

test('la pantalla sale entera en los dos idiomas', async () => {
  await limpio()
  await dentro((q) => abrirMes(q, G, 2026, 3, 'es'))
  const en = pintarPeriodos(await dentro((q) => meses(q, G, 'en')), 'en', 'af')
  assert.match(en, /Accounting months/)
  assert.match(en, /April/i)
  assert.equal(en.includes('‹falta:'), false)
})
