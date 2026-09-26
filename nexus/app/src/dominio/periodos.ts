/**
 * Los meses contables.
 *
 * Un asiento solo entra en un mes abierto. Parece un detalle administrativo y es lo
 * que bloquea todo lo demás el día 1: sin el mes nuevo abierto no entra ni una
 * factura ni un cobro, y el mensaje que sale —«el mes no tiene periodo abierto»— no
 * se entiende si no hay una pantalla donde arreglarlo.
 *
 * Cerrar es la operación seria. No se reabre desde aquí, y no es una limitación:
 * corregir un mes cerrado se hace con un asiento de reverso en el mes siguiente, que
 * es como tiene que quedar el rastro. Reabrir un mes ya declarado al SENIAT es como
 * se acaba con dos versiones de la misma declaración.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, t, type Idioma } from '../i18n/t.ts'

export type Mes = {
  readonly anio: number
  readonly mes: number
  readonly nombre: string
  readonly abierto: boolean
  readonly asientos: number
  readonly descuadre: string
  readonly cuadra: boolean
  /** Solo se ofrece cerrar el más antiguo que siga abierto. */
  readonly puedeCerrar: boolean
}

export type Meses = {
  readonly lista: readonly Mes[]
  /** El primer mes que todavía no existe, para ofrecer abrirlo. */
  readonly siguiente: { anio: number; mes: number; nombre: string } | null
}

function nombreMes(idioma: Idioma, anio: number, mes: number): string {
  // El nombre del mes lo da el propio navegador del servidor, no una lista escrita a
  // mano: una lista a mano son doce cadenas por idioma que hay que mantener, y las
  // maneras de escribirlas mal son doce.
  return new Intl.DateTimeFormat(idioma === 'es' ? 'es-VE' : 'en-US',
    { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(anio, mes - 1, 1)))
}

export async function meses(q: Consulta, orgId: string, idioma: Idioma): Promise<Meses> {
  const filas = (await q`
    select pe.anio, pe.mes, pe.estado::text,
           coalesce((select count(*) from asiento a
                      where a.organizacion_id = pe.organizacion_id
                        and a.anio = pe.anio and a.mes = pe.mes), 0)::int as asientos,
           coalesce((select sum(p.monto_ves) from partida p
                      join asiento a on a.id = p.asiento_id
                     where a.organizacion_id = pe.organizacion_id
                       and a.anio = pe.anio and a.mes = pe.mes), 0)::text as descuadre
      from periodo pe
     where pe.organizacion_id = ${orgId}::uuid
     order by pe.anio desc, pe.mes desc
     limit 24
  `) as unknown as Array<{
    anio: number; mes: number; estado: string; asientos: number; descuadre: string
  }>

  // El más antiguo que siga abierto es el único que se puede cerrar: cerrar marzo
  // dejando febrero abierto deja un agujero por el que entran asientos a un mes que
  // ya se declaró.
  const abiertos = filas.filter((f) => f.estado === 'abierto')
  const cerrable = abiertos.length === 0 ? null
    : abiertos.reduce((a, b) => (a.anio * 12 + a.mes <= b.anio * 12 + b.mes ? a : b))

  const lista = filas.map((f): Mes => ({
    anio: Number(f.anio),
    mes: Number(f.mes),
    nombre: nombreMes(idioma, Number(f.anio), Number(f.mes)),
    abierto: f.estado === 'abierto',
    asientos: Number(f.asientos),
    descuadre: moneda(idioma, Number(f.descuadre), 'VES'),
    cuadra: Math.abs(Number(f.descuadre)) < 0.005,
    puedeCerrar: cerrable !== null &&
      Number(f.anio) === Number(cerrable.anio) && Number(f.mes) === Number(cerrable.mes),
  }))

  // El siguiente por abrir: el que viene después del último que existe, o el mes en
  // curso si no existe ninguno. Se cuenta en meses desde el año cero con el mes en
  // base 0, que es la única forma de que diciembre pase a enero sin un caso aparte.
  const hoy = new Date()
  let siguiente: { anio: number; mes: number }
  if (filas.length === 0) {
    siguiente = { anio: hoy.getUTCFullYear(), mes: hoy.getUTCMonth() + 1 }
  } else {
    const ultimo = filas.reduce((a, b) => (a.anio * 12 + a.mes >= b.anio * 12 + b.mes ? a : b))
    const n = Number(ultimo.anio) * 12 + (Number(ultimo.mes) - 1) + 1
    siguiente = { anio: Math.floor(n / 12), mes: (n % 12) + 1 }
  }

  return {
    lista,
    siguiente: { ...siguiente, nombre: nombreMes(idioma, siguiente.anio, siguiente.mes) },
  }
}

