/**
 * La hoja de valuación, tal como se pinta en pantalla.
 *
 * El cálculo NO está aquí: está en la base de datos, en `hoja_valuacion()`, y ya
 * tiene su prueba aritmética contra un caso hecho a mano. Repetirlo en TypeScript
 * sería tener dos verdades, y el día que difieran nadie sabría cuál vale.
 *
 * Lo que hay aquí es lo que sí es asunto de la interfaz: traducir, formatear según
 * el idioma, y decidir qué líneas ve el cliente.
 */

import type { Consulta } from '../db/conexion.ts'
import { traductor, moneda, numero, t, type Clave, type Idioma } from '../i18n/t.ts'

export type LineaHoja = {
  readonly orden: number
  readonly concepto: string
  readonly base: string | null
  readonly porcentaje: string | null
  readonly monto: string
  /** Para pintar en rojo lo que resta, sin que la pantalla tenga que interpretar el signo. */
  readonly resta: boolean
  /** La última línea, el neto, se pinta distinta. */
  readonly total: boolean
}

type FilaCruda = {
  orden: number
  /** La base de datos devuelve la clave del concepto, nunca su texto. */
  clave: Clave
  base: string | null
  porcentaje: string | null
  monto: string
  visible_cliente: boolean
}

/**
 * Lee la hoja y la deja lista para pintar.
 *
 * `paraCliente` no esconde nada que el cliente pudiera ver de todos modos: las
 * políticas de fila ya deciden si alcanza esta valuación. Aquí solo se retiran
 * las líneas que no le aportan nada, y eso es una decisión de diseño, no de
 * seguridad. La seguridad está una capa más abajo, donde no se puede olvidar.
 */
export async function hojaDeValuacion(
  q: Consulta,
  valuacionId: string,
  idioma: Idioma,
  cual: 'VES' | 'USD',
  paraCliente = false,
): Promise<readonly LineaHoja[]> {
  const filas = (await q`
    select orden, clave, base, porcentaje, monto, visible_cliente
      from hoja_valuacion(${valuacionId}::uuid)
     order by orden
  `) as unknown as FilaCruda[]

  if (filas.length === 0) {
    throw new ValuacionNoAlcanzable(valuacionId)
  }

  const ultima = Math.max(...filas.map((f) => f.orden))

  return filas
    .filter((f) => !paraCliente || f.visible_cliente)
    .map((f): LineaHoja => {
      const m = Number(f.monto)
      return {
        orden: f.orden,
        concepto: t(idioma, f.clave),
        base: f.base === null ? null : moneda(idioma, Number(f.base), cual),
        porcentaje: f.porcentaje === null ? null : `${numero(idioma, Number(f.porcentaje))} %`,
        monto: moneda(idioma, m, cual),
        resta: m < 0,
        total: f.orden === ultima,
      }
    })
}

/**
 * Cuando una valuación no aparece puede ser que no exista o que a quien pregunta
 * no le corresponda. **No se distinguen los dos casos a propósito**: decir "existe
 * pero no es tuya" ya es contar algo sobre el contrato de otro cliente.
 */
export class ValuacionNoAlcanzable extends Error {
  // Sin propiedad de parámetro: Node ejecuta TypeScript quitando los tipos, sin
  // compilarlo, y esa azúcar sintáctica generaría código que el intérprete no ve.
  readonly valuacionId: string
  constructor(valuacionId: string) {
    super('No se encuentra esa valuación')
    this.name = 'ValuacionNoAlcanzable'
    this.valuacionId = valuacionId
  }
}

export function encabezado(idioma: Idioma) {
  const t = traductor(idioma)
  return {
    titulo: t('valuacion.titulo'),
    numero: t('valuacion.numero'),
    periodo: t('valuacion.periodo'),
    neto: t('valuacion.neto'),
  }
}
