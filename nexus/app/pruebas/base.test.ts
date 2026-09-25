/**
 * Que no vuelva a haber cuatro paletas.
 *
 * Los colores estuvieron escritos cuatro veces, una por pantalla, y las cuatro
 * copias habían derivado sin que nadie lo hiciera a propósito: la hoja de valuación
 * había perdido el ámbar, la de entrada no tenía fondo, y el verde de acento era un
 * tono distinto según dónde se mirara. Es la misma avería que «dos plantillas, una
 * para móvil y otra para escritorio», solo que más lenta de ver.
 *
 * Esto lo cierra: si alguien vuelve a declarar los colores dentro de una pantalla,
 * la prueba lo dice.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pagina, ESTILOS_BASE } from '../src/pantallas/base.ts'

const CARPETA = new URL('../src/pantallas/', import.meta.url).pathname
const PANTALLAS = readdirSync(CARPETA)
  .filter((f) => f.endsWith('.ts') && f !== 'base.ts')

test('ninguna pantalla declara sus propios colores', () => {
  for (const f of PANTALLAS) {
    const texto = readFileSync(join(CARPETA, f), 'utf-8')
    assert.equal(texto.includes('--nv:'), false, `${f} vuelve a declarar la paleta`)
    assert.equal(texto.includes('prefers-color-scheme'), false,
      `${f} vuelve a declarar el modo oscuro por su cuenta`)
  }
})

test('ninguna pantalla monta su propio documento', () => {
  for (const f of PANTALLAS) {
    const texto = readFileSync(join(CARPETA, f), 'utf-8')
    assert.equal(texto.includes('<!doctype html>'), false,
      `${f} monta el documento a mano en vez de usar la envoltura común`)
  }
})

test('ninguna pantalla repite la función de escapar', () => {
  // Dos versiones de escapar es como se cuela el texto de un cliente sin escapar
  // por una de las dos.
  for (const f of PANTALLAS) {
    const texto = readFileSync(join(CARPETA, f), 'utf-8')
    assert.equal(texto.includes('const escapar ='), false, `${f} tiene su propio escapar`)
  }
})

test('la envoltura declara el idioma y el modo oscuro', () => {
  const h = pagina({ idioma: 'es', titulo: 'Prueba', estilos: '', cabecera: '', cuerpo: '' })
  assert.match(h, /<html lang="es">/)
  assert.match(h, /prefers-color-scheme:dark/)
  // Y las tres declaraciones: la del sistema, la que deja forzar claro y la oscura.
  assert.match(ESTILOS_BASE, /:root:not\(\[data-theme="light"\]\)/)
  assert.match(ESTILOS_BASE, /:root\[data-theme="dark"\]/)
})

test('el título de la pestaña se escapa, y lleva el producto detrás', () => {
  const h = pagina({
    idioma: 'en', titulo: 'Operadora <X> & Cía', estilos: '', cabecera: '', cuerpo: '',
  })
  assert.match(h, /<title>Operadora &lt;X&gt; &amp; Cía · GPS Nexus<\/title>/)
  assert.equal(h.includes('<X>'), false)
})
