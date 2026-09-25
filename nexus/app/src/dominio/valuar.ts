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

export type Presentada =
  | { readonly hecho: true }
  | { readonly hecho: false; readonly motivo: 'no_alcanzable' | 'estado_equivocado' }

/**
 * Presentar la valuación al cliente.
 *
 * Es el momento en que sale de GPS. Antes de esto el cliente no la ve — está en
 * borrador, que es donde se revisa y se corrige. Al presentarla se le avisa por
 * correo, y eso lo hace la base de datos sola: el aviso se encola en la misma
 * transacción que el cambio de estado.
 *
 * La condición del estado va DENTRO del update: dos pulsaciones simultáneas no
 * pueden presentar dos veces, y presentar dos veces mandaría dos correos.
 */
export async function presentar(
  q: Consulta, valuacionId: string, esCliente: boolean,
): Promise<Presentada> {
  // Presenta GPS, no el cliente. Un cliente que pudiera presentar se estaría
  // mandando trabajo a sí mismo para firmar.
  if (esCliente) return { hecho: false, motivo: 'no_alcanzable' }

  const [v] = (await q`
    select estado::text from valuacion where id = ${valuacionId}::uuid
  `) as unknown as Array<{ estado: string }>
  if (!v) return { hecho: false, motivo: 'no_alcanzable' }
  if (v.estado !== 'borrador') return { hecho: false, motivo: 'estado_equivocado' }

  const filas = await q`
    update valuacion set estado = 'presentada', presentada_el = current_date
     where id = ${valuacionId}::uuid and estado = 'borrador'
    returning id`
  return filas.length === 1 ? { hecho: true } : { hecho: false, motivo: 'estado_equivocado' }
}

export type Facturada =
  | { readonly hecho: true; readonly numero: string; readonly control: string }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Emite la factura de una valuación aprobada.
 *
 * El correlativo y el número de control los pone la base de datos dentro de la misma
 * transacción. Un correlativo llevado a mano acaba con huecos o repetido, y las dos
 * cosas son un problema con el SENIAT: un hueco hay que justificarlo y un repetido
 * invalida las dos facturas.
 *
 * Las condiciones se comprueban aquí antes de llamar, igual que al importar: una
 * excepción dentro de una transacción la aborta entera y no deja decir nada útil.
 */
export async function facturar(
  q: Consulta, valuacionId: string, personaId: string, esCliente: boolean, idioma: Idioma,
): Promise<Facturada> {
  // Factura GPS. Una factura que emite quien la recibe no es una factura.
  if (esCliente) return { hecho: false, motivo: t(idioma, 'valuar.error.contrato') }

  const [v] = (await q`
    select estado::text, documento_id from valuacion where id = ${valuacionId}::uuid
  `) as unknown as Array<{ estado: string; documento_id: string | null }>
  if (!v) return { hecho: false, motivo: t(idioma, 'valuar.error.contrato') }
  if (v.documento_id) return { hecho: false, motivo: t(idioma, 'facturar.error.ya') }
  if (v.estado !== 'aprobada') {
    return { hecho: false, motivo: t(idioma, 'facturar.error.sin_aprobar') }
  }

  const [sin] = (await q`
    select count(*)::int as n from objecion
     where valuacion_id = ${valuacionId}::uuid and respondida_en is null
  `) as unknown as Array<{ n: number }>
  if (Number(sin?.n ?? 0) > 0) {
    return { hecho: false, motivo: t(idioma, 'facturar.error.objecion') }
  }

  const [doc] = (await q`
    select emitir_factura(${valuacionId}::uuid, ${personaId}::uuid) as id
  `) as unknown as Array<{ id: string }>

  const [f] = (await q`
    select numero, numero_control from documento_fiscal where id = ${doc!.id}::uuid
  `) as unknown as Array<{ numero: string; numero_control: string }>

  return { hecho: true, numero: f!.numero, control: f!.numero_control }
}

export type Nota = {
  readonly tipo: 'nota_credito' | 'nota_debito'
  readonly numero: string
  readonly base: string
  readonly motivo: string
  readonly fecha: string
}

