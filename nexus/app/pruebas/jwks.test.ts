/**
 * La firma del testigo de identidad.
 *
 * Es lo único que separa «entrar con la cuenta de la empresa» de «entrar diciendo
 * que eres quien quieras». Se prueba con una clave RSA generada aquí mismo: no hace
 * falta red, y el ataque que importa —cambiar el algoritmo— no la necesita.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createSign, createHmac, randomUUID } from 'node:crypto'
import {
  verificarFirma, partes, mismaCadena, Claves, FirmaInvalida,
  type JuegoDeClaves,
} from '../src/servidor/jwks.ts'

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const KID = 'clave-de-prueba-1'
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }
const JUEGO: JuegoDeClaves = { keys: [JWK as never] }

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf-8').toString('base64url')

function firmar(cuerpo: object, cabecera: object = { alg: 'RS256', kid: KID, typ: 'JWT' }): string {
  const firmado = `${b64(cabecera)}.${b64(cuerpo)}`
  const s = createSign('RSA-SHA256')
  s.update(firmado)
  s.end()
  return `${firmado}.${s.sign(privateKey).toString('base64url')}`
}

const CUERPO = { iss: 'https://login.microsoftonline.com/x/v2.0', sub: 'u-1', email: 'a@b.test' }

test('un testigo bien firmado se acepta y devuelve su cuerpo', () => {
  const c = verificarFirma(firmar(CUERPO), JUEGO)
  assert.equal(c['sub'], 'u-1')
  assert.equal(c['email'], 'a@b.test')
})

test('alg:none NO pasa: el algoritmo lo decide quien verifica', () => {
  // Es el ataque clásico contra JWT, y funciona en más sitios de los que debería.
  const sin = `${b64({ alg: 'none', kid: KID })}.${b64(CUERPO)}.`
  assert.throws(() => verificarFirma(sin, JUEGO), FirmaInvalida)
})

test('cambiar RS256 por HS256 firmando con la clave PÚBLICA no pasa', () => {
  // La clave pública es pública. Si se aceptara HS256, cualquiera que la tenga
  // —cualquiera— podría firmar un testigo válido.
  const cabecera = { alg: 'HS256', kid: KID }
  const firmado = `${b64(cabecera)}.${b64(CUERPO)}`
  const publicaPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
  const h = createHmac('sha256', publicaPem).update(firmado).digest('base64url')
  assert.throws(() => verificarFirma(`${firmado}.${h}`, JUEGO), /solo se acepta RS256/)
})

test('un testigo sin kid no pasa: probar todas las claves acepta una retirada', () => {
  assert.throws(() => verificarFirma(firmar(CUERPO, { alg: 'RS256' }), JUEGO), /sin kid/)
})

test('un kid que no está en el juego no pasa', () => {
  assert.throws(
    () => verificarFirma(firmar(CUERPO, { alg: 'RS256', kid: 'otra' }), JUEGO),
    /kid desconocido/,
  )
})

test('cambiar una coma del cuerpo invalida la firma', () => {
  const bueno = firmar(CUERPO)
  const [c, , f] = bueno.split('.') as [string, string, string]
  const manipulado = `${c}.${b64({ ...CUERPO, sub: 'otro-usuario' })}.${f}`
  assert.throws(() => verificarFirma(manipulado, JUEGO), /la firma no cuadra/)
})

test('firmado con OTRA clave RSA no pasa', () => {
  const otra = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const firmado = `${b64({ alg: 'RS256', kid: KID })}.${b64(CUERPO)}`
  const s = createSign('RSA-SHA256')
  s.update(firmado)
  s.end()
  const malo = `${firmado}.${s.sign(otra.privateKey).toString('base64url')}`
  assert.throws(() => verificarFirma(malo, JUEGO), /la firma no cuadra/)
})

test('un testigo que no es un testigo se rechaza sin reventar', () => {
  for (const malo of ['', 'a', 'a.b', 'a.b.c.d', 'no.es.json', '...']) {
    assert.throws(() => verificarFirma(malo, JUEGO), FirmaInvalida, `pasó: ${malo}`)
  }
})

test('el error NO lleva el testigo dentro', () => {
  // Un testigo en un registro es la sesión de otro en manos de quien lea el registro.
  try {
    verificarFirma(firmar(CUERPO, { alg: 'none', kid: KID }), JUEGO)
    assert.fail('tenía que fallar')
  } catch (e) {
    assert.equal((e as Error).message.includes('eyJ'), false)
    assert.equal((e as Error).message.includes('a@b.test'), false)
  }
})

test('las partes se leen sin verificar, pero eso no devuelve nada usable solo', () => {
  const { cabecera, cuerpo } = partes(firmar(CUERPO))
  assert.equal(cabecera['kid'], KID)
  assert.equal(cuerpo['sub'], 'u-1')
  // Y la función que sí se usa nunca devuelve el cuerpo sin comprobar la firma: no
  // hay forma de obtenerlo «para mirarlo antes».
  assert.throws(() => verificarFirma(firmar(CUERPO, { alg: 'RS256', kid: 'x' }), JUEGO))
})

test('el juego de claves se guarda un rato y no se pide dos veces', async () => {
  let veces = 0
  const c = new Claves(async () => { veces++; return JUEGO })
  await c.de('https://p/keys', KID, 1000)
  await c.de('https://p/keys', KID, 2000)
  assert.equal(veces, 1, 'pedirlo en cada entrada hace del proveedor un punto de fallo')
})

test('un kid desconocido lo vuelve a pedir: los proveedores rotan sin avisar', async () => {
  let veces = 0
  const c = new Claves(async () => { veces++; return JUEGO })
  await c.de('https://p/keys', KID, 1000)
  await c.de('https://p/keys', 'kid-nuevo', 1000)
  // Sin este reintento, el día de la rotación no entra nadie.
  assert.equal(veces, 2)
})

test('pasado su rato, se vuelve a pedir', async () => {
  let veces = 0
  const c = new Claves(async () => { veces++; return JUEGO }, 1000)
  await c.de('https://p/keys', KID, 0)
  await c.de('https://p/keys', KID, 5000)
  assert.equal(veces, 2)
})

test('el estado y el nonce se comparan en tiempo constante', () => {
  const a = randomUUID()
  assert.equal(mismaCadena(a, a), true)
  assert.equal(mismaCadena(a, a.slice(0, -1) + 'x'), false)
  assert.equal(mismaCadena(a, ''), false)
  assert.equal(mismaCadena('', ''), true)
})
