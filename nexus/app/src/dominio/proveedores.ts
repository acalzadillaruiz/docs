/**
 * Las facturas de proveedor y sus retenciones.
 *
 * GPS es agente de retención: retiene el IVA y el ISLR a sus proveedores y emite el
 * comprobante. No es un trámite opcional — no retener cuando toca lo paga GPS de su
 * bolsillo, con multa.
 *
 * El correlativo del comprobante lo pone la base de datos. Uno llevado a mano acaba
 * con huecos o repetido, y el SENIAT pide justificar los huecos.
 *
 * Y lo que más se discute con un proveedor: **sin número de control, la retención de
 * IVA es del 100% y no del 75%.** Eso ya lo decide el generador; aquí se enseña
 * antes de pulsar, que es cuando sirve de algo.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, numero, t, type Idioma } from '../i18n/t.ts'

export type FacturaProveedor = {
  readonly id: string
  readonly numero: string
  readonly control: string | null
  readonly proveedor: string
  readonly rif: string
  readonly fecha: string
  readonly base: string
  readonly iva: string
  readonly tieneIva: boolean
  readonly retenidoIva: string | null
  readonly retenidoIslr: string | null
  readonly comprobanteIva: string | null
  readonly comprobanteIslr: string | null
}

export type Concepto = { readonly codigo: string; readonly nombre: string }

/**
 * Si la empresa consta como agente de retención de IVA.
 *
 * Solo un contribuyente especial retiene. Si no lo es, el botón no se ofrece y se
 * dice por qué: un botón que aparece y revienta hace pensar que el sistema está
 * roto, cuando lo que falta es un dato del régimen.
 */
export async function esAgenteDeRetencion(
  q: Consulta, orgId: string, fecha = new Date().toISOString().slice(0, 10),
): Promise<boolean> {
  const [r] = (await q`
    select es_especial from regimen_iva
     where organizacion_id = ${orgId}::uuid and vigente_desde <= ${fecha}::date
     order by vigente_desde desc limit 1
  `) as unknown as Array<{ es_especial: boolean }>
  return r?.es_especial === true
}

export async function facturasDeProveedor(
  q: Consulta, orgId: string, idioma: Idioma, soloPendientes = true,
): Promise<readonly FacturaProveedor[]> {
  const filas = (await q`
    select df.id, df.numero, df.numero_control, df.fecha,
           df.base_ves::text as base, df.iva_ves::text as iva,
           o.nombre as proveedor, o.rif,
           (select r.monto_ves::text from retencion r
             where r.documento_id = df.id and r.clase = 'iva') as ret_iva,
           (select r.comprobante from retencion r
             where r.documento_id = df.id and r.clase = 'iva') as comp_iva,
           (select r.monto_ves::text from retencion r
             where r.documento_id = df.id and r.clase = 'islr') as ret_islr,
           (select r.comprobante from retencion r
             where r.documento_id = df.id and r.clase = 'islr') as comp_islr
      from documento_fiscal df
      join organizacion o on o.id = df.contraparte_id
     where df.organizacion_id = ${orgId}::uuid
       and df.sentido = 'recibido' and df.tipo = 'factura'
     order by df.fecha desc, df.numero desc
     limit 100
  `) as unknown as Array<Record<string, string | Date | null>>

  const todas = filas.map((f): FacturaProveedor => ({
    id: f['id'] as string,
    numero: f['numero'] as string,
    control: (f['numero_control'] as string | null) ?? null,
    proveedor: f['proveedor'] as string,
    rif: f['rif'] as string,
    fecha: (f['fecha'] as Date).toISOString().slice(0, 10),
    base: moneda(idioma, Number(f['base']), 'VES'),
    iva: moneda(idioma, Number(f['iva']), 'VES'),
    tieneIva: Number(f['iva']) > 0,
    retenidoIva: f['ret_iva'] ? moneda(idioma, Number(f['ret_iva']), 'VES') : null,
    retenidoIslr: f['ret_islr'] ? moneda(idioma, Number(f['ret_islr']), 'VES') : null,
    comprobanteIva: (f['comp_iva'] as string | null) ?? null,
    comprobanteIslr: (f['comp_islr'] as string | null) ?? null,
  }))

  // Lo pendiente primero, porque es lo que hay que hacer. Una lista donde lo hecho
  // y lo pendiente se mezclan obliga a leerla entera cada vez.
  return soloPendientes
    ? todas.filter((f) => f.retenidoIva === null || f.retenidoIslr === null)
    : todas
}

