/**
 * Reexpresión por inflación (VEN-NIF / NIC 29), en pantalla.
 *
 * En una economía hiperinflacionaria, comparar el resultado de enero con el de
 * diciembre sin reexpresar no es una aproximación: **es una cifra falsa**. Un balance
 * histórico dice que la empresa creció cuando lo único que creció fue el índice.
 *
 * Lo que esta pantalla tiene que dejar claro, y por eso el dominio devuelve las tres
 * cosas juntas por cuenta:
 *
 *   - Lo **monetario** no se reexpresa. Un bolívar en el banco sigue siendo un
 *     bolívar. Y precisamente por eso tenerlo cuesta dinero.
 *   - Ese coste es el **resultado monetario del ejercicio**, y no es un ajuste de
 *     cuadre inventado: es exactamente lo que costó tener bolívares mientras se
 *     devaluaban. Es la cifra que un CFO mira primero.
 *   - El ajuste se ve **cuenta por cuenta**, no como un número al final. Un ajuste
 *     global que nadie puede abrir es un número que nadie se cree.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, t, type Idioma } from '../i18n/t.ts'

export type Linea = {
  readonly codigo: string
  readonly cuenta: string
  readonly monetaria: boolean
  readonly historico: string
  readonly reexpresado: string
  readonly ajuste: string
  readonly ajusteCrudo: number
}

export type Cuadro = {
  readonly al: string
  readonly lineas: readonly Linea[]
  /** El REME, con signo: negativo es pérdida por haber tenido bolívares. */
  readonly reme: string
  readonly remeCrudo: number
  /** Sin índice de precios no hay nada que enseñar, y hay que decirlo así. */
  readonly sinIndice: boolean
}

export async function cuadro(
  q: Consulta, orgId: string, idioma: Idioma, al: string,
): Promise<Cuadro> {
  // Sin índice al día pedido, `reexpresar` levanta una excepción que aborta la
  // transacción entera. Se pregunta antes, para poder explicarlo en vez de reventar.
  const [i] = (await q`select indice_del_dia(${al}::date) as v`) as unknown as
    Array<{ v: string | null }>
  if (i?.v == null) {
    return { al, lineas: [], reme: moneda(idioma, 0, 'VES'), remeCrudo: 0, sinIndice: true }
  }

  const filas = (await q`
    select codigo, cuenta_es, cuenta_en, monetaria,
           historico::text, reexpresado::text, ajuste::text
      from reexpresar(${orgId}::uuid, ${al}::date)
  `) as unknown as Array<Record<string, string | boolean>>

  const [r] = (await q`
    select resultado_monetario(${orgId}::uuid, ${al}::date)::text as reme
  `) as unknown as Array<{ reme: string }>
  const reme = Number(r?.reme ?? 0)

  return {
    al,
    lineas: filas.map((f) => ({
      codigo: f['codigo'] as string,
      cuenta: (idioma === 'es' ? f['cuenta_es'] : f['cuenta_en']) as string,
      monetaria: f['monetaria'] === true,
      historico: moneda(idioma, Number(f['historico']), 'VES'),
      reexpresado: moneda(idioma, Number(f['reexpresado']), 'VES'),
      ajuste: moneda(idioma, Number(f['ajuste']), 'VES'),
      ajusteCrudo: Number(f['ajuste']),
    })),
    reme: moneda(idioma, reme, 'VES'),
    remeCrudo: reme,
    sinIndice: false,
  }
}

export type Asentado =
  | { readonly hecho: true; readonly asiento: string | null }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Asienta la reexpresión de un mes.
 *
 * Las tres condiciones se comprueban aquí, antes de llamar: una excepción dentro de
 * una transacción la aborta entera, y entonces no queda nada que contarle a nadie.
 */
export async function asentarMes(
  q: Consulta, orgId: string, anio: number, mes: number, personaId: string, idioma: Idioma,
): Promise<Asentado> {
  const [ya] = (await q`
    select count(*)::int as n from asiento asi
     where asi.organizacion_id = ${orgId}::uuid and asi.origen_tipo = 'reexpresion'
       and asi.anio = ${anio} and asi.mes = ${mes} and asi.reversa_a is null
       and not exists (select 1 from asiento rev where rev.reversa_a = asi.id)
  `) as unknown as Array<{ n: number }>
  if (Number(ya?.n ?? 0) > 0) return { hecho: false, motivo: t(idioma, 'reex.error.mes') }

  const [periodo] = (await q`
    select 1 as x from periodo
     where organizacion_id = ${orgId}::uuid and anio = ${anio} and mes = ${mes}
       and estado = 'abierto'
  `) as unknown as Array<{ x: number }>
  if (!periodo) return { hecho: false, motivo: t(idioma, 'reex.error.periodo') }

  const fin = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10)
  const [i] = (await q`select indice_del_dia(${fin}::date) as v`) as unknown as
    Array<{ v: string | null }>
  if (i?.v == null) return { hecho: false, motivo: t(idioma, 'reex.error.indice') }

  const [a] = (await q`
    select asentar_reexpresion(${orgId}::uuid, ${anio}, ${mes}, ${personaId}::uuid) as id
  `) as unknown as Array<{ id: string | null }>
  return { hecho: true, asiento: a?.id ?? null }
}

/** Los meses ya reexpresados, para no ofrecer el botón dos veces. */
export async function mesesReexpresados(
  q: Consulta, orgId: string,
): Promise<readonly { anio: number; mes: number }[]> {
  return (await q`
    select asi.anio, asi.mes from asiento asi
     where asi.organizacion_id = ${orgId}::uuid and asi.origen_tipo = 'reexpresion'
       and asi.reversa_a is null
       and not exists (select 1 from asiento rev where rev.reversa_a = asi.id)
     order by asi.anio desc, asi.mes desc limit 24
  `) as unknown as Array<{ anio: number; mes: number }>
}
