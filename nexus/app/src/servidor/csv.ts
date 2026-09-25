/**
 * Leer una hoja de cálculo exportada.
 *
 * No se lee .xlsx. Se lee CSV, y es una decisión, no una limitación: un .xlsx es un
 * ZIP con XML dentro, hacen falta miles de líneas o una dependencia para abrirlo, y
 * lo que llega de verdad son hojas que alguien exporta. «Guardar como CSV» son dos
 * clics y deja un archivo que se puede abrir con cualquier cosa dentro de diez años.
 *
 * Lo que hay que acertar, y donde falla casi todo lo que lee CSV a mano:
 *
 *   1. EL SEPARADOR. Excel en español usa punto y coma, porque la coma ya es el
 *      separador decimal. Excel en inglés usa coma. Adivinarlo mal parte «1.234,56»
 *      en dos columnas, y el número que se importa es otro.
 *
 *   2. LAS COMILLAS. Un campo entrecomillado puede llevar dentro el separador, un
 *      salto de línea y comillas dobladas. La descripción de un renglón petrolero
 *      lleva comillas casi siempre: `Cabezal 11" 5M`.
 *
 *   3. EL BOM. Excel escribe tres bytes invisibles al principio del archivo. Si no
 *      se quitan, la primera cabecera nunca coincide con nada y nadie entiende por
 *      qué solo falla la primera columna.
 */

export type Hoja = {
  readonly separador: ',' | ';' | '\t'
  readonly filas: readonly (readonly string[])[]
}

/**
 * Qué separa las columnas, deducido de las primeras líneas.
 *
 * Se cuenta fuera de las comillas: una descripción con un punto y coma dentro no
 * debe decidir el formato del archivo entero.
 */
export function separadorDe(texto: string): ',' | ';' | '\t' {
  const muestra = texto.slice(0, 8192)
  const cuenta = { ',': 0, ';': 0, '\t': 0 }
  let dentro = false
  for (let i = 0; i < muestra.length; i++) {
    const c = muestra[i]!
    if (c === '"') { dentro = !dentro; continue }
    if (dentro) continue
    if (c === ',' || c === ';' || c === '\t') cuenta[c]++
  }
  // El punto y coma gana los empates: en español es lo normal, y equivocarse hacia
  // la coma parte los números en dos.
  if (cuenta[';'] >= cuenta[','] && cuenta[';'] >= cuenta['\t'] && cuenta[';'] > 0) return ';'
  if (cuenta['\t'] > cuenta[','] && cuenta['\t'] > 0) return '\t'
  return ','
}

/** Quita los tres bytes invisibles que Excel escribe al principio. */
export function sinBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto
}

export class HojaVacia extends Error {
  constructor() {
    super('la hoja no tiene ninguna fila con datos')
    this.name = 'HojaVacia'
  }
}

export type Limites = { readonly maxFilas: number; readonly maxColumnas: number }
export const LIMITES_HOJA: Limites = { maxFilas: 20_000, maxColumnas: 120 }

export class HojaDemasiadoGrande extends Error {
  constructor(que: string, cuantas: number) {
    super(`la hoja tiene demasiadas ${que}: ${cuantas}`)
    this.name = 'HojaDemasiadoGrande'
  }
}

/**
 * Parte la hoja en filas y columnas.
 *
 * Se recorre carácter a carácter y no con una expresión regular a propósito: las
 * expresiones regulares para CSV o no manejan el salto de línea dentro de comillas,
 * o son ilegibles, o las dos cosas.
 */
export function leerHoja(
  crudo: string, separador?: ',' | ';' | '\t', limites: Limites = LIMITES_HOJA,
): Hoja {
  const texto = sinBom(crudo)
  const sep = separador ?? separadorDe(texto)

  const filas: string[][] = []
  let fila: string[] = []
  let celda = ''
  let entrecomillado = false

  const cerrarCelda = () => {
    if (fila.length >= limites.maxColumnas) {
      throw new HojaDemasiadoGrande('columnas', fila.length + 1)
    }
    fila.push(celda)
    celda = ''
  }
  const cerrarFila = () => {
    cerrarCelda()
    // Una fila que es solo celdas vacías no es una fila: las hojas llevan huecos.
    if (fila.some((c) => c.trim() !== '')) {
      if (filas.length >= limites.maxFilas) {
        throw new HojaDemasiadoGrande('filas', filas.length + 1)
      }
      filas.push(fila)
    }
    fila = []
  }

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!
    if (entrecomillado) {
      if (c === '"') {
        // Dos comillas seguidas dentro de comillas son una comilla de verdad. Es la
        // forma en que un `Cabezal 11" 5M` sobrevive al viaje por la hoja.
        if (texto[i + 1] === '"') { celda += '"'; i++ }
        else entrecomillado = false
      } else celda += c
      continue
    }
    if (c === '"' && celda === '') { entrecomillado = true; continue }
    if (c === sep) { cerrarCelda(); continue }
    if (c === '\r') continue
    if (c === '\n') { cerrarFila(); continue }
    celda += c
  }
  // Lo que quede sin cerrar es la última fila, si el archivo no termina en salto.
  if (celda !== '' || fila.length > 0) cerrarFila()

  if (filas.length === 0) throw new HojaVacia()
  return { separador: sep, filas }
}

/**
 * Un número escrito a la venezolana o a la anglosajona.
 *
 * `1.234,56` son mil doscientos treinta y cuatro con cincuenta y seis en una hoja
 * española, y uno coma dos tres cuatro en una inglesa. No se adivina: se declara al
 * mapear la columna. Esto solo aplica el formato declarado.
 *
 * Devuelve null si no se puede leer. Nunca devuelve cero: un cero silencioso es un
 * importe que entra mal y nadie ve.
 */
export function leerNumero(texto: string, formato: 'ven' | 'ang'): number | null {
  const limpio = texto.trim().replace(/\s| /g, '')
  if (limpio === '') return null
  // Un paréntesis alrededor es un negativo en contabilidad: (1.234,56).
  const negativo = /^\(.*\)$/.test(limpio) || limpio.startsWith('-')
  const cuerpo = limpio.replace(/^[-(]/, '').replace(/\)$/, '')
  if (!/^[\d.,]+$/.test(cuerpo)) return null

  const normal = formato === 'ven'
    ? cuerpo.replace(/\./g, '').replace(',', '.')
    : cuerpo.replace(/,/g, '')
  if (!/^\d*\.?\d*$/.test(normal) || normal === '' || normal === '.') return null

  const n = Number(normal)
  if (!Number.isFinite(n)) return null
  return negativo ? -n : n
}

/**
 * Una fecha escrita como la escribe la gente.
 *
 * `03/04/2026` es el tres de abril en una hoja española y el cuatro de marzo en una
 * inglesa. Tampoco se adivina: el formato se declara al mapear.
 */
export function leerFecha(texto: string, formato: 'dmy' | 'mdy' | 'iso'): string | null {
  const t = texto.trim()
  if (t === '') return null

  if (formato === 'iso') {
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(t)
    return m ? armar(Number(m[1]), Number(m[2]), Number(m[3])) : null
  }
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(t)
  if (!m) return null
  const a = Number(m[1]), b = Number(m[2])
  let anio = Number(m[3])
  // Un año de dos cifras se completa al siglo en curso. No hay facturas de 1926.
  if (anio < 100) anio += 2000
  return formato === 'dmy' ? armar(anio, b, a) : armar(anio, a, b)
}

function armar(anio: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  // La fecha se comprueba de verdad: el 31 de febrero no existe aunque se escriba.
  const d = new Date(Date.UTC(anio, mes - 1, dia))
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}
