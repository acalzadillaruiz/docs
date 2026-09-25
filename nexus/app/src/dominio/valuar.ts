/**
 * De la evidencia al dinero.
 *
 * Es donde la tesis del proyecto toca la caja:
 *
 *        SIN EVIDENCIA NO HAY AVANCE, Y SIN AVANCE NO SE FACTURA.
 *
 * La obra de una valuación no se teclea. Sale de los hitos verificados que todavía
 * no se han cobrado, y el cálculo vive en la base de datos, donde ya tiene su prueba.
 * Aquí solo se propone, se confirma y se marca lo cobrado — en la misma transacción,
 * porque una valuación creada cuyos hitos siguieran marcados como pendientes haría
 * que la siguiente los cobrara otra vez.
 *
 * Lo declarado sin documento NO aparece en la propuesta, ni siquiera como aviso: un
 * número que sale en una propuesta acaba facturándose.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, numero, t, type Idioma } from '../i18n/t.ts'

export type LineaPropuesta = {
  readonly renglonId: string
  readonly numero: number
  readonly descripcion: string
  readonly peso: number
  readonly hitos: readonly string[]
  readonly valor: string
  readonly valorCrudo: number
}

export type Propuesta = {
  readonly contratoId: string
  readonly contrato: string
  readonly cliente: string
  readonly moneda: 'VES' | 'USD'
  readonly siguienteNumero: number
  readonly lineas: readonly LineaPropuesta[]
  readonly obra: string
  readonly obraCruda: number
  /** Lo que se facturó y después se quedó sin respaldo. No se corrige solo. */
  readonly caidos: readonly {
    readonly valuacion: number
    readonly hito: string
    readonly valor: string
  }[]
}

export class ContratoNoValuable extends Error {
  constructor() {
    super('ese contrato no existe, no te corresponde, o no está vigente')
    this.name = 'ContratoNoValuable'
  }
}

export async function proponer(
  q: Consulta, contratoId: string, hasta: string, idioma: Idioma,
): Promise<Propuesta> {
  // Facturar es de GPS. La ruta ya responde 404 a un cliente, y esto lo repite aquí
  // a propósito: una propuesta de facturación dice qué va a cobrar GPS y cuándo, y
  // esa intención no es del cliente aunque los hitos de los que sale sí los vea.
  const [quien] = (await q`select es_interna() as dentro`) as unknown as
    Array<{ dentro: boolean }>
  if (!quien?.dentro) throw new ContratoNoValuable()

  const [c] = (await q`
    select ct.id, ct.codigo, ct.moneda, ct.estado::text, o.nombre as cliente,
           coalesce((select max(v.numero) from valuacion v where v.contrato_id = ct.id), 0) + 1
             as siguiente
      from contrato ct join organizacion o on o.id = ct.cliente_id
     where ct.id = ${contratoId}::uuid
  `) as unknown as Array<{
    id: string; codigo: string; moneda: 'VES' | 'USD'; estado: string
    cliente: string; siguiente: number
  }>
  // No se distingue «no existe» de «no es tuyo» de «no está vigente»: los tres se
  // responden igual, y distinguirlos convertiría la dirección en un buscador.
  if (!c || c.estado !== 'vigente') throw new ContratoNoValuable()

  const lineas = (await q`
    select * from por_facturar(${contratoId}::uuid, ${hasta}::date)
  `) as unknown as Array<{
    renglon_id: string; numero: number; descripcion: string
    peso: string; hitos: string[]; valor: string
  }>

  const caidos = (await q`
    select fs.valuacion, fs.hito, fs.valor::text, fs.moneda
      from facturado_sin_respaldo(
        (select organizacion_id from contrato where id = ${contratoId}::uuid)) fs
  `) as unknown as Array<{ valuacion: number; hito: string; valor: string; moneda: 'VES' | 'USD' }>

  const obra = lineas.reduce((s, l) => s + Number(l.valor), 0)

  return {
    contratoId,
    contrato: c.codigo,
    cliente: c.cliente,
    moneda: c.moneda,
    siguienteNumero: c.siguiente,
    lineas: lineas.map((l): LineaPropuesta => ({
      renglonId: l.renglon_id,
      numero: l.numero,
      descripcion: l.descripcion,
      peso: Number(l.peso),
      hitos: l.hitos,
      valor: moneda(idioma, Number(l.valor), c.moneda),
      valorCrudo: Number(l.valor),
    })),
    obra: moneda(idioma, obra, c.moneda),
    obraCruda: obra,
    caidos: caidos.map((f) => ({
      valuacion: f.valuacion,
      hito: f.hito,
      valor: moneda(idioma, Number(f.valor), f.moneda),
    })),
  }
}

