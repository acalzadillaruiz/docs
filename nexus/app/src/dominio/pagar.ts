/**
 * Pagar una factura de proveedor.
 *
 * Estaban las dos mitades —la tabla `pago` y el generador `asentar_pago`— y no había
 * forma de llegar a ellas desde ninguna pantalla. Una contabilidad en la que entran
 * facturas y no sale nunca un pago da un saldo de proveedores que crece para siempre
 * y que no es el de nadie. Esto cierra el ciclo.
 *
 * Dos cosas que se deciden aquí y no en la pantalla:
 *
 * **El IGTF lo calcula el generador, no la persona.** Pagar en divisa cuesta un 3%
 * más, y ese 3% es un gasto con su cuenta propia. Dejarlo a criterio de quien teclea
 * es garantizar que la mitad de los pagos lo lleven y la otra mitad no.
 *
 * **No se puede pagar más de lo que se debe.** El saldo sale de restar —factura,
 * menos retenciones, menos lo ya pagado—, nunca de una columna guardada, así que no
 * hay forma de que se quede viejo.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, t, type Clave, type Idioma } from '../i18n/t.ts'

export type Deuda = {
  readonly documento: string
  readonly proveedor: string
  readonly factura: string
  readonly fecha: string
  readonly dias: number
  readonly saldo: string
  readonly saldoCrudo: number
  readonly contrato: string | null
  readonly pagos: readonly PagoHecho[]
}

export type PagoHecho = {
  readonly fecha: string
  readonly medio: string
  readonly monto: string
  readonly referencia: string | null
  readonly asiento: string | null
}

export const MEDIOS = ['transferencia', 'divisa_efectivo', 'cheque', 'compensacion'] as const
export type Medio = (typeof MEDIOS)[number]

const MEDIO_CLAVE: Record<Medio, Clave> = {
  transferencia: 'pago.medio.transferencia',
  divisa_efectivo: 'pago.medio.divisa',
  cheque: 'pago.medio.cheque',
  compensacion: 'pago.medio.compensacion',
}

export function esMedio(v: string): v is Medio {
  return (MEDIOS as readonly string[]).includes(v)
}

export async function porPagar(
  q: Consulta, orgId: string, idioma: Idioma, al = new Date().toISOString().slice(0, 10),
): Promise<readonly Deuda[]> {
  const filas = (await q`
    select documento, proveedor, factura, to_char(fecha,'YYYY-MM-DD') as fecha,
           dias, saldo::text, contrato
      from por_pagar(${orgId}::uuid, ${al}::date)
  `) as unknown as Array<{
    documento: string; proveedor: string; factura: string; fecha: string
    dias: number; saldo: string; contrato: string | null
  }>

  const salida: Deuda[] = []
  for (const f of filas) {
    const pagos = (await q`
      select to_char(fecha,'YYYY-MM-DD') as fecha, medio, monto::text, referencia,
             asiento::text
        from pagos_de(${f.documento}::uuid)
    `) as unknown as Array<{
      fecha: string; medio: string; monto: string; referencia: string | null
      asiento: string | null
    }>
    salida.push({
      documento: f.documento,
      proveedor: f.proveedor,
      factura: f.factura,
      fecha: f.fecha,
      dias: Number(f.dias),
      saldo: moneda(idioma, Number(f.saldo), 'VES'),
      saldoCrudo: Number(f.saldo),
      contrato: f.contrato,
      // Un pago que no se ve es un pago que se hace dos veces.
      pagos: pagos.map((p): PagoHecho => ({
        fecha: p.fecha,
        medio: t(idioma, MEDIO_CLAVE[p.medio as Medio] ?? 'pago.medio.transferencia'),
        monto: moneda(idioma, Number(p.monto), 'VES'),
        referencia: p.referencia,
        asiento: p.asiento,
      })),
    })
  }
  return salida
}

export type Pagado =
  | { readonly hecho: true; readonly id: string }
  | { readonly hecho: false; readonly motivo: string }

export type Orden = {
  readonly documento: string
  readonly fecha: string
  readonly medio: string
  readonly moneda: 'VES' | 'USD'
  readonly monto: number
  readonly referencia: string | null
}

/**
 * Todo se comprueba ANTES de llamar.
 *
 * Una excepción dentro de una transacción la aborta entera y la biblioteca la vuelve
 * a lanzar al cerrarla: un `try` alrededor devuelve un mensaje amable y el error
 * crudo sale igual.
 */
export async function registrarPago(
  q: Consulta, o: Orden, personaId: string, idioma: Idioma,
): Promise<Pagado> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.fecha) || Number.isNaN(Date.parse(o.fecha))) {
    return { hecho: false, motivo: t(idioma, 'pago.error.fecha') }
  }
  if (!esMedio(o.medio)) return { hecho: false, motivo: t(idioma, 'pago.error.medio') }
  if (!(o.monto > 0)) return { hecho: false, motivo: t(idioma, 'pago.error.monto') }

  const [d] = (await q`
    select d.id, d.sentido::text, saldo_documento(d.id)::text as saldo,
           tasa_del_dia(${o.fecha}::date) as tasa
      from documento_fiscal d
     where d.id = ${/^[0-9a-f-]{36}$/i.test(o.documento) ? o.documento : null}::uuid
  `) as unknown as Array<{ id: string; sentido: string; saldo: string; tasa: string | null }>
  if (!d) return { hecho: false, motivo: t(idioma, 'pago.error.factura') }
  if (d.sentido !== 'recibido') return { hecho: false, motivo: t(idioma, 'pago.error.factura') }
  if (d.tasa === null) return { hecho: false, motivo: t(idioma, 'pago.error.tasa') }

  // En bolívares se compara directo; en divisas hay que pasar por la tasa del día,
  // que es la misma que usará el asiento. Comparar un importe en dólares contra un
  // saldo en bolívares daría por bueno cualquier pago.
  const [c] = (await q`
    select ${o.moneda === 'VES' ? o.monto : 0}::numeric
           + case when ${o.moneda} = 'USD'
                  then convertir(${o.monto}, 'USD','VES', ${d.tasa}::uuid) else 0 end as ves
  `) as unknown as Array<{ ves: string }>
  if (Number(c!.ves) > Number(d.saldo)) {
    return {
      hecho: false,
      motivo: t(idioma, 'pago.error.excede').replace('{n}', moneda(idioma, Number(d.saldo), 'VES')),
    }
  }

  const [p] = (await q`
    select 1 as x from periodo pe
     join documento_fiscal df on df.organizacion_id = pe.organizacion_id
    where df.id = ${o.documento}::uuid
      and pe.anio = extract(year from ${o.fecha}::date)::int
      and pe.mes  = extract(month from ${o.fecha}::date)::int
      and pe.estado = 'abierto'
  `) as unknown as Array<{ x: number }>
  if (!p) return { hecho: false, motivo: t(idioma, 'pago.error.periodo') }

  const [r] = (await q`
    select registrar_pago(${o.documento}::uuid, ${o.fecha}::date, ${o.medio}::medio_pago,
                          ${o.moneda}::moneda, ${o.monto}, ${o.referencia},
                          ${personaId}::uuid) as id
  `) as unknown as Array<{ id: string }>
  return { hecho: true, id: r!.id }
}

/** Los medios de pago, ya traducidos, para el desplegable. */
export function mediosTraducidos(idioma: Idioma): readonly { codigo: Medio; nombre: string }[] {
  return MEDIOS.map((m) => ({ codigo: m, nombre: t(idioma, MEDIO_CLAVE[m]) }))
}
