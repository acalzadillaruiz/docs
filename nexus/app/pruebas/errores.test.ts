/**
 * Los textos de error, repasados en conjunto.
 *
 * Son los que más se leen y los que nunca se revisan: cada uno se escribe el día que
 * hace falta, solo, y nadie los vuelve a mirar juntos. Mirándolos juntos salieron
 * cuatro cosas, y las cuatro están aquí convertidas en comprobación:
 *
 *   1. **`alta.error.campo` decía «Falta algo obligatorio»** para cuatro causas
 *      distintas: la cabecera, el tipo, un renglón y un porcentaje. Un mensaje que no
 *      dice qué falta obliga a adivinar. Son cuatro mensajes ahora.
 *   2. **Un texto de error que no usa nadie** es un texto que se escribió para algo
 *      que no se enseña. `accion.error.sin_hitos` existía, era perfecto, y la ruta
 *      contestaba **409 con el cuerpo vacío**: una página en blanco.
 *   3. **Los huecos `{n}` tienen que estar en los dos idiomas.** Si falta en uno, esa
 *      lengua enseña una frase a la que le falta el número, y no se ve hasta que
 *      alguien la lee.
 *   4. **Nada de jerga.** Ni `uuid`, ni `NaN`, ni «base de datos». Quien lee el error
 *      no escribió el programa.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const RAIZ = new URL('../../i18n/', import.meta.url)

const leer = async (n: string) =>
  JSON.parse(await readFile(new URL(`${n}.json`, RAIZ), 'utf8')) as Record<string, string>

/** Todo el código de la aplicación, de una pieza, para buscar claves dentro. */
async function fuentes(): Promise<string> {
  const carpetas = ['dominio', 'pantallas', 'servidor', 'db', 'i18n', 'correo']
  let todo = ''
  for (const c of carpetas) {
    const d = new URL(`../src/${c}/`, import.meta.url)
    let nombres: string[]
    try { nombres = await readdir(d) } catch { continue }
    for (const n of nombres) {
      if (n.endsWith('.ts')) todo += await readFile(new URL(n, d), 'utf8')
    }
  }
  return todo
}

const esError = (k: string) => k.includes('.error.')

test('todo texto de error se usa en alguna parte', async () => {
  // Un mensaje que no se enseña es un mensaje que se escribió para un camino que no
  // existe. Así se encontró el 409 con el cuerpo vacío al poner un contrato en vigor.
  const es = await leer('es')
  const codigo = await fuentes()
  const claves = Object.keys(es).filter(esError)
  assert.ok(claves.length > 40, `el barrido tiene que mirar los errores de verdad, y miró ${claves.length}`)

  const sueltas = claves.filter((k) => !codigo.includes(`'${k}'`) && !codigo.includes(`"${k}"`))
  assert.deepEqual(sueltas, [], 'estos errores no los enseña nadie')
})

test('los huecos de un error están en los dos idiomas', async () => {
  const [es, en] = [await leer('es'), await leer('en')]
  let mirados = 0
  for (const k of Object.keys(es).filter(esError)) {
    const hueco = /\{[a-z_]+\}/g
    const a = (es[k]!.match(hueco) ?? []).sort()
    const b = (en[k]!.match(hueco) ?? []).sort()
    if (a.length > 0 || b.length > 0) mirados++
    assert.deepEqual(a, b, `los huecos de ${k} no casan`)
  }
  assert.ok(mirados > 0, 'si ningún error lleva huecos, esta prueba no comprueba nada')
})

test('ningún error le habla al que escribió el programa', async () => {
  // Quien lee esto está intentando dar de alta un contrato, no depurar.
  const jerga = /\b(uuid|null|NaN|undefined|SQL|PostgreSQL|postgres|base de datos|database|rollback|token|hash|timestamp|constraint)\b/i
  let mirados = 0
  for (const idioma of ['es', 'en'] as const) {
    const d = await leer(idioma)
    for (const k of Object.keys(d).filter(esError)) {
      mirados++
      const m = jerga.exec(d[k]!)
      assert.equal(m, null, `${k} (${idioma}) dice «${m?.[0]}»`)
    }
  }
  assert.ok(mirados > 80, `tenía que mirar los errores en los dos idiomas, y miró ${mirados}`)
})

test('ningún error es tan corto que no diga nada', async () => {
  // El umbral sale de medir, no de una opinión: repasados los ochenta, el más corto
  // que sí dice algo es «Esa caja no existe» (18). «Falta algo obligatorio» tenía 22
  // y no decía nada, así que la longitud sola no basta — pero por debajo de 15 no
  // cabe una frase útil en ninguno de los dos idiomas.
  for (const idioma of ['es', 'en'] as const) {
    const d = await leer(idioma)
    for (const k of Object.keys(d).filter(esError)) {
      assert.ok(d[k]!.length >= 15, `${k} (${idioma}) son ${d[k]!.length} caracteres: «${d[k]}»`)
    }
  }
})

test('un error habla del problema, no de lo que la persona hizo mal', async () => {
  // «Usted escribió mal» y «entrada inválida» son las dos formas de no ayudar. Se
  // comprueba la segunda, que es la que se cuela sin querer al traducir.
  const feas = [/\binválid[oa]s?\b/i, /\binvalid\b/i, /\berror de\b/i, /\bilegal\b/i]
  for (const idioma of ['es', 'en'] as const) {
    const d = await leer(idioma)
    for (const k of Object.keys(d).filter(esError)) {
      for (const f of feas) {
        assert.equal(f.test(d[k]!), false, `${k} (${idioma}): «${d[k]}»`)
      }
    }
  }
})
