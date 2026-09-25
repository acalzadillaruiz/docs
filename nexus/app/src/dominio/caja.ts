/**
 * La caja chica.
 *
 * Es el dinero que se gasta sin pedir permiso: el taxi al pozo, la soldadura de
 * urgencia, el almuerzo de la cuadrilla. Cien gastos pequeños, ninguno imputado, y
 * al cerrar el contrato el margen no está donde decía el presupuesto. Ahí es donde
 * se pierde, y no en la factura grande que todo el mundo mira.
 *
 * Este módulo se construyó **sin esperar** a que se contestaran las ocho preguntas
 * de contabilidad. Esperar ya costó semanas. En su lugar hay seis supuestos
 * declarados, escritos aquí y **en la pantalla**, para que se corrijan cuando se
 * quiera. Un supuesto que solo vive en el código no es un supuesto: es una decisión
 * tomada a escondidas.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, t, type Clave, type Idioma } from '../i18n/t.ts'

/** Los seis supuestos, por su clave en el diccionario. Se pintan en la pantalla. */
export const SUPUESTOS: readonly Clave[] = [
  'caja.supuesto.fondo',
  'caja.supuesto.soporte',
  'caja.supuesto.iva',
  'caja.supuesto.banco',
  'caja.supuesto.moneda',
  'caja.supuesto.grande',
]

export type Vale = {
  readonly id: string
  readonly numero: number
  readonly fecha: string
  readonly concepto: string
  readonly beneficiario: string | null
  readonly monto: string
  readonly cuenta: string
  readonly contrato: string | null
  readonly conSoporte: boolean
  readonly repuesto: boolean
  /** Supuesto 6: por encima del porcentaje del fondo, esto no es caja chica. */
  readonly grande: boolean
  /** Días entre el gasto y su anotación. La distancia entre lo que pasó y lo que se supo. */
  readonly tardo: number
}

export type Caja = {
  readonly id: string
  readonly nombre: string
  readonly moneda: 'VES' | 'USD'
  readonly fondo: string
  readonly efectivo: string
  readonly efectivoPct: number
  readonly porReponer: string
  readonly porReponerCrudo: number
  readonly sinSoporte: string
  readonly sinSoporteCrudo: number
  readonly responsable: string
  readonly cerrada: boolean
  readonly hayQueReponer: boolean
  readonly vales: readonly Vale[]
}

type FilaCaja = {
  id: string; nombre: string; moneda: 'VES' | 'USD'; fondo: string
  efectivo: string; por_reponer: string; sin_soporte: string
  vale_grande_pct: string; reponer_bajo_pct: string
  responsable: string; cerrada_el: Date | null
}

type FilaVale = {
  id: string; numero: number; ocurrido_en: Date; registrado_en: Date
  concepto: string; beneficiario: string | null; monto: string
  cuenta: string; cuenta_nombre: string; contrato: string | null
  soporte_huella: string | null; reposicion_id: string | null
}

/** Cuántos días pasaron entre el gasto y su anotación. */
function tardanza(ocurrido: Date, registrado: Date): number {
  const dia = 24 * 60 * 60 * 1000
  const a = Date.UTC(ocurrido.getUTCFullYear(), ocurrido.getUTCMonth(), ocurrido.getUTCDate())
  const b = Date.UTC(registrado.getUTCFullYear(), registrado.getUTCMonth(), registrado.getUTCDate())
  return Math.max(0, Math.round((b - a) / dia))
}

