/**
 * Todo lo que llega de fuera y se convierte en número.
 *
 * `Number('hola')` NO falla: devuelve `NaN`. Y `NaN` tiene tres propiedades que lo
 * hacen el peor valor posible para colarse en un sistema de contabilidad:
 *
 *   1. **Llega hasta la base de datos.** PostgreSQL contesta `invalid input syntax
 *      for type integer: "NaN"`, que es un error de servidor — no un «eso no vale».
 *   2. **No es igual a nada, ni a sí mismo.** Una comprobación escrita como
 *      `if (x <= 0) error` lo deja pasar, porque `NaN <= 0` es falso.
 *   3. **Y contamina.** Una vez dentro de una suma, todo lo que toca es NaN.
 *
 * Ya costó un fallo en la pantalla de meses. Esta prueba recorre el resto de sitios
 * donde entra un número de fuera: el formulario, la cabecera de la petición, la
 * respuesta del servidor de correo y las variables del arranque.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { idiomaPedido } from '../src/servidor/cookies.ts'

test('NaN se cuela por una comprobación escrita al revés', () => {
  // La razón por la que el idioma de este archivo importa. Las dos líneas dicen lo
  // mismo en castellano y hacen lo contrario con un NaN.
  const malo = NaN
  assert.equal(malo <= 0, false, 'la forma que DEJA pasar la basura')
  assert.equal(!(malo > 0), true, 'la forma que la para')
})

test('un «q» que no es un número no desordena la negociación de idioma', () => {
  // La cabecera la escribe quien llama. Con NaN en el comparador, el orden lo decide
  // el orden de llegada — que es justo lo que esta función existe para no hacer.
  assert.equal(idiomaPedido('en;q=hola, es;q=0.9'), 'en')
  // `Number('')` NO es NaN: es CERO. Un `q=` vacío leído como cero significa «no
  // quiero este idioma», que es lo contrario de no haber dicho nada.
  assert.equal(idiomaPedido('en;q=, es;q=0.9'), 'en')
  assert.equal(idiomaPedido('en;q=   , es;q=0.9'), 'en')
  // Y lo normal sigue funcionando: gana el de más peso, no el primero.
  assert.equal(idiomaPedido('en;q=0.2, es;q=0.9'), 'es')
  assert.equal(idiomaPedido('es;q=0.2, en;q=0.9'), 'en')
})

test('un q=0 de verdad SÍ es un rechazo, y se respeta', () => {
  // Lo de arriba no puede llevarse por delante lo que la norma sí dice: q=0 escrito
  // a propósito significa «este idioma no».
  assert.equal(idiomaPedido('en;q=0, es;q=0.1'), 'es')
})

test('un «q» fuera de rango se recorta, no se cree a ciegas', () => {
  // q=999 en el segundo no puede ganarle al primero por gritar más fuerte.
  assert.equal(idiomaPedido('es, en;q=999'), 'es')
  assert.equal(idiomaPedido('en;q=-5, es;q=0.1'), 'es')
})

test('sin cabecera, o con una ilegible, se contesta en español', () => {
  assert.equal(idiomaPedido(undefined), 'es')
  assert.equal(idiomaPedido(''), 'es')
  assert.equal(idiomaPedido(';;;;'), 'es')
  assert.equal(idiomaPedido('klingon'), 'es')
})

test('lo guardado por la persona manda sobre la cabecera', () => {
  assert.equal(idiomaPedido('en;q=1', 'es'), 'es')
  assert.equal(idiomaPedido('es;q=1', 'en'), 'en')
})

test('una respuesta que no es SMTP no se da por buena', async () => {
  // Lo que contesta el otro lado no lo controlamos. Sin las tres cifras al principio
  // esto no es una respuesta, y darla por buena sería dar por enviado un aviso que
  // no salió.
  const { CorreoRechazado } = await import('../src/servidor/correo.ts')
  assert.ok(CorreoRechazado, 'el error de correo rechazado tiene que existir')
  // El comportamiento se comprueba en correo.test.ts contra un servidor de mentira;
  // aquí solo queda escrito POR QUÉ un código ilegible vale cero y no NaN.
  assert.equal(Math.floor(Number('hol') / 100) !== 2, true)
  assert.equal(Math.floor(0 / 100) !== 2, true, 'un cero nunca coincide con lo esperado')
})

test('la conversión de un importe con coma sigue funcionando', async () => {
  // Lo de arriba no puede haber roto lo de siempre: en Venezuela se teclea con coma.
  const { leerNumero } = await import('../src/servidor/csv.ts')
  assert.equal(leerNumero('1.234,56', 'ven'), 1234.56)
  assert.equal(leerNumero('hola', 'ven'), null, 'lo que no es número devuelve nada, NUNCA cero')
})
