/**
 * Los equipos y su desgaste.
 *
 * Para GPS no es contabilidad de adorno: **alquiler de equipos es uno de los cinco
 * tipos de contrato**, y un equipo alquilado genera ingreso y se gasta al mismo
 * tiempo. Si solo se mira el ingreso, el negocio parece mejor de lo que es.
 *
 * Por eso la pantalla no enseña una lista de activos con su valor: enseña, por cada
 * equipo alquilado, **lo que deja** — lo facturado menos el desgaste. Es la única
 * cifra que contesta «¿alquilar esto sale a cuenta?».
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, t, type Idioma } from '../i18n/t.ts'

export type Equipo = {
  readonly id: string
  readonly codigo: string
  readonly descripcion: string
  readonly enServicio: string
  readonly costo: string
  readonly enLibros: string
  readonly deBaja: boolean
  readonly contrato: string | null
  /** Solo para los alquilados: lo facturado, el desgaste, y la diferencia. */
  readonly ingreso: string | null
  readonly desgaste: string | null
  readonly deja: string | null
  readonly dejaCrudo: number | null
}

export async function equipos(
  q: Consulta, orgId: string, idioma: Idioma, al = new Date().toISOString().slice(0, 10),
): Promise<readonly Equipo[]> {
  const filas = (await q`
    select a.id, a.codigo, a.descripcion_es, a.descripcion_en, a.en_servicio_el,
           a.costo_ves::text as costo, a.baja_el, ct.codigo as contrato,
           valor_en_libros(a.id, ${al}::date)::text as en_libros
      from activo a
      left join contrato ct on ct.id = a.contrato_id
     where a.organizacion_id = ${orgId}::uuid
     order by a.baja_el nulls first, a.codigo
  `) as unknown as Array<Record<string, string | Date | null>>

  const salida: Equipo[] = []
  for (const f of filas) {
    const id = f['id'] as string
    let ingreso: number | null = null
    let desgaste: number | null = null
    let deja: number | null = null

    if (f['contrato']) {
      const [r] = (await q`
        select ingreso::text, desgaste::text, deja::text
          from rendimiento_alquiler(${id}::uuid, ${al}::date)
      `) as unknown as Array<{ ingreso: string; desgaste: string; deja: string }>
      if (r) {
        ingreso = Number(r.ingreso)
        desgaste = Number(r.desgaste)
        deja = Number(r.deja)
      }
    }

    salida.push({
      id,
      codigo: f['codigo'] as string,
      descripcion: (idioma === 'es' ? f['descripcion_es'] : f['descripcion_en']) as string,
      enServicio: (f['en_servicio_el'] as Date).toISOString().slice(0, 10),
      costo: moneda(idioma, Number(f['costo']), 'VES'),
      enLibros: moneda(idioma, Number(f['en_libros']), 'VES'),
      deBaja: f['baja_el'] !== null,
      contrato: (f['contrato'] as string | null) ?? null,
      ingreso: ingreso === null ? null : moneda(idioma, ingreso, 'VES'),
      desgaste: desgaste === null ? null : moneda(idioma, desgaste, 'VES'),
      deja: deja === null ? null : moneda(idioma, deja, 'VES'),
      dejaCrudo: deja,
    })
  }
  return salida
}

export type Depreciado =
  | { readonly hecho: true; readonly asiento: string }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Deprecia un mes entero, de una vez.
 *
 * Se hace por mes y no por equipo porque genera **un** asiento con una línea por
 * equipo: uno por equipo llenaría el libro de asientos de cuatro líneas y haría
 * ilegible el mayor de la cuenta de depreciación.
 *
 * Las condiciones se comprueban aquí antes de llamar: una excepción dentro de una
 * transacción la aborta entera y no deja decir nada útil.
 */
export async function depreciarMes(
  q: Consulta, orgId: string, anio: number, mes: number, personaId: string, idioma: Idioma,
): Promise<Depreciado> {
  const [ya] = (await q`
    select count(*)::int as n from depreciacion d
      join activo a on a.id = d.activo_id
     where a.organizacion_id = ${orgId}::uuid and d.anio = ${anio} and d.mes = ${mes}
  `) as unknown as Array<{ n: number }>
  if (Number(ya?.n ?? 0) > 0) return { hecho: false, motivo: t(idioma, 'activo.error.mes') }

  const [periodo] = (await q`
    select 1 as x from periodo
     where organizacion_id = ${orgId}::uuid and anio = ${anio} and mes = ${mes}
       and estado = 'abierto'
  `) as unknown as Array<{ x: number }>
  if (!periodo) return { hecho: false, motivo: t(idioma, 'activo.error.periodo') }

  const [hay] = (await q`
    select count(*)::int as n from activo
     where organizacion_id = ${orgId}::uuid
       and (baja_el is null or baja_el > make_date(${anio}, ${mes}, 1))
       and en_servicio_el <= (make_date(${anio}, ${mes}, 1) + interval '1 month - 1 day')::date
  `) as unknown as Array<{ n: number }>
  if (Number(hay?.n ?? 0) === 0) return { hecho: false, motivo: t(idioma, 'activo.error.nada') }

  const [a] = (await q`
    select depreciar_mes(${orgId}::uuid, ${anio}, ${mes}, ${personaId}::uuid) as id
  `) as unknown as Array<{ id: string }>
  return { hecho: true, asiento: a!.id }
}

/** Los meses ya depreciados, para no ofrecer el botón dos veces. */
export async function mesesDepreciados(
  q: Consulta, orgId: string,
): Promise<readonly { anio: number; mes: number }[]> {
  return (await q`
    select distinct d.anio, d.mes from depreciacion d
      join activo a on a.id = d.activo_id
     where a.organizacion_id = ${orgId}::uuid
     order by d.anio desc, d.mes desc limit 24
  `) as unknown as Array<{ anio: number; mes: number }>
}
