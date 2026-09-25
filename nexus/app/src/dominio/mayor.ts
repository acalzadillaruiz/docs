/**
 * El mayor de una cuenta: por qué el banco tiene este saldo.
 *
 * El diario recorre el TIEMPO: todo lo que pasó en un mes. El mayor recorre una
 * CUENTA: todo lo que le pasó a esa cuenta, en orden, con el saldo arrastrándose
 * línea a línea. Son las dos mitades de lo que usa un contador, y contestan preguntas
 * distintas:
 *
 *   diario → «¿qué pasó en diciembre?»
 *   mayor  → «¿por qué el banco tiene exactamente este saldo?»
 *
 * La segunda es la que se hace cuando algo no cuadra, y hasta ahora no tenía dónde
 * contestarse: había que pedirle a alguien que mirara la base de datos.
 *
 * El saldo que se arrastra viene calculado por la base de datos, no sumado aquí. Dos
 * sitios sumando lo mismo es como se acaba con dos saldos distintos para la misma
 * cuenta, y entonces nadie sabe cuál es.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, fecha as fechaF, type Idioma } from '../i18n/t.ts'

export type Movimiento = {
  readonly fecha: string
  readonly asiento: number
  readonly concepto: string
  readonly origen: string
  readonly debe: string
  readonly haber: string
  readonly saldo: string
  readonly saldoCrudo: number
}

export type CuentaBreve = {
  readonly codigo: string
  readonly nombre: string
  readonly naturaleza: string
}

export type Mayor = {
  readonly cuenta: CuentaBreve | null
  readonly desde: string
  readonly hasta: string
  readonly movimientos: readonly Movimiento[]
  readonly totalDebe: string
  readonly totalHaber: string
  readonly saldoFinal: string
  readonly saldoFinalCrudo: number
  readonly cuentas: readonly CuentaBreve[]
}

const n = (v: unknown) => Number(v ?? 0)

/** Las cuentas que de verdad tienen movimiento. Ofrecer las 80 del plan es ruido. */
export async function cuentasConMovimiento(
  q: Consulta, orgId: string, idioma: Idioma,
): Promise<readonly CuentaBreve[]> {
  const filas = (await q`
    select c.codigo, c.nombre_es, c.nombre_en, c.naturaleza::text
      from cuenta c
     where c.organizacion_id = ${orgId}::uuid
       and exists (select 1 from partida p
                    where p.organizacion_id = c.organizacion_id and p.cuenta = c.codigo)
     order by c.codigo
  `) as unknown as Array<Record<string, string>>
  return filas.map((f) => ({
    codigo: f['codigo']!,
    nombre: (idioma === 'es' ? f['nombre_es'] : f['nombre_en'])!,
    naturaleza: f['naturaleza']!,
  }))
}

export async function mayor(
  q: Consulta, orgId: string, codigo: string, desde: string, hasta: string, idioma: Idioma,
): Promise<Mayor> {
  const cuentas = await cuentasConMovimiento(q, orgId, idioma)
  const cuenta = cuentas.find((c) => c.codigo === codigo) ?? null

  if (cuenta === null) {
    return {
      cuenta: null, desde, hasta, movimientos: [],
      totalDebe: moneda(idioma, 0, 'VES'),
      totalHaber: moneda(idioma, 0, 'VES'),
      saldoFinal: moneda(idioma, 0, 'VES'),
      saldoFinalCrudo: 0,
      cuentas,
    }
  }

  const filas = (await q`
    select fecha, asiento_num, concepto, origen_tipo,
           debe_ves::text, haber_ves::text, saldo_ves::text
      from mayor(${orgId}::uuid, ${codigo}, ${desde}::date, ${hasta}::date)
  `) as unknown as Array<Record<string, unknown>>

  let debe = 0
  let haber = 0
  const movimientos = filas.map((f): Movimiento => {
    debe += n(f['debe_ves'])
    haber += n(f['haber_ves'])
    return {
      fecha: fechaF(idioma, f['fecha'] as Date),
      asiento: Number(f['asiento_num']),
      concepto: f['concepto'] as string,
      origen: f['origen_tipo'] as string,
      // La columna vacía en vez de un cero: un cero se lee como un importe.
      debe: n(f['debe_ves']) === 0 ? '' : moneda(idioma, n(f['debe_ves']), 'VES'),
      haber: n(f['haber_ves']) === 0 ? '' : moneda(idioma, n(f['haber_ves']), 'VES'),
      saldo: moneda(idioma, n(f['saldo_ves']), 'VES'),
      saldoCrudo: n(f['saldo_ves']),
    }
  })

  const ultimo = movimientos.length === 0 ? 0 : movimientos[movimientos.length - 1]!.saldoCrudo
  return {
    cuenta, desde, hasta, movimientos,
    totalDebe: moneda(idioma, debe, 'VES'),
    totalHaber: moneda(idioma, haber, 'VES'),
    saldoFinal: moneda(idioma, ultimo, 'VES'),
    saldoFinalCrudo: ultimo,
    cuentas,
  }
}
