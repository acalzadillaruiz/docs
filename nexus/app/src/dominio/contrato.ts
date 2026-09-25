/**
 * La ficha de contrato.
 *
 * Es la pantalla a la que lleva cada tarjeta de la cartera, y la que tiene que
 * contestar la segunda pregunta: «vale, ¿y qué está pasando exactamente?».
 *
 * Dos decisiones:
 *
 *   - Los renglones llevan **norma y especificación** a la vista, no escondidas en un
 *     desplegable. En un contrato petrolero, que un cabezal sea API 6A y no otra cosa
 *     es la mitad de lo que se compró, y es lo primero que se discute cuando algo
 *     llega y no encaja.
 *
 *   - El precio de compra y el margen **no se piden en la consulta** cuando quien
 *     pregunta es un cliente. No es que se filtren después: el rol del cliente no
 *     tiene permiso sobre esa columna, así que pedirla daría un error. Se pide solo
 *     cuando corresponde, y el tipo lo refleja.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, numero, fecha as formatearFecha, t, type Clave, type Idioma } from '../i18n/t.ts'
import { ValuacionNoAlcanzable } from './valuacion.ts'

export type Renglon = {
  readonly numero: number
  readonly descripcion: string
  readonly cantidad: string
  readonly unidad: string
  readonly norma: string | null
  readonly especificacion: string | null
  readonly precioUnitario: string
  readonly total: string
  /** Solo para dentro. Nulo siempre que quien pregunta es un cliente. */
  readonly costoUnitario: string | null
  readonly margenPct: string | null
}

export type ValuacionBreve = {
  readonly id: string
  readonly numero: number
  readonly periodo: string
  readonly estado: string
  readonly estadoCrudo: string
  readonly obra: string
}

export type FichaContrato = {
  readonly id: string
  readonly codigo: string
  readonly cliente: string
  readonly titulo: string
  readonly tipo: string
  readonly estado: string
  readonly monto: string
  readonly moneda: 'VES' | 'USD'
  readonly firmado: string | null
  readonly inicio: string | null
  readonly finPrevisto: string | null
  readonly anticipoPct: string
  readonly garantiaPct: string
  readonly renglones: readonly Renglon[]
  readonly valuaciones: readonly ValuacionBreve[]
}

const TIPO: Record<string, Clave> = {
  procura: 'contrato.tipo.procura',
  servicio: 'contrato.tipo.servicio',
  reacondicionamiento: 'contrato.tipo.reacondicionamiento',
  transporte: 'contrato.tipo.transporte',
  alquiler: 'contrato.tipo.alquiler',
}
const ESTADO_C: Record<string, Clave> = {
  borrador: 'contrato.estado.borrador', vigente: 'contrato.estado.vigente',
  suspendido: 'contrato.estado.suspendido', cerrado: 'contrato.estado.cerrado',
  liquidado: 'contrato.estado.liquidado',
}
const ESTADO_V: Record<string, Clave> = {
  borrador: 'valuacion.estado.borrador', presentada: 'valuacion.estado.presentada',
  objetada: 'valuacion.estado.objetada', aprobada: 'valuacion.estado.aprobada',
  facturada: 'valuacion.estado.facturada', cobrada: 'valuacion.estado.cobrada',
  anulada: 'valuacion.estado.anulada',
}

/**
 * No existir y no corresponderte se contestan igual, por el mismo motivo que en la
 * valuación: decir «existe pero no es tuyo» ya cuenta algo del contrato de otro.
 */
export class ContratoNoAlcanzable extends Error {
  readonly contratoId: string
  constructor(contratoId: string) {
    super('No se encuentra ese contrato')
    this.name = 'ContratoNoAlcanzable'
    this.contratoId = contratoId
  }
}

