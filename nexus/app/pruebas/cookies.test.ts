import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ponerCookie, borrarCookie, leerCookie, idiomaPedido, NOMBRE_COOKIE } from '../src/servidor/cookies.ts'

test('la cookie lleva los cuatro atributos que la hacen segura', () => {
  const c = ponerCookie('testigo-abc')
  assert.match(c, /HttpOnly/)   // ningún guion de la página puede leerla
  assert.match(c, /Secure/)     // no viaja en claro
  assert.match(c, /SameSite=Lax/) // otra web no la puede provocar
  assert.match(c, /Path=\//)
})

test('no lleva Expires: la caducidad de verdad vive en la base de datos', () => {
  // Una caducidad en la cookie la pone el cliente y se puede falsificar.
  const c = ponerCookie('testigo-abc')
  assert.equal(/Expires|Max-Age/.test(c), false)
})

test('borrarla la vacía y la caduca de inmediato', () => {
  const c = borrarCookie()
  assert.match(c, new RegExp(`${NOMBRE_COOKIE}=;`))
  assert.match(c, /Max-Age=0/)
})

test('se lee el testigo entre otras cookies', () => {
  assert.equal(leerCookie(`otra=1; ${NOMBRE_COOKIE}=abc123; tercera=2`), 'abc123')
  assert.equal(leerCookie(`${NOMBRE_COOKIE}=abc123`), 'abc123')
})

test('sin cookie, o con la nuestra vacía, se devuelve nulo y no una cadena vacía', () => {
  // Una cadena vacía se cuela por un 'if (testigo)' mal escrito.
  assert.equal(leerCookie(undefined), null)
  assert.equal(leerCookie('otra=1'), null)
  assert.equal(leerCookie(`${NOMBRE_COOKIE}=`), null)
})

test('una cookie con nombre parecido no se confunde con la nuestra', () => {
  assert.equal(leerCookie(`${NOMBRE_COOKIE}_falsa=malo`), null)
  assert.equal(leerCookie(`otro_${NOMBRE_COOKIE}=malo`), null)
})

test('el idioma sale del navegador la primera vez', () => {
  assert.equal(idiomaPedido('en-US,en;q=0.9'), 'en')
  assert.equal(idiomaPedido('es-VE,es;q=0.9'), 'es')
})

test('se respeta el orden de preferencia, no el de aparición', () => {
  // El navegador puede listar primero uno con menos peso.
  assert.equal(idiomaPedido('fr-FR,fr;q=0.9,en;q=0.8,es;q=0.3'), 'en')
  assert.equal(idiomaPedido('fr-FR,fr;q=0.9,en;q=0.3,es;q=0.8'), 'es')
})

test('lo que la persona eligió manda sobre lo que diga el navegador', () => {
  assert.equal(idiomaPedido('en-US,en;q=0.9', 'es'), 'es')
  assert.equal(idiomaPedido('es-VE', 'en'), 'en')
})

test('un idioma que no tenemos cae en español, no en blanco', () => {
  assert.equal(idiomaPedido('ja-JP,ja;q=0.9'), 'es')
  assert.equal(idiomaPedido(undefined), 'es')
  assert.equal(idiomaPedido(''), 'es')
})
