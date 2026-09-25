/**
 * Leer un formulario con archivo.
 *
 * Es lo único del servidor que acepta bytes arbitrarios de fuera, así que aquí se
 * prueba sobre todo lo que llega mal: el nombre con ruta dentro, el cuerpo que
 * pasa del techo, la parte que no termina, y el byte de más que cambiaría la huella.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  partir, campos, archivo, frontera, nombreLimpio,
  MultipartMalFormado, DemasiadoGrande,
} from '../src/servidor/multipart.ts'

const F = 'XbOuNdArY42'

/** Arma un cuerpo como lo armaría un navegador, con CRLF de verdad. */
function cuerpo(partes: Array<{ nombre: string; archivo?: string; tipo?: string; valor: string | Buffer }>): Buffer {
  const trozos: Buffer[] = []
  for (const p of partes) {
    let cab = `--${F}\r\nContent-Disposition: form-data; name="${p.nombre}"`
    if (p.archivo !== undefined) cab += `; filename="${p.archivo}"`
    cab += '\r\n'
    if (p.tipo) cab += `Content-Type: ${p.tipo}\r\n`
    cab += '\r\n'
    trozos.push(Buffer.from(cab, 'utf-8'))
    trozos.push(Buffer.isBuffer(p.valor) ? p.valor : Buffer.from(p.valor, 'utf-8'))
    trozos.push(Buffer.from('\r\n', 'utf-8'))
  }
  trozos.push(Buffer.from(`--${F}--\r\n`, 'utf-8'))
  return Buffer.concat(trozos)
}

test('la frontera se saca del tipo de contenido, con comillas o sin ellas', () => {
  assert.equal(frontera(`multipart/form-data; boundary=${F}`), F)
  assert.equal(frontera(`multipart/form-data; boundary="${F}"`), F)
  assert.equal(frontera(`Multipart/Form-Data; charset=utf-8; boundary=${F}`), F)
  // Lo que no es multipart no tiene frontera, y no se inventa una.
  assert.equal(frontera('application/x-www-form-urlencoded'), null)
  assert.equal(frontera(undefined), null)
})

test('campos y archivo salen separados', () => {
  const partes = partir(cuerpo([
    { nombre: 'clase', valor: 'certificado' },
    { nombre: 'antifalsificacion', valor: 'af-123' },
    { nombre: 'documento', archivo: 'mtr.pdf', tipo: 'application/pdf', valor: 'colada 44821' },
  ]), F)

  assert.deepEqual(campos(partes), { clase: 'certificado', antifalsificacion: 'af-123' })
  const a = archivo(partes, 'documento')!
  assert.equal(a.archivo, 'mtr.pdf')
  assert.equal(a.tipoMime, 'application/pdf')
  assert.equal(Buffer.from(a.contenido).toString('utf-8'), 'colada 44821')
})

test('el contenido sale byte a byte: un CRLF de más cambiaría la huella', () => {
  // Es lo único que importa de verdad aquí. La identidad del documento es su huella,
  // y una huella mal calculada rompe todo lo que se apoya en ella.
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x0d, 0x0a, 0x00, 0xff, 0x0d, 0x0a])
  const partes = partir(cuerpo([
    { nombre: 'documento', archivo: 'raro.bin', tipo: 'application/octet-stream', valor: bytes },
  ]), F)
  const a = archivo(partes, 'documento')!
  assert.equal(Buffer.from(a.contenido).length, bytes.length)
  assert.deepEqual(Buffer.from(a.contenido), bytes)
  assert.equal(
    createHash('sha256').update(a.contenido).digest('hex'),
    createHash('sha256').update(bytes).digest('hex'),
  )
})

test('un archivo que termina en CRLF conserva su CRLF', () => {
  // El CRLF de antes de la frontera es de la frontera. El del archivo es del archivo.
  const bytes = Buffer.from('linea\r\n', 'utf-8')
  const partes = partir(cuerpo([
    { nombre: 'd', archivo: 'a.txt', tipo: 'text/plain', valor: bytes },
  ]), F)
  assert.deepEqual(Buffer.from(archivo(partes, 'd')!.contenido), bytes)
})

test('del nombre del archivo no queda ninguna ruta', () => {
  assert.equal(nombreLimpio('../../etc/passwd'), 'passwd')
  assert.equal(nombreLimpio('C:\\Users\\adolfo\\acta.pdf'), 'acta.pdf')
  assert.equal(nombreLimpio('/tmp/x/y/z.jpg'), 'z.jpg')
  // Un salto de línea en el nombre permitiría inyectar una cabecera entera. Aquí
  // además se corta antes por la barra, así que del intento no queda ni el intento.
  const inyectado = nombreLimpio('acta\r\nContent-Type: text/html.pdf')
  assert.equal(inyectado, 'html.pdf')
  assert.equal(/[\r\n]/.test(inyectado), false)
  // Y un nombre que se queda en nada tiene que salir con algo, no vacío.
  assert.equal(nombreLimpio('...'), 'documento')
  assert.equal(nombreLimpio(''), 'documento')
})

test('el nombre no crece sin límite', () => {
  assert.equal(nombreLimpio('a'.repeat(5000)).length, 120)
})

test('un cuerpo por encima del techo se rechaza', () => {
  const grande = cuerpo([
    { nombre: 'd', archivo: 'g.bin', tipo: 'application/octet-stream',
      valor: Buffer.alloc(2048) },
  ])
  assert.throws(() => partir(grande, F, { maxBytes: 1024, maxPartes: 8 }), DemasiadoGrande)
})

test('demasiadas partes se rechazan: no todo el gasto viene del tamaño', () => {
  const muchas = cuerpo(Array.from({ length: 30 }, (_, i) => ({ nombre: `c${i}`, valor: 'x' })))
  assert.throws(() => partir(muchas, F, { maxBytes: 1 << 20, maxPartes: 8 }), MultipartMalFormado)
})

test('un cuerpo sin frontera no se entiende, y lo dice', () => {
  assert.throws(() => partir(Buffer.from('cualquier cosa'), F), MultipartMalFormado)
})

test('una parte que no termina no se entiende', () => {
  const roto = Buffer.from(`--${F}\r\nContent-Disposition: form-data; name="d"\r\n\r\nhola`)
  assert.throws(() => partir(roto, F), MultipartMalFormado)
})

test('un archivo vacío no cuenta como archivo', () => {
  // El navegador manda la parte aunque no se eligiera nada. Tratarlo como archivo
  // haría entrar un documento de cero bytes que no prueba nada.
  const partes = partir(cuerpo([
    { nombre: 'documento', archivo: '', tipo: 'application/octet-stream', valor: '' },
  ]), F)
  assert.equal(archivo(partes, 'documento'), null)
})

test('sin tipo declarado se asume el genérico, no se adivina', () => {
  const partes = partir(cuerpo([{ nombre: 'd', archivo: 'x.pdf', valor: 'algo' }]), F)
  assert.equal(archivo(partes, 'd')!.tipoMime, 'application/octet-stream')
})
