/**
 * Dar de alta un contrato.
 *
 * Es el agujero más grande que quedaba: todo lo construido —el avance, la evidencia,
 * las valuaciones, las medidas— funcionaba sobre contratos que solo podían entrar
 * tocando la base de datos a mano.
 *
 * Cuatro decisiones:
 *
 *   1. EL MONTO SE CALCULA, no se teclea. Es la suma de los renglones. Un monto
 *      tecleado aparte empieza cuadrando y deja de cuadrar el día que alguien
 *      corrige un renglón — y entonces hay dos verdades sobre cuánto vale el
 *      contrato, que es exactamente lo que este sistema existe para evitar.
 *
 *   2. NACE EN BORRADOR, siempre. Un contrato que naciera vigente sería visible para
 *      el cliente en el mismo instante en que alguien pulsa «crear», erratas
 *      incluidas. Ponerlo vigente es un segundo acto deliberado.
 *
 *   3. LOS HITOS SE CREAN AQUÍ MISMO, en la misma transacción. Un contrato sin hitos
 *      tiene avance cero, el mismo cero que uno que no ha empezado. Dejar el paso
 *      para después es dejar que se olvide.
 *
 *   4. TODO SE VALIDA ANTES DE ESCRIBIR NADA, y los errores salen TODOS juntos. Ir
 *      devolviendo el primero obliga a rellenar el formulario seis veces, y a la
 *      tercera se abre Excel.
 */

import type { Consulta } from '../db/conexion.ts'
import { t, type Clave, type Idioma } from '../i18n/t.ts'

export type TipoContrato =
  | 'procura' | 'servicio' | 'reacondicionamiento' | 'transporte' | 'alquiler'

export const TIPOS: readonly TipoContrato[] = [
  'procura', 'servicio', 'reacondicionamiento', 'transporte', 'alquiler',
]

export type RenglonNuevo = {
  readonly descripcionEs: string
  readonly descripcionEn: string
  readonly cantidad: number
  readonly unidad: string
  readonly norma: string | null
  readonly especificacion: string | null
  readonly precioUnitario: number
  readonly costoUnitario: number | null
}

export type ContratoNuevo = {
  readonly clienteId: string
  readonly codigo: string
  readonly tipo: TipoContrato
  readonly tituloEs: string
  readonly tituloEn: string
  readonly moneda: 'VES' | 'USD'
  readonly firmadoEl: string | null
  readonly inicio: string | null
  readonly finPrevisto: string | null
  readonly anticipoPct: number
  readonly amortizaPct: number
  readonly garantiaPct: number
  readonly renglones: readonly RenglonNuevo[]
}

export type Alta =
  | { readonly hecho: true; readonly contratoId: string; readonly hitos: number }
  | { readonly hecho: false; readonly errores: readonly string[] }

/**
 * Lo que está mal, TODO junto y en el idioma de quien mira.
 *
 * Devolver una lista y no el primer error no es cortesía: un formulario de contrato
 * tiene veinte campos, y quien lo rellena está mirando un PDF firmado en otra
 * ventana. Seis viajes de ida y vuelta es cuando se abandona y se vuelve a Excel.
 */
function revisar(c: ContratoNuevo, idioma: Idioma): string[] {
  const malo: string[] = []
  const falta = (v: string) => v.trim() === ''

  if (falta(c.clienteId)) malo.push(t(idioma, 'alta.error.cliente'))
  if (falta(c.codigo) || falta(c.tituloEs) || falta(c.tituloEn)) {
    malo.push(t(idioma, 'alta.error.campo'))
  }
  if (!TIPOS.includes(c.tipo)) malo.push(t(idioma, 'alta.error.campo'))
  if (c.renglones.length === 0) malo.push(t(idioma, 'alta.error.renglones'))

  for (const r of c.renglones) {
    if (falta(r.descripcionEs) || falta(r.descripcionEn) || falta(r.unidad) ||
        !(r.cantidad > 0) || !(r.precioUnitario >= 0)) {
      malo.push(t(idioma, 'alta.error.campo'))
      break
    }
  }

  if (c.inicio && c.finPrevisto && c.finPrevisto < c.inicio) {
    malo.push(t(idioma, 'alta.error.fechas'))
  }
  // Un anticipo sin ritmo de amortización es dinero recibido que no se descuenta de
  // ninguna valuación: se queda cobrado dos veces hasta que alguien lo note.
  if (c.anticipoPct > 0 && c.amortizaPct <= 0) malo.push(t(idioma, 'alta.error.amortiza'))
  for (const p of [c.anticipoPct, c.amortizaPct, c.garantiaPct]) {
    if (!(p >= 0 && p <= 100)) { malo.push(t(idioma, 'alta.error.campo')); break }
  }
  return [...new Set(malo)]
}

