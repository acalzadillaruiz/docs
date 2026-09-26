/**
 * Reexpresión por inflación (VEN-NIF / NIC 29), en pantalla.
 *
 * En una economía hiperinflacionaria, comparar el resultado de enero con el de
 * diciembre sin reexpresar no es una aproximación: **es una cifra falsa**. Un balance
 * histórico dice que la empresa creció cuando lo único que creció fue el índice.
 *
 * Lo que esta pantalla tiene que dejar claro, y por eso el dominio devuelve las tres
 * cosas juntas por cuenta:
 *
 *   - Lo **monetario** no se reexpresa. Un bolívar en el banco sigue siendo un
 *     bolívar. Y precisamente por eso tenerlo cuesta dinero.
 *   - Ese coste es el **resultado monetario del ejercicio**, y no es un ajuste de
 *     cuadre inventado: es exactamente lo que costó tener bolívares mientras se
 *     devaluaban. Es la cifra que un CFO mira primero.
 *   - El ajuste se ve **cuenta por cuenta**, no como un número al final. Un ajuste
 *     global que nadie puede abrir es un número que nadie se cree.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, numero, t, type Idioma } from '../i18n/t.ts'

export type Linea = {
  readonly codigo: string
  readonly cuenta: string
  readonly monetaria: boolean
  readonly historico: string
  readonly reexpresado: string
  readonly ajuste: string
  readonly ajusteCrudo: number
}

export type Cuadro = {
  readonly al: string
  readonly lineas: readonly Linea[]
  /** El REME, con signo: negativo es pérdida por haber tenido bolívares. */
  readonly reme: string
  readonly remeCrudo: number
  /** Sin índice de precios no hay nada que enseñar, y hay que decirlo así. */
  readonly sinIndice: boolean
}

export async function cuadro(
  q: Consulta, orgId: string, idioma: Idioma, al: string,
): Promise<Cuadro> {
  // Sin índice al día pedido, `reexpresar` levanta una excepción que aborta la
  // transacción entera. Se pregunta antes, para poder explicarlo en vez de reventar.
  const [i] = (await q`select indice_del_dia(${al}::date) as v`) as unknown as
    Array<{ v: string | null }>
  if (i?.v == null) {
    return { al, lineas: [], reme: moneda(idioma, 0, 'VES'), remeCrudo: 0, sinIndice: true }
  }

  const filas = (await q`
    select codigo, cuenta_es, cuenta_en, monetaria,
           historico::text, reexpresado::text, ajuste::text
      from reexpresar(${orgId}::uuid, ${al}::date)
  `) as unknown as Array<Record<string, string | boolean>>

  const [r] = (await q`
    select resultado_monetario(${orgId}::uuid, ${al}::date)::text as reme
  `) as unknown as Array<{ reme: string }>
  const reme = Number(r?.reme ?? 0)

  return {
    al,
    lineas: filas.map((f) => ({
      codigo: f['codigo'] as string,
      cuenta: (idioma === 'es' ? f['cuenta_es'] : f['cuenta_en']) as string,
      monetaria: f['monetaria'] === true,
      historico: moneda(idioma, Number(f['historico']), 'VES'),
      reexpresado: moneda(idioma, Number(f['reexpresado']), 'VES'),
      ajuste: moneda(idioma, Number(f['ajuste']), 'VES'),
      ajusteCrudo: Number(f['ajuste']),
    })),
    reme: moneda(idioma, reme, 'VES'),
    remeCrudo: reme,
    sinIndice: false,
  }
}

export type Asentado =
  | { readonly hecho: true; readonly asiento: string | null }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Asienta la reexpresión de un mes.
 *
 * Las tres condiciones se comprueban aquí, antes de llamar: una excepción dentro de
 * una transacción la aborta entera, y entonces no queda nada que contarle a nadie.
 */
export async function asentarMes(
  q: Consulta, orgId: string, anio: number, mes: number, personaId: string, idioma: Idioma,
): Promise<Asentado> {
  const [ya] = (await q`
    select count(*)::int as n from asiento asi
     where asi.organizacion_id = ${orgId}::uuid and asi.origen_tipo = 'reexpresion'
       and asi.anio = ${anio} and asi.mes = ${mes} and asi.reversa_a is null
       and not exists (select 1 from asiento rev where rev.reversa_a = asi.id)
  `) as unknown as Array<{ n: number }>
  if (Number(ya?.n ?? 0) > 0) return { hecho: false, motivo: t(idioma, 'reex.error.mes') }

  const [periodo] = (await q`
    select 1 as x from periodo
     where organizacion_id = ${orgId}::uuid and anio = ${anio} and mes = ${mes}
       and estado = 'abierto'
  `) as unknown as Array<{ x: number }>
  if (!periodo) return { hecho: false, motivo: t(idioma, 'reex.error.periodo') }

  const fin = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10)
  const [i] = (await q`select indice_del_dia(${fin}::date) as v`) as unknown as
    Array<{ v: string | null }>
  if (i?.v == null) return { hecho: false, motivo: t(idioma, 'reex.error.indice') }

  const [a] = (await q`
    select asentar_reexpresion(${orgId}::uuid, ${anio}, ${mes}, ${personaId}::uuid) as id
  `) as unknown as Array<{ id: string | null }>
  return { hecho: true, asiento: a?.id ?? null }
}

