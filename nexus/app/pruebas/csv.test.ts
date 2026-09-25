/**
 * Leer una hoja exportada de Excel.
 *
 * Aquí es donde se pierde información sin enterarse: un separador mal adivinado
 * parte «1.234,56» en dos columnas, y el importe que entra en la contabilidad es
 * otro. Todo lo de este archivo son casos reales de hojas venezolanas.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  leerHoja, separadorDe, sinBom, leerNumero, leerFecha,
  HojaVacia, HojaDemasiadoGrande,
} from '../src/servidor/csv.ts'

test('Excel en español separa con punto y coma, porque la coma es el decimal', () => {
  // Adivinarlo mal parte 1.234,56 en dos columnas.
  const h = leerHoja('fecha;concepto;monto\r\n03/04/2026;Cabezal;1.234,56\r\n')
  assert.equal(h.separador, ';')
  assert.deepEqual(h.filas[1], ['03/04/2026', 'Cabezal', '1.234,56'])
})

test('Excel en inglés separa con coma', () => {
  const h = leerHoja('date,item,amount\n2026-04-03,Wellhead,1234.56\n')
  assert.equal(h.separador, ',')
  assert.deepEqual(h.filas[1], ['2026-04-03', 'Wellhead', '1234.56'])
})

test('un punto y coma dentro de comillas no decide el formato del archivo', () => {
  const h = leerHoja('a,b\n"uno; dos",tres\n')
  assert.equal(h.separador, ',')
  assert.deepEqual(h.filas[1], ['uno; dos', 'tres'])
})

test('las comillas dobladas sobreviven: Cabezal 11" 5M', () => {
  // La descripción de un renglón petrolero lleva comillas casi siempre.
  const h = leerHoja('desc;monto\n"Cabezal 11"" 5M";100\n')
  assert.deepEqual(h.filas[1], ['Cabezal 11" 5M', '100'])
})

test('un salto de línea dentro de comillas no parte la fila', () => {
  const h = leerHoja('desc;monto\n"Cabezal\ncon nota";100\n')
  assert.equal(h.filas.length, 2)
  assert.deepEqual(h.filas[1], ['Cabezal\ncon nota', '100'])
})

test('los tres bytes invisibles de Excel se quitan', () => {
  // Si no, la primera cabecera no coincide con nada y nadie entiende por qué solo
  // falla la primera columna.
  const con = '﻿fecha;monto\n01/01/2026;10\n'
  assert.equal(sinBom(con).startsWith('fecha'), true)
  assert.equal(leerHoja(con).filas[0]![0], 'fecha')
})

test('la última fila entra aunque el archivo no termine en salto de línea', () => {
  const h = leerHoja('a;b\n1;2')
  assert.equal(h.filas.length, 2)
  assert.deepEqual(h.filas[1], ['1', '2'])
})

test('las filas totalmente vacías se descartan: las hojas llevan huecos', () => {
  const h = leerHoja('a;b\n1;2\n;\n\n3;4\n')
  assert.equal(h.filas.length, 3)
  assert.deepEqual(h.filas[2], ['3', '4'])
})

test('una hoja sin nada dice que no tiene nada', () => {
  assert.throws(() => leerHoja('\n\n;;\n'), HojaVacia)
})

test('una hoja descomunal se rechaza antes de comérsela entera', () => {
  const muchas = 'a;b\n' + '1;2\n'.repeat(50)
  assert.throws(() => leerHoja(muchas, ';', { maxFilas: 10, maxColumnas: 20 }),
    HojaDemasiadoGrande)
  const anchas = Array.from({ length: 40 }, (_, i) => `c${i}`).join(';')
  assert.throws(() => leerHoja(anchas, ';', { maxFilas: 100, maxColumnas: 10 }),
    HojaDemasiadoGrande)
})

test('el separador se puede imponer: adivinar no es obligatorio', () => {
  const h = leerHoja('a,b;c', ';')
  assert.deepEqual(h.filas[0], ['a,b', 'c'])
})

test('1.234,56 venezolano y 1,234.56 anglosajón son el mismo número', () => {
  assert.equal(leerNumero('1.234,56', 'ven'), 1234.56)
  assert.equal(leerNumero('1,234.56', 'ang'), 1234.56)
  // Y leídos con el formato equivocado dan otra cosa, que es justo el peligro.
  assert.notEqual(leerNumero('1.234,56', 'ang'), 1234.56)
})

test('un paréntesis es un negativo, que es como lo escribe la contabilidad', () => {
  assert.equal(leerNumero('(1.234,56)', 'ven'), -1234.56)
  assert.equal(leerNumero('-1.234,56', 'ven'), -1234.56)
})

test('lo que no es un número devuelve nada, NUNCA cero', () => {
  // Un cero silencioso es un importe que entra mal y que nadie ve.
  for (const malo of ['', '   ', 'N/A', 'pendiente', '12,34,56.78', '.', '-']) {
    assert.equal(leerNumero(malo, 'ven'), null, `pasó: ${malo}`)
  }
})

test('los espacios raros de Excel no estorban', () => {
  assert.equal(leerNumero(' 1.234,56 ', 'ven'), 1234.56)
  // Excel separa los miles con un espacio duro cuando el sistema lo pide asi.
  assert.equal(leerNumero('1\u00a0234,56', 'ven'), 1234.56)
})

test('03/04/2026 es tres de abril o cuatro de marzo según quién escribió la hoja', () => {
  assert.equal(leerFecha('03/04/2026', 'dmy'), '2026-04-03')
  assert.equal(leerFecha('03/04/2026', 'mdy'), '2026-03-04')
  assert.equal(leerFecha('2026-04-03', 'iso'), '2026-04-03')
})

test('un año de dos cifras se completa: no hay facturas de 1926', () => {
  assert.equal(leerFecha('03/04/26', 'dmy'), '2026-04-03')
})

test('el 31 de febrero no existe aunque se escriba', () => {
  assert.equal(leerFecha('31/02/2026', 'dmy'), null)
  assert.equal(leerFecha('00/01/2026', 'dmy'), null)
  assert.equal(leerFecha('01/13/2026', 'dmy'), null)
  assert.equal(leerFecha('no es fecha', 'dmy'), null)
  assert.equal(leerFecha('', 'dmy'), null)
})

test('los puntos también separan una fecha: 03.04.2026', () => {
  assert.equal(leerFecha('03.04.2026', 'dmy'), '2026-04-03')
})

test('una hoja de facturas de proveedor real entra entera', () => {
  const hoja = [
    'Fecha;Proveedor;RIF;Factura;Control;Base;IVA;Descripción',
    '03/04/2026;Suministros Zulia;J-30111111-1;00012345;01-00098765;"1.200.000,00";"192.000,00";"Cabezal 11"" 5M"',
    '15/04/2026;Transporte Lara;J-30222222-2;00000987;01-00012345;"350.000,00";"56.000,00";Flete Maracaibo-Cabimas',
  ].join('\r\n')

  const h = leerHoja(hoja)
  assert.equal(h.separador, ';')
  assert.equal(h.filas.length, 3)
  assert.equal(h.filas[1]![7], 'Cabezal 11" 5M')
  assert.equal(leerNumero(h.filas[1]![5]!, 'ven'), 1200000)
  assert.equal(leerFecha(h.filas[2]![0]!, 'dmy'), '2026-04-15')
})