export async function conceptosIslr(q: Consulta, idioma: Idioma): Promise<readonly Concepto[]> {
  const filas = (await q`
    select codigo, nombre_es, nombre_en, porcentaje::text
      from concepto_islr where vigente_desde <= current_date
     order by codigo
  `) as unknown as Array<{
    codigo: string; nombre_es: string; nombre_en: string; porcentaje: string
  }>
  return filas.map((f): Concepto => ({
    codigo: f.codigo,
    nombre: `${idioma === 'es' ? f.nombre_es : f.nombre_en} · ${f.porcentaje} %`,
  }))
}

export type Retenida =
  | { readonly hecho: true; readonly comprobante: string }
  | { readonly hecho: false; readonly motivo: string }

export async function retener(
  q: Consulta, documentoId: string, clase: 'iva' | 'islr', concepto: string,
  personaId: string, idioma: Idioma,
): Promise<Retenida> {
  const [d] = (await q`
    select df.iva_ves::text as iva,
           exists (select 1 from retencion r
                    where r.documento_id = df.id and r.clase = ${clase}) as ya
      from documento_fiscal df
     where df.id = ${documentoId}::uuid
       and df.sentido = 'recibido' and df.tipo = 'factura'
  `) as unknown as Array<{ iva: string; ya: boolean }>
  if (!d) return { hecho: false, motivo: t(idioma, 'proveedor.error.ya') }
  if (d.ya) return { hecho: false, motivo: t(idioma, 'proveedor.error.ya') }
  if (clase === 'iva' && Number(d.iva) <= 0) {
    return { hecho: false, motivo: t(idioma, 'proveedor.error.sin_iva') }
  }
  if (clase === 'iva') {
    const [o] = (await q`
      select organizacion_id, fecha from documento_fiscal where id = ${documentoId}::uuid
    `) as unknown as Array<{ organizacion_id: string; fecha: Date }>
    const agente = await esAgenteDeRetencion(
      q, o!.organizacion_id, o!.fecha.toISOString().slice(0, 10))
    if (!agente) return { hecho: false, motivo: t(idioma, 'proveedor.no_agente') }
  }
  if (clase === 'islr' && concepto.trim() === '') {
    return { hecho: false, motivo: t(idioma, 'proveedor.error.concepto') }
  }

  const [r] = (clase === 'iva'
    ? await q`select retener_iva_proveedor(${documentoId}::uuid, ${personaId}::uuid) as id`
    : await q`select retener_islr_proveedor(${documentoId}::uuid, ${concepto.trim()},
                                            ${personaId}::uuid) as id`
  ) as unknown as Array<{ id: string }>

  const [c] = (await q`
    select comprobante from retencion where id = ${r!.id}::uuid
  `) as unknown as Array<{ comprobante: string | null }>
  return { hecho: true, comprobante: c?.comprobante ?? '' }
}

// ---------------------------------------------------------------------------
// El régimen de IVA de la empresa.
//
// La pantalla decía, literalmente: «Esta empresa no consta como agente de retención de
// IVA en esta fecha, así que no corresponde retener. Si lo es, **hay que registrarlo en
// su régimen de IVA**». Y no había forma de registrarlo: `regimen_iva` la escribían
// solo las pruebas, cada una en su fixture.
//
// O sea que en uso real la retención de IVA a proveedores —que es una obligación, no
// una opción, para un contribuyente especial— no se podía hacer nunca. Una pantalla que
// manda hacer algo tiene que poder hacerlo.

