/**
 * Leer un formulario con archivo, sin armazón.
 *
 * Es la pieza más delicada del servidor después del camino de entrada, porque es lo
 * único que acepta bytes arbitrarios de fuera. Por eso está escrita aquí y no traída
 * de una dependencia: son ciento y pico líneas, el formato lleva congelado desde
 * 1998 (RFC 7578), y el día que algo falle a las tres de la madrugada conviene poder
 * leerlo entero.
 *
 * Lo que impone, y ninguna de las tres es opcional:
 *
 *   1. UN TECHO DE BYTES, comprobado mientras llegan y no al final. Comprobarlo al
 *      final significa haberse comido ya el archivo entero en memoria, que es
 *      exactamente lo que se quería evitar.
 *
 *   2. UN TECHO DE PARTES. Sin él, un cuerpo pequeño con cien mil partes vacías
 *      cuesta más en tiempo que uno grande.
 *
 *   3. EL NOMBRE DEL ARCHIVO SE LIMPIA, siempre. Llega tal cual del navegador, así
 *      que puede traer barras, puntos dobles o un nombre de dispositivo de Windows.
 *      Aquí el nombre es solo una etiqueta — la identidad del documento es su huella
 *      — pero aunque no se use para abrir nada, acaba escrito en una página y en una
 *      cabecera, y eso ya es suficiente para limpiarlo.
 */

export type Parte =
  | { readonly clase: 'campo'; readonly nombre: string; readonly valor: string }
  | {
      readonly clase: 'archivo'
      readonly nombre: string
      readonly archivo: string
      readonly tipoMime: string
      readonly contenido: Uint8Array
    }

export class MultipartMalFormado extends Error {
  constructor(motivo: string) {
    super(`el formulario no se entiende: ${motivo}`)
    this.name = 'MultipartMalFormado'
  }
}

export class DemasiadoGrande extends Error {
  readonly bytes: number
  constructor(bytes: number) {
    super('el archivo pasa del tamaño permitido')
    this.name = 'DemasiadoGrande'
    this.bytes = bytes
  }
}

/** La frontera que separa las partes. Viene en el tipo de contenido de la petición. */
export function frontera(tipoContenido: string | undefined): string | null {
  if (!tipoContenido) return null
  if (!tipoContenido.toLowerCase().startsWith('multipart/form-data')) return null
  // Puede venir entre comillas, y puede llevar otros parámetros delante o detrás.
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(tipoContenido)
  const valor = m?.[1] ?? m?.[2]
  return valor ? valor : null
}

/**
 * El nombre del archivo, reducido a algo que se pueda enseñar sin peligro.
 *
 * No se conserva la ruta: un navegador no debería mandarla, pero alguno la manda y
 * un cliente hecho a mano manda lo que quiera. De `../../etc/passwd` queda `passwd`.
 */
export function nombreLimpio(crudo: string): string {
  const soloNombre = crudo.split(/[/\\]/).pop() ?? ''
  const limpio = soloNombre
    // Los de control incluyen el salto de línea, que en una cabecera permitiría
    // inyectar otra cabecera entera.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
  return limpio.slice(0, 120) || 'documento'
}

const CRLF = Buffer.from('\r\n')

function posicion(dentro: Buffer, busca: Buffer, desde: number): number {
  return dentro.indexOf(busca, desde)
}

export type Limites = {
  /** Techo de bytes del cuerpo entero. */
  readonly maxBytes: number
  readonly maxPartes: number
}

export const LIMITES: Limites = { maxBytes: 25 * 1024 * 1024, maxPartes: 24 }

/**
 * Parte un cuerpo `multipart/form-data` ya leído.
 *
 * Recibe el cuerpo entero y no un flujo, y eso es una decisión con fecha de
 * caducidad: con el techo de 25 MB de ahora es asumible, y a cambio el código cabe
 * de una vez en la cabeza. El día que haya que aceptar vídeo del patio habrá que
 * escribirlo por trozos, y ese día esta nota dirá por qué no se hizo ya.
 */
export function partir(cuerpo: Buffer, laFrontera: string, limites: Limites = LIMITES): Parte[] {
  if (cuerpo.length > limites.maxBytes) throw new DemasiadoGrande(cuerpo.length)

  const sep = Buffer.from(`--${laFrontera}`)
  let i = posicion(cuerpo, sep, 0)
  if (i < 0) throw new MultipartMalFormado('no aparece la frontera')

  const partes: Parte[] = []
  while (i >= 0) {
    i += sep.length
    // `--` justo después de la frontera marca el final del cuerpo.
    if (cuerpo.slice(i, i + 2).toString() === '--') break
    // Y un salto de línea marca que empieza otra parte.
    const finCabeceras = posicion(cuerpo, Buffer.from('\r\n\r\n'), i)
    if (finCabeceras < 0) throw new MultipartMalFormado('una parte no tiene cabeceras')

    const cabeceras = cuerpo.slice(i, finCabeceras).toString('utf-8')
    const siguiente = posicion(cuerpo, sep, finCabeceras)
    if (siguiente < 0) throw new MultipartMalFormado('una parte no termina')

    // El CRLF que va justo antes de la frontera siguiente pertenece a la frontera,
    // no al contenido. Sin quitarlo, todo archivo subido saldría dos bytes más largo
    // y con la huella cambiada — y una huella mal calculada aquí rompe la identidad
    // del documento, que es lo único en lo que se apoya el resto.
    let fin = siguiente
    if (cuerpo.slice(fin - 2, fin).equals(CRLF)) fin -= 2

    const contenido = cuerpo.slice(finCabeceras + 4, fin)

    const nombre = /name="([^"]*)"/i.exec(cabeceras)?.[1]
    if (nombre === undefined) throw new MultipartMalFormado('una parte no dice cómo se llama')
    const archivo = /filename="([^"]*)"/i.exec(cabeceras)?.[1]

    if (archivo === undefined) {
      partes.push({ clase: 'campo', nombre, valor: contenido.toString('utf-8') })
    } else {
      partes.push({
        clase: 'archivo',
        nombre,
        archivo: nombreLimpio(archivo),
        tipoMime: (/content-type:\s*([^\r\n;]+)/i.exec(cabeceras)?.[1] ?? '').trim()
          || 'application/octet-stream',
        contenido: new Uint8Array(contenido),
      })
    }

    if (partes.length > limites.maxPartes) {
      throw new MultipartMalFormado(`más de ${limites.maxPartes} partes`)
    }
    i = siguiente
  }

  return partes
}

/** Los campos de texto, por nombre. Es lo que espera el resto del servidor. */
export function campos(partes: readonly Parte[]): Record<string, string> {
  const r: Record<string, string> = {}
  for (const p of partes) if (p.clase === 'campo') r[p.nombre] = p.valor
  return r
}

/** El primer archivo con ese nombre de campo, si vino alguno con contenido. */
export function archivo(partes: readonly Parte[], nombre: string):
  Extract<Parte, { clase: 'archivo' }> | null {
  for (const p of partes) {
    if (p.clase === 'archivo' && p.nombre === nombre && p.contenido.length > 0) return p
  }
  return null
}
