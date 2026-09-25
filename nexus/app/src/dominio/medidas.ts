/**
 * Las tres cifras que no da ningún portal de seguimiento.
 *
 * Las tres viven en la base de datos y están probadas desde hace tiempo. Aquí solo
 * se piden, se formatean en el idioma de quien mira, y se ordenan poniendo delante
 * lo que más duele. Nada se recalcula: repetir el cálculo aquí sería tener dos
 * verdades sobre lo mismo.
 *
 * **Cuántas filas se enseñan.** Estas cuatro tablas traen una fila por contrato, y
 * con quinientos contratos la pantalla tardaba un segundo y pesaba 613 KB. En el
 * patio, con la cobertura que hay, eso son decenas de segundos.
 *
 * Pero el problema de fondo no es el peso: es que **una lista de problemas de
 * quinientas filas no es una lista, es una pared**. Esta pantalla existe para que
 * alguien haga algo, y nadie actúa sobre quinientas cosas. Se enseñan las peores y
 * se dice cuántas quedan detrás — que es distinto de esconderlas.
 *
 * Lo que NO se recorta nunca es el total: la brecha en dinero se suma sobre TODAS
 * las filas. Un titular calculado sobre una lista cortada sería un número falso, y
 * un número falso en una pantalla de dirección es peor que no tener la pantalla.
 *
 * Nada de esto sale nunca al cliente. No hace falta esconderlo en la pantalla: la
 * ruta se niega, y además las funciones piden la organización de GPS. Un cliente que
 * llamara aquí obtendría su propia organización, que no es de tipo gps, y por tanto
 * ningún contrato.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, numero, type Idioma } from '../i18n/t.ts'

export type FilaBrecha = {
  readonly contrato: string
  readonly cliente: string
  readonly declarado: string
  readonly evidenciado: string
  readonly brecha: string
  readonly brechaPct: number
  /** Para la barra. Cuánto de lo declarado está demostrado, en tanto por ciento. */
  readonly demostradoPct: number
}

export type FilaVerdad = {
  readonly contrato: string
  readonly hechos: number
  readonly mediana: number
  readonly peor: number
}

export type FilaCobertura = {
  readonly contrato: string
  readonly cliente: string
  readonly vendido: string
  readonly conRespaldo: string
  readonly sinRespaldo: string
  readonly sinRespaldoPct: number
}

export type FilaSinHitos = {
  readonly renglonId: string
  readonly contratoId: string
  readonly contrato: string
  readonly renglon: string
  readonly valor: string
}

export type Medidas = {
  readonly brecha: readonly FilaBrecha[]
  readonly verdad: readonly FilaVerdad[]
  readonly cobertura: readonly FilaCobertura[]
  readonly sinHitos: readonly FilaSinHitos[]
  /** El total de la brecha, en cada moneda. No se suman dólares con bolívares. */
  readonly brechaTotal: readonly string[]
  /** Cuántas filas quedaron fuera de cada tabla. Se dicen, no se esconden. */
  readonly ocultas: {
    readonly brecha: number
    readonly verdad: number
    readonly cobertura: number
    readonly sinHitos: number
  }
}

/**
 * Cuántas filas se enseñan de cada tabla.
 *
 * Veinticinco es lo que cabe en una pantalla sin que se convierta en una pared, y
 * las cuatro consultas ya vienen ordenadas con lo peor delante. Si alguien necesita
 * la lista entera, eso es una exportación, no una pantalla más larga.
 */
export const CUANTAS = 25

