/**
 * El ciclo de vida de un contrato: suspenderlo, cerrarlo, liquidarlo, y reabrirlo.
 *
 * `estado_contrato` declara cinco estados desde el primer día y la aplicación sabía llegar
 * a **dos**: `alta.ts` pasa de borrador a vigente y ahí se acababa. Nada suspendía, nada
 * cerraba y nada liquidaba. Lo encontró un barrido nuevo —columnas que ni la aplicación ni
 * el esquema nombran— por `contrato.fin_real`, que no escribía nadie.
 *
 * Y eso no era una casilla de menos. Un contrato terminado se quedaba **vigente para
 * siempre**: la cartera enseñaba los acabados junto a los que están corriendo, «¿terminamos
 * tarde?» no se podía contestar en un producto que existe para medir la ejecución de
 * contratos, y dos pantallas —equipos y caja chica— ya consultaban
 * `estado in ('vigente','suspendido')`, escritas contando con que la suspensión existiera.
 *
 * Las reglas duras están en la base de datos (`cambiar_estado_contrato`), que es la que no
 * se puede saltar. Aquí se comprueba antes para dar una frase legible en el idioma de quien
 * mira, porque una excepción aborta la transacción y deja a quien pulsó sin nada que leer.
 *
 * El módulo se llama `ciclo` y no `estados` porque `estados.ts` ya existe y es el de los
 * estados contables —balance y resultados—: lo sobrescribí por descuido al empezar esto, y
 * lo salvó que `tsc` gritó enseguida.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, t, type Clave, type Idioma } from '../i18n/t.ts'

export type EstadoContrato =
  'borrador' | 'vigente' | 'suspendido' | 'cerrado' | 'liquidado'

/** Los pasos que existen, los mismos que `pasos_de_contrato` del esquema. */
export const PASOS: Readonly<Record<EstadoContrato, readonly EstadoContrato[]>> = {
  borrador: ['vigente'],
  vigente: ['suspendido', 'cerrado'],
  suspendido: ['vigente', 'cerrado'],
  cerrado: ['vigente', 'liquidado'],
  liquidado: [],
}

export type Cambio = {
  readonly de: EstadoContrato
  readonly a: EstadoContrato
  readonly motivo: string
  readonly finReal: string | null
  readonly cuando: string
  readonly quien: string
}

export type Situacion = {
  readonly estado: EstadoContrato
  readonly finPrevisto: string | null
  readonly finReal: string | null
  /** A dónde se puede ir desde aquí. Vacío en liquidado, que es el final. */
  readonly pasos: readonly EstadoContrato[]
  /** Lo que impide liquidar, ya con su cifra. Vacío cuando no impide nada. */
  readonly faltaLiquidar: readonly string[]
  readonly historia: readonly Cambio[]
}

/**
 * La situación de un contrato: en qué estado está, a dónde puede ir, qué le falta para
 * liquidarse y por dónde ha pasado.
 *
 * Lo que falta para liquidar se calcula y se enseña **antes** de que alguien lo intente. Un
 * botón que se puede pulsar y contesta «no se puede» es peor que un botón que explica desde
 * el principio por qué todavía no está.
 */
export async function situacion(
  q: Consulta, contratoId: string, orgId: string, idioma: Idioma,
): Promise<Situacion | null> {
  const [c] = (await q`
    select estado::text, fin_previsto, fin_real, moneda::text
      from contrato
     where id = ${contratoId}::uuid and organizacion_id = ${orgId}::uuid
  `) as unknown as Array<{
    estado: string; fin_previsto: Date | null; fin_real: Date | null; moneda: string
  }>
  if (!c) return null

  const [f] = (await q`
    select sin_cobrar::text, sin_facturar::text from falta_para_liquidar(${contratoId}::uuid)
  `) as unknown as Array<{ sin_cobrar: string; sin_facturar: string }>

  const filas = (await q`
    select ce.de::text as de, ce.a::text as a, ce.motivo, ce.fin_real,
           ce.ocurrido_en, p.nombre
      from contrato_estado ce join persona p on p.id = ce.por
     where ce.contrato_id = ${contratoId}::uuid
     order by ce.ocurrido_en desc
  `) as unknown as Array<{
    de: string; a: string; motivo: string; fin_real: Date | null
    ocurrido_en: Date; nombre: string
  }>

  const falta: string[] = []
  const sinCobrar = Number(f?.sin_cobrar ?? 0)
  const sinFacturar = Number(f?.sin_facturar ?? 0)
  const mon = c.moneda as 'VES' | 'USD'
  if (sinCobrar !== 0) {
    falta.push(t(idioma, 'ciclo.falta.cobrar')
      .replace('{m}', moneda(idioma, sinCobrar, mon)))
  }
  if (sinFacturar !== 0) {
    falta.push(t(idioma, 'ciclo.falta.facturar')
      .replace('{m}', moneda(idioma, sinFacturar, mon)))
  }

  const estado = c.estado as EstadoContrato
  return {
    estado,
    finPrevisto: c.fin_previsto?.toISOString().slice(0, 10) ?? null,
    finReal: c.fin_real?.toISOString().slice(0, 10) ?? null,
    pasos: PASOS[estado] ?? [],
    faltaLiquidar: falta,
    historia: filas.map((r): Cambio => ({
      de: r.de as EstadoContrato,
      a: r.a as EstadoContrato,
      motivo: r.motivo,
      finReal: r.fin_real?.toISOString().slice(0, 10) ?? null,
      cuando: r.ocurrido_en.toISOString().slice(0, 10),
      quien: r.nombre,
    })),
  }
}

