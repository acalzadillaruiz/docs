/**
 * Los libros de ventas y de compras.
 *
 * No son una tabla: son lo que ya pasó, ordenado. Nadie los escribe, nadie los
 * corrige y nadie los cuadra a mano — salen de los documentos fiscales que ya
 * existen. Eso es lo que los hace valer: un libro que se teclea aparte del sistema
 * acaba discrepando del sistema, y entonces hay dos verdades.
 *
 * Son además lo que se declara. De todo lo que hay en esta aplicación, esto es lo
 * único que sale de la empresa con destino al SENIAT, así que lo que importa no es
 * que se vea bonito: es que los totales sean exactamente los de la declaración y que
 * se puedan sacar del navegador sin volver a teclear nada.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, traductor, type Idioma } from '../i18n/t.ts'

export type Asiento = {
  readonly fecha: string
  readonly rif: string
  readonly nombre: string
  readonly tipo: string
  readonly numero: string
  readonly control: string | null
  readonly afecta: string | null
  readonly base: string
  readonly exento: string
  readonly alicuota: string | null
  readonly iva: string
  readonly retenido: string | null
  readonly total: string
}

export type Libro = {
  readonly cual: 'ventas' | 'compras'
  readonly anio: number
  readonly mes: number
  readonly lineas: readonly Asiento[]
  /** Los totales, que son los que se declaran. */
  readonly totalBase: string
  readonly totalIva: string
  readonly totalExento: string
  readonly totalRetenido: string
  readonly total: string
  readonly cuantas: number
}

/** Lo mismo, en crudo, para sacarlo a un archivo sin pasar por el formato de pantalla. */
export type Crudo = {
  readonly cabeceras: readonly string[]
  readonly filas: readonly (readonly string[])[]
}

const num = (v: unknown) => Number(v ?? 0)

export async function libro(
  q: Consulta, orgId: string, cual: 'ventas' | 'compras',
  anio: number, mes: number, idioma: Idioma,
): Promise<Libro> {
  // Las dos vistas tienen la misma forma salvo el nombre de dos columnas. Se
  // consultan por separado en vez de armar el nombre de la vista con texto: una
  // consulta compuesta a mano es por donde se cuela lo que no debe colarse.
  const filas = cual === 'ventas'
    ? ((await q`
        select fecha, rif_cliente as rif, cliente as nombre, tipo::text, numero_factura,
               numero_control, afecta_numero, base_imponible_ves::text as base,
               exento_ves::text as exento, alicuota::text,
               debito_fiscal_ves::text as iva, iva_retenido_ves::text as retenido,
               total_ves::text as total
          from libro_ventas
         where organizacion_id = ${orgId}::uuid
           and periodo = make_date(${anio}, ${mes}, 1)
         order by fecha, numero_factura
      `) as unknown as Array<Record<string, unknown>>)
    : ((await q`
        select fecha, rif_proveedor as rif, proveedor as nombre, tipo::text, numero_factura,
               numero_control, afecta_numero, base_imponible_ves::text as base,
               exento_ves::text as exento, alicuota::text,
               credito_fiscal_ves::text as iva, iva_retenido_ves::text as retenido,
               total_ves::text as total
          from libro_compras
         where organizacion_id = ${orgId}::uuid
           and periodo = make_date(${anio}, ${mes}, 1)
         order by fecha, numero_factura
      `) as unknown as Array<Record<string, unknown>>)

  let tBase = 0, tIva = 0, tExento = 0, tRet = 0, tTotal = 0
  const lineas = filas.map((f): Asiento => {
    tBase += num(f['base'])
    tIva += num(f['iva'])
    tExento += num(f['exento'])
    tRet += num(f['retenido'])
    tTotal += num(f['total'])
    return {
      fecha: (f['fecha'] as Date).toISOString().slice(0, 10),
      rif: f['rif'] as string,
      nombre: f['nombre'] as string,
      tipo: f['tipo'] as string,
      numero: f['numero_factura'] as string,
      control: (f['numero_control'] as string | null) ?? null,
      afecta: (f['afecta_numero'] as string | null) ?? null,
      base: moneda(idioma, num(f['base']), 'VES'),
      exento: moneda(idioma, num(f['exento']), 'VES'),
      alicuota: f['alicuota'] == null ? null : `${num(f['alicuota'])}%`,
      iva: moneda(idioma, num(f['iva']), 'VES'),
      retenido: f['retenido'] == null ? null : moneda(idioma, num(f['retenido']), 'VES'),
      total: moneda(idioma, num(f['total']), 'VES'),
    }
  })

  return {
    cual, anio, mes, lineas,
    totalBase: moneda(idioma, tBase, 'VES'),
    totalIva: moneda(idioma, tIva, 'VES'),
    totalExento: moneda(idioma, tExento, 'VES'),
    totalRetenido: moneda(idioma, tRet, 'VES'),
    total: moneda(idioma, tTotal, 'VES'),
    cuantas: lineas.length,
  }
}

