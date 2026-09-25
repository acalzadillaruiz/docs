/**
 * La cartera de contratos.
 *
 * Es la primera pantalla con datos que ve cualquiera, y la que decide si el cliente
 * vuelve a entrar. La diferencia entre una lista y algo útil está en qué se enseña
 * de cada contrato sin tener que abrirlo.
 *
 * Aquí no se enseña «58%». Se enseña **qué está esperando a quién**, que es lo que
 * la persona vino a averiguar. Un porcentaje global no contesta ninguna pregunta:
 * ni cuándo llega lo suyo, ni si hay algo parado, ni si tiene que hacer algo.
 *
 * El aislamiento no se hace aquí: lo hacen las políticas de fila. Este módulo escribe
 * la consulta que quiere y la base de datos devuelve lo que a quien pregunta le toca.
 * Por eso la misma función sirve para dentro y para el cliente sin una sola rama.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, numero, fecha as formatearFecha, t, type Clave, type Idioma } from '../i18n/t.ts'

export type ResumenContrato = {
  readonly id: string
  readonly codigo: string
  readonly cliente: string
  readonly tipo: string
  readonly estado: string
  readonly monto: string
  readonly moneda: 'VES' | 'USD'
  /** Lo valuado y aprobado, sobre el monto del contrato. Sale del libro, no de un campo. */
  readonly avance: number
  readonly avanceTexto: string
  /** Qué está esperando a quién. Nulo cuando no hay nada pendiente. */
  readonly espera: Espera | null
  readonly finPrevisto: string | null
  /** Días de retraso sobre el fin previsto. Negativo es adelanto. */
  readonly diasTarde: number | null
}

export type Espera = {
  readonly deQuien: 'cliente' | 'gps'
  readonly que: string
  readonly cuantas: number
  readonly desdeDias: number
}

type Fila = {
  id: string
  codigo: string
  cliente: string
  tipo: string
  estado: string
  monto: string
  moneda: 'VES' | 'USD'
  valuado: string
  fin_previsto: Date | null
  dias_tarde: number | null
  por_aprobar: number
  por_aprobar_dias: number | null
  por_cobrar: number
  por_cobrar_dias: number | null
}

const TIPO: Record<string, Clave> = {
  procura: 'contrato.tipo.procura',
  servicio: 'contrato.tipo.servicio',
  reacondicionamiento: 'contrato.tipo.reacondicionamiento',
  transporte: 'contrato.tipo.transporte',
  alquiler: 'contrato.tipo.alquiler',
}

const ESTADO: Record<string, Clave> = {
  borrador: 'contrato.estado.borrador',
  vigente: 'contrato.estado.vigente',
  suspendido: 'contrato.estado.suspendido',
  cerrado: 'contrato.estado.cerrado',
  liquidado: 'contrato.estado.liquidado',
}

/**
 * Los contratos que le tocan a quien pregunta, con lo que necesita saber de cada uno.
 *
 * El orden no es alfabético ni por monto: primero lo que espera a alguien, y dentro
 * de eso lo que lleva más tiempo esperando. Una lista ordenada por código obliga a
 * leerla entera para encontrar lo que importa.
 */
export async function cartera(q: Consulta, idioma: Idioma): Promise<readonly ResumenContrato[]> {
  const filas = (await q`
    with v as (
      select contrato_id,
             sum(obra) filter (where estado in ('aprobada','facturada','cobrada')) as valuado,
             count(*)  filter (where estado in ('presentada','objetada'))           as por_aprobar,
             min(presentada_el) filter (where estado in ('presentada','objetada'))  as desde_aprobar,
             count(*)  filter (where estado in ('aprobada','facturada'))            as por_cobrar,
             min(aprobada_el)   filter (where estado in ('aprobada','facturada'))   as desde_cobrar
        from valuacion group by contrato_id
    )
    select c.id, c.codigo, o.nombre as cliente, c.tipo::text, c.estado::text,
           c.monto::text, c.moneda, coalesce(v.valuado, 0)::text as valuado,
           c.fin_previsto,
           case when c.fin_previsto is null or c.estado <> 'vigente' then null
                else (current_date - c.fin_previsto) end as dias_tarde,
           coalesce(v.por_aprobar, 0)::int as por_aprobar,
           case when v.desde_aprobar is null then null
                else (current_date - v.desde_aprobar) end as por_aprobar_dias,
           coalesce(v.por_cobrar, 0)::int as por_cobrar,
           case when v.desde_cobrar is null then null
                else (current_date - v.desde_cobrar) end as por_cobrar_dias
      from contrato c
      join organizacion o on o.id = c.cliente_id
      left join v on v.contrato_id = c.id
     order by (coalesce(v.por_aprobar, 0) > 0) desc,
              coalesce(v.desde_aprobar, current_date) asc,
              c.codigo
  `) as unknown as Fila[]

  return filas.map((f): ResumenContrato => {
    const monto = Number(f.monto)
    const valuado = Number(f.valuado)
    const avance = monto === 0 ? 0 : Math.round((valuado / monto) * 1000) / 10

    let espera: Espera | null = null
    if (f.por_aprobar > 0) {
      espera = {
        deQuien: 'cliente',
        que: t(idioma, 'valuacion.titulo'),
        cuantas: f.por_aprobar,
        desdeDias: f.por_aprobar_dias ?? 0,
      }
    } else if (f.por_cobrar > 0) {
      espera = {
        deQuien: 'gps',
        que: t(idioma, 'tesoreria.cxc'),
        cuantas: f.por_cobrar,
        desdeDias: f.por_cobrar_dias ?? 0,
      }
    }

    return {
      id: f.id,
      codigo: f.codigo,
      cliente: f.cliente,
      tipo: t(idioma, TIPO[f.tipo] ?? 'contrato.tipo.servicio'),
      estado: t(idioma, ESTADO[f.estado] ?? 'contrato.estado.vigente'),
      monto: moneda(idioma, monto, f.moneda),
      moneda: f.moneda,
      avance,
      avanceTexto: `${numero(idioma, avance, 1)} %`,
      espera,
      finPrevisto: f.fin_previsto ? formatearFecha(idioma, f.fin_previsto) : null,
      diasTarde: f.dias_tarde,
    }
  })
}