export async function cajas(q: Consulta, orgId: string, idioma: Idioma): Promise<readonly Caja[]> {
  const filas = (await q`
    select c.id, c.nombre, c.moneda, c.fondo_fijo::text as fondo,
           efectivo_caja(c.id)::text as efectivo,
           por_reponer(c.id)::text   as por_reponer,
           sin_soporte(c.id)::text   as sin_soporte,
           c.vale_grande_pct::text, c.reponer_bajo_pct::text,
           p.nombre as responsable, c.cerrada_el
      from caja_chica c
      join persona p on p.id = c.responsable_id
     where c.organizacion_id = ${orgId}::uuid
     order by c.cerrada_el nulls first, c.nombre
  `) as unknown as FilaCaja[]

  const salida: Caja[] = []
  for (const f of filas) {
    const fondo = Number(f.fondo)
    const efectivo = Number(f.efectivo)
    const grandeDesde = (fondo * Number(f.vale_grande_pct)) / 100

    const vales = (await q`
      select v.id, v.numero, v.ocurrido_en, v.registrado_en, v.concepto, v.beneficiario,
             v.monto::text, v.cuenta_gasto as cuenta,
             case when ${idioma} = 'es' then cu.nombre_es else cu.nombre_en end as cuenta_nombre,
             ct.codigo as contrato, v.soporte_huella, v.reposicion_id
        from vale v
        join cuenta cu on cu.organizacion_id = v.organizacion_id and cu.codigo = v.cuenta_gasto
        left join contrato ct on ct.id = v.contrato_id
       where v.caja_id = ${f.id}::uuid and v.anulado_el is null
       order by v.numero desc
       limit 60
    `) as unknown as FilaVale[]

    salida.push({
      id: f.id,
      nombre: f.nombre,
      moneda: f.moneda,
      fondo: moneda(idioma, fondo, f.moneda),
      efectivo: moneda(idioma, efectivo, f.moneda),
      efectivoPct: fondo === 0 ? 0 : Math.round((efectivo / fondo) * 100),
      porReponer: moneda(idioma, Number(f.por_reponer), f.moneda),
      porReponerCrudo: Number(f.por_reponer),
      sinSoporte: moneda(idioma, Number(f.sin_soporte), f.moneda),
      sinSoporteCrudo: Number(f.sin_soporte),
      responsable: f.responsable,
      cerrada: f.cerrada_el !== null,
      hayQueReponer: fondo > 0 && (efectivo / fondo) * 100 < Number(f.reponer_bajo_pct),
      vales: vales.map((v): Vale => ({
        id: v.id,
        numero: v.numero,
        fecha: v.ocurrido_en.toISOString().slice(0, 10),
        concepto: v.concepto,
        beneficiario: v.beneficiario,
        monto: moneda(idioma, Number(v.monto), f.moneda),
        cuenta: `${v.cuenta} · ${v.cuenta_nombre}`,
        contrato: v.contrato,
        conSoporte: v.soporte_huella !== null,
        repuesto: v.reposicion_id !== null,
        grande: Number(v.monto) > grandeDesde,
        tardo: tardanza(v.ocurrido_en, v.registrado_en),
      })),
    })
  }
  return salida
}

/** Las cuentas de gasto a las que se puede imputar un vale. */
export async function cuentasDeGasto(
  q: Consulta, orgId: string, idioma: Idioma,
): Promise<readonly { codigo: string; nombre: string }[]> {
  const filas = (await q`
    select codigo, case when ${idioma} = 'es' then nombre_es else nombre_en end as nombre
      from cuenta
     where organizacion_id = ${orgId}::uuid and naturaleza = 'gasto' and imputable
     order by codigo
  `) as unknown as Array<{ codigo: string; nombre: string }>
  return filas
}

/** Los contratos vigentes, para imputar el vale a uno. */
export async function contratosAbiertos(
  q: Consulta, orgId: string,
): Promise<readonly { id: string; codigo: string }[]> {
  return (await q`
    select id, codigo from contrato
     where organizacion_id = ${orgId}::uuid and estado in ('vigente','suspendido')
     order by codigo
  `) as unknown as Array<{ id: string; codigo: string }>
}

export type Hecho =
  | { readonly hecho: true; readonly id: string }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Por qué aquí se comprueba TODO antes de llamar.
 *
 * Una excepción dentro de una transacción la aborta entera, y la biblioteca la
 * vuelve a lanzar al cerrarla: el `try` que la rodea no sirve de nada, porque la
 * transacción ya está muerta cuando llega. Así que las condiciones se miran antes,
 * una por una, y el mensaje sale del diccionario y no de PostgreSQL. Los avisos de
 * las funciones siguen ahí, pero son la última valla, no la pantalla.
 */
type Estado = {
  abierta: string; cerrada: boolean; efectivo: number; porReponer: number
}

