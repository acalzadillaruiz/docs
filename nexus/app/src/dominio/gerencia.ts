/**
 * «¿Cómo va el mes?», en una sola pantalla.
 *
 * Todo lo que hay aquí debajo estaba construido y probado desde hace meses —margen,
 * rentabilidad por cliente y por servicio, ejecutado sin cobrar, flujo de caja,
 * estado de resultados— y **no lo usaba ninguna pantalla**. Estaba en la base de
 * datos, que es como no tenerlo: el CFO sigue con su Excel.
 *
 * El orden en que se enseña no es decorativo. Contesta, por ese orden, las tres
 * preguntas que de verdad se hacen a fin de mes:
 *
 *   1. **¿Ganamos o perdimos?** — el resultado del mes.
 *   2. **¿Y dónde está el dinero?** — porque un mes bueno puede no tener caja. Eso
 *      es lo ejecutado sin cobrar, y es la cifra que lo explica.
 *   3. **¿Qué nos deja dinero y qué nos lo quita?** — por cliente y por servicio.
 *
 * Nada de esto lo ve nunca el cliente. Es la contabilidad de GPS.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, type Idioma } from '../i18n/t.ts'

export type Resultado = {
  readonly ingresos: string
  readonly gastos: string
  readonly resultado: string
  readonly resultadoCrudo: number
  readonly resultadoUsd: string
}

export type Fila = {
  readonly nombre: string
  readonly contratos: number
  readonly valuado: string
  readonly costo: string
  readonly margen: string
  readonly margenPct: number
}

export type Semana = {
  readonly semana: string
  readonly entra: string
  readonly sale: string
  readonly neto: string
  readonly netoCrudo: number
}

export type LineaPyG = {
  readonly seccion: 'ingresos' | 'gastos'
  readonly codigo: string
  readonly cuenta: string
  readonly monto: string
}

export type Contrato = {
  readonly contrato: string
  readonly cliente: string
  readonly estado: string
  readonly valuado: string
  readonly costo: string
  readonly margen: string
  readonly margenPct: number
}

export type Mes = {
  readonly anio: number
  readonly mes: number
  readonly desde: string
  readonly hasta: string
  readonly resultado: Resultado
  readonly sinCobrar: string
  readonly sinCobrarCrudo: number
  readonly porCliente: readonly Fila[]
  readonly porServicio: readonly Fila[]
  readonly semanas: readonly Semana[]
  /** El resultado abierto cuenta por cuenta: de dónde sale cada bolívar. */
  readonly pyg: readonly LineaPyG[]
  /** La cartera contrato por contrato, ordenada por lo que más duele. */
  readonly contratos: readonly Contrato[]
  /** Si el libro no cuadra, todo lo de arriba vale menos. Se dice antes que nada. */
  readonly descuadre: string
  readonly cuadra: boolean
}

const n = (v: unknown) => Number(v ?? 0)

