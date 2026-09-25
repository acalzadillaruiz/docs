/**
 * Los estados contables: lo que se le enseña a un banco, y lo que se cobra y se paga.
 *
 * Cuatro cosas que estaban construidas y probadas y no las enseñaba ninguna pantalla:
 *
 *   - **Balance general.** Es literalmente el documento que pide un banco para dar
 *     una línea de crédito. Tenerlo solo en la base de datos significa volver a
 *     armarlo en Excel cada vez que alguien lo pide.
 *   - **Balance de comprobación.** El debe y el haber de cada cuenta. Es donde mira
 *     un contador cuando algo no cuadra, y no sirve de nada si hay que pedirlo.
 *   - **Antigüedad de la cartera.** Quién debe, cuánto, y desde hace cuántos días.
 *     Una deuda de 120 días no es la misma que una de 20 aunque el importe sea igual.
 *   - **Por pagar.** Lo mismo del otro lado.
 *
 * Las dos últimas van juntas a propósito: mirar solo lo que te deben, sin mirar lo
 * que debes, es como se decide gastar un dinero que ya estaba comprometido.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, type Idioma } from '../i18n/t.ts'

export type Linea = {
  readonly codigo: string
  readonly cuenta: string
  readonly monto: string
  readonly montoCrudo: number
}

export type Seccion = {
  readonly cual: 'activo' | 'pasivo' | 'patrimonio'
  readonly lineas: readonly Linea[]
  readonly total: string
  readonly totalCrudo: number
}

export type Comprobacion = {
  readonly codigo: string
  readonly cuenta: string
  readonly debe: string
  readonly haber: string
  readonly saldo: string
}

export type Deuda = {
  readonly quien: string
  readonly referencia: string
  readonly contrato: string | null
  readonly desde: string
  readonly dias: number
  readonly saldo: string
  readonly saldoCrudo: number
  /** El tramo de antigüedad, que es lo que de verdad se mira. */
  readonly tramo: '0-30' | '31-60' | '61-90' | '90+'
}

export type Estados = {
  readonly al: string
  readonly secciones: readonly Seccion[]
  readonly comprobacion: readonly Comprobacion[]
  readonly cobrar: readonly Deuda[]
  readonly pagar: readonly Deuda[]
  readonly totalCobrar: string
  readonly totalPagar: string
  /** Activo menos pasivo y patrimonio. Si no es cero, el balance no balancea. */
  readonly descuadre: string
  readonly cuadra: boolean
}

const n = (v: unknown) => Number(v ?? 0)

function tramoDe(dias: number): Deuda['tramo'] {
  if (dias <= 30) return '0-30'
  if (dias <= 60) return '31-60'
  if (dias <= 90) return '61-90'
  return '90+'
}

export async function estados(
  q: Consulta, orgId: string, idioma: Idioma, al: string,
): Promise<Estados> {
  const balance = (await q`
    select seccion, codigo, cuenta_es, cuenta_en, monto_ves::text
      from balance_general(${orgId}::uuid, ${al}::date)
  `) as unknown as Array<Record<string, string>>

  const comp = (await q`
    select codigo, cuenta_es, cuenta_en, debe_ves::text, haber_ves::text, saldo_ves::text
      from balance_comprobacion(${orgId}::uuid, ${al}::date)
  `) as unknown as Array<Record<string, string>>

  const ant = (await q`
    select cliente, contrato, valuacion, to_char(vencida_el,'YYYY-MM-DD') as vencida_el,
           dias, saldo::text
      from antiguedad(${orgId}::uuid, ${al}::date)
  `) as unknown as Array<Record<string, string | number>>

  const pag = (await q`
    select proveedor, factura, to_char(fecha,'YYYY-MM-DD') as fecha, dias,
           saldo::text, contrato
      from por_pagar(${orgId}::uuid, ${al}::date)
  `) as unknown as Array<Record<string, string | number>>

  const nombre = (f: Record<string, string>) =>
    (idioma === 'es' ? f['cuenta_es'] : f['cuenta_en']) as string

  const seccion = (cual: Seccion['cual']): Seccion => {
    const lineas = balance.filter((f) => f['seccion'] === cual).map((f): Linea => ({
      codigo: f['codigo']!,
      cuenta: nombre(f),
      monto: moneda(idioma, n(f['monto_ves']), 'VES'),
      montoCrudo: n(f['monto_ves']),
    }))
    const total = lineas.reduce((a, l) => a + l.montoCrudo, 0)
    return { cual, lineas, total: moneda(idioma, total, 'VES'), totalCrudo: total }
  }

  const secciones = [seccion('activo'), seccion('pasivo'), seccion('patrimonio')]
  const activo = secciones[0]!.totalCrudo
  const resto = secciones[1]!.totalCrudo + secciones[2]!.totalCrudo
  const desc = activo - resto

  const cobrar = ant.map((f): Deuda => ({
    quien: String(f['cliente'] ?? ''),
    referencia: `${f['contrato'] ?? ''} · №${f['valuacion'] ?? ''}`,
    contrato: (f['contrato'] as string | null) ?? null,
    desde: String(f['vencida_el'] ?? ''),
    dias: Number(f['dias'] ?? 0),
    saldo: moneda(idioma, n(f['saldo']), 'VES'),
    saldoCrudo: n(f['saldo']),
    tramo: tramoDe(Number(f['dias'] ?? 0)),
  }))

  const pagar = pag.map((f): Deuda => ({
    quien: String(f['proveedor'] ?? ''),
    referencia: String(f['factura'] ?? ''),
    contrato: (f['contrato'] as string | null) ?? null,
    desde: String(f['fecha'] ?? ''),
    dias: Number(f['dias'] ?? 0),
    saldo: moneda(idioma, n(f['saldo']), 'VES'),
    saldoCrudo: n(f['saldo']),
    tramo: tramoDe(Number(f['dias'] ?? 0)),
  }))

  return {
    al,
    secciones,
    comprobacion: comp.map((f): Comprobacion => ({
      codigo: f['codigo']!,
      cuenta: nombre(f),
      debe: moneda(idioma, n(f['debe_ves']), 'VES'),
      haber: moneda(idioma, n(f['haber_ves']), 'VES'),
      saldo: moneda(idioma, n(f['saldo_ves']), 'VES'),
    })),
    cobrar,
    pagar,
    totalCobrar: moneda(idioma, cobrar.reduce((a, d) => a + d.saldoCrudo, 0), 'VES'),
    totalPagar: moneda(idioma, pagar.reduce((a, d) => a + d.saldoCrudo, 0), 'VES'),
    descuadre: moneda(idioma, desc, 'VES'),
    cuadra: Math.abs(desc) < 0.005,
  }
}
