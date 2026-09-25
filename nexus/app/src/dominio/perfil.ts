/**
 * El perfil: lo poco que cada persona decide sobre sí misma.
 *
 * Hoy son dos cosas: en qué idioma ve la aplicación y de qué quiere que le avisen.
 * Parece poco y es lo que decide si los avisos sobreviven. Un aviso del que no
 * puedes salir acaba marcado como correo no deseado, y con él todos los demás —
 * incluido el que avisa de que una valuación lleva un mes sin firmar.
 *
 * Las preferencias son de cada persona y de nadie más: ni de su empresa, ni de GPS.
 * Lo hacen cumplir las políticas de fila, no esta capa.
 */

import type { Consulta } from '../db/conexion.ts'
import { t, type Idioma } from '../i18n/t.ts'

export const TIPOS_AVISO = [
  'objecion_nueva', 'objecion_respondida', 'valuacion_presentada',
  'valuacion_aprobada', 'evidencia_sin_revisar', 'hito_atrasado',
] as const

export type TipoAviso = (typeof TIPOS_AVISO)[number]

/** Los avisos que solo tienen sentido dentro de GPS. Al cliente ni se le ofrecen. */
const SOLO_DENTRO: ReadonlySet<string> = new Set([
  'objecion_nueva', 'valuacion_aprobada', 'evidencia_sin_revisar', 'hito_atrasado',
])

export type Preferencia = {
  readonly tipo: TipoAviso
  readonly nombre: string
  readonly quiere: boolean
}

export type Perfil = {
  readonly nombre: string
  readonly correo: string
  readonly organizacion: string
  readonly idioma: Idioma
  readonly preferencias: readonly Preferencia[]
}

export async function perfil(
  q: Consulta, personaId: string, idioma: Idioma, esCliente: boolean,
): Promise<Perfil> {
  const [p] = (await q`
    select pe.nombre, pe.correo, pe.idioma, o.nombre as organizacion
      from persona pe join organizacion o on o.id = pe.organizacion_id
     where pe.id = ${personaId}::uuid
  `) as unknown as Array<{ nombre: string; correo: string; idioma: string; organizacion: string }>
  if (!p) throw new Error('no se encuentra a esa persona')

  const dichas = (await q`
    select tipo::text, quiere from preferencia_aviso where persona_id = ${personaId}::uuid
  `) as unknown as Array<{ tipo: string; quiere: boolean }>
  const mapa = new Map(dichas.map((d) => [d.tipo, d.quiere]))

  return {
    nombre: p.nombre,
    correo: p.correo,
    organizacion: p.organizacion,
    idioma: p.idioma === 'en' ? 'en' : 'es',
    preferencias: TIPOS_AVISO
      .filter((tipo) => !(esCliente && SOLO_DENTRO.has(tipo)))
      .map((tipo): Preferencia => ({
        tipo,
        // El nombre del aviso es su propio asunto, sin los datos rellenados. Es lo
        // que la persona va a reconocer en su bandeja.
        nombre: t(idioma, `aviso.${tipo}.asunto` as Parameters<typeof t>[1])
          .replace(/\{\w+\}/g, '…'),
        // Por omisión se recibe: un aviso que hay que activar es un aviso que nadie
        // activa.
        quiere: mapa.get(tipo) ?? true,
      })),
  }
}

/**
 * Guarda lo que la persona marcó.
 *
 * Llegan los tipos que SÍ quiere; lo que no viene es que lo desmarcó. Un formulario
 * con casillas manda solo las marcadas, así que guardar «lo que vino» sin escribir
 * también lo que no vino dejaría imposible desmarcar nada.
 */
export async function guardarPerfil(
  q: Consulta, personaId: string, idioma: Idioma, quiere: readonly string[],
  esCliente: boolean,
): Promise<void> {
  const marcados = new Set(quiere)
  await q`update persona set idioma = ${idioma} where id = ${personaId}::uuid`

  for (const tipo of TIPOS_AVISO) {
    if (esCliente && SOLO_DENTRO.has(tipo)) continue
    await q`
      insert into preferencia_aviso (persona_id, tipo, quiere)
      values (${personaId}::uuid, ${tipo}, ${marcados.has(tipo)})
      on conflict (persona_id, tipo) do update set quiere = excluded.quiere`
  }
}