async function estado(q: Consulta, cajaId: string): Promise<Estado | null> {
  if (!/^[0-9a-f-]{36}$/i.test(cajaId)) return null
  const [c] = (await q`
    select c.abierta_el, c.cerrada_el,
           efectivo_caja(c.id)::text as efectivo, por_reponer(c.id)::text as por_reponer
      from caja_chica c where c.id = ${cajaId}::uuid
  `) as unknown as Array<{
    abierta_el: Date; cerrada_el: Date | null; efectivo: string; por_reponer: string
  }>
  if (!c) return null
  return {
    abierta: c.abierta_el.toISOString().slice(0, 10),
    cerrada: c.cerrada_el !== null,
    efectivo: Number(c.efectivo),
    porReponer: Number(c.por_reponer),
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const fechaMala = (f: string) => !FECHA.test(f) || Number.isNaN(Date.parse(f))

export type NuevoVale = {
  readonly cajaId: string
  readonly fecha: string
  readonly concepto: string
  readonly monto: number
  readonly cuenta: string
  readonly contratoId: string | null
  readonly beneficiario: string | null
  readonly soporte: string | null
}

export async function anotarVale(
  q: Consulta, v: NuevoVale, personaId: string, idioma: Idioma,
): Promise<Hecho> {
  if (v.concepto.trim() === '') return { hecho: false, motivo: t(idioma, 'caja.error.concepto') }
  // Con `!(x > 0)` y no con `x <= 0`: lo segundo deja pasar un NaN, que no es mayor
  // ni menor que nada, y NaN llega hasta PostgreSQL.
  if (!(v.monto > 0)) return { hecho: false, motivo: t(idioma, 'caja.error.monto') }
  if (fechaMala(v.fecha)) return { hecho: false, motivo: t(idioma, 'caja.error.fecha') }

  const e = await estado(q, v.cajaId)
  if (e === null) return { hecho: false, motivo: t(idioma, 'caja.error.no_existe') }
  if (e.cerrada) return { hecho: false, motivo: t(idioma, 'caja.error.cerrada') }
  if (v.fecha < e.abierta) {
    return { hecho: false, motivo: t(idioma, 'caja.error.antes').replace('{f}', e.abierta) }
  }
  if (e.efectivo - v.monto < 0) {
    return {
      hecho: false,
      motivo: t(idioma, 'caja.error.no_cabe').replace('{n}', e.efectivo.toFixed(2)),
    }
  }

  const [r] = (await q`
    select anotar_vale(${v.cajaId}::uuid, ${v.fecha}::date, ${v.concepto.trim()},
                       ${v.monto}, ${v.cuenta}, ${v.contratoId}::uuid,
                       ${v.beneficiario}, ${v.soporte}, ${personaId}::uuid) as id
  `) as unknown as Array<{ id: string }>
  return { hecho: true, id: r!.id }
}

/** Reponer la caja: aquí, y solo aquí, el gasto entra al libro. */
export async function reponer(
  q: Consulta, cajaId: string, fecha: string, personaId: string, idioma: Idioma,
): Promise<Hecho> {
  if (fechaMala(fecha)) return { hecho: false, motivo: t(idioma, 'caja.error.fecha') }
  const e = await estado(q, cajaId)
  if (e === null) return { hecho: false, motivo: t(idioma, 'caja.error.no_existe') }
  if (e.cerrada) return { hecho: false, motivo: t(idioma, 'caja.error.cerrada') }
  if (!(e.porReponer > 0)) return { hecho: false, motivo: t(idioma, 'caja.error.nada_reponer') }
  if (!await periodoAbierto(q, cajaId, fecha)) {
    return { hecho: false, motivo: t(idioma, 'caja.error.periodo') }
  }
  if (!await hayTasa(q, fecha)) return { hecho: false, motivo: t(idioma, 'caja.error.tasa') }

  const [r] = (await q`
    select reponer_caja(${cajaId}::uuid, ${fecha}::date, ${personaId}::uuid) as id
  `) as unknown as Array<{ id: string }>
  return { hecho: true, id: r!.id }
}

export async function cerrar(
  q: Consulta, cajaId: string, fecha: string, personaId: string, idioma: Idioma,
): Promise<Hecho> {
  if (fechaMala(fecha)) return { hecho: false, motivo: t(idioma, 'caja.error.fecha') }
  const e = await estado(q, cajaId)
  if (e === null) return { hecho: false, motivo: t(idioma, 'caja.error.no_existe') }
  if (e.cerrada) return { hecho: false, motivo: t(idioma, 'caja.error.cerrada') }
  // Cerrar con vales justificados sin reponer seria quedarse el dinero de alguien.
  if (e.porReponer > 0) return { hecho: false, motivo: t(idioma, 'caja.error.pendiente') }
  if (!await periodoAbierto(q, cajaId, fecha)) {
    return { hecho: false, motivo: t(idioma, 'caja.error.periodo') }
  }
  if (!await hayTasa(q, fecha)) return { hecho: false, motivo: t(idioma, 'caja.error.tasa') }

  const [r] = (await q`
    select cerrar_caja(${cajaId}::uuid, ${fecha}::date, ${personaId}::uuid) as id
  `) as unknown as Array<{ id: string }>
  return { hecho: true, id: r!.id }
}

async function periodoAbierto(q: Consulta, cajaId: string, fecha: string): Promise<boolean> {
  const [p] = (await q`
    select 1 as x from periodo pe
     join caja_chica c on c.organizacion_id = pe.organizacion_id
    where c.id = ${cajaId}::uuid
      and pe.anio = extract(year from ${fecha}::date)::int
      and pe.mes  = extract(month from ${fecha}::date)::int
      and pe.estado = 'abierto'
  `) as unknown as Array<{ x: number }>
  return p !== undefined
}

async function hayTasa(q: Consulta, fecha: string): Promise<boolean> {
  const [r] = (await q`select tasa_del_dia(${fecha}::date) as id`) as unknown as
    Array<{ id: string | null }>
  return (r?.id ?? null) !== null
}

export async function abrirCaja(
  q: Consulta, orgId: string, nombre: string, mon: 'VES' | 'USD', fondo: number,
  responsableId: string, fecha: string, personaId: string, idioma: Idioma,
): Promise<Hecho> {
  if (nombre.trim() === '') return { hecho: false, motivo: t(idioma, 'caja.error.nombre') }
  if (!(fondo > 0)) return { hecho: false, motivo: t(idioma, 'caja.error.monto') }
  if (fechaMala(fecha)) return { hecho: false, motivo: t(idioma, 'caja.error.fecha') }

  const [ya] = (await q`
    select 1 as x from caja_chica
     where organizacion_id = ${orgId}::uuid and nombre = ${nombre.trim()}
  `) as unknown as Array<{ x: number }>
  if (ya) return { hecho: false, motivo: t(idioma, 'caja.error.repetida') }
  if (!await periodoAbiertoOrg(q, orgId, fecha)) {
    return { hecho: false, motivo: t(idioma, 'caja.error.periodo') }
  }
  if (!await hayTasa(q, fecha)) return { hecho: false, motivo: t(idioma, 'caja.error.tasa') }

  const [r] = (await q`
    select abrir_caja(${orgId}::uuid, ${nombre.trim()}, ${mon}::moneda, ${fondo},
                      ${responsableId}::uuid, ${fecha}::date, ${personaId}::uuid) as id
  `) as unknown as Array<{ id: string }>
  return { hecho: true, id: r!.id }
}

async function periodoAbiertoOrg(q: Consulta, orgId: string, fecha: string): Promise<boolean> {
  const [p] = (await q`
    select 1 as x from periodo
     where organizacion_id = ${orgId}::uuid
       and anio = extract(year from ${fecha}::date)::int
       and mes  = extract(month from ${fecha}::date)::int
       and estado = 'abierto'
  `) as unknown as Array<{ x: number }>
  return p !== undefined
}

export type PorContrato = {
  readonly contrato: string
  readonly cliente: string
  readonly moneda: 'VES' | 'USD'
  readonly gastado: string
  readonly vales: number
  readonly sinPapel: string
  readonly sinPapelCrudo: number
}

/** Lo que se ha ido en caja chica, por contrato. La cifra por la que existe esto. */
export async function porContrato(
  q: Consulta, orgId: string, desde: string, hasta: string, idioma: Idioma,
): Promise<readonly PorContrato[]> {
  const filas = (await q`
    select contrato, cliente, moneda, gastado::text, vales, sin_papel::text
      from caja_por_contrato(${orgId}::uuid, ${desde}::date, ${hasta}::date)
  `) as unknown as Array<{
    contrato: string; cliente: string; moneda: 'VES' | 'USD'
    gastado: string; vales: number; sin_papel: string
  }>
  // Cada fila lleva la moneda de su caja y se formatea con ella. Dos cajas en
  // monedas distintas salen en filas distintas: sumarlas daría una cifra que no es
  // de nadie.
  return filas.map((f) => ({
    contrato: f.contrato,
    cliente: f.cliente,
    moneda: f.moneda,
    gastado: moneda(idioma, Number(f.gastado), f.moneda),
    vales: Number(f.vales),
    sinPapel: moneda(idioma, Number(f.sin_papel), f.moneda),
    sinPapelCrudo: Number(f.sin_papel),
  }))
}
