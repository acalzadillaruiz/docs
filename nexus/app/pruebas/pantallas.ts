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
  // Devuelven una hoja de cálculo, no una página. Las dos las pilló este mismo
  // barrido el día que se añadieron, que es para lo que está.
  '/libros/hoja', '/diario/hoja',
  // Es una pantalla, pero no se puede abrir sin la ficha de una invitación viva, y
  // el barrido entra con una sesión, que es justo lo que aquí todavía no hay. Tiene
  // sus propias pruebas en personas.test.ts.
  '/invitacion',
])

async function rutas(): Promise<string[]> {
  const fuente = await readFile(new URL('../src/servidor/rutas.ts', import.meta.url), 'utf8')
  // El juego de caracteres lleva el punto y el guion: sin ellos, una ruta como
  // '/manifest.webmanifest' es invisible, y eso ya pasó una vez en el barrido de
  // aislamiento, que dijo que todo estaba bien después de añadir tres rutas nuevas.
  const todas = [...fuente.matchAll(/p\.ruta === '(\/[a-z0-9./-]*)'/g)].map((m) => m[1]!)
  return [...new Set(todas)].filter((r) => !SIN_PANTALLA.has(r)).sort()
}

/**
 * Las pantallas que son SOLO del cliente, sacadas también del código.
 *
 * Hacía falta separarlas el día que apareció la primera —el estado de cuenta— y el barrido del
 * móvil la abrió como GPS, recibió el 404 y dijo, con razón, que salía en blanco. La
 * tentación era apuntarla en la lista de «esto no es una pantalla»; eso la habría dejado
 * **sin barrer nunca**, que es justo el agujero por el que existe este archivo.
 *
 * Se reconocen por su cerradura: la ruta empieza negándose a quien NO es cliente.
 */
async function soloDelCliente(): Promise<Set<string>> {
  const fuente = await readFile(new URL('../src/servidor/rutas.ts', import.meta.url), 'utf8')
  const suyas = new Set<string>()
  // Cada ruta con lo que viene detrás hasta la siguiente: si ahí dentro se niega a quien no
  // es cliente, es del cliente.
  const trozos = fuente.split(/(?=p\.ruta === ')/)
  for (const t of trozos) {
    const m = /^p\.ruta === '(\/[a-z0-9./-]*)'/.exec(t)
    if (m && /!esCliente\) return noEncontrado/.test(t)) suyas.add(m[1]!)
  }
  return suyas
}

/** Las pantallas que un interno puede abrir. */
export async function pantallasDelCodigo(): Promise<string[]> {
  const suyas = await soloDelCliente()
  return (await rutas()).filter((r) => !suyas.has(r))
}

/** Y las del cliente, que hay que barrer igual pero entrando como él. */
export async function pantallasDeCliente(): Promise<string[]> {
  const suyas = await soloDelCliente()
  return (await rutas()).filter((r) => suyas.has(r))
}

/**
 * Cuántas tiene que haber como mínimo para que un barrido cuente como barrido.
 *
 * Es la afirmación que falla cuando el barrido deja de mirar. Sube cuando se añaden
 * pantallas; si alguna vez hay que bajarla, la pregunta no es cómo arreglarla.
 */
export const AL_MENOS = 19

/**
 * Y cuántas del cliente. Hoy una; si algún día son cero, es que alguien quitó la cerradura
 * que las distingue y el barrido dejó de mirarlas sin avisar.
 */
export const AL_MENOS_CLIENTE = 1