export async function medidas(
  q: Consulta, orgId: string, idioma: Idioma,
): Promise<Medidas> {
  const brechaCruda = (await q`
    select * from brecha_evidencia(${orgId}::uuid)
  `) as unknown as Array<{
    contrato: string; cliente: string; declarado: string; evidenciado: string
    brecha: string; brecha_pct: string; moneda: 'VES' | 'USD'
  }>

  const verdadCruda = (await q`
    select * from tiempo_hasta_la_verdad(${orgId}::uuid)
  `) as unknown as Array<{ contrato: string; hechos: number; mediana: string; peor: number }>

  const coberturaCruda = (await q`
    select * from cobertura(${orgId}::uuid)
  `) as unknown as Array<{
    contrato: string; cliente: string; vendido: string
    con_respaldo: string; sin_respaldo: string; moneda: 'VES' | 'USD'
  }>

  const sinHitosCrudo = (await q`
    select * from renglones_sin_hitos(${orgId}::uuid)
  `) as unknown as Array<{
    renglon_id: string; contrato_id: string; contrato: string
    renglon: string; valor: string; moneda: 'VES' | 'USD'
  }>

  // Los totales se suman por moneda. Sumar dólares con bolívares daría un número
  // grande y falso, y un número falso en una pantalla de dirección es peor que no
  // tener la pantalla.
  const porMoneda = new Map<string, number>()
  for (const f of brechaCruda) {
    porMoneda.set(f.moneda, (porMoneda.get(f.moneda) ?? 0) + Number(f.brecha))
  }

  return {
    ocultas: {
      brecha: Math.max(0, brechaCruda.length - CUANTAS),
      verdad: Math.max(0, verdadCruda.length - CUANTAS),
      cobertura: Math.max(0, coberturaCruda.length - CUANTAS),
      sinHitos: Math.max(0, sinHitosCrudo.length - CUANTAS),
    },
    brecha: brechaCruda.slice(0, CUANTAS).map((f): FilaBrecha => {
      const declarado = Number(f.declarado)
      const evidenciado = Number(f.evidenciado)
      return {
        contrato: f.contrato,
        cliente: f.cliente,
        declarado: moneda(idioma, declarado, f.moneda),
        evidenciado: moneda(idioma, evidenciado, f.moneda),
        brecha: moneda(idioma, Number(f.brecha), f.moneda),
        brechaPct: Number(f.brecha_pct),
        demostradoPct: declarado === 0 ? 0
          : Math.round((evidenciado / declarado) * 1000) / 10,
      }
    }),
    verdad: verdadCruda.slice(0, CUANTAS).map((f): FilaVerdad => ({
      contrato: f.contrato,
      hechos: Number(f.hechos),
      mediana: Number(f.mediana),
      peor: Number(f.peor),
    })),
    cobertura: coberturaCruda.slice(0, CUANTAS).map((f): FilaCobertura => {
      const vendido = Number(f.vendido)
      const sin = Number(f.sin_respaldo)
      return {
        contrato: f.contrato,
        cliente: f.cliente,
        vendido: moneda(idioma, vendido, f.moneda),
        conRespaldo: moneda(idioma, Number(f.con_respaldo), f.moneda),
        sinRespaldo: moneda(idioma, sin, f.moneda),
        sinRespaldoPct: vendido === 0 ? 0 : Math.round((sin / vendido) * 1000) / 10,
      }
    }),
    sinHitos: sinHitosCrudo.slice(0, CUANTAS).map((f): FilaSinHitos => ({
      renglonId: f.renglon_id,
      contratoId: f.contrato_id,
      contrato: f.contrato,
      renglon: f.renglon,
      valor: moneda(idioma, Number(f.valor), f.moneda),
    })),
    brechaTotal: [...porMoneda.entries()]
      .filter(([, v]) => v !== 0)
      .map(([m, v]) => moneda(idioma, v, m as 'VES' | 'USD')),
  }
}

/** Los días, dichos como se dicen. */
export function dias(idioma: Idioma, n: number): string {
  const texto = numero(idioma, n, n % 1 === 0 ? 0 : 1)
  if (idioma === 'en') return `${texto} ${n === 1 ? 'day' : 'days'}`
  return `${texto} ${n === 1 ? 'día' : 'días'}`
}
