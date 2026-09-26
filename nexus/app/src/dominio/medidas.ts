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
import { moneda, numero, t, type Idioma } from '../i18n/t.ts'
import { plantillaUsable } from './plantillas.ts'

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

// ---------------------------------------------------------------------------
// Crear los hitos que faltan.
//
// La pantalla señalaba los renglones sin hitos —«a estos se les olvidó»— y no había
// forma de crearlos. `crear_hitos_desde_plantilla()` existía desde el principio y la
// llamaba UN sitio: el alta de un contrato. Un renglón que llegó por otro camino —de
// una hoja de Excel, de un contrato anterior a la plantilla— se quedaba sin hitos
// para siempre, con avance cero, indistinguible de uno que no ha empezado. Octava vez
// que aparece la misma forma: la máquina ya estaba debajo y faltaba la puerta.
//
// Y el texto del botón llevaba escrito en el diccionario desde el primer día, en los
// dos idiomas, sin que ninguna pantalla lo usara. Eso es lo que lo destapó.

export type Creados =
  | { readonly hecho: true; readonly cuantos: number }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Crea los hitos de un renglón a partir de la plantilla de su tipo de contrato.
 *
 * **La comprobación de a quién pertenece el renglón se hace AQUÍ y no se puede
 * quitar.** `crear_hitos_desde_plantilla()` es `security definer`: se salta las
 * políticas de fila. Llamarla con un identificador que llegue de un formulario sin
 * haber comprobado antes de quién es sería dejar escribir en el contrato de otro.
 *
 * Todas las condiciones se comprueban ANTES de llamarla. Un `try/catch` alrededor no
 * serviría: esto corre dentro de una transacción, y postgres vuelve a lanzar el error
 * al cerrarla aunque aquí se hubiera atrapado.
 */
export async function crearHitos(
  q: Consulta, renglonId: string, orgId: string, idioma: Idioma,
): Promise<Creados> {
  if (!/^[0-9a-f-]{36}$/i.test(renglonId)) {
    return { hecho: false, motivo: t(idioma, 'medida.error.no_existe') }
  }

  const [r] = (await q`
    select ct.tipo::text as tipo,
           (select count(*)::int from hito h where h.renglon_id = rg.id) as hitos,
           (select count(*)::int from plantilla_hito pl where pl.tipo = ct.tipo) as pasos
      from renglon rg join contrato ct on ct.id = rg.contrato_id
     where rg.id = ${renglonId}::uuid
       and ct.organizacion_id = ${orgId}::uuid
       and ct.estado = 'vigente'
  `) as unknown as Array<{ tipo: string; hitos: number; pasos: number }>

  // No existe, no es de esta organización, o su contrato no está vigente: las tres
  // contestan lo mismo. Distinguirlas diría si existe un renglón que no es tuyo.
  if (!r) return { hecho: false, motivo: t(idioma, 'medida.error.no_existe') }
  if (r.hitos > 0) return { hecho: false, motivo: t(idioma, 'medida.error.ya_tiene') }
  // Que haya plantilla, y que sume 100. Con 90, este renglón no pasaría del 90 % ni con
  // todo verificado, y no saldría ningún error en ninguna parte: saldría un contrato que
  // no avanza. Las dos cosas las contesta `plantillaUsable`, y por eso aquí ya no hay un
  // `pasos === 0` aparte: lo había, con su propio término del diccionario, y decía
  // exactamente la misma frase. Dos maneras de llegar al mismo sitio no son dos
  // cerraduras, son una cerradura y una copia que hay que acordarse de cambiar.
  const u = await plantillaUsable(q, r.tipo, idioma)
  if (!u.sirve) return { hecho: false, motivo: u.motivo }

  const [n] = (await q`
    select crear_hitos_desde_plantilla(${renglonId}::uuid) as n
  `) as unknown as Array<{ n: number }>
  return { hecho: true, cuantos: Number(n?.n ?? 0) }
}
