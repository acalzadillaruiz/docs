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

test('las seis pantallas existen en los dos idiomas y ninguna queda sin traducir', () => {
  const pasos: PasoEntrada[] = [
    { paso: 'ingreso' },
    { paso: 'segundo_factor', desafio: 'x' },
    { paso: 'recuperacion' },
    { paso: 'espera', segundos: 8 },
    { paso: 'empresa', metodo: 'google' },
    { paso: 'invitacion', nombre: 'Ana', ficha: 'f' },
  ]
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
  for (const p of [
    { paso: 'ingreso' }, { paso: 'segundo_factor', desafio: 'x' }, { paso: 'recuperacion' },
  ] as PasoEntrada[]) {
    assert.equal(pintarEntrada(p, 'es').includes('<script>'), false, `${p.paso} no debería llevar guion`)
  }
  assert.match(pintarEntrada({ paso: 'espera', segundos: 5 }, 'es'), /<script>/)
})