export async function crearContrato(
  q: Consulta, c: ContratoNuevo, personaId: string, orgId: string, idioma: Idioma,
): Promise<Alta> {
  const errores = revisar(c, idioma)

  // El código repetido se pregunta a la base de datos, no se adivina. La restricción
  // de unicidad sigue ahí: esto solo sirve para decirlo antes y en castellano.
  if (errores.length === 0) {
    const [ya] = (await q`
      select 1 as x from contrato
       where organizacion_id = ${orgId}::uuid and codigo = ${c.codigo.trim()}
    `) as unknown as Array<{ x: number }>
    if (ya) errores.push(t(idioma, 'alta.error.codigo'))
  }

  // La tasa del día se congela al crear. Sin ella no hay contrato: un monto sin tasa
  // es un número sin unidad en cuanto pasan dos semanas.
  let tasaId = ''
  if (errores.length === 0) {
    const [tasa] = (await q`
      select id from tasa_bcv where vigente_el <= current_date
       order by vigente_el desc limit 1
    `) as unknown as Array<{ id: string }>
    if (!tasa) errores.push(t(idioma, 'alta.error.tasa'))
    else tasaId = tasa.id
  }

  if (errores.length > 0) return { hecho: false, errores }

  // El monto sale de los renglones. Aquí, y no en un campo del formulario.
  const monto = c.renglones.reduce((s, r) => s + r.cantidad * r.precioUnitario, 0)
  if (!(monto > 0)) {
    return { hecho: false, errores: [t(idioma, 'alta.error.renglones')] }
  }

  const [contrato] = (await q`
    insert into contrato (organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                          estado, moneda, monto, tasa_id, firmado_el, inicio, fin_previsto,
                          anticipo_pct, amortiza_pct, garantia_pct, creado_por)
    values (${orgId}::uuid, ${c.clienteId}::uuid, ${c.codigo.trim()}, ${c.tipo},
            ${c.tituloEs.trim()}, ${c.tituloEn.trim()}, 'borrador', ${c.moneda},
            ${monto.toFixed(2)}, ${tasaId}::uuid,
            ${c.firmadoEl || null}, ${c.inicio || null}, ${c.finPrevisto || null},
            ${c.anticipoPct}, ${c.amortizaPct}, ${c.garantiaPct}, ${personaId}::uuid)
    returning id
  `) as unknown as Array<{ id: string }>

  let hitos = 0
  let numero = 0
  for (const r of c.renglones) {
    numero++
    const [fila] = (await q`
      insert into renglon (contrato_id, numero, descripcion_es, descripcion_en,
                           cantidad, unidad, norma, especificacion,
                           precio_unitario, costo_unitario)
      values (${contrato!.id}::uuid, ${numero}, ${r.descripcionEs.trim()},
              ${r.descripcionEn.trim()}, ${r.cantidad}, ${r.unidad.trim()},
              ${r.norma?.trim() || null}, ${r.especificacion?.trim() || null},
              ${r.precioUnitario}, ${r.costoUnitario ?? null})
      returning id
    `) as unknown as Array<{ id: string }>

    // En la misma transacción. Un contrato sin hitos tiene avance cero, el mismo
    // cero que uno que no ha empezado, y dejar el paso para después es dejar que
    // se olvide.
    const [n] = (await q`
      select crear_hitos_desde_plantilla(${fila!.id}::uuid) as n
    `) as unknown as Array<{ n: number }>
    hitos += Number(n?.n ?? 0)
  }

  return { hecho: true, contratoId: contrato!.id, hitos }
}

export type ClienteBreve = { readonly id: string; readonly nombre: string; readonly rif: string }

/** Las operadoras que ya existen. No se crea una empresa desde aquí. */
export async function clientes(q: Consulta): Promise<readonly ClienteBreve[]> {
  return (await q`
    select id, nombre, rif from organizacion where tipo = 'operadora' order by nombre
  `) as unknown as ClienteBreve[]
}

export function nombreTipo(idioma: Idioma, tipo: TipoContrato): string {
  return t(idioma, `contrato.tipo.${tipo}` as Clave)
}

export type Cambio =
  | { readonly hecho: true }
  | { readonly hecho: false; readonly motivo: 'no_alcanzable' | 'estado_equivocado' | 'sin_hitos' }

/**
 * Poner un contrato en vigor.
 *
 * Es el segundo acto deliberado: hasta aquí el contrato era un borrador que el
 * cliente no veía, erratas incluidas. Al pasar a vigente aparece en su portal.
 *
 * No se deja poner vigente un contrato cuyos renglones no tengan hitos. Sería un
 * contrato que el cliente ve con avance cero y que se va a quedar en cero para
 * siempre, y nadie entendería por qué.
 *
 * La condición del estado va DENTRO del update, no en un `if` de arriba: entre la
 * consulta y la escritura cabe otra petición.
 */
export async function activar(
  q: Consulta, contratoId: string, orgId: string,
): Promise<Cambio> {
  const [c] = (await q`
    select estado::text from contrato
     where id = ${contratoId}::uuid and organizacion_id = ${orgId}::uuid
  `) as unknown as Array<{ estado: string }>
  if (!c) return { hecho: false, motivo: 'no_alcanzable' }
  if (c.estado !== 'borrador') return { hecho: false, motivo: 'estado_equivocado' }

  const [sin] = (await q`
    select count(*)::int as n from renglon rg
     where rg.contrato_id = ${contratoId}::uuid
       and not exists (select 1 from hito h where h.renglon_id = rg.id)
  `) as unknown as Array<{ n: number }>
  if (Number(sin?.n ?? 0) > 0) return { hecho: false, motivo: 'sin_hitos' }

  const filas = await q`
    update contrato set estado = 'vigente'
     where id = ${contratoId}::uuid and organizacion_id = ${orgId}::uuid
       and estado = 'borrador'
    returning id`
  return filas.length === 1 ? { hecho: true } : { hecho: false, motivo: 'estado_equivocado' }
}
