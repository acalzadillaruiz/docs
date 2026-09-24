/**
 * Las cinco comprobaciones que no se pueden saltar al entrar con la cuenta de la
 * empresa. Cada una de estas pruebas describe una forma real de colarse.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validar, iniciarPeticion, estadoValido, huellaSujeto,
  type Afirmaciones, type Esperado,
} from '../src/dominio/empresa.ts'

const AHORA = new Date('2026-09-24T22:00:00Z')
const SEG = Math.floor(AHORA.getTime() / 1000)
const NONCE = 'el-nonce-de-esta-peticion'

const ESPERADO: Esperado = {
  emisor: 'https://login.microsoftonline.com/t-operadora/v2.0',
  destinatario: 'gps-nexus',
  inquilino: 't-operadora',
  metodo: 'microsoft',
}

const BUENAS: Afirmaciones = {
  iss: ESPERADO.emisor,
  aud: ESPERADO.destinatario,
  sub: 'sujeto-del-ingeniero',
  tid: 't-operadora',
  email: 'Ingeniero@Operadora.com',
  email_verified: true,
  exp: SEG + 3600,
  iat: SEG - 30,
  nonce: NONCE,
}

test('un testigo correcto pasa, y el correo sale en minúsculas', () => {
  const v = validar(BUENAS, ESPERADO, NONCE, AHORA)
  assert.equal(v.valido, true)
  assert.equal((v as { correo: string }).correo, 'ingeniero@operadora.com')
})

test('un testigo de otro emisor no vale, por válido que sea en su sitio', () => {
  const v = validar({ ...BUENAS, iss: 'https://accounts.google.com' }, ESPERADO, NONCE, AHORA)
  assert.deepEqual(v, { valido: false, motivo: 'emisor_distinto' })
})

test('un testigo emitido para otra aplicación del mismo emisor tampoco', () => {
  const v = validar({ ...BUENAS, aud: 'otra-aplicacion' }, ESPERADO, NONCE, AHORA)
  assert.deepEqual(v, { valido: false, motivo: 'destinatario_distinto' })
})

test('con varios destinatarios, basta con que el nuestro esté', () => {
  const v = validar({ ...BUENAS, aud: ['otra', 'gps-nexus'] }, ESPERADO, NONCE, AHORA)
  assert.equal(v.valido, true)
})

test('alguien con un Microsoft personal NO entra: falta el inquilino de la operadora', () => {
  // Es el error clásico. Microsoft emite testigos para todo el mundo; sin exigir el
  // inquilino, cualquiera con una cuenta de Hotmail entra en el portal del cliente.
  const v = validar({ ...BUENAS, tid: '9188040d-personal' }, ESPERADO, NONCE, AHORA)
  assert.deepEqual(v, { valido: false, motivo: 'inquilino_distinto' })
})

test('sin inquilino en el testigo, tampoco', () => {
  const { tid: _, ...sinTid } = BUENAS
  assert.deepEqual(validar(sinTid, ESPERADO, NONCE, AHORA),
    { valido: false, motivo: 'inquilino_distinto' })
})

test('en Google el inquilino es el dominio alojado', () => {
  const google: Esperado = {
    emisor: 'https://accounts.google.com', destinatario: 'gps-nexus',
    inquilino: 'operadora.com', metodo: 'google',
  }
  // Se quita 'tid' en vez de ponerlo a undefined: con exactOptionalPropertyTypes,
  // una propiedad ausente y una puesta a undefined no son lo mismo, y aquí el
  // testigo de Google sencillamente no trae ese campo.
  const { tid: _sinTid, ...base } = BUENAS
  const buenas = { ...base, iss: google.emisor, hd: 'operadora.com' }
  assert.equal(validar(buenas, google, NONCE, AHORA).valido, true)
  assert.deepEqual(validar({ ...buenas, hd: 'gmail.com' }, google, NONCE, AHORA),
    { valido: false, motivo: 'inquilino_distinto' })
})

test('un testigo sin el nonce de esta petición no vale', () => {
  // Sin nonce, un testigo robado de otra sesión sirve.
  assert.deepEqual(validar({ ...BUENAS, nonce: 'otro' }, ESPERADO, NONCE, AHORA),
    { valido: false, motivo: 'nonce_distinto' })
  const { nonce: _, ...sinNonce } = BUENAS
  assert.deepEqual(validar(sinNonce, ESPERADO, NONCE, AHORA),
    { valido: false, motivo: 'nonce_distinto' })
})

test('un testigo caducado no vale, pero hay margen para el reloj', () => {
  assert.deepEqual(validar({ ...BUENAS, exp: SEG - 3600 }, ESPERADO, NONCE, AHORA),
    { valido: false, motivo: 'caducado' })
  // Caducado hace treinta segundos: dentro del margen de dos minutos.
  assert.equal(validar({ ...BUENAS, exp: SEG - 30 }, ESPERADO, NONCE, AHORA).valido, true)
})

test('un testigo del futuro tampoco', () => {
  assert.deepEqual(validar({ ...BUENAS, iat: SEG + 3600 }, ESPERADO, NONCE, AHORA),
    { valido: false, motivo: 'futuro' })
})

test('un correo sin verificar no vale: en algunos proveedores basta con escribirlo', () => {
  assert.deepEqual(validar({ ...BUENAS, email_verified: false }, ESPERADO, NONCE, AHORA),
    { valido: false, motivo: 'correo_sin_verificar' })
})

test('sin sujeto y sin correo, no', () => {
  const { sub: _s, ...sinSub } = BUENAS
  const { email: _e, ...sinCorreo } = BUENAS
  assert.deepEqual(validar(sinSub, ESPERADO, NONCE, AHORA), { valido: false, motivo: 'sin_sujeto' })
  assert.deepEqual(validar(sinCorreo, ESPERADO, NONCE, AHORA), { valido: false, motivo: 'sin_correo' })
})

test('cada petición lleva estado y nonce propios, y son largos', () => {
  const a = iniciarPeticion('microsoft', AHORA)
  const b = iniciarPeticion('microsoft', AHORA)
  assert.notEqual(a.estado, b.estado)
  assert.notEqual(a.nonce, b.nonce)
  assert.ok(a.estado.length >= 43, 'el estado debería venir de 32 bytes')
})

test('el estado devuelto tiene que ser el mismo, y no puede ser viejo', () => {
  const p = iniciarPeticion('microsoft', AHORA)
  assert.equal(estadoValido(p, p.estado, AHORA), true)
  assert.equal(estadoValido(p, 'otro-estado', AHORA), false)
  const tarde = new Date(AHORA.getTime() + 11 * 60_000)
  assert.equal(estadoValido(p, p.estado, tarde), false)
})

test('la huella del sujeto no contiene el sujeto, y distingue emisores', () => {
  const h = huellaSujeto(ESPERADO.emisor, 'sujeto-del-ingeniero')
  assert.equal(h.includes('sujeto-del-ingeniero'), false)
  // El mismo sujeto en otro emisor es otra persona.
  assert.notEqual(h, huellaSujeto('https://accounts.google.com', 'sujeto-del-ingeniero'))
})