export type FacturaViva = {
  readonly id: string
  readonly numero: string
  readonly control: string
  readonly base: string
  readonly vivo: string
  readonly notas: readonly Nota[]
}

/**
 * La factura de una valuación, con lo que queda vivo después de sus notas.
 *
 * Lo vivo no se guarda: se resta. Un importe guardado es un importe que algún día
 * dejará de ser cierto.
 */
export async function facturaDe(
  q: Consulta, valuacionId: string, idioma: Idioma,
): Promise<FacturaViva | null> {
  const [f] = (await q`
    select df.id, df.numero, df.numero_control, df.base_ves::text as base,
           ct.moneda
      from documento_fiscal df
      join valuacion v on v.documento_id = df.id
      join contrato ct on ct.id = v.contrato_id
     where v.id = ${valuacionId}::uuid
  `) as unknown as Array<{
    id: string; numero: string; numero_control: string; base: string; moneda: 'VES' | 'USD'
  }>
  if (!f) return null

  const [vivo] = (await q`
    select base::text from neto_facturado(${f.id}::uuid)
  `) as unknown as Array<{ base: string }>

  const notas = (await q`
    select tipo::text, numero, base_ves::text as base, motivo, fecha
      from documento_fiscal where afecta_a = ${f.id}::uuid order by fecha, numero
  `) as unknown as Array<{
    tipo: 'nota_credito' | 'nota_debito'; numero: string; base: string
    motivo: string; fecha: Date
  }>

  return {
    id: f.id,
    numero: f.numero,
    control: f.numero_control,
    base: moneda(idioma, Number(f.base), 'VES'),
    vivo: moneda(idioma, Number(vivo?.base ?? f.base), 'VES'),
    notas: notas.map((n): Nota => ({
      tipo: n.tipo,
      numero: n.numero,
      base: moneda(idioma, Number(n.base), 'VES'),
      motivo: n.motivo,
      fecha: n.fecha.toISOString().slice(0, 10),
    })),
  }
}

export type NotaNueva = {
  readonly facturaId: string
  readonly tipo: 'nota_credito' | 'nota_debito'
  readonly base: number
  readonly motivo: string
}

export type NotaEmitida =
  | { readonly hecho: true; readonly numero: string }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Emite la nota. Las condiciones se comprueban aquí antes de llamar: una excepción
 * dentro de una transacción la aborta entera y no deja decir nada útil.
 */
export async function emitirNota(
  q: Consulta, n: NotaNueva, personaId: string, esCliente: boolean, idioma: Idioma,
): Promise<NotaEmitida> {
  if (esCliente) return { hecho: false, motivo: t(idioma, 'nota.error.sin_factura') }
  if (!(n.base > 0)) return { hecho: false, motivo: t(idioma, 'nota.error.base') }
  if (n.motivo.trim() === '') return { hecho: false, motivo: t(idioma, 'nota.error.motivo') }

  const [f] = (await q`
    select base_ves::text as base, tipo::text, sentido::text
      from documento_fiscal where id = ${n.facturaId}::uuid
  `) as unknown as Array<{ base: string; tipo: string; sentido: string }>
  if (!f || f.tipo !== 'factura' || f.sentido !== 'emitido') {
    return { hecho: false, motivo: t(idioma, 'nota.error.sin_factura') }
  }

  if (n.tipo === 'nota_credito') {
    const [vivo] = (await q`
      select base::text from neto_facturado(${n.facturaId}::uuid)
    `) as unknown as Array<{ base: string }>
    if (n.base > Number(vivo?.base ?? 0) + 0.005) {
      return { hecho: false, motivo: t(idioma, 'nota.error.pasa') }
    }
  }

  const [nota] = (await q`
    select emitir_nota(${n.facturaId}::uuid, ${n.tipo}, ${n.base.toFixed(2)},
                       ${n.motivo.trim()}, ${personaId}::uuid) as id
  `) as unknown as Array<{ id: string }>
  const [d] = (await q`
    select numero from documento_fiscal where id = ${nota!.id}::uuid
  `) as unknown as Array<{ numero: string }>
  return { hecho: true, numero: d!.numero }
}
