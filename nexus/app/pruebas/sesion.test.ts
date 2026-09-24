/**
 * El flujo de entrada, contra la base de datos real.
 *
 * Lo que se comprueba no es que se pueda entrar: eso es lo fácil. Es que NO se pueda
 * entrar de las seis formas en que se suele poder.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { iniciar, completar, quienEs } from '../src/dominio/sesion.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const ORG = '0e1f2a3b-0000-0000-0000-00000000000a'
const YO  = '0e1f2a3b-0000-0000-0000-00000000000d'
const BAJA = '0e1f2a3b-0000-0000-0000-00000000000e'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLAVE = 'una clave razonable'
const AHORA = new Date('2026-09-24T22:00:00Z')

const codigoBueno = () => codigoEnPaso(desdeBase32(SECRETO), pasoDe(AHORA))
const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  const hash = await cifrarClave(CLAVE)
  await dentro(async (q) => {
    await q.unsafe(`set local role none`)
    await q`insert into organizacion (id, tipo, nombre, rif)
            values (${ORG},'gps','GPS Sesiones','J-955555555-5') on conflict do nothing`
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${ORG},'entrada@prueba.test','Quien entra','clave_2fa', ${hash}, ${SECRETO}),
                   (${BAJA}, ${ORG},'baja@prueba.test','Dado de baja','clave_2fa', ${hash}, ${SECRETO})
            on conflict do nothing`
    await q`update persona set activa = false where id = ${BAJA}::uuid`
    await q`delete from intento_acceso where correo like '%@prueba.test'`
  })
})

after(async () => { await cerrar() })

const origenUnico = () => `origen-${Math.random().toString(36).slice(2)}`

test('con clave y código correctos se entra', async () => {
  const o = origenUnico()
  const r1 = await dentro((q) => iniciar(q, { correo: 'entrada@prueba.test', clave: CLAVE, origen: o }))
  assert.equal(r1.estado, 'falta_segundo_factor')
  const r2 = await dentro((q) =>
    completar(q, (r1 as { desafio: string }).desafio, codigoBueno(), o, AHORA))
  assert.equal(r2.estado, 'dentro')
})

test('la clave sola NUNCA basta: siempre hace falta el segundo factor', async () => {
  const o = origenUnico()
  const r = await dentro((q) => iniciar(q, { correo: 'entrada@prueba.test', clave: CLAVE, origen: o }))
  assert.equal(r.estado, 'falta_segundo_factor')
  assert.equal('testigo' in r, false)
})

test('un correo que no existe y una clave mala dan exactamente el mismo resultado', async () => {
  // Si se distinguieran, la pantalla de entrada sería un buscador de correos válidos.
  const a = await dentro((q) =>
    iniciar(q, { correo: 'nadie@prueba.test', clave: CLAVE, origen: origenUnico() }))
  const b = await dentro((q) =>
    iniciar(q, { correo: 'entrada@prueba.test', clave: 'esta no es', origen: origenUnico() }))
  assert.deepEqual(a, b)
  assert.equal(a.estado, 'rechazado')
})

test('un correo inexistente tarda lo mismo que uno real: no se delata por rapidez', async () => {
  const medir = async (correo: string) => {
    const t = process.hrtime.bigint()
    await dentro((q) => iniciar(q, { correo, clave: CLAVE, origen: origenUnico() }))
    return Number(process.hrtime.bigint() - t) / 1e6
  }
  const inexistente = await medir('nadie2@prueba.test')
  const real = await medir('entrada@prueba.test')
  // Si el inexistente saliera sin verificar nada, tardaría una fracción.
  assert.ok(inexistente > real * 0.4,
    `inexistente ${inexistente.toFixed(0)} ms contra real ${real.toFixed(0)} ms`)
})

test('una cuenta dada de baja no entra, aunque la clave sea correcta', async () => {
  const r = await dentro((q) =>
    iniciar(q, { correo: 'baja@prueba.test', clave: CLAVE, origen: origenUnico() }))
  assert.equal(r.estado, 'rechazado')
})

test('el desafío se quema al primer código equivocado', async () => {
  // Si sobreviviera, se podrían probar los diez mil códigos posibles con una sola
  // verificación de clave.
  const o = origenUnico()
  const r1 = await dentro((q) => iniciar(q, { correo: 'entrada@prueba.test', clave: CLAVE, origen: o }))
  const desafio = (r1 as { desafio: string }).desafio
  const malo = await dentro((q) => completar(q, desafio, '000000', o, AHORA))
  assert.equal(malo.estado, 'rechazado')
  const luegoElBueno = await dentro((q) => completar(q, desafio, codigoBueno(), o, AHORA))
  assert.equal(luegoElBueno.estado, 'rechazado')
})

test('un desafío inventado no sirve para saltarse la clave', async () => {
  const r = await dentro((q) => completar(q, 'esto-me-lo-invento', codigoBueno(), origenUnico(), AHORA))
  assert.equal(r.estado, 'rechazado')
})

test('el testigo identifica a su dueño, y uno inventado no', async () => {
  const o = origenUnico()
  const r1 = await dentro((q) => iniciar(q, { correo: 'entrada@prueba.test', clave: CLAVE, origen: o }))
  const r2 = await dentro((q) =>
    completar(q, (r1 as { desafio: string }).desafio, codigoBueno(), o, AHORA))
  const testigo = (r2 as { testigo: string }).testigo
  assert.equal(await dentro((q) => quienEs(q, testigo)), YO)
  assert.equal(await dentro((q) => quienEs(q, 'testigo-inventado')), null)
})

test('tras tres fallos, ese origen espera; y el dueño desde otro sitio entra igual', async () => {
  const atacante = origenUnico()
  for (let i = 0; i < 3; i++) {
    await dentro((q) => iniciar(q, { correo: 'entrada@prueba.test', clave: 'mala', origen: atacante }))
  }
  const frenado = await dentro((q) =>
    iniciar(q, { correo: 'entrada@prueba.test', clave: CLAVE, origen: atacante }))
  assert.equal(frenado.estado, 'espera')

  const dueno = await dentro((q) =>
    iniciar(q, { correo: 'entrada@prueba.test', clave: CLAVE, origen: origenUnico() }))
  assert.equal(dueno.estado, 'falta_segundo_factor')
})