export type Cambio =
  | { readonly hecho: true }
  | { readonly hecho: false; readonly motivo: string }

export async function abrirMes(
  q: Consulta, orgId: string, anio: number, mes: number, idioma: Idioma,
): Promise<Cambio> {
  if (!(mes >= 1 && mes <= 12) || !(anio >= 2000 && anio <= 2100)) {
    return { hecho: false, motivo: t(idioma, 'periodo.error.fecha') }
  }
  const filas = await q`
    insert into periodo (organizacion_id, anio, mes) values (${orgId}::uuid, ${anio}, ${mes})
    on conflict (organizacion_id, anio, mes) do nothing
    returning anio`
  return filas.length === 1
    ? { hecho: true }
    : { hecho: false, motivo: t(idioma, 'periodo.error.ya') }
}

/**
 * Cerrar.
 *
 * Las dos condiciones las hace cumplir `cerrar_periodo()` en la base de datos, que
 * es donde tienen que estar. Aquí se comprueban antes solo para poder decirlo en el
 * idioma de quien mira, y porque una excepción dentro de una transacción la aborta
 * entera y no deja contar nada.
 */
export async function cerrarMes(
  q: Consulta, orgId: string, anio: number, mes: number, personaId: string, idioma: Idioma,
): Promise<Cambio> {
  const [anterior] = (await q`
    select estado::text from periodo
     where organizacion_id = ${orgId}::uuid
       and (anio * 12 + mes) = ${anio * 12 + mes - 1}
  `) as unknown as Array<{ estado: string }>
  if (anterior && anterior.estado === 'abierto') {
    return { hecho: false, motivo: t(idioma, 'periodo.error.orden') }
  }

  const [d] = (await q`
    select coalesce(sum(p.monto_ves), 0)::text as descuadre
      from partida p join asiento a on a.id = p.asiento_id
     where a.organizacion_id = ${orgId}::uuid and a.anio = ${anio} and a.mes = ${mes}
  `) as unknown as Array<{ descuadre: string }>
  if (Math.abs(Number(d?.descuadre ?? 0)) >= 0.005) {
    return { hecho: false, motivo: t(idioma, 'periodo.error.descuadre') }
  }

  await q`select cerrar_periodo(${orgId}::uuid, ${anio}, ${mes}, ${personaId}::uuid)`
  return { hecho: true }
}

/**
 * Si esta empresa tiene ya su plan de cuentas.
 *
 * Hace falta preguntarlo porque **sin plan no se puede hacer nada**: no se importa
 * una factura, no se asienta un cobro, no se abre un mes con sentido. El importador
 * ya lo decía —«esta empresa todavía no tiene plan de cuentas instalado»— y **no
 * había forma de instalarlo desde ninguna pantalla**. Otra instrucción sin camino.
 */
export async function tienePlan(q: Consulta, orgId: string): Promise<number> {
  const [n] = (await q`
    select count(*)::int as n from cuenta where organizacion_id = ${orgId}::uuid
  `) as unknown as Array<{ n: number }>
  return Number(n?.n ?? 0)
}

/**
 * Instala el plan de cuentas propuesto para servicios petroleros en Venezuela.
 *
 * Es una PROPUESTA, no una imposición, y la pantalla lo dice: nada del sistema
 * depende de estos códigos concretos, porque las cuentas se referencian por concepto
 * a través de `mapa_cuenta`. Si GPS tiene el suyo, se carga el suyo.
 *
 * No se instala dos veces: con cuentas ya creadas, volver a pasar por aquí no añade
 * nada, pero tampoco tiene por qué ser un botón que se pueda pulsar.
 */
export async function instalarPlan(
  q: Consulta, orgId: string, idioma: Idioma,
): Promise<Cambio> {
  if (await tienePlan(q, orgId) > 0) {
    return { hecho: false, motivo: t(idioma, 'periodo.error.plan_ya') }
  }
  await q`select instalar_plan_cuentas(${orgId}::uuid)`
  return { hecho: true }
}
