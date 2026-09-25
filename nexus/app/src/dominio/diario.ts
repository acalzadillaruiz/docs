/**
 * El libro diario y el mayor: donde termina cualquier cifra de este sistema.
 *
 * Todas las pantallas de números de esta aplicación enseñan algo DERIVADO —el
 * resultado del mes, el margen de un contrato, el ajuste de la reexpresión— y todas
 * siguen la misma regla: un total que no se puede abrir es un número que nadie se
 * cree. Esta es la pantalla donde se acaba de abrir. Debajo de un asiento no hay
 * nada: es el hecho, con sus líneas y su fecha.
 *
 * Dos cosas que se enseñan y en otros sitios no se ven:
 *
 *   - **Cuándo ocurrió y cuándo se supo.** Son dos fechas distintas y la diferencia
 *     entre ellas es la medida de «tiempo hasta la verdad» de este sistema. Un
 *     asiento de marzo registrado en junio no es un error, pero saberlo cambia lo que
 *     se piensa de las cifras de marzo.
 *   - **Si un asiento fue reversado, o si es el reverso de otro.** Un asiento no se
 *     borra ni se edita: se contrapone. Los dos se quedan en el libro, y quien mire
 *     dentro de dos años tiene que poder ver cuál es cuál.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, fecha as fechaF, type Idioma } from '../i18n/t.ts'

export type Movimiento = {
  readonly linea: number
  readonly cuenta: string
  readonly nombre: string
  readonly debe: string
  readonly haber: string
  readonly contrato: string | null
}

export type Apunte = {
  readonly id: string
  readonly numero: number
  readonly ocurrido: string
  readonly registrado: string
  /** Días entre que pasó y que se supo. Cero es lo sano; doce es un aviso. */
  readonly tardanza: number
  readonly descripcion: string
  readonly origen: string
  readonly total: string
  readonly esReverso: boolean
  readonly reversado: boolean
  readonly lineas: readonly Movimiento[]
}

export type Diario = {
  readonly anio: number
  readonly mes: number
  readonly apuntes: readonly Apunte[]
  readonly total: string
  /** Suma de todas las líneas del mes. Tiene que ser cero. */
  readonly descuadre: string
  readonly cuadra: boolean
}

const n = (v: unknown) => Number(v ?? 0)

export async function diario(
  q: Consulta, orgId: string, anio: number, mesN: number, idioma: Idioma,
): Promise<Diario> {
  const cabeceras = (await q`
    select a.id, a.numero, a.ocurrido_en, a.registrado_en,
           a.descripcion_es, a.descripcion_en, a.origen_tipo,
           (a.reversa_a is not null) as es_reverso,
           exists (select 1 from asiento r where r.reversa_a = a.id) as reversado,
           coalesce((select sum(p.monto_ves) filter (where p.monto_ves > 0)
                       from partida p where p.asiento_id = a.id), 0)::text as total
      from asiento a
     where a.organizacion_id = ${orgId}::uuid and a.anio = ${anio} and a.mes = ${mesN}
     order by a.numero
  `) as unknown as Array<Record<string, unknown>>

  const lineas = (await q`
    select p.asiento_id, p.linea, p.cuenta, c.nombre_es, c.nombre_en,
           p.monto_ves::text, ct.codigo as contrato
      from partida p
      join asiento a on a.id = p.asiento_id
      join cuenta c on c.organizacion_id = p.organizacion_id and c.codigo = p.cuenta
      left join contrato ct on ct.id = p.contrato_id
     where a.organizacion_id = ${orgId}::uuid and a.anio = ${anio} and a.mes = ${mesN}
     order by p.asiento_id, p.linea
  `) as unknown as Array<Record<string, unknown>>

  const porAsiento = new Map<string, Movimiento[]>()
  let suma = 0
  for (const l of lineas) {
    const monto = n(l['monto_ves'])
    suma += monto
    const m: Movimiento = {
      linea: Number(l['linea']),
      cuenta: l['cuenta'] as string,
      nombre: (idioma === 'es' ? l['nombre_es'] : l['nombre_en']) as string,
      // Debe positivo, haber negativo: un solo campo con signo, nunca los dos.
      debe: monto > 0 ? moneda(idioma, monto, 'VES') : '',
      haber: monto < 0 ? moneda(idioma, -monto, 'VES') : '',
      contrato: (l['contrato'] as string | null) ?? null,
    }
    const id = l['asiento_id'] as string
    porAsiento.set(id, [...(porAsiento.get(id) ?? []), m])
  }

  let total = 0
  const apuntes = cabeceras.map((a): Apunte => {
    const ocurrido = a['ocurrido_en'] as Date
    const registrado = a['registrado_en'] as Date
    total += n(a['total'])
    return {
      id: a['id'] as string,
      numero: Number(a['numero']),
      ocurrido: fechaF(idioma, ocurrido),
      registrado: fechaF(idioma, registrado),
      tardanza: Math.max(0, Math.round(
        (registrado.getTime() - ocurrido.getTime()) / 86_400_000)),
      descripcion: (idioma === 'es' ? a['descripcion_es'] : a['descripcion_en']) as string,
      origen: a['origen_tipo'] as string,
      total: moneda(idioma, n(a['total']), 'VES'),
      esReverso: a['es_reverso'] === true,
      reversado: a['reversado'] === true,
      lineas: porAsiento.get(a['id'] as string) ?? [],
    }
  })

  return {
    anio, mes: mesN, apuntes,
    total: moneda(idioma, total, 'VES'),
    descuadre: moneda(idioma, suma, 'VES'),
    cuadra: Math.abs(suma) < 0.005,
  }
}
