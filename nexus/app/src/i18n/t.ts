/**
 * Traducción.
 *
 * Ningún texto se escribe dentro de una pantalla: todo sale del diccionario.
 * `comprobar.py` ya garantiza que las dos versiones tengan las mismas claves;
 * aquí el tipo `Clave` hace que TypeScript rechace una clave que no exista,
 * de modo que una errata se ve al escribir el código y no en producción.
 */

import es from '../../../i18n/es.json' with { type: 'json' }
import en from '../../../i18n/en.json' with { type: 'json' }

export type Idioma = 'es' | 'en'
export type Clave = keyof typeof es

const DICCIONARIOS: Record<Idioma, Record<string, string>> = { es, en }

/** El texto de `clave` en `idioma`. */
export function t(idioma: Idioma, clave: Clave): string {
  const d = DICCIONARIOS[idioma]
  const texto = d[clave as string]
  if (texto === undefined) {
    // No se devuelve la clave disfrazada de texto: eso hace que un olvido pase
    // desapercibido en pantalla. Se devuelve algo que salta a la vista.
    return `‹falta: ${clave}›`
  }
  return texto
}

/** Un traductor ya atado a un idioma, para no repetirlo en cada línea. */
export function traductor(idioma: Idioma): (clave: Clave) => string {
  return (clave) => t(idioma, clave)
}

/**
 * Formato de número según el idioma. En español venezolano el separador de miles
 * es el punto y el decimal la coma; en inglés al revés. Escribir 1.234,56 donde
 * se espera 1,234.56 no es un detalle estético en una factura.
 */
export function numero(idioma: Idioma, valor: number, decimales = 2): string {
  return new Intl.NumberFormat(idioma === 'es' ? 'es-VE' : 'en-US', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valor)
}

export function moneda(idioma: Idioma, valor: number, cual: 'VES' | 'USD'): string {
  return new Intl.NumberFormat(idioma === 'es' ? 'es-VE' : 'en-US', {
    style: 'currency',
    currency: cual,
    minimumFractionDigits: 2,
  }).format(valor)
}

export function fecha(idioma: Idioma, valor: Date): string {
  return new Intl.DateTimeFormat(idioma === 'es' ? 'es-VE' : 'en-US', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(valor)
}
