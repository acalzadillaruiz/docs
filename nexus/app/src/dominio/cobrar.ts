/**
 * Registrar un cobro.
 *
 * Cierra el ciclo: valuación → asiento → cobro → asiento. Cuando el cobro entra, la
 * cuenta por cobrar de esa valuación queda en cero **sola**. Nadie la marca a mano,
 * y eso no es comodidad: un saldo que alguien marca es un saldo que algún día se
 * queda sin marcar.
 *
 * El saldo tampoco se guarda: se resta. Un saldo guardado es un saldo que algún día
 * dejará de ser cierto.
 *
 * Y el IGTF se causa aquí y no al facturar, porque el impuesto grava el pago en
 * divisa, no la factura. Un cobro parcial en bolívares no lo causa; uno en dólares
 * sí. Eso ya vive en el generador del asiento y no se repite aquí.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, t, type Idioma } from '../i18n/t.ts'

export type Medio = 'transferencia' | 'divisa_efectivo' | 'cheque' | 'compensacion'

export const MEDIOS: readonly Medio[] = [
  'transferencia', 'divisa_efectivo', 'cheque', 'compensacion',
]

export type EstadoCobro = {
  readonly valuacionId: string
  readonly numero: number
  readonly contrato: string
  readonly cliente: string
  readonly moneda: 'VES' | 'USD'
  readonly saldo: string
  readonly saldoCrudo: number
  readonly cobrada: boolean
  readonly cobros: readonly {
    readonly fecha: string
    readonly medio: Medio
    readonly monto: string
    readonly referencia: string | null
  }[]
}

export class NoCobrable extends Error {
  constructor() {
    super('esa valuación no existe, no te corresponde, o todavía no se puede cobrar')
    this.name = 'NoCobrable'
  }
}

export async function estadoDeCobro(
  q: Consulta, valuacionId: string, idioma: Idioma,
): Promise<EstadoCobro> {
  const [quien] = (await q`select es_interna() as dentro`) as unknown as
    Array<{ dentro: boolean }>
  // Cobrar es de GPS. El cliente ve su valuación, no la caja de quien le factura.
  if (!quien?.dentro) throw new NoCobrable()

  const [v] = (await q`
    select va.id, va.numero, va.moneda, va.estado::text, ct.codigo, o.nombre as cliente,
           saldo_valuacion(va.id)::text as saldo
      from valuacion va
      join contrato ct on ct.id = va.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where va.id = ${valuacionId}::uuid
  `) as unknown as Array<{
    id: string; numero: number; moneda: 'VES' | 'USD'; estado: string
    codigo: string; cliente: string; saldo: string
  }>
  if (!v) throw new NoCobrable()

  const cobros = (await q`
    select fecha, medio::text, monto::text, moneda, referencia
      from cobro where valuacion_id = ${valuacionId}::uuid order by fecha
  `) as unknown as Array<{
    fecha: Date; medio: Medio; monto: string; moneda: 'VES' | 'USD'; referencia: string | null
  }>

  const saldo = Number(v.saldo)
  return {
    valuacionId,
    numero: v.numero,
    contrato: v.codigo,
    cliente: v.cliente,
    moneda: v.moneda,
    saldo: moneda(idioma, saldo, v.moneda),
    saldoCrudo: saldo,
    cobrada: saldo <= 0,
    cobros: cobros.map((c) => ({
      fecha: c.fecha.toISOString().slice(0, 10),
      medio: c.medio,
      monto: moneda(idioma, Number(c.monto), c.moneda),
      referencia: c.referencia,
    })),
  }
}

export type Cobro = {
  readonly valuacionId: string
  readonly fecha: string
  readonly medio: Medio
  readonly monto: number
  readonly referencia: string
}

export type Registrado =
  | { readonly hecho: true; readonly cobroId: string; readonly saldo: number }
  | { readonly hecho: false; readonly errores: readonly string[] }

/**
 * Anota el cobro y lo asienta, en la misma transacción.
 *
 * Igual que con las facturas importadas: un cobro registrado y sin asentar parece
 * que cuenta y no cuenta. O entran las dos cosas o no entra ninguna.
 */
export async function registrarCobro(
  q: Consulta, c: Cobro, personaId: string, orgId: string, idioma: Idioma,
): Promise<Registrado> {
  const errores: string[] = []
  if (!(c.monto > 0)) errores.push(t(idioma, 'cobrar.error.monto'))

  const [v] = (await q`
    select estado::text, moneda, saldo_valuacion(id)::text as saldo
      from valuacion where id = ${c.valuacionId}::uuid
  `) as unknown as Array<{ estado: string; moneda: 'VES' | 'USD'; saldo: string }>
  if (!v) throw new NoCobrable()
  if (!['aprobada', 'facturada', 'cobrada'].includes(v.estado)) {
    errores.push(t(idioma, 'cobrar.error.estado'))
  }
  // Cobrar de más no es un descuido que se arregle luego: deja la cuenta por cobrar
  // en negativo, y un saldo negativo no significa nada en un libro.
  if (v && c.monto > Number(v.saldo) + 0.005) errores.push(t(idioma, 'cobrar.error.pasa'))

  const [tasa] = (await q`
    select id from tasa_bcv where vigente_el <= ${c.fecha}::date
     order by vigente_el desc limit 1
  `) as unknown as Array<{ id: string }>
  if (!tasa) errores.push(t(idioma, 'cobrar.error.tasa'))

  const [periodo] = (await q`
    select 1 as x from periodo
     where organizacion_id = ${orgId}::uuid
       and anio = extract(year from ${c.fecha}::date)::int
       and mes = extract(month from ${c.fecha}::date)::int
       and estado = 'abierto'
  `) as unknown as Array<{ x: number }>
  if (!periodo) errores.push(t(idioma, 'cobrar.error.periodo'))

  if (errores.length > 0) return { hecho: false, errores: [...new Set(errores)] }

  const [fila] = (await q`
    insert into cobro (organizacion_id, valuacion_id, fecha, medio, moneda, monto,
                       tasa_id, referencia, registrado_por)
    values (${orgId}::uuid, ${c.valuacionId}::uuid, ${c.fecha}::date, ${c.medio},
            ${v!.moneda}, ${c.monto.toFixed(2)}, ${tasa!.id}::uuid,
            ${c.referencia.trim() || null}, ${personaId}::uuid)
    returning id
  `) as unknown as Array<{ id: string }>

  await q`select asentar_cobro(${fila!.id}::uuid, ${personaId}::uuid)`

  const [despues] = (await q`
    select saldo_valuacion(${c.valuacionId}::uuid)::text as saldo
  `) as unknown as Array<{ saldo: string }>
  const saldo = Number(despues?.saldo ?? 0)

  // Cuando no queda nada, la valuación pasa a cobrada. La condición va DENTRO del
  // update: dos cobros simultáneos no pueden dejarla a medias.
  if (saldo <= 0) {
    await q`
      update valuacion set estado = 'cobrada'
       where id = ${c.valuacionId}::uuid and estado in ('aprobada','facturada')`
  }

  return { hecho: true, cobroId: fila!.id, saldo }
}

export function nombreMedio(idioma: Idioma, medio: Medio): string {
  return t(idioma, `medio.${medio}` as Parameters<typeof t>[1])
}
