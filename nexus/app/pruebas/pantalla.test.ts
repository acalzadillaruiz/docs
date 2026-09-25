import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pintarValuacion, type DatosValuacion } from '../src/pantallas/valuacion.ts'
import type { LineaHoja } from '../src/dominio/valuacion.ts'

const linea = (o: number, c: string, m: string, resta = false, total = false): LineaHoja =>
  ({ orden: o, concepto: c, base: null, porcentaje: null, monto: m, resta, total })

const DATOS: DatosValuacion = {
  id: '11111111-1111-1111-1111-111111111111',
  contratoId: '22222222-2222-2222-2222-222222222222',
  estadoCrudo: 'aprobada',
  puedeDecidir: false,
  puedeResponder: false,
  antifalsificacion: 'af-de-prueba',
  objeciones: [],
  contrato: 'GPS-2026-001',
  cliente: 'Operadora <Ejemplo> & Cía',
  numero: 1,
  desde: '01/09/2026',
  hasta: '30/09/2026',
  moneda: 'VES',
  estado: 'Aprobada',
  lineas: [
    linea(1, 'Obra ejecutada del período', 'Bs 1.000.000,00'),
    linea(4, 'Amortización de anticipo', '-Bs 200.000,00', true),
    linea(9, 'Neto a cobrar', 'Bs 740.037,50', false, true),
  ],
}

test('el neto va en su propio bloque, no como una línea más', () => {
  const h = pintarValuacion(DATOS, 'es')
  assert.match(h, /<div class="neto">[\s\S]*740\.037,50/)
  // Y no aparece además dentro de la lista de líneas.
  const cuerpo = h.slice(h.indexOf('<div class="cab">'), h.indexOf('<div class="neto">'))
  assert.equal(cuerpo.includes('740.037,50'), false)
})

test('lo que resta se marca con una clase, no con el signo', () => {
  const h = pintarValuacion(DATOS, 'es')
  assert.match(h, /class="ln resta"/)
})

test('el texto del cliente se escapa: un nombre con < o & no rompe la página', () => {
  const h = pintarValuacion(DATOS, 'es')
  assert.match(h, /Operadora &lt;Ejemplo&gt; &amp; Cía/)
  assert.equal(h.includes('<Ejemplo>'), false)
})

test('la página declara su idioma, para el lector de pantalla y el traductor del navegador', () => {
  assert.match(pintarValuacion(DATOS, 'es'), /<html lang="es">/)
  assert.match(pintarValuacion(DATOS, 'en'), /<html lang="en">/)
})

test('es una sola pantalla para las dos superficies, no dos', () => {
  const h = pintarValuacion(DATOS, 'es')
  // En el móvil las columnas se apilan; no hay una segunda plantilla.
  assert.match(h, /@media\(max-width:620px\)/)
  assert.match(h, /<meta name="viewport"/)
})

test('funciona en modo oscuro sin que el usuario elija nada', () => {
  const h = pintarValuacion(DATOS, 'es')
  assert.match(h, /@media \(prefers-color-scheme:dark\)/)
  assert.match(h, /:root\[data-theme="dark"\]/)
})

test('el título de la pestaña dice de qué valuación se trata', () => {
  assert.match(pintarValuacion(DATOS, 'es'), /<title>Valuación 1 · GPS-2026-001<\/title>/)
  assert.match(pintarValuacion(DATOS, 'en'), /<title>Progress payment 1 · GPS-2026-001<\/title>/)
})

test('los botones solo aparecen cuando se pueden pulsar de verdad', () => {
  // Enseñar un botón que va a rebotar enseña que la acción existe y esconde que no
  // te corresponde. Peor que no enseñarlo.
  const sin = pintarValuacion(DATOS, 'es')
  assert.equal(sin.includes('Aprobar esta valuación'), false)

  const con = pintarValuacion({ ...DATOS, puedeDecidir: true, estadoCrudo: 'presentada' }, 'es')
  assert.match(con, /Aprobar esta valuación/)
  assert.match(con, /action="\/valuaciones\/11111111-1111-1111-1111-111111111111\/aprobar"/)
})

test('los formularios que escriben llevan el testigo antifalsificación', () => {
  const h = pintarValuacion({ ...DATOS, puedeDecidir: true }, 'es')
  const cuantos = (h.match(/name="af" value="af-de-prueba"/g) ?? []).length
  assert.equal(cuantos, 2, 'lo llevan el de aprobar y el de objetar')
})

