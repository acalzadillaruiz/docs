/**
 * Repetir un trabajo cada pocos minutos, sin que se solape consigo mismo.
 *
 * Existe por una razón concreta: la cola de avisos se llena sola y nadie la vacía si
 * no hay algo llamándola. Hasta ahora eso quedaba «para el que instale el sistema», y
 * un sistema que depende de que alguien acierte con una línea de cron es un sistema
 * que la primera semana avisa y la tercera no.
 *
 * Tres decisiones, las tres por el mismo motivo — que esto va a correr meses seguidos
 * sin que nadie lo mire:
 *
 *   - La espera se cuenta DESPUÉS de terminar, no cada N segundos desde que empezó.
 *     Si un servidor de correo lento tarda más que el intervalo, contar desde el
 *     principio arranca la siguiente vuelta encima de la anterior, y a partir de ahí
 *     se acumulan hasta que el proceso se cae.
 *   - Un fallo no mata el bucle. Que la base de datos se caiga dos minutos no puede
 *     dejar sin avisos el resto del mes; se anota y se vuelve a intentar.
 *   - Pero un fallo tras otro sí espera más cada vez, hasta un techo. Reintentar
 *     cada diez segundos contra algo que está caído es una forma de tirarlo más.
 */

export type Reloj = {
  readonly ahora: () => number
  readonly esperar: (ms: number) => Promise<void>
}

export const RELOJ: Reloj = {
  ahora: () => Date.now(),
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
}

export type Bucle = {
  /** Cada cuánto vuelve a empezar, en milisegundos. */
  readonly cada: number
  /** Lo que hace cada vuelta. */
  readonly trabajo: () => Promise<void>
  /** Mientras diga que sí, sigue. Así se para sin matar el proceso a mitad. */
  readonly seguir: () => boolean
  /** Qué hacer con un fallo. Anotarlo, no tragárselo. */
  readonly fallo?: (e: unknown, seguidos: number) => void
  /** Tope de la espera creciente tras fallos. Por defecto, quince minutos. */
  readonly techo?: number
  readonly reloj?: Reloj
}

/** Espera tras `n` fallos seguidos: el intervalo, doblado por cada fallo, con techo. */
export function esperaTrasFallos(cada: number, n: number, techo: number): number {
  if (n <= 0) return cada
  return Math.min(cada * 2 ** Math.min(n, 20), techo)
}

/** Devuelve cuántas vueltas dio. Sale solo cuando `seguir()` dice que no. */
export async function repetir(b: Bucle): Promise<number> {
  const reloj = b.reloj ?? RELOJ
  const techo = b.techo ?? 15 * 60_000
  let vueltas = 0
  let seguidos = 0

  while (b.seguir()) {
    const arranque = reloj.ahora()
    try {
      await b.trabajo()
      seguidos = 0
    } catch (e) {
      seguidos++
      b.fallo?.(e, seguidos)
    }
    vueltas++
    if (!b.seguir()) break

    // Lo que tardó el trabajo se descuenta de la espera, pero nunca se salta la
    // espera entera: una vuelta que tarda más que el intervalo no debe encadenar
    // vueltas sin respiro contra una base de datos que ya va justa.
    const objetivo = esperaTrasFallos(b.cada, seguidos, techo)
    const tardo = reloj.ahora() - arranque
    await reloj.esperar(Math.max(objetivo - tardo, Math.min(1000, objetivo)))
  }
  return vueltas
}