/** Los meses ya reexpresados, para no ofrecer el botón dos veces. */
export async function mesesReexpresados(
  q: Consulta, orgId: string,
): Promise<readonly { anio: number; mes: number }[]> {
  return (await q`
    select asi.anio, asi.mes from asiento asi
     where asi.organizacion_id = ${orgId}::uuid and asi.origen_tipo = 'reexpresion'
       and asi.reversa_a is null
       and not exists (select 1 from asiento rev where rev.reversa_a = asi.id)
     order by asi.anio desc, asi.mes desc limit 24
  `) as unknown as Array<{ anio: number; mes: number }>
}

// ---------------------------------------------------------------------------
// Cargar el INPC del mes.
//
// La pantalla decía «No hay índice de precios (INPC) cargado a esa fecha. Sin índice
// no se puede reexpresar nada» — y no había forma de cargarlo. `indice_precios` la
// escribía **solo una prueba de la base de datos**, así que la reexpresión por
// inflación, que es de lo que va este módulo entero, no podía correr nunca.
//
// El índice es un número que publica el BCV una vez al mes. Se pide por año y mes, no
// por fecha libre: así se guarda siempre el día uno y `indice_del_dia()` —que busca el
// último vigente hasta la fecha— encuentra el del mes que toca sin sorpresas.

export type Indice = {
  readonly anio: number
  readonly mes: number
  readonly valor: string
  /** Cuánto subió respecto al mes anterior cargado. Un dedo gordo se ve aquí. */
  readonly variacion: string | null
}

export async function indices(
  q: Consulta, idioma: Idioma, cuantos = 18,
): Promise<readonly Indice[]> {
  const filas = (await q`
    select vigente_desde, valor::text as valor,
           lag(valor) over (order by vigente_desde) as anterior
      from indice_precios
     order by vigente_desde desc
     limit ${cuantos}
  `) as unknown as Array<{ vigente_desde: Date; valor: string; anterior: string | null }>
  return filas.map((f): Indice => {
    const d = f.vigente_desde
    const ant = f.anterior === null ? null : Number(f.anterior)
    return {
      anio: d.getUTCFullYear(),
      mes: d.getUTCMonth() + 1,
      valor: numero(idioma, Number(f.valor), 4),
      // Se enseña la variación, no solo el número: un índice escrito con un cero de
      // más pasa desapercibido, y un «+1.240 %» no.
      variacion: ant === null || ant === 0
        ? null
        : `${Number(f.valor) >= ant ? '+' : ''}${
            numero(idioma, ((Number(f.valor) - ant) / ant) * 100, 2)} %`,
    }
  })
}

export type Cargado =
  | { readonly hecho: true }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Guarda el INPC de un mes.
 *
 * Se puede corregir mientras no se haya usado. Si ya hay una reexpresión asentada en
 * ese mes o después, **no**: cambiar el índice por debajo de un asiento ya hecho deja
 * un libro que nadie puede volver a explicar. Entonces el camino es reversar esa
 * reexpresión, que es el que el propio módulo ya ofrece.
 */
export async function cargarIndice(
  q: Consulta, orgId: string, anio: number, mes: number, valor: number, idioma: Idioma,
): Promise<Cargado> {
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    return { hecho: false, motivo: t(idioma, 'reex.error.anio') }
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    return { hecho: false, motivo: t(idioma, 'reex.error.mes_numero') }
  }
  // Se pregunta por lo que TIENE que ser: con `<= 0`, un NaN pasaría, porque toda
  // comparación con NaN es falsa.
  if (!(valor > 0)) return { hecho: false, motivo: t(idioma, 'reex.error.valor') }

  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`

  // La regla mira la FECHA, no si la fila ya existía.
  //
  // La primera versión solo impedía CAMBIAR un índice que ya se había usado, y dejaba
  // cargar por primera vez uno de un mes anterior. Eso rompe lo mismo: la reexpresión
  // va partida por partida, cada una con el índice de su fecha, así que meter un
  // índice de mayo después de haber reexpresado julio hace que el asiento de julio
  // deje de salir de los datos que hay. El asiento no cambia —no se puede—, pero deja
  // de poder explicarse, que es peor.
  //
  // Así que: nada que valga en una fecha ya reexpresada, exista o no la fila. Lo de
  // después, libre.
  const [reexpresado] = (await q`
    select max(make_date(asi.anio, asi.mes, 1) + interval '1 month' - interval '1 day')::date
             as hasta
      from asiento asi
     where asi.organizacion_id = ${orgId}::uuid and asi.origen_tipo = 'reexpresion'
       and asi.reversa_a is null
       and not exists (select 1 from asiento rev where rev.reversa_a = asi.id)
  `) as unknown as Array<{ hasta: Date | null }>
  const hasta = reexpresado?.hasta ?? null
  if (hasta !== null && desde <= hasta.toISOString().slice(0, 10)) {
    return { hecho: false, motivo: t(idioma, 'reex.error.indice_usado') }
  }

  await q`
    insert into indice_precios (vigente_desde, valor, fuente)
    values (${desde}::date, ${valor}, 'bcv')
    on conflict (vigente_desde) do update
      set valor = excluded.valor, registrado_en = now()`
  return { hecho: true }
}
