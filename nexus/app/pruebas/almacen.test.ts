/**
 * El almacén de documentos.
 *
 * Guarda por huella, no por nombre. Aquí se comprueba sobre todo lo que pasaría si
 * la huella viniera torcida: es lo único de este archivo que construye una ruta, y
 * una ruta armada con texto de fuera es la forma clásica de leer lo que no toca.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Almacen, rutaDe, HuellaInvalida, DocumentoAusente } from '../src/servidor/almacen.ts'

let raiz = ''
let a: Almacen

const bytes = (t: string) => new TextEncoder().encode(t)
const sha = (t: string) => createHash('sha256').update(bytes(t)).digest('hex')

before(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'nexus-almacen-'))
  a = new Almacen(raiz)
})
after(async () => { await rm(raiz, { recursive: true, force: true }) })

test('lo guardado se lee igual, byte a byte', async () => {
  const contenido = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a])
  const { huella } = await a.guardar(contenido)
  assert.deepEqual(await a.leer(huella), contenido)
})

test('la huella es la del contenido, no la del nombre', async () => {
  const { huella } = await a.guardar(bytes('colada 44821'))
  assert.equal(huella, sha('colada 44821'))
})

test('el mismo documento dos veces ocupa una vez', async () => {
  // En procura no es un detalle: el mismo certificado acompaña a las cuatro
  // válvulas del mismo lote, y hoy se sube cuatro veces.
  const uno = await a.guardar(bytes('certificado idéntico'))
  const dos = await a.guardar(bytes('certificado idéntico'))
  assert.equal(uno.yaEstaba, false)
  assert.equal(dos.yaEstaba, true)
  assert.equal(uno.huella, dos.huella)
})

test('dos documentos distintos no se pisan', async () => {
  const uno = await a.guardar(bytes('acta A'))
  const dos = await a.guardar(bytes('acta B'))
  assert.notEqual(uno.huella, dos.huella)
  assert.deepEqual(await a.leer(uno.huella), bytes('acta A'))
  assert.deepEqual(await a.leer(dos.huella), bytes('acta B'))
})

test('una huella que no es una huella no llega al disco', async () => {
  for (const mala of [
    '../../../etc/passwd',
    '..',
    'a'.repeat(63),
    'a'.repeat(65),
    'ABCDEF' + 'a'.repeat(58),   // mayúsculas: la huella se escribe en minúsculas
    '../' + 'a'.repeat(61),
    '',
  ]) {
    assert.throws(() => rutaDe(raiz, mala), HuellaInvalida, `pasó: ${mala}`)
    await assert.rejects(a.leer(mala), HuellaInvalida)
  }
})

test('pedir algo que no está da un error propio, no uno del sistema', async () => {
  // Un error del sistema lleva dentro la ruta, y una ruta enseña dónde vive todo.
  await assert.rejects(a.leer(sha('nunca se guardó')), DocumentoAusente)
})

test('la ruta reparte en dos niveles, para no dejar cien mil archivos juntos', () => {
  const h = sha('x')
  const r = rutaDe(raiz, h)
  assert.ok(r.endsWith(join(h.slice(0, 2), h.slice(2, 4), h)))
  assert.ok(r.startsWith(raiz + '/'))
})

test('se puede comprobar que lo guardado sigue siendo lo que dice ser', async () => {
  const { huella } = await a.guardar(bytes('acta de recepción'))
  assert.equal(await a.intacto(huella), true)

  // Un disco que se degrada en silencio no avisa. Aquí se simula a mano.
  await writeFile(rutaDe(raiz, huella), bytes('acta cambiada'))
  assert.equal(await a.intacto(huella), false,
    'un documento cambiado por debajo tiene que delatarse')
})

test('lo que no está tampoco está intacto, y no revienta', async () => {
  assert.equal(await a.intacto(sha('no existe')), false)
  assert.equal(await a.intacto('no-es-una-huella'), false)
})

test('el archivo queda en disco con exactamente los bytes que entraron', async () => {
  const contenido = new Uint8Array([0, 1, 2, 253, 254, 255])
  const { huella } = await a.guardar(contenido)
  assert.deepEqual(new Uint8Array(await readFile(rutaDe(raiz, huella))), contenido)
})
