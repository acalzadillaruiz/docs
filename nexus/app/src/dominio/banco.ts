/**
 * Conciliación bancaria.
 *
 * La máquina PROPONE el casamiento; casar lo hace una persona. Dos movimientos del
 * mismo importe el mismo día son más frecuentes de lo que parece, y una conciliación
 * automática que se equivoca una vez al mes es peor que ninguna: se deja de revisar
 * y el error se descubre en la auditoría.
 *
 * Y lo que no casa NO SE ESCONDE. Queda señalado hasta que alguien lo explique por
 * escrito. Esa es la mitad de la pantalla que nadie quiere mirar y la única que de
 * verdad hace falta: un movimiento del banco sin documento es dinero que salió o
 * entró sin que la contabilidad se enterara.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, t, type Idioma } from '../i18n/t.ts'

export type Propuesta = {
  readonly movimiento: string
  readonly fecha: string
  readonly monto: string
  readonly descripcion: string
  readonly casaCon: 'cobro' | 'pago'
  readonly candidato: string
  readonly dias: number
}

export type Descuadre = {
  readonly lado: 'solo en el banco' | 'solo en la contabilidad'
  readonly id: string
  readonly fecha: string
  readonly monto: string
  readonly detalle: string
  readonly esDelBanco: boolean
}

export type Conciliacion = {
  readonly propuestas: readonly Propuesta[]
  readonly descuadres: readonly Descuadre[]
  readonly desde: string
  readonly hasta: string
}

export async function conciliacion(
  q: Consulta, orgId: string, desde: string, hasta: string, idioma: Idioma,
): Promise<Conciliacion> {
  const props = (await q`
    select * from proponer_conciliacion(${orgId}::uuid, ${desde}::date, ${hasta}::date)
  `) as unknown as Array<{
    movimiento: string; fecha: Date; monto: string; descripcion: string | null
    casa_con: string; candidato: string; dias_de_diferencia: number
  }>

  const desc = (await q`
    select * from descuadres_banco(${orgId}::uuid, ${desde}::date, ${hasta}::date)
  `) as unknown as Array<{
    lado: string; id: string; fecha: Date; monto: string; detalle: string
  }>

  return {
    desde,
    hasta,
    propuestas: props.map((p): Propuesta => ({
      movimiento: p.movimiento,
      fecha: p.fecha.toISOString().slice(0, 10),
      monto: moneda(idioma, Number(p.monto), 'VES'),
      descripcion: p.descripcion ?? '',
      casaCon: p.casa_con === 'pago' ? 'pago' : 'cobro',
      candidato: p.candidato,
      dias: Number(p.dias_de_diferencia),
    })),
    descuadres: desc.map((d): Descuadre => ({
      lado: d.lado as Descuadre['lado'],
      id: d.id,
      fecha: d.fecha.toISOString().slice(0, 10),
      monto: moneda(idioma, Number(d.monto), 'VES'),
      detalle: d.detalle,
      esDelBanco: d.lado === 'solo en el banco',
    })),
  }
}

export type Casado =
  | { readonly hecho: true }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Casa un movimiento con su cobro o su pago.
 *
 * La condición de «todavía sin conciliar» va DENTRO del update: entre la consulta y
 * la escritura cabe otra persona casando el mismo movimiento con otra cosa.
 */
export async function casar(
  q: Consulta, movimientoId: string, clase: 'cobro' | 'pago', candidatoId: string,
  personaId: string, idioma: Idioma,
): Promise<Casado> {
  const filas = clase === 'cobro'
    ? await q`
        update movimiento_banco
           set cobro_id = ${candidatoId}::uuid, conciliado_en = now(),
               conciliado_por = ${personaId}::uuid
         where id = ${movimientoId}::uuid and conciliado_en is null
           and not exists (select 1 from movimiento_banco x
                            where x.cobro_id = ${candidatoId}::uuid)
        returning id`
    : await q`
        update movimiento_banco
           set pago_id = ${candidatoId}::uuid, conciliado_en = now(),
               conciliado_por = ${personaId}::uuid
         where id = ${movimientoId}::uuid and conciliado_en is null
           and not exists (select 1 from movimiento_banco x
                            where x.pago_id = ${candidatoId}::uuid)
        returning id`

  if (filas.length === 1) return { hecho: true }

  // Se distingue entre «ya conciliado» y «ese cobro ya lo cogió otro»: las dos se
  // arreglan de forma distinta, y decir solo «no se pudo» deja a alguien mirando la
  // pantalla sin saber qué hacer.
  const [m] = (await q`
    select conciliado_en from movimiento_banco where id = ${movimientoId}::uuid
  `) as unknown as Array<{ conciliado_en: Date | null }>
  if (m?.conciliado_en) return { hecho: false, motivo: t(idioma, 'banco.error.ya') }
  return { hecho: false, motivo: t(idioma, 'banco.error.tomado') }
}

/**
 * Acepta un movimiento sin casarlo, con su nota.
 *
 * La nota es obligatoria y lo hace cumplir también la base de datos. Un movimiento
 * aceptado sin explicación es un descuadre que desaparece de la pantalla sin haberse
 * resuelto, que es justo lo que esta pantalla existe para impedir.
 */
export async function aceptarConNota(
  q: Consulta, movimientoId: string, nota: string, personaId: string, idioma: Idioma,
): Promise<Casado> {
  if (nota.trim() === '') return { hecho: false, motivo: t(idioma, 'banco.error.nota') }

  const filas = await q`
    update movimiento_banco
       set nota = ${nota.trim()}, conciliado_en = now(), conciliado_por = ${personaId}::uuid
     where id = ${movimientoId}::uuid and conciliado_en is null
    returning id`
  return filas.length === 1
    ? { hecho: true }
    : { hecho: false, motivo: t(idioma, 'banco.error.ya') }
}