export type CambioNuevo = {
  readonly contratoId: string
  readonly a: string
  readonly motivo: string
  readonly finReal: string
}

export type Cambiado =
  | { readonly hecho: true; readonly a: EstadoContrato }
  | { readonly hecho: false; readonly errores: readonly string[] }

const ISO = /^\d{4}-\d{2}-\d{2}$/

function fechaBuena(s: string): boolean {
  if (!ISO.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * Cambia el estado de un contrato.
 *
 * El motivo escrito es obligatorio, y no por burocracia: el estado de un contrato es de lo
 * que se discute con el cliente seis meses después, y un cambio sin motivo es un cambio que
 * ya nadie sabe explicar. Además es lo que impide que un formulario mandado sin tocar nada
 * suspenda un contrato — el mismo fallo que ya salió dos veces, con dar de baja a una
 * persona y con quitar un paso de una plantilla.
 */
export async function cambiarEstado(
  q: Consulta, c: CambioNuevo, personaId: string, orgId: string, idioma: Idioma,
): Promise<Cambiado> {
  const mal: string[] = []

  const [ctr] = (await q`
    select estado::text, inicio from contrato
     where id = ${c.contratoId}::uuid and organizacion_id = ${orgId}::uuid
  `) as unknown as Array<{ estado: string; inicio: Date | null }>

  // No existe, o no es de esta organización: la misma respuesta para las dos cosas.
  // Distinguirlas diría que existe un contrato que no es tuyo.
  if (!ctr) return { hecho: false, errores: [t(idioma, 'ciclo.error.no_existe')] }

  const de = ctr.estado as EstadoContrato
  const a = c.a as EstadoContrato
  const permitidos = PASOS[de] ?? []

  if (!permitidos.includes(a)) {
    mal.push(t(idioma, 'ciclo.error.paso')
      .replace('{de}', t(idioma, `contrato.estado.${de}` as Clave))
      .replace('{a}', ESTADOS.includes(a)
        ? t(idioma, `contrato.estado.${a}` as Clave)
        : a)
      .replace('{hacia}', permitidos.length === 0
        ? t(idioma, 'ciclo.error.a_ninguna_parte')
        : permitidos.map((x) => t(idioma, `contrato.estado.${x}` as Clave)).join(', ')))
  }

  if (c.motivo.trim().length < 3) mal.push(t(idioma, 'ciclo.error.motivo'))

  if (a === 'cerrado') {
    if (!fechaBuena(c.finReal)) {
      mal.push(t(idioma, 'ciclo.error.fin_real'))
    } else {
      const hoy = new Date().toISOString().slice(0, 10)
      if (c.finReal > hoy) mal.push(t(idioma, 'ciclo.error.fin_futuro'))
      const inicio = ctr.inicio?.toISOString().slice(0, 10) ?? null
      if (inicio !== null && c.finReal < inicio) {
        mal.push(t(idioma, 'ciclo.error.fin_antes').replace('{d}', inicio))
      }
    }
  }

  // Liquidar con dinero por medio se niega aquí con la cifra, además de negarse en la base
  // de datos. La cifra es lo que hace que el mensaje sirva: «no se puede» manda a buscar,
  // «quedan 12.400 sin cobrar» manda a cobrar.
  if (a === 'liquidado' && permitidos.includes(a)) {
    const s = await situacion(q, c.contratoId, orgId, idioma)
    for (const f of s?.faltaLiquidar ?? []) mal.push(f)
  }

  if (mal.length > 0) return { hecho: false, errores: mal }

  await q`
    select cambiar_estado_contrato(
      ${c.contratoId}::uuid, ${a}::estado_contrato,
      ${a === 'cerrado' ? c.finReal : null}::date,
      ${c.motivo.trim()}, ${personaId}::uuid)
  `
  return { hecho: true, a }
}

/** Para no pedirle al diccionario una clave que no existe cuando llega un estado inventado. */
const ESTADOS: readonly string[] = [
  'borrador', 'vigente', 'suspendido', 'cerrado', 'liquidado',
]