export type Emision = {
  readonly contratoId: string
  readonly desde: string
  readonly hasta: string
  readonly pagaEnDivisa: boolean
  readonly retieneIva: boolean
}

export type Emitida =
  | { readonly hecho: true; readonly valuacionId: string; readonly hitos: number }
  | { readonly hecho: false; readonly errores: readonly string[] }

/**
 * Crea la valuación y se lleva los hitos.
 *
 * Los porcentajes se copian del contrato y se congelan aquí: si el contrato cambia
 * mañana, lo ya emitido no se mueve. Eso no es una comodidad — es la diferencia
 * entre poder defender una factura dentro de dos años o no.
 */
export async function emitir(
  q: Consulta, e: Emision, personaId: string, orgId: string, idioma: Idioma,
): Promise<Emitida> {
  const errores: string[] = []
  if (e.hasta < e.desde) errores.push(t(idioma, 'valuar.error.periodo'))

  const [c] = (await q`
    select ct.codigo, ct.moneda, ct.estado::text, ct.amortiza_pct::text,
           ct.garantia_pct::text,
           coalesce((select max(v.numero) from valuacion v where v.contrato_id = ct.id), 0) + 1
             as siguiente
      from contrato ct where ct.id = ${e.contratoId}::uuid
  `) as unknown as Array<{
    codigo: string; moneda: string; estado: string
    amortiza_pct: string; garantia_pct: string; siguiente: number
  }>
  if (!c || c.estado !== 'vigente') errores.push(t(idioma, 'valuar.error.contrato'))

  const lineas = (await q`
    select valor::text from por_facturar(${e.contratoId}::uuid, ${e.hasta}::date)
  `) as unknown as Array<{ valor: string }>
  const obra = lineas.reduce((s, l) => s + Number(l.valor), 0)
  if (!(obra > 0)) errores.push(t(idioma, 'valuar.error.nada'))

  const [tasa] = (await q`
    select id from tasa_bcv where vigente_el <= current_date
     order by vigente_el desc limit 1
  `) as unknown as Array<{ id: string }>
  if (!tasa) errores.push(t(idioma, 'valuar.error.tasa'))

  const [fiscal] = (await q`
    select (select id from alicuota_iva where clase = 'general' and vigente_desde <= ${e.hasta}::date
             order by vigente_desde desc limit 1) as iva,
           (select codigo from concepto_islr where vigente_desde <= ${e.hasta}::date
             order by vigente_desde desc limit 1) as islr
  `) as unknown as Array<{ iva: string | null; islr: string | null }>
  if (!fiscal?.iva || !fiscal.islr) errores.push(t(idioma, 'valuar.error.fiscal'))

  if (errores.length > 0) return { hecho: false, errores: [...new Set(errores)] }

  const [v] = (await q`
    insert into valuacion (organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                           obra, origen_obra, moneda, tasa_id, amortiza_pct, garantia_pct,
                           alicuota_iva_id, concepto_islr, ret_iva_pct, paga_en_divisa,
                           estado, creada_por)
    values (${orgId}::uuid, ${e.contratoId}::uuid, ${c!.siguiente}, ${e.desde}::date,
            ${e.hasta}::date, ${obra.toFixed(2)}, 'hitos_evidenciados', ${c!.moneda},
            ${tasa!.id}::uuid, ${c!.amortiza_pct}, ${c!.garantia_pct},
            ${fiscal!.iva!}::uuid, ${fiscal!.islr!},
            ${e.retieneIva ? 75 : 0}, ${e.pagaEnDivisa}, 'borrador', ${personaId}::uuid)
    returning id
  `) as unknown as Array<{ id: string }>

  // En la MISMA transacción. Una valuación creada cuyos hitos siguieran marcados
  // como pendientes haría que la siguiente valuación los cobrara otra vez.
  const [n] = (await q`
    select marcar_facturados(${v!.id}::uuid, ${e.contratoId}::uuid, ${e.hasta}::date) as n
  `) as unknown as Array<{ n: number }>

  return { hecho: true, valuacionId: v!.id, hitos: Number(n?.n ?? 0) }
}

/** El peso, dicho en tanto por ciento y en el idioma de quien mira. */
export function pesoTexto(idioma: Idioma, n: number): string {
  return `${numero(idioma, n, n % 1 === 0 ? 0 : 2)} %`
}
