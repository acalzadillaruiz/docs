import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verificar, codigoEnPaso, desdeBase32, pasoDe, SecretoInvalido } from '../src/dominio/totp.ts'

// Vectores del RFC 6238. El secreto es '12345678901234567890' en base32.
// Si estos cuatro no salen, la implementación está mal, por bien que parezca.
const RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

test('los vectores del RFC 6238 salen exactos', () => {
  const s = desdeBase32(RFC)
  // El RFC da códigos de 8 dígitos; aquí se comprueban los 6 de la derecha,
  // que es lo que usa Google Authenticator.
  assert.equal(codigoEnPaso(s, Math.floor(59 / 30)), '287082')
  assert.equal(codigoEnPaso(s, Math.floor(1111111109 / 30)), '081804')
  assert.equal(codigoEnPaso(s, Math.floor(1111111111 / 30)), '050471')
  assert.equal(codigoEnPaso(s, Math.floor(1234567890 / 30)), '005924')
})

test('el código del momento vale', () => {
  const ahora = new Date('2026-09-24T22:00:00Z')
  const codigo = codigoEnPaso(desdeBase32(RFC), pasoDe(ahora))
  assert.equal(verificar(RFC, codigo, ahora), true)
})

test('el del paso anterior y el del siguiente también', () => {
  // Sin esta tolerancia, quien tenga el reloj treinta segundos desfasado no entra
  // nunca — y acaba pidiendo que se le quite el doble factor.
  const ahora = new Date('2026-09-24T22:00:00Z')
  const paso = pasoDe(ahora)
  const s = desdeBase32(RFC)
  assert.equal(verificar(RFC, codigoEnPaso(s, paso - 1), ahora), true)
  assert.equal(verificar(RFC, codigoEnPaso(s, paso + 1), ahora), true)
})

test('dos pasos de distancia ya no valen', () => {
  const ahora = new Date('2026-09-24T22:00:00Z')
  const s = desdeBase32(RFC)
  assert.equal(verificar(RFC, codigoEnPaso(s, pasoDe(ahora) - 2), ahora), false)
  assert.equal(verificar(RFC, codigoEnPaso(s, pasoDe(ahora) + 2), ahora), false)
})

test('un código de ayer no vale hoy', () => {
  const ayer = new Date('2026-09-23T22:00:00Z')
  const hoy = new Date('2026-09-24T22:00:00Z')
  const viejo = codigoEnPaso(desdeBase32(RFC), pasoDe(ayer))
  assert.equal(verificar(RFC, viejo, hoy), false)
})

test('se aceptan espacios, porque la gente los escribe', () => {
  const ahora = new Date('2026-09-24T22:00:00Z')
  const c = codigoEnPaso(desdeBase32(RFC), pasoDe(ahora))
  assert.equal(verificar(RFC, `${c.slice(0, 3)} ${c.slice(3)}`, ahora), true)
})

test('lo que no sea seis dígitos se rechaza sin tocar la criptografía', () => {
  const ahora = new Date('2026-09-24T22:00:00Z')
  for (const malo of ['', '12345', '1234567', 'abcdef', '12 34 5', '−12345']) {
    assert.equal(verificar(RFC, malo, ahora), false, `debería rechazar: ${malo}`)
  }
})

test('un secreto que no es base32 se rechaza diciendo qué carácter sobra', () => {
  assert.throws(() => desdeBase32('ABC1!'), SecretoInvalido)
})

test('el código correcto de otro secreto no vale', () => {
  const ahora = new Date('2026-09-24T22:00:00Z')
  const otro = 'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U'
  const c = codigoEnPaso(desdeBase32(otro), pasoDe(ahora))
  assert.equal(verificar(RFC, c, ahora), false)
})
