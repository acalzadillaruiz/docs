import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pintarValuacion, type DatosValuacion } from '../src/pantallas/valuacion.ts'
import type { LineaHoja } from '../src/dominio/valuacion.ts'

const linea = (o: number, c: string, m: string, resta = false, total = false): LineaHoja =>
  ({ orden: o, concepto: c, base: null, porcentaje: null, monto: m, resta, total })

const DATOS: DatosValuacion = {
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
