import { test } from 'node:test'
import assert from 'node:assert/strict'
import { t, traductor, numero, moneda } from '../src/i18n/t.ts'

test('traduce a los dos idiomas', () => {
  assert.equal(t('es', 'valuacion.neto'), 'Neto a cobrar')
  assert.equal(t('en', 'valuacion.neto'), 'Net payable')
})

test('el vocabulario técnico no es una traducción literal', () => {
  // 'valuación' no es 'valuation'. Confundirlos en un contrato con una operadora
  // internacional cambia lo que se está diciendo.
  assert.equal(t('en', 'valuacion.titulo'), 'Progress payment')
  assert.equal(t('en', 'valuacion.garantia'), 'Retention')
  assert.equal(t('en', 'contrato.tipo.reacondicionamiento'), 'Well workover')
  assert.equal(t('en', 'calidad.colada'), 'Heat number')
  assert.equal(t('en', 'fiscal.sustraendo'), 'Deductible amount')
  assert.equal(t('en', 'calidad.punto_espera'), 'Hold point')
})

test('una clave que falta salta a la vista, no se disfraza de texto', () => {
  // @ts-expect-error: clave inexistente, a propósito
  assert.equal(t('es', 'esta.clave.no.existe'), '‹falta: esta.clave.no.existe›')
})

test('el traductor atado ahorra repetir el idioma', () => {
  const es = traductor('es')
  assert.equal(es('conta.libro_mayor'), 'Libro mayor')
})

test('los números se escriben como se escriben en cada sitio', () => {
  // Escribir 1.234,56 donde se espera 1,234.56 no es un detalle estético
  // cuando va en una factura.
  assert.equal(numero('es', 1234.56), '1.234,56')
  assert.equal(numero('en', 1234.56), '1,234.56')
})

test('la moneda lleva su símbolo y su formato', () => {
  assert.match(moneda('es', 1234.56, 'VES'), /1\.234,56/)
  assert.match(moneda('en', 1234.56, 'USD'), /1,234\.56/)
})
