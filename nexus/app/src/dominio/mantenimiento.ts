/**
 * El mantenimiento periódico: cerrar lo vencido y no guardar lo que no se mira.
 *
 * Había dos funciones en la base de datos comentadas con «se llama desde una tarea
 * periódica», y **ninguna tarea periódica las llamaba**. No rompía nada, y por eso
 * llevaba meses ahí: tres tablas creciendo para siempre en un sistema pensado para
 * correr años sin que nadie lo mire.
 *
 * Va montado sobre el mismo bucle que vacía la cola de avisos, y no sobre un segundo
 * servicio, por lo mismo que existe `bucle.ts`: un sistema que depende de que alguien
 * acierte con una segunda línea de cron es un sistema que la primera semana limpia y
 * la tercera no. Una cosa que instalar, no dos.
 *
 * Pero no cada vuelta. La cola de avisos se mira cada tres minutos porque un correo
 * que llega tarde molesta; una sesión vencida que se cierra una hora tarde no la nota
 * nadie, y borrar en cada vuelta es trabajo constante contra la base de datos a
 * cambio de nada.
 */

import type { Consulta } from '../db/conexion.ts'

/** Cada cuánto toca limpiar, en milisegundos. Una hora. */
export const CADA_CUANTO = 60 * 60 * 1000

export type Limpieza = {
  /** Sesiones vencidas que se han cerrado en esta pasada. */
  readonly sesiones: number
  /** Peticiones de entrada por SSO que nadie llegó a usar. */
  readonly peticiones: number
  /** Intentos de entrada más viejos que el plazo: correos que ya no se van a mirar. */
  readonly intentos: number
}

/**
 * Cuántos días se guardan los intentos de entrada.
 *
 * El freno contra probar claves a ciegas solo mira la última hora. Lo demás es el
 * historial que se lee cuando hay que investigar algo, y un mes basta para eso. Más
 * allá es una lista de correos de gente que crece sola sin que nadie la abra nunca.
 */
export const DIAS_INTENTOS = 30

/** Cuántos días vive una petición de SSO sin usar. */
export const DIAS_SSO = 2

export async function limpiar(
  q: Consulta, diasSso = DIAS_SSO, diasIntentos = DIAS_INTENTOS,
): Promise<Limpieza> {
  const [r] = (await q`
    select sesiones, peticiones, intentos from mantenimiento(${diasSso}, ${diasIntentos})
  `) as unknown as Array<{ sesiones: number; peticiones: number; intentos: number }>
  return {
    sesiones: Number(r?.sesiones ?? 0),
    peticiones: Number(r?.peticiones ?? 0),
    intentos: Number(r?.intentos ?? 0),
  }
}

/** Si toca limpiar, mirando cuándo se limpió por última vez. */
export const tocaLimpiar = (ultima: number | null, ahora: number, cada = CADA_CUANTO) =>
  ultima === null || ahora - ultima >= cada
