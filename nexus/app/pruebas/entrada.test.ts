import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pintarEntrada, type PasoEntrada } from '../src/pantallas/entrada.ts'

test('el campo del código saca el teclado numérico y se deja rellenar solo', () => {
  // Dos atributos. Se notan seis veces al día, todos los días.
  const h = pintarEntrada({ paso: 'segundo_factor', desafio: 'x' }, 'es')
  assert.match(h, /inputmode="numeric"/)
  assert.match(h, /autocomplete="one-time-code"/)
  assert.match(h, /maxlength="6"/)
})

test('el correo no se autocapitaliza ni se corrige', () => {
  // Un teclado de móvil que pone mayúscula inicial en un correo es el motivo más
  // tonto por el que alguien no entra.
  const h = pintarEntrada({ paso: 'ingreso' }, 'es')
  assert.match(h, /autocapitalize="none"/)
  assert.match(h, /spellcheck="false"/)
  assert.match(h, /inputmode="email"/)
})

test('la espera dice cuántos segundos, no «demasiados intentos» a secas', () => {
  // Sin número, la gente recarga veinte veces y empeora su propia espera.
  const h = pintarEntrada({ paso: 'espera', segundos: 16 }, 'es')
  assert.match(h, /dentro de 16 segundos/)
  assert.match(h, /data-segundos="16"/)
})

test('un segundo va en singular', () => {
  assert.match(pintarEntrada({ paso: 'espera', segundos: 1 }, 'es'), /dentro de 1 segundo\./)
  assert.match(pintarEntrada({ paso: 'espera', segundos: 1 }, 'en'), /in 1 second\./)
})

test('el error se anuncia al lector de pantalla', () => {
  const h = pintarEntrada({ paso: 'ingreso', error: 'rechazado' }, 'es')
  assert.match(h, /role="alert"/)
})

test('el error no dice si el fallo fue el correo o la clave', () => {
  const h = pintarEntrada({ paso: 'ingreso', error: 'rechazado' }, 'es')
  assert.equal(/correo no existe|no such|usuario no encontrado/i.test(h), false)
  assert.match(h, /No hemos podido entrar con esos datos/)
})

test('el desafío viaja en el formulario, no en la dirección', () => {
  // En la dirección quedaría en el historial del navegador y en los registros
  // de cualquier intermediario.
  const h = pintarEntrada({ paso: 'segundo_factor', desafio: 'abc123' }, 'es')
  assert.match(h, /<input type="hidden" name="desafio" value="abc123">/)
})

test('desde la pantalla del código se puede llegar a la de recuperación', () => {
  const h = pintarEntrada({ paso: 'segundo_factor', desafio: 'x' }, 'es')
  assert.match(h, /Perdí el teléfono/)
  assert.match(h, /\/entrar\/recuperacion/)
})

test('la invitación pide doce caracteres y lo dice antes de fallar', () => {
  const h = pintarEntrada({ paso: 'invitacion', nombre: 'Ana', ficha: 'f' }, 'es')
  assert.match(h, /minlength="12"/)
  assert.match(h, /Doce caracteres como mínimo/)
  assert.match(h, /autocomplete="new-password"/)
})

test('la invitación saluda por el nombre, escapado', () => {
  const h = pintarEntrada({ paso: 'invitacion', nombre: 'Ana <Pérez> & Cía', ficha: 'f' }, 'es')
  assert.match(h, /Ana &lt;Pérez&gt; &amp; Cía/)
  assert.equal(h.includes('<Pérez>'), false)
})

test('quien entra por su empresa no ve un campo de clave', () => {
  const h = pintarEntrada({ paso: 'empresa', metodo: 'microsoft' }, 'es')
  assert.equal(h.includes('type="password"'), false)
  assert.match(h, /Microsoft/)
})

/**
 * Una por cada paso del tipo, y sin `as`: el molde exige los campos de cada uno.
 *
 * Si se añade un paso y no se añade aquí, los barridos dejan de mirarlo. Ya pasó:
 * el paso que enseña «entraste con un código de recuperación» no existía porque
 * tampoco existía la ruta que lo pinta.
 */
const TODOS: PasoEntrada[] = [
  { paso: 'ingreso' },
  { paso: 'segundo_factor', desafio: 'x' },
  { paso: 'recuperacion', desafio: 'x' },
  { paso: 'espera', segundos: 8 },
  { paso: 'empresa', metodo: 'google' },
  { paso: 'invitacion', nombre: 'Ana', ficha: 'f' },
  { paso: 'creada', correo: 'a@b.test', secreto: 'ABC', codigos: ['A-1', 'B-2'] },
  { paso: 'gastado', quedan: 9 },
]

test('TODAS las pantallas de entrada salen en los dos idiomas, sin nada sin traducir', () => {
  const pasos = TODOS
  for (const p of pasos) {
    for (const idioma of ['es', 'en'] as const) {
      const h = pintarEntrada(p, idioma)
      assert.match(h, new RegExp(`<html lang="${idioma}">`))
      assert.equal(h.includes('‹falta:'), false, `${p.paso}/${idioma} tiene una clave sin traducir`)
      assert.match(h, /<meta name="viewport"/)
    }
  }
})

test('la pantalla de espera es la única que lleva guion', () => {
  // Menos código en el camino de entrada es menos superficie que vigilar.
  //
  // Esta lista estaba escrita a mano Y con un `as PasoEntrada[]` encima, que es lo
  // peor de las dos cosas: la copia se quedaba vieja y el molde de TypeScript no
  // avisaba porque el `as` lo desactiva. Al añadirle un campo obligatorio al paso de
  // recuperación, la prueba se cayó por dentro en vez de decir qué faltaba. Ahora
  // sale de la misma lista que el barrido de arriba, sin ningún `as`.
  for (const p of TODOS.filter((x) => x.paso !== 'espera')) {
    assert.equal(pintarEntrada(p, 'es').includes('<script>'), false,
      `${p.paso} no debería llevar guion`)
  }
  assert.match(pintarEntrada({ paso: 'espera', segundos: 5 }, 'es'), /<script>/)
})