test('se avisa de que aprobar no se deshace, antes de pulsar', () => {
  const h = pintarValuacion({ ...DATOS, puedeDecidir: true }, 'es')
  assert.match(h, /Esto no se deshace/)
  assert.match(pintarValuacion({ ...DATOS, puedeDecidir: true }, 'en'), /cannot be undone/)
})

test('objetar exige escribir qué no cuadra', () => {
  const h = pintarValuacion({ ...DATOS, puedeDecidir: true }, 'es')
  assert.match(h, /<textarea[^>]*required/)
})

test('una objeción sin responder se marca distinto de una respondida', () => {
  const h = pintarValuacion({ ...DATOS, objeciones: [
    { id: 'aaaa1111-1111-1111-1111-111111111111',
      motivo: 'Faltan 12 horas de grúa', cuando: '14/09/2026', respuesta: null, respondidaEn: null },
    { id: 'bbbb2222-2222-2222-2222-222222222222',
      motivo: 'Falta el acta', cuando: '10/09/2026',
      respuesta: 'Se adjunta firmada', respondidaEn: '12/09/2026' },
  ] }, 'es')
  assert.match(h, /class="obj abierta"/)
  assert.match(h, /Sin responder todavía/)
  assert.match(h, /Se adjunta firmada/)
})

test('el texto de una objeción se escapa: lo escribe el cliente', () => {
  const h = pintarValuacion({ ...DATOS, objeciones: [
    { id: 'cccc3333-3333-3333-3333-333333333333',
      motivo: '<script>alert(1)</script>', cuando: '14/09/2026', respuesta: null, respondidaEn: null },
  ] }, 'es')
  assert.equal(h.includes('<script>alert(1)</script>'), false)
  assert.match(h, /&lt;script&gt;/)
})

test('desde la valuación se puede volver al contrato', () => {
  assert.match(pintarValuacion(DATOS, 'es'),
    /href="\/contratos\/22222222-2222-2222-2222-222222222222"/)
})

const ABIERTA = {
  id: 'aaaa1111-1111-1111-1111-111111111111',
  motivo: 'Faltan 12 horas de grúa', cuando: '14/09/2026',
  respuesta: null, respondidaEn: null,
} as const

test('desde dentro se puede responder una objeción abierta, ahí mismo', () => {
  // Sin esto habría que salir a otra pantalla a contestar, y lo que cuesta un
  // desvío no se hace: la objeción se queda abierta.
  const h = pintarValuacion({ ...DATOS, puedeResponder: true, objeciones: [ABIERTA] }, 'es')
  assert.match(h, /action="\/objeciones\/aaaa1111-1111-1111-1111-111111111111\/responder"/)
  assert.match(h, /name="respuesta"/)
  assert.match(h, /<textarea[^>]*required/)
})

test('el formulario de responder lleva el testigo antifalsificación y un destino propio', () => {
  const h = pintarValuacion({ ...DATOS, puedeResponder: true, objeciones: [ABIERTA] }, 'es')
  assert.match(h, /name="af" value="af-de-prueba"/)
  // El destino de vuelta es una ruta nuestra. La ruta además lo sanea, pero aquí
  // ya se manda bien de origen.
  assert.match(h, /name="volver" value="\/valuaciones\/11111111-1111-1111-1111-111111111111"/)
})

test('se recuerda por qué urge responder: sin respuesta no se factura', () => {
  const h = pintarValuacion({ ...DATOS, puedeResponder: true, objeciones: [ABIERTA] }, 'es')
  assert.match(h, /no se puede facturar/)
  assert.match(pintarValuacion({ ...DATOS, puedeResponder: true, objeciones: [ABIERTA] }, 'en'),
    /cannot be invoiced/)
})

test('el cliente NO ve el formulario de responder: no es suyo', () => {
  const h = pintarValuacion({ ...DATOS, puedeResponder: false, objeciones: [ABIERTA] }, 'es')
  assert.equal(h.includes('/responder'), false)
  assert.match(h, /Sin responder todavía/)
})

test('una objeción ya respondida no vuelve a ofrecer el formulario', () => {
  const h = pintarValuacion({ ...DATOS, puedeResponder: true, objeciones: [
    { ...ABIERTA, respuesta: 'Se retiran las 12 horas.', respondidaEn: '16/09/2026' },
  ] }, 'es')
  assert.equal(h.includes('/responder'), false)
  assert.match(h, /Se retiran las 12 horas/)
})
