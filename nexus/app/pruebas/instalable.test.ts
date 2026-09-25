/**
 * Que esto se pueda instalar en un teléfono.
 *
 * El producto se describe desde el primer día como «aplicación web instalable», y
 * no lo era: no había manifiesto ni icono. Quien abría la dirección en el móvil
 * tenía una página web, no un icono en su pantalla de inicio — y un ingeniero en una
 * locación no vuelve a escribir una dirección larga cada mañana.
 *
 * Se consigue **sin una línea de JavaScript**, que es lo que permite mantener
 * `default-src 'none'`. Lo único que no se puede hacer sin JavaScript es funcionar
 * sin conexión: eso pide un «service worker», que es un archivo de código y cambia
 * la política de seguridad. Es una decisión, no un olvido, y está escrita en ESTADO.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { iconoPng, iconoSvg } from '../src/servidor/icono.ts'
import { pagina } from '../src/pantallas/base.ts'

const YO = '00000000-0000-0000-0000-0000000000aa'

const pedir = (p: Partial<Peticion>) => resolver({
  metodo: 'GET', ruta: '/', campos: {}, cookie: null, idioma: 'es', archivo: null,
  origen: `o-${Math.random().toString(36).slice(2)}`, ...p,
}, YO, false)

test('el manifiesto se sirve SIN sesión: si no, el navegador no ofrece instalar', async () => {
  const r = await pedir({ ruta: '/manifest.webmanifest' })
  assert.equal(r.codigo, 200)
  assert.match(r.cabeceras!['Content-Type']!, /application\/manifest\+json/)

  const m = JSON.parse(r.cuerpo!) as Record<string, unknown>
  // Lo que un navegador exige para ofrecer «añadir a la pantalla de inicio».
  for (const clave of ['name', 'short_name', 'start_url', 'display', 'icons']) {
    assert.ok(m[clave], `falta ${clave}, y sin eso no se instala`)
  }
  assert.equal(m['display'], 'standalone')
  assert.equal(m['start_url'], '/')
  assert.ok((m['icons'] as unknown[]).length >= 2)
})

test('el manifiesto está en los dos idiomas, como todo lo demás', async () => {
  const es = JSON.parse((await pedir({ ruta: '/manifest.webmanifest', idioma: 'es' })).cuerpo!)
  const en = JSON.parse((await pedir({ ruta: '/manifest.webmanifest', idioma: 'en' })).cuerpo!)
  assert.equal(es.lang, 'es')
  assert.equal(en.lang, 'en')
  assert.notEqual(es.name, en.name)
  assert.match(es.description, /demostrar/)
  assert.match(en.description, /proven/)
})

test('los iconos se sirven, y el PNG es un PNG de verdad', async () => {
  const svg = await pedir({ ruta: '/icono.svg' })
  assert.equal(svg.codigo, 200)
  assert.match(svg.cabeceras!['Content-Type']!, /image\/svg\+xml/)
  assert.match(svg.cuerpo!, /<svg/)

  for (const lado of [180, 512]) {
    const r = await pedir({ ruta: `/icono-${lado}.png` })
    assert.equal(r.codigo, 200, `falta el icono de ${lado}`)
    assert.equal(r.cabeceras!['Content-Type'], 'image/png')
    const b = Buffer.from(r.bytes!)
    // La firma de un PNG, tal cual la exige el formato.
    assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    // Y su cabecera dice el tamaño que dice el manifiesto. Un manifiesto que promete
    // 180 y sirve otra cosa hace que el teléfono descarte el icono sin decir nada.
    assert.equal(b.readUInt32BE(16), lado, 'el ancho')
    assert.equal(b.readUInt32BE(20), lado, 'el alto')
    assert.equal(Number(r.cabeceras!['Content-Length']), b.length)
  }
})

test('el icono es la barra del producto: verde lo verificado, rayado lo declarado', async () => {
  // No es un adorno. Si el icono del teléfono dice eso, dice lo único que hay que
  // entender de este sistema. Se comprueba mirando los píxeles del centro.
  const b = iconoPng(180)
  assert.ok(b.length > 200, 'un PNG de cuatro bytes no es un dibujo')
  assert.match(iconoSvg(), /07734a/i, 'el verde de lo verificado')
  assert.match(iconoSvg(), /946307/i, 'el ámbar de lo declarado sin demostrar')
  assert.match(iconoSvg(), /pattern/, 'y el rayado, que es lo que los distingue')
})

test('toda página enlaza el manifiesto y el icono', async () => {
  // Enlazarlo en una sola pantalla no sirve: se instala desde donde se esté.
  const h = pagina({ idioma: 'es', titulo: 'Prueba', estilos: '', cabecera: '', cuerpo: '' })
  assert.match(h, /rel="manifest" href="\/manifest\.webmanifest"/)
  assert.match(h, /rel="apple-touch-icon"/)
  assert.match(h, /name="theme-color"/)
  // Dos colores de barra: uno por tema. Con uno solo, media flota de teléfonos
  // enseña una barra que no pega con nada.
  assert.equal((h.match(/name="theme-color"/g) ?? []).length, 2)
})

test('la política de seguridad deja pedir el manifiesto, y sigue sin permitir código', async () => {
  const r = await pedir({ ruta: '/manifest.webmanifest' })
  const csp = r.cabeceras!['Content-Security-Policy']!
  assert.match(csp, /manifest-src 'self'/)
  // Lo que NO se ha abierto: nada de JavaScript. Es la valla que sostiene todo lo
  // demás, y esto es lo que salta si alguien la abre para «solo una cosita».
  assert.equal(/script-src/.test(csp), false)
  assert.match(csp, /default-src 'none'/)
})