export type Regimen = {
  readonly desde: string
  readonly esEspecial: boolean
  readonly normal: string
  readonly falla: string
  /** Cuántas retenciones se emitieron bajo este régimen. Cambiarlo se ve aquí. */
  readonly retenciones: number
}

export async function regimenes(
  q: Consulta, orgId: string, idioma: Idioma,
): Promise<readonly Regimen[]> {
  const filas = (await q`
    select r.vigente_desde, r.es_especial,
           r.retencion_normal::text as normal, r.retencion_falla::text as falla,
           (select count(*)::int from retencion re
             where re.organizacion_id = r.organizacion_id and re.clase = 'iva'
               and re.sentido = 'emitido'
               and re.fecha >= r.vigente_desde
               and re.fecha < coalesce((
                 select min(r2.vigente_desde) from regimen_iva r2
                  where r2.organizacion_id = r.organizacion_id
                    and r2.vigente_desde > r.vigente_desde), 'infinity'::date)
           ) as retenciones
      from regimen_iva r
     where r.organizacion_id = ${orgId}::uuid
     order by r.vigente_desde desc
  `) as unknown as Array<{
    vigente_desde: Date; es_especial: boolean
    normal: string; falla: string; retenciones: number
  }>
  return filas.map((f): Regimen => ({
    desde: f.vigente_desde.toISOString().slice(0, 10),
    esEspecial: f.es_especial === true,
    normal: numero(idioma, Number(f.normal), 2),
    falla: numero(idioma, Number(f.falla), 2),
    retenciones: Number(f.retenciones),
  }))
}

export type RegimenNuevo = {
  readonly desde: string
  readonly esEspecial: boolean
  readonly normal: number
  readonly falla: number
}

export type Registrado =
  | { readonly hecho: true }
  | { readonly hecho: false; readonly errores: readonly string[] }

/**
 * Registra el régimen de IVA de la empresa a partir de una fecha.
 *
 * Es un histórico, no un ajuste: una empresa pasa a ser contribuyente especial el día
 * que el SENIAT la designa, y lo que se le retuvo antes se rigió por lo de antes. Por
 * eso lleva fecha y por eso la lista enseña cuántas retenciones se emitieron bajo cada
 * tramo: cambiar uno con retenciones debajo se ve antes de hacerlo.
 */
export async function registrarRegimen(
  q: Consulta, orgId: string, r: RegimenNuevo, idioma: Idioma,
): Promise<Registrado> {
  const mal: string[] = []

  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.desde) || Number.isNaN(Date.parse(r.desde))) {
    mal.push(t(idioma, 'regimen.error.fecha'))
  }
  // Se pregunta por lo que TIENE que ser: con `< 0 || > 100`, un NaN pasa, porque toda
  // comparación con NaN es falsa.
  for (const [v, clave] of [
    [r.normal, 'regimen.error.normal'], [r.falla, 'regimen.error.falla'],
  ] as const) {
    if (!(v >= 0 && v <= 100)) mal.push(t(idioma, clave))
  }
  // Y lo que nadie piensa en comprobar: la retención por factura defectuosa no puede
  // ser MENOR que la normal. Al revés significaría que a un proveedor le sale mejor
  // entregar la factura mal, y eso no lo dice ninguna ley — lo diría un dedo gordo.
  if (r.normal >= 0 && r.falla >= 0 && r.falla < r.normal) {
    mal.push(t(idioma, 'regimen.error.orden'))
  }

  if (mal.length > 0) return { hecho: false, errores: mal }

  await q`
    insert into regimen_iva (organizacion_id, vigente_desde, es_especial,
                             retencion_normal, retencion_falla)
    values (${orgId}::uuid, ${r.desde}::date, ${r.esEspecial}, ${r.normal}, ${r.falla})
    on conflict (organizacion_id, vigente_desde) do update
      set es_especial = excluded.es_especial,
          retencion_normal = excluded.retencion_normal,
          retencion_falla = excluded.retencion_falla`
  return { hecho: true }
}