export async function ficha(
  q: Consulta, contratoId: string, idioma: Idioma, verCostos: boolean,
): Promise<FichaContrato> {
  const [c] = (await q`
    select c.id, c.codigo, o.nombre as cliente, c.titulo_es, c.titulo_en,
           c.tipo::text, c.estado::text, c.monto::text, c.moneda,
           c.firmado_el, c.inicio, c.fin_previsto,
           c.anticipo_pct::text, c.garantia_pct::text
      from contrato c join organizacion o on o.id = c.cliente_id
     where c.id = ${contratoId}::uuid
  `) as unknown as Array<{
    id: string; codigo: string; cliente: string; titulo_es: string; titulo_en: string
    tipo: string; estado: string; monto: string; moneda: 'VES' | 'USD'
    firmado_el: Date | null; inicio: Date | null; fin_previsto: Date | null
    anticipo_pct: string; garantia_pct: string
  }>

  if (!c) throw new ContratoNoAlcanzable(contratoId)

  // El costo solo se PIDE cuando corresponde. El rol del cliente no tiene permiso
  // sobre esa columna, así que pedirla daría un error de privilegios, no una fila
  // con un hueco. Esa diferencia importa: un error es ruidoso y un hueco se cuela.
  const renglonesCrudos = verCostos
    ? (await q`
        select numero, descripcion_es, descripcion_en, cantidad::text, unidad,
               norma, especificacion, precio_unitario::text, costo_unitario::text
          from renglon where contrato_id = ${contratoId}::uuid order by numero
      `) as unknown as Array<Record<string, string | null>>
    : (await q`
        select numero, descripcion_es, descripcion_en, cantidad::text, unidad,
               norma, especificacion, precio_unitario::text, null as costo_unitario
          from renglon where contrato_id = ${contratoId}::uuid order by numero
      `) as unknown as Array<Record<string, string | null>>

  const valuacionesCrudas = (await q`
    select id, numero, periodo_desde, periodo_hasta, estado::text, obra::text
      from valuacion where contrato_id = ${contratoId}::uuid order by numero desc
  `) as unknown as Array<{
    id: string; numero: number; periodo_desde: Date; periodo_hasta: Date
    estado: string; obra: string
  }>

  return {
    id: c.id,
    codigo: c.codigo,
    cliente: c.cliente,
    titulo: idioma === 'es' ? c.titulo_es : c.titulo_en,
    tipo: t(idioma, TIPO[c.tipo] ?? 'contrato.tipo.servicio'),
    estado: t(idioma, ESTADO_C[c.estado] ?? 'contrato.estado.vigente'),
    monto: moneda(idioma, Number(c.monto), c.moneda),
    moneda: c.moneda,
    firmado: c.firmado_el ? formatearFecha(idioma, c.firmado_el) : null,
    inicio: c.inicio ? formatearFecha(idioma, c.inicio) : null,
    finPrevisto: c.fin_previsto ? formatearFecha(idioma, c.fin_previsto) : null,
    anticipoPct: `${numero(idioma, Number(c.anticipo_pct), 2)} %`,
    garantiaPct: `${numero(idioma, Number(c.garantia_pct), 2)} %`,
    renglones: renglonesCrudos.map((r): Renglon => {
      const cantidad = Number(r['cantidad'])
      const precio = Number(r['precio_unitario'])
      const costo = r['costo_unitario'] === null ? null : Number(r['costo_unitario'])
      return {
        numero: Number(r['numero']),
        descripcion: (idioma === 'es' ? r['descripcion_es'] : r['descripcion_en']) ?? '',
        cantidad: numero(idioma, cantidad, cantidad % 1 === 0 ? 0 : 2),
        unidad: r['unidad'] ?? '',
        // `noUncheckedIndexedAccess` obliga a tratar la ausencia: una columna que
        // no vino y una que vino nula no son lo mismo, y aquí las dos son «no hay».
        norma: r['norma'] ?? null,
        especificacion: r['especificacion'] ?? null,
        precioUnitario: moneda(idioma, precio, c.moneda),
        total: moneda(idioma, cantidad * precio, c.moneda),
        costoUnitario: costo === null ? null : moneda(idioma, costo, c.moneda),
        margenPct: costo === null || precio === 0
          ? null
          : `${numero(idioma, Math.round(((precio - costo) / precio) * 1000) / 10, 1)} %`,
      }
    }),
    valuaciones: valuacionesCrudas.map((v): ValuacionBreve => ({
      id: v.id,
      numero: v.numero,
      periodo: `${formatearFecha(idioma, v.periodo_desde)} — ${formatearFecha(idioma, v.periodo_hasta)}`,
      estado: t(idioma, ESTADO_V[v.estado] ?? 'valuacion.estado.borrador'),
      estadoCrudo: v.estado,
      obra: moneda(idioma, Number(v.obra), c.moneda),
    })),
  }
}

export { ValuacionNoAlcanzable }
