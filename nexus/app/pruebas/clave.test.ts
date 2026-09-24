import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cifrarClave, verificarClave, ClaveDemasiadoCorta,
  generarCodigosRecuperacion, huellaCodigo, codigoCoincide,
} from '../src/dominio/clave.ts'

test('una clave correcta se reconoce', async () => {
  const h = await cifrarClave('una clave razonable')
  assert.equal(await verificarClave('una clave razonable', h), true)
})

test('una clave equivocada no', async () => {
  const h = await cifrarClave('una clave razonable')
  assert.equal(await verificarClave('una clave razonablE', h), false)
  assert.equal(await verificarClave('', h), false)
})

test('la misma clave da huellas distintas: cada una lleva su sal', async () => {
  // Sin sal, dos personas con la misma clave tendrían la misma huella, y quien
  // leyera la base de datos sabría quiénes comparten clave.
  const a = await cifrarClave('la misma clave de siempre')
  const b = await cifrarClave('la misma clave de siempre')
  assert.notEqual(a, b)
  assert.equal(await verificarClave('la misma clave de siempre', a), true)
  assert.equal(await verificarClave('la misma clave de siempre', b), true)
})

test('la huella no contiene la clave', async () => {
  const h = await cifrarClave('bombeo mecanico 2026')
  assert.equal(h.includes('bombeo'), false)
  assert.equal(h.includes('2026'), false)
})

test('los parámetros van dentro, para poder subir el coste más adelante', async () => {
  const h = await cifrarClave('una clave razonable')
  assert.match(h, /^scrypt\$32768\$8\$1\$/)
})

test('una clave corta se rechaza al crearla, no al usarla', async () => {
  await assert.rejects(() => cifrarClave('corta'), ClaveDemasiadoCorta)
})

test('los acentos se normalizan: la misma clave escrita de dos formas es la misma', async () => {
  // 'á' se puede escribir como un carácter o como 'a' más una tilde combinante.
  // Un teclado de móvil y uno de escritorio pueden producir formas distintas.
  const compuesta = 'perforación profunda'   // n + tilde combinante
  const precompuesta = 'perforación profunda'       // un solo carácter
  const h = await cifrarClave(compuesta)
  assert.equal(await verificarClave(precompuesta, h), true)
})

test('una huella corrompida no revienta: devuelve falso', async () => {
  for (const mala of ['', 'x', 'scrypt$32768$8$1$sal', 'bcrypt$a$b$c$d$e']) {
    assert.equal(await verificarClave('lo que sea aquí', mala), false)
  }
})

test('se generan diez códigos de recuperación, todos distintos', () => {
  const c = generarCodigosRecuperacion()
  assert.equal(c.length, 10)
  assert.equal(new Set(c).size, 10)
})

test('los códigos no llevan caracteres que se confunden al copiarlos a mano', () => {
  // Estos códigos se apuntan en papel. Un 0 que se lee como O en el peor momento
  // es lo que hace que la gente acabe desactivando el doble factor.
  for (const c of generarCodigosRecuperacion(50)) {
    assert.doesNotMatch(c, /[0O1IL]/, `el código ${c} lleva un carácter ambiguo`)
  }
})

test('un código se reconoce aunque se escriba en minúsculas o sin el guion', () => {
  const [codigo] = generarCodigosRecuperacion(1)
  const h = huellaCodigo(codigo!)
  assert.equal(codigoCoincide(codigo!.toLowerCase(), h), true)
  assert.equal(codigoCoincide(codigo!.replace('-', ''), h), true)
  assert.equal(codigoCoincide(codigo!.replace('-', ' '), h), true)
})

test('la huella guardada no permite reconstruir el código', () => {
  const [codigo] = generarCodigosRecuperacion(1)
  const h = huellaCodigo(codigo!)
  assert.equal(h.includes(codigo!.replace('-', '')), false)
})

test('otro código no coincide', () => {
  const [a, b] = generarCodigosRecuperacion(2)
  assert.equal(codigoCoincide(b!, huellaCodigo(a!)), false)
})
