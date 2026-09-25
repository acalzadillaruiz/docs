import { test } from 'node:test'
import assert from 'node:assert/strict'
import { testigoAnti, testigoAntiValido, fijarClave } from '../src/servidor/csrf.ts'

fijarClave('clave-de-prueba')

test('el testigo de una sesión vale para esa sesión', () => {
  assert.equal(testigoAntiValido('sesion-abc', testigoAnti('sesion-abc')), true)
})

test('el de otra sesión no vale', () => {
  assert.equal(testigoAntiValido('sesion-abc', testigoAnti('sesion-xyz')), false)
})

test('sin sesión, nada vale', () => {
  assert.equal(testigoAntiValido(null, testigoAnti('sesion-abc')), false)
})

test('vacío, ausente o de otro tipo no valen', () => {
  for (const malo of ['', undefined, null, 0, {}, []]) {
    assert.equal(testigoAntiValido('sesion-abc', malo), false, `debería rechazar: ${String(malo)}`)
  }
})

test('no se puede deducir el testigo de sesión a partir del antifalsificación', () => {
  // Con un hash a secas y un testigo de poca entropía, se podría probar y dar con él.
  // Con HMAC y clave del servidor, no: el resultado no depende solo de la entrada.
  const a = testigoAnti('sesion-abc')
  fijarClave('otra-clave-distinta')
  const b = testigoAnti('sesion-abc')
  assert.notEqual(a, b)
  fijarClave('clave-de-prueba')
})

test('el testigo no contiene el de sesión', () => {
  assert.equal(testigoAnti('sesion-abc').includes('sesion-abc'), false)
})
