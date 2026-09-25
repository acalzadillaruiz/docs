/**
 * Qué pantallas tiene la aplicación. Una sola respuesta, sacada del código.
 *
 * Existe porque la misma lista estaba copiada a mano en TRES barridos —el día 1, los
 * formularios y el móvil— y las tres se quedaron viejas: tenían diez u once
 * pantallas cuando la aplicación ya iba por dieciocho. El cuadro de mando, los
 * estados, el diario, el mayor, la caja chica, lo que toca pagar y el tablero de
 * material **no se habían mandado en blanco, ni con basura dentro, ni dibujado nunca
 * en un teléfono**.
 *
 * Una lista escrita a mano se queda vieja justo cuando hace falta, y mientras tanto
 * da la seguridad de una comprobación sin serlo. Cuando una prueba necesita saber
 * qué pantallas hay, la respuesta está en `rutas.ts`.
 */

import { readFile } from 'node:fs/promises'

/** Lo que responde a una dirección y NO es una pantalla que se mire. */
const SIN_PANTALLA = new Set([
  // El circuito de entrada tiene su propio archivo de pruebas, y aquí se usa para
  // entrar antes de mirar nada.
  '/entrar', '/entrar/codigo', '/entrar/empresa', '/entrar/empresa/vuelta',
  '/entrar/recuperacion', '/salir',
  // Ni son pantallas ni piden sesión: hacen que la aplicación se instale.
  '/manifest.webmanifest', '/icono.svg', '/icono-180.png', '/icono-512.png',
  // Devuelve una hoja de cálculo, no una página.
  '/libros/hoja',
])

/** Las pantallas que un interno puede abrir, sacadas de las rutas del servidor. */
export async function pantallasDelCodigo(): Promise<string[]> {
  const fuente = await readFile(new URL('../src/servidor/rutas.ts', import.meta.url), 'utf8')
  // El juego de caracteres lleva el punto y el guion: sin ellos, una ruta como
  // '/manifest.webmanifest' es invisible, y eso ya pasó una vez en el barrido de
  // aislamiento, que dijo que todo estaba bien después de añadir tres rutas nuevas.
  const todas = [...fuente.matchAll(/p\.ruta === '(\/[a-z0-9./-]*)'/g)].map((m) => m[1]!)
  return [...new Set(todas)].filter((r) => !SIN_PANTALLA.has(r)).sort()
}

/**
 * Cuántas tiene que haber como mínimo para que un barrido cuente como barrido.
 *
 * Es la afirmación que falla cuando el barrido deja de mirar. Sube cuando se añaden
 * pantallas; si alguna vez hay que bajarla, la pregunta no es cómo arreglarla.
 */
export const AL_MENOS = 18
