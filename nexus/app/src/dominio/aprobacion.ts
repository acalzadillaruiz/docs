/**
 * Aprobar y objetar una valuación.
 *
 * Es el momento en que la aplicación deja de informar y empieza a hacer que pasen
 * cosas. Todo lo anterior se podía deshacer recargando; esto no.
 *
 * Cuatro reglas, y ninguna es opcional:
 *
 *   1. Aprueba el CLIENTE, no GPS. Que GPS pudiera aprobar sus propias valuaciones
 *      vaciaría de sentido la firma: el acta valdría lo que vale un papel que se
 *      firma uno mismo.
 *   2. Solo se aprueba lo presentado. Un borrador no ha salido de GPS todavía, y una
 *      valuación ya aprobada no se vuelve a aprobar: se corrige con su reverso.
 *   3. Queda quién y cuándo. Sin eso, dentro de un año nadie puede defender que esa
 *      valuación se aprobó, y es exactamente lo que se discute en una controversia.
 *   4. La transición es atómica y condicionada al estado actual. Dos pulsaciones
 *      simultáneas no pueden aprobar dos veces.
 */

import type { Consulta } from '../db/conexion.ts'
import { ValuacionNoAlcanzable } from './valuacion.ts'

export type Resultado =
  | { readonly hecho: true }
  | { readonly hecho: false; readonly motivo: Motivo }

export type Motivo =
  | 'no_alcanzable'      // no existe, o no te corresponde: no se distinguen
  | 'no_eres_el_cliente' // GPS no aprueba sus propias valuaciones
  | 'estado_equivocado'  // no estaba presentada

/**
 * `personaId` es de quién se anota la firma. `esCliente` dice si quien pulsa es del
 * lado del cliente: se pasa desde fuera porque quien resuelve la petición ya lo sabe,
 * y volver a consultarlo aquí abriría la puerta a que las dos respuestas difieran.
 */
export async function aprobar(
  q: Consulta, valuacionId: string, personaId: string, esCliente: boolean,
): Promise<Resultado> {
  if (!esCliente) return { hecho: false, motivo: 'no_eres_el_cliente' }

  const [v] = (await q`
    select estado::text from valuacion where id = ${valuacionId}::uuid
  `) as unknown as Array<{ estado: string }>
  if (!v) return { hecho: false, motivo: 'no_alcanzable' }
  if (v.estado !== 'presentada' && v.estado !== 'objetada') {
    return { hecho: false, motivo: 'estado_equivocado' }
  }

  // La condición del estado va DENTRO del update, no en un if de arriba. Entre la
  // consulta y la escritura cabe otra petición, y sin esto las dos aprobarían.
  const filas = await q`
    update valuacion
       set estado = 'aprobada', aprobada_el = current_date, aprobada_por = ${personaId}::uuid
     where id = ${valuacionId}::uuid
       and estado in ('presentada','objetada')
    returning id
  `
  return filas.length === 1
    ? { hecho: true }
    : { hecho: false, motivo: 'estado_equivocado' }
}

export async function objetar(
  q: Consulta, valuacionId: string, personaId: string, esCliente: boolean, motivo: string,
): Promise<Resultado> {
  if (!esCliente) return { hecho: false, motivo: 'no_eres_el_cliente' }
  if (motivo.trim() === '') return { hecho: false, motivo: 'estado_equivocado' }

  const [v] = (await q`
    select estado::text from valuacion where id = ${valuacionId}::uuid
  `) as unknown as Array<{ estado: string }>
  if (!v) return { hecho: false, motivo: 'no_alcanzable' }

  const filas = await q`
    update valuacion set estado = 'objetada'
     where id = ${valuacionId}::uuid and estado = 'presentada'
    returning id
  `
  if (filas.length !== 1) return { hecho: false, motivo: 'estado_equivocado' }

  // La objeción va a su propia tabla y se guarda entera, no resumida: es la mitad
  // del expediente el día que hay que demostrar qué se discutió y cuándo.
  await q`
    insert into objecion (valuacion_id, persona_id, motivo)
    values (${valuacionId}::uuid, ${personaId}::uuid, ${motivo})
  `
  return { hecho: true }
}

export { ValuacionNoAlcanzable }

/**
 * Responder una objeción. Es de dentro, y es lo que vuelve a poner la valuación en
 * movimiento: mientras haya una sin responder, no se puede facturar.
 *
 * No borra la objeción ni la cambia: le añade la respuesta. El texto original del
 * cliente se queda tal cual, porque el expediente es la conversación entera y no
 * solo la última versión de quien tuvo la última palabra.
 */
export async function responder(
  q: Consulta, objecionId: string, personaId: string, esInterna: boolean, respuesta: string,
): Promise<Resultado> {
  if (!esInterna) return { hecho: false, motivo: 'no_eres_el_cliente' }
  if (respuesta.trim() === '') return { hecho: false, motivo: 'estado_equivocado' }

  const filas = await q`
    update objecion
       set respuesta = ${respuesta}, respondida_en = now(), respondida_por = ${personaId}::uuid
     where id = ${objecionId}::uuid
       and respondida_en is null
    returning id`
  if (filas.length === 1) return { hecho: true }

  // Puede ser que no exista, que no te corresponda, o que ya estuviera respondida.
  // Se distingue solo lo último, que no cuenta nada de nadie.
  const [existe] = (await q`
    select respondida_en from objecion where id = ${objecionId}::uuid
  `) as unknown as Array<{ respondida_en: Date | null }>
  return existe
    ? { hecho: false, motivo: 'estado_equivocado' }
    : { hecho: false, motivo: 'no_alcanzable' }
}
