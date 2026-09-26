/**
 * El estado de cuenta del cliente: qué le han facturado y qué debe.
 *
 * Es la segunda pregunta de cualquiera que paga —la primera es «¿cómo va mi obra?»— y no la
 * contestaba ninguna pantalla desde su lado. El cliente veía cada valuación por separado y
 * tenía que sumarlas él, o llamar a GPS a preguntar. Y llamar a preguntar por una cifra que el
 * sistema ya sabe es exactamente lo que hace que un portal no se use.
 *
 * La base de datos estaba preparada: la política de fila de `documento_fiscal` le concede al
 * cliente las facturas emitidas a su nombre, y el permiso de tabla también. Un permiso
 * concedido a propósito que ninguna pantalla usaba.
 *
 * Lo que sí faltaba: **el cliente no puede ver la tabla de cobros**, y con razón — ahí vive el
 * medio de pago y la referencia bancaria de GPS. Por eso lo suma una función de la base con
 * `security definer`, que le devuelve el total pagado sin abrirle la tabla. Todo el cuidado de
 * ese trozo está en la propia función y en su comentario: saltarse las políticas de fila es lo
 * que la hace útil, y por eso lo primero que hace es comprobar quién pregunta.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, t, type Clave, type Idioma } from '../i18n/t.ts'

export type LineaCuenta = {
  readonly contratoId: string
  readonly contrato: string
  readonly titulo: string
  readonly valuacionId: string
  readonly numero: number
  readonly hasta: string
  readonly estado: string
  /** El estado sin traducir, para que la pantalla pueda marcar lo que espera al cliente. */
  readonly estadoCrudo: string
  readonly neto: string
  readonly cobrado: string
  readonly saldo: string
  /** Vacío mientras no se haya facturado: aprobada no es facturada. */
  readonly factura: string | null
  readonly facturaEl: string | null
  /** Para poder sumar sin volver a pedir nada. */
  readonly saldoCrudo: number
  readonly netoCrudo: number
}

export type Cuenta = {
  readonly lineas: readonly LineaCuenta[]
  readonly moneda: string
  /** Lo facturado y presentado, lo cobrado y lo que queda, ya escrito. */
  readonly totalNeto: string
  readonly totalCobrado: string
  readonly totalSaldo: string
  /** Lo que espera su firma, que es lo único de aquí sobre lo que puede actuar. */
  readonly porFirmar: number
}

/**
 * El estado de cuenta de una organización cliente.
 *
 * Las monedas no se suman entre sí: si hubiera contratos en bolívares y en dólares, sumarlos
 * daría un número que no significa nada. Mientras todo esté en la misma, se totaliza; si hay
 * más de una, los totales se dejan por línea y el total va vacío. Es preferible no dar un
 * total a dar uno falso.
 */
export async function estadoDeCuenta(
  q: Consulta, orgId: string, idioma: Idioma,
): Promise<Cuenta> {
  const filas = (await q`
    select contrato_id, contrato, titulo_es, titulo_en, valuacion_id, numero,
           periodo_hasta, estado, moneda, neto::text as neto, cobrado::text as cobrado,
           saldo::text as saldo, factura, control, factura_el
      from estado_de_cuenta(${orgId}::uuid)
  `) as unknown as Array<{
    contrato_id: string; contrato: string; titulo_es: string; titulo_en: string
    valuacion_id: string; numero: number; periodo_hasta: Date; estado: string
    moneda: string; neto: string; cobrado: string; saldo: string
    factura: string | null; control: string | null; factura_el: Date | null
  }>

  const monedas = new Set(filas.map((f) => f.moneda))
  const unica = monedas.size === 1 ? [...monedas][0]! : null

  let neto = 0
  let cobrado = 0
  let saldo = 0
  let porFirmar = 0

  const lineas = filas.map((f): LineaCuenta => {
    neto += Number(f.neto)
    cobrado += Number(f.cobrado)
    saldo += Number(f.saldo)
    if (f.estado === 'presentada') porFirmar += 1
    return {
      contratoId: f.contrato_id,
      contrato: f.contrato,
      titulo: idioma === 'es' ? f.titulo_es : f.titulo_en,
      valuacionId: f.valuacion_id,
      numero: f.numero,
      hasta: f.periodo_hasta.toISOString().slice(0, 10),
      estado: t(idioma, `valuacion.estado.${f.estado}` as Clave),
      estadoCrudo: f.estado,
      neto: moneda(idioma, Number(f.neto), f.moneda as 'VES' | 'USD'),
      cobrado: moneda(idioma, Number(f.cobrado), f.moneda as 'VES' | 'USD'),
      saldo: moneda(idioma, Number(f.saldo), f.moneda as 'VES' | 'USD'),
      // El número de control va junto al de factura porque es el que pide el SENIAT y el
      // que el cliente necesita para declarar su crédito fiscal.
      factura: f.factura === null ? null
        : f.control === null ? f.factura : `${f.factura} · ${f.control}`,
      facturaEl: f.factura_el?.toISOString().slice(0, 10) ?? null,
      saldoCrudo: Number(f.saldo),
      netoCrudo: Number(f.neto),
    }
  })

  const total = (v: number) => unica === null
    ? '' : moneda(idioma, v, unica as 'VES' | 'USD')

  return {
    lineas,
    moneda: unica ?? '',
    totalNeto: total(neto),
    totalCobrado: total(cobrado),
    totalSaldo: total(saldo),
    porFirmar,
  }
}