/**
 * El libro para sacarlo a un archivo.
 *
 * Los importes van SIN formatear —punto decimal y sin separador de miles— porque
 * esto lo abre una hoja de cálculo, y «1.234,56» leído por una hoja en inglés se
 * convierte en 1,23456 o en texto. El que lo lee es una máquina, no una persona.
 */
export function aFilas(l: Libro, idioma: Idioma, crudos: readonly Record<string, unknown>[] = []): Crudo {
  // Las cabeceras salen del DICCIONARIO, no escritas aquí en los dos idiomas. Estaban
  // escritas aquí, y por eso se separaron de la pantalla: la columna de total pasó a
  // llamarse «Total con IVA» arriba —porque ahora lo incluye— y en el archivo que se baja
  // seguía diciendo «Total». Dos nombres para la misma columna en el documento que se
  // declara es exactamente la clase de detalle que hace dudar del resto.
  const tr = traductor(idioma)
  const cabeceras = [
    tr('libro.fecha'),
    tr(l.cual === 'ventas' ? 'libro.rif_cliente' : 'libro.rif_proveedor'),
    tr('libro.nombre_col'), tr('libro.tipo'), tr('libro.numero'), tr('libro.control'),
    tr('libro.afecta'), tr('libro.base'), tr('libro.exento'), tr('libro.alicuota'),
    tr(l.cual === 'ventas' ? 'libro.debito' : 'libro.credito'),
    tr('libro.retenido'), tr('libro.total'),
  ]

  const filas = crudos.map((c) => [
    String(c['fecha'] ?? ''), String(c['rif'] ?? ''), String(c['nombre'] ?? ''),
    String(c['tipo'] ?? ''), String(c['numero'] ?? ''), String(c['control'] ?? ''),
    String(c['afecta'] ?? ''), String(c['base'] ?? '0'), String(c['exento'] ?? '0'),
    String(c['alicuota'] ?? ''), String(c['iva'] ?? '0'), String(c['retenido'] ?? ''),
    String(c['total'] ?? '0'),
  ])
  return { cabeceras, filas }
}

/** Los mismos datos sin formatear, que es lo que va al archivo. */
export async function libroCrudo(
  q: Consulta, orgId: string, cual: 'ventas' | 'compras', anio: number, mes: number,
): Promise<readonly Record<string, unknown>[]> {
  return cual === 'ventas'
    ? ((await q`
        select to_char(fecha,'YYYY-MM-DD') as fecha, rif_cliente as rif, cliente as nombre,
               tipo::text, numero_factura as numero, numero_control as control,
               afecta_numero as afecta, base_imponible_ves::text as base,
               exento_ves::text as exento, alicuota::text,
               debito_fiscal_ves::text as iva, iva_retenido_ves::text as retenido,
               total_ves::text as total
          from libro_ventas
         where organizacion_id = ${orgId}::uuid and periodo = make_date(${anio}, ${mes}, 1)
         order by fecha, numero_factura
      `) as unknown as Array<Record<string, unknown>>)
    : ((await q`
        select to_char(fecha,'YYYY-MM-DD') as fecha, rif_proveedor as rif, proveedor as nombre,
               tipo::text, numero_factura as numero, numero_control as control,
               afecta_numero as afecta, base_imponible_ves::text as base,
               exento_ves::text as exento, alicuota::text,
               credito_fiscal_ves::text as iva, iva_retenido_ves::text as retenido,
               total_ves::text as total
          from libro_compras
         where organizacion_id = ${orgId}::uuid and periodo = make_date(${anio}, ${mes}, 1)
         order by fecha, numero_factura
      `) as unknown as Array<Record<string, unknown>>)
}