export async function mes(
  q: Consulta, orgId: string, anio: number, mesN: number, idioma: Idioma,
): Promise<Mes> {
  const desde = `${anio}-${String(mesN).padStart(2, '0')}-01`
  const hasta = new Date(Date.UTC(anio, mesN, 0)).toISOString().slice(0, 10)

  const [r] = (await q`
    select ingresos_ves::text, gastos_ves::text, resultado_ves::text, resultado_usd::text
      from resultado_neto(${orgId}::uuid, ${desde}::date, ${hasta}::date)
  `) as unknown as Array<Record<string, string>>

  const [sc] = (await q`
    select ejecutado_sin_cobrar(${orgId}::uuid, ${hasta}::date)::text as v
  `) as unknown as Array<{ v: string }>

  const [d] = (await q`
    select ves::text from descuadre(${orgId}::uuid, ${hasta}::date)
  `) as unknown as Array<{ ves: string }>

  const clientes = (await q`
    select cliente, contratos, valuado::text, costo::text, margen::text, margen_pct::text
      from rentabilidad_por_cliente(${orgId}::uuid, ${desde}::date, ${hasta}::date)
  `) as unknown as Array<Record<string, string | number>>

  const servicios = (await q`
    select tipo::text, contratos, valuado::text, costo::text, margen::text, margen_pct::text
      from rentabilidad_por_servicio(${orgId}::uuid, ${desde}::date, ${hasta}::date)
  `) as unknown as Array<Record<string, string | number>>

  // Ocho semanas: dos meses vista. Más allá, lo que se proyecta es adivinar.
  const flujo = (await q`
    select to_char(semana,'YYYY-MM-DD') as semana, entra::text, sale::text, neto::text
      from flujo_caja(${orgId}::uuid, ${hasta}::date, 8)
  `) as unknown as Array<Record<string, string>>

  // El resultado, abierto cuenta por cuenta. Un total sin poder abrirlo es un número
  // que nadie se cree, igual que el ajuste de la reexpresión.
  const pyg = (await q`
    select seccion, codigo, cuenta_es, cuenta_en, monto_ves::text
      from estado_resultados(${orgId}::uuid, ${desde}::date, ${hasta}::date)
  `) as unknown as Array<Record<string, string>>

  // Y la cartera contrato por contrato. `margen_cartera` ya viene ordenada por el
  // margen ascendente: lo que más duele, primero. Eso es deliberado y se respeta.
  const cartera = (await q`
    select contrato, cliente, estado::text, valuado::text, costo::text,
           margen::text, margen_pct::text
      from margen_cartera(${orgId}::uuid, ${hasta}::date)
  `) as unknown as Array<Record<string, string>>

  const aFila = (f: Record<string, string | number>, clave: string): Fila => ({
    nombre: String(f[clave] ?? ''),
    contratos: Number(f['contratos'] ?? 0),
    valuado: moneda(idioma, n(f['valuado']), 'VES'),
    costo: moneda(idioma, n(f['costo']), 'VES'),
    margen: moneda(idioma, n(f['margen']), 'VES'),
    margenPct: n(f['margen_pct']),
  })

  return {
    anio, mes: mesN, desde, hasta,
    resultado: {
      ingresos: moneda(idioma, n(r?.['ingresos_ves']), 'VES'),
      gastos: moneda(idioma, n(r?.['gastos_ves']), 'VES'),
      resultado: moneda(idioma, n(r?.['resultado_ves']), 'VES'),
      resultadoCrudo: n(r?.['resultado_ves']),
      resultadoUsd: moneda(idioma, n(r?.['resultado_usd']), 'USD'),
    },
    sinCobrar: moneda(idioma, n(sc?.v), 'VES'),
    sinCobrarCrudo: n(sc?.v),
    porCliente: clientes.map((f) => aFila(f, 'cliente')),
    porServicio: servicios.map((f) => aFila(f, 'tipo')),
    semanas: flujo.map((f): Semana => ({
      semana: String(f['semana']),
      entra: moneda(idioma, n(f['entra']), 'VES'),
      sale: moneda(idioma, n(f['sale']), 'VES'),
      neto: moneda(idioma, n(f['neto']), 'VES'),
      netoCrudo: n(f['neto']),
    })),
    pyg: pyg.map((f): LineaPyG => ({
      seccion: f['seccion'] === 'ingresos' ? 'ingresos' : 'gastos',
      codigo: f['codigo']!,
      cuenta: (idioma === 'es' ? f['cuenta_es'] : f['cuenta_en'])!,
      monto: moneda(idioma, n(f['monto_ves']), 'VES'),
    })),
    contratos: cartera.map((f): Contrato => ({
      contrato: f['contrato']!,
      cliente: f['cliente']!,
      estado: f['estado']!,
      valuado: moneda(idioma, n(f['valuado']), 'VES'),
      costo: moneda(idioma, n(f['costo']), 'VES'),
      margen: moneda(idioma, n(f['margen']), 'VES'),
      margenPct: n(f['margen_pct']),
    })),
    descuadre: moneda(idioma, n(d?.ves), 'VES'),
    cuadra: Math.abs(n(d?.ves)) < 0.005,
  }
}
