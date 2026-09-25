/**
 * El bucle que mantiene los avisos saliendo.
 *
 * Se prueba con un reloj de mentira: un bucle que se prueba esperando de verdad es un
 * bucle que nadie vuelve a probar.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repetir, esperaTrasFallos, type Reloj } from '../src/servidor/bucle.ts'

/** Reloj falso: no espera, apunta lo que le pidieron esperar y avanza la hora. */
function relojFalso() {
  let t = 0
  const esperas: number[] = []
  const reloj: Reloj = {
    ahora: () => t,
    esperar: async (ms) => { esperas.push(ms); t += ms },
  }
  return { reloj, esperas, avanzar: (ms: number) => { t += ms } }
}

test('repite hasta que se le dice que pare, y no una vuelta más', async () => {
  const f = relojFalso()
  let n = 0
  const vueltas = await repetir({
    cada: 60_000, reloj: f.reloj,
    seguir: () => n < 3,
    trabajo: async () => { n++ },
  })
  assert.equal(n, 3)
  assert.equal(vueltas, 3)
  // Tres vueltas, dos esperas: no espera después de la última.
  assert.equal(f.esperas.length, 2)
})

test('la espera se cuenta desde que TERMINA, no desde que empieza', async () => {
  // Si se contara desde el principio, un correo lento arrancaría la vuelta siguiente
  // encima de la anterior, y a partir de ahí se acumulan hasta tirar el proceso.
  const f = relojFalso()
  let n = 0
  await repetir({
    cada: 60_000, reloj: f.reloj,
    seguir: () => n < 2,
    trabajo: async () => { n++; f.avanzar(20_000) },
  })
  assert.deepEqual(f.esperas, [40_000])
})

test('una vuelta más lenta que el intervalo igual respira antes de la siguiente', async () => {
  const f = relojFalso()
  let n = 0
  await repetir({
    cada: 10_000, reloj: f.reloj,
    seguir: () => n < 2,
    trabajo: async () => { n++; f.avanzar(90_000) },
  })
  assert.deepEqual(f.esperas, [1_000])
})

test('un fallo no mata el bucle: se anota y se sigue', async () => {
  // Que la base de datos se caiga dos minutos no puede dejar sin avisos el mes.
  const f = relojFalso()
  const vistos: string[] = []
  let n = 0
  await repetir({
    cada: 1_000, reloj: f.reloj,
    seguir: () => n < 3,
    trabajo: async () => { n++; if (n === 1) throw new Error('la base no responde') },
    fallo: (e) => vistos.push((e as Error).message),
  })
  assert.deepEqual(vistos, ['la base no responde'])
  assert.equal(n, 3)
})

test('fallo tras fallo espera más cada vez, con techo', async () => {
  // Reintentar cada diez segundos contra algo caído es una forma de tirarlo más.
  assert.equal(esperaTrasFallos(60_000, 0, 900_000), 60_000)
  assert.equal(esperaTrasFallos(60_000, 1, 900_000), 120_000)
  assert.equal(esperaTrasFallos(60_000, 2, 900_000), 240_000)
  assert.equal(esperaTrasFallos(60_000, 99, 900_000), 900_000)
})

test('una vuelta buena borra la cuenta de fallos: no arrastra el castigo', async () => {
  const f = relojFalso()
  let n = 0
  await repetir({
    cada: 1_000, techo: 100_000, reloj: f.reloj,
    seguir: () => n < 3,
    trabajo: async () => { n++; if (n === 1) throw new Error('uno') },
  })
  assert.deepEqual(f.esperas, [2_000, 1_000])
})

test('si dice que no antes de empezar, no trabaja ni una vez', async () => {
  let n = 0
  const vueltas = await repetir({
    cada: 1_000, reloj: relojFalso().reloj,
    seguir: () => false,
    trabajo: async () => { n++ },
  })
  assert.equal(n, 0)
  assert.equal(vueltas, 0)
})
