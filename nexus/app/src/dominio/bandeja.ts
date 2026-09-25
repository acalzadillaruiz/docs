/**
 * La bandeja de lo que espera a GPS.
 *
 * Es la otra mitad del círculo. Sin esto, el cliente objeta una valuación y nadie de
 * GPS se entera hasta que a alguien se le ocurre entrar a mirar — que es exactamente
 * el agujero que hace que un portal de cliente acabe sin usarse: el cliente escribe
 * y no pasa nada.
 *
 * Se ordena por lo que lleva más tiempo esperando, no por fecha de contrato ni por
 * importe. Lo que lleva veinte días parado es más urgente que lo que llegó ayer,
 * aunque sea de menos dinero, porque el daño de dejar a un cliente sin respuesta no
 * es proporcional al importe.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, t, type Idioma } from '../i18n/t.ts'

export type Pendiente = {
  readonly clase: 'objecion' | 'sin_presentar' | 'por_cobrar'
  readonly valuacionId: string
  readonly contratoId: string
  readonly contrato: string
  readonly cliente: string
  readonly titulo: string
  readonly detalle: string
  readonly dias: number
  readonly importe: string
}

type Fila = {
  clase: 'objecion' | 'sin_presentar' | 'por_cobrar'
  valuacion_id: string
  contrato_id: string
  contrato: string
  cliente: string
  detalle: string | null
  dias: number
  importe: string
  moneda: 'VES' | 'USD'
}

const TITULO: Record<string, { es: string; en: string }> = {
  objecion: { es: 'Objeción sin responder', en: 'Unanswered dispute' },
  sin_presentar: { es: 'Valuación sin presentar', en: 'Progress payment not submitted' },
  por_cobrar: { es: 'Aprobada y sin cobrar', en: 'Approved and unpaid' },
}

/**
 * Lo que espera a GPS, ordenado por antigüedad.
 *
 * No lleva ninguna rama para el cliente: esta consulta solo la puede hacer alguien de
 * dentro, porque toca valuaciones en estado borrador, que las políticas de fila no
 * devuelven a un cliente. Si un cliente la llamara, recibiría una lista vacía.
 */
export async function bandeja(q: Consulta, idioma: Idioma): Promise<readonly Pendiente[]> {
  const filas = (await q`
    -- Objeciones que el cliente escribió y nadie ha contestado.
    select 'objecion' as clase, v.id as valuacion_id, ct.id as contrato_id,
           ct.codigo as contrato, o.nombre as cliente,
           left(ob.motivo, 160) as detalle,
           (current_date - ob.objetada_en::date) as dias,
           v.obra::text as importe, v.moneda
      from objecion ob
      join valuacion v on v.id = ob.valuacion_id
      join contrato ct on ct.id = v.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where ob.respondida_en is null

    union all

    -- Valuaciones que se quedaron en borrador: obra hecha que ni siquiera se ha
    -- puesto delante del cliente. Es dinero parado por descuido, no por discusión.
    select 'sin_presentar', v.id, ct.id, ct.codigo, o.nombre,
           null,
           (current_date - v.periodo_hasta),
           v.obra::text, v.moneda
      from valuacion v
      join contrato ct on ct.id = v.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where v.estado = 'borrador' and v.periodo_hasta < current_date

    union all

    -- Aprobadas hace tiempo y todavía sin cobrar.
    select 'por_cobrar', v.id, ct.id, ct.codigo, o.nombre,
           null,
           (current_date - v.aprobada_el),
           v.obra::text, v.moneda
      from valuacion v
      join contrato ct on ct.id = v.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where v.estado in ('aprobada','facturada')
       and v.aprobada_el is not null
       and (current_date - v.aprobada_el) >= 30

     order by 7 desc
  `) as unknown as Fila[]

  return filas.map((f): Pendiente => ({
    clase: f.clase,
    valuacionId: f.valuacion_id,
    contratoId: f.contrato_id,
    contrato: f.contrato,
    cliente: f.cliente,
    titulo: TITULO[f.clase]![idioma],
    detalle: f.detalle ?? t(idioma, 'valuacion.titulo'),
    dias: f.dias,
    importe: moneda(idioma, Number(f.importe), f.moneda),
  }))
}
