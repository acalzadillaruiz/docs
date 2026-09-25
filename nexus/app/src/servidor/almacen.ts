/**
 * Dónde viven los bytes.
 *
 * El documento se guarda bajo su propia huella, no bajo su nombre. Tres cosas se
 * siguen de ahí, y las tres importan:
 *
 *   - El mismo documento subido dos veces ocupa una vez. En procura eso no es un
 *     detalle: el mismo certificado de colada acompaña a las cuatro válvulas del
 *     mismo lote, y hoy se sube cuatro veces.
 *   - Comprobar que un documento no se ha cambiado es volver a calcular su huella.
 *     No hace falta confiar en nadie ni guardar una firma aparte.
 *   - Renombrar no existe. Un nombre es una etiqueta que se escribe al lado; el
 *     documento es sus bytes.
 *
 * Se parte la huella en dos niveles de directorio porque cien mil archivos en una
 * sola carpeta hace lenta hasta la orden de listarla.
 *
 * Esto es un almacén de archivos en disco, a propósito: es lo que se puede poner a
 * andar hoy en el mismo servidor. El día que haga falta S3 o equivalente, cambia
 * este archivo y nada más — el resto del sistema solo conoce huellas.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export class HuellaInvalida extends Error {
  constructor() {
    super('eso no es una huella SHA-256')
    this.name = 'HuellaInvalida'
  }
}

export class DocumentoAusente extends Error {
  constructor() {
    super('el documento no está en el almacén')
    this.name = 'DocumentoAusente'
  }
}

const ES_HUELLA = /^[0-9a-f]{64}$/

/**
 * La ruta de una huella dentro del almacén.
 *
 * La huella se valida antes de tocarla, y no por desconfiar del código de al lado:
 * esta función acaba construyendo una ruta, y una ruta armada con texto que viene
 * de fuera es la forma clásica de leer un archivo que no toca. Con la comprobación
 * puesta, `..` no es una huella y no llega aquí.
 */
export function rutaDe(raiz: string, huella: string): string {
  if (!ES_HUELLA.test(huella)) throw new HuellaInvalida()
  const completa = resolve(join(raiz, huella.slice(0, 2), huella.slice(2, 4), huella))
  // Cinturón y tirantes: aunque la comprobación de arriba ya lo impide, se verifica
  // que lo construido cae dentro de la raíz. Las dos cosas tendrían que fallar a la
  // vez para que algo se escapara.
  const base = resolve(raiz)
  if (!completa.startsWith(base + '/')) throw new HuellaInvalida()
  return completa
}

export class Almacen {
  readonly raiz: string

  constructor(raiz: string) {
    this.raiz = resolve(raiz)
  }

  /**
   * Guarda los bytes y devuelve su huella.
   *
   * Si ya estaban, no se reescriben: los mismos bytes dan la misma huella, así que
   * volver a escribirlos solo gasta disco y arriesga dejar el archivo a medias si
   * algo falla en mitad.
   */
  async guardar(contenido: Uint8Array): Promise<{ huella: string; yaEstaba: boolean }> {
    const huella = createHash('sha256').update(contenido).digest('hex')
    const ruta = rutaDe(this.raiz, huella)
    try {
      await stat(ruta)
      return { huella, yaEstaba: true }
    } catch {
      await mkdir(dirname(ruta), { recursive: true })
      await writeFile(ruta, contenido, { flag: 'wx' }).catch(async (e: NodeJS.ErrnoException) => {
        // 'wx' falla si otro lo escribió entre el stat y el write. No es un error:
        // es el caso bueno, dos personas subiendo el mismo papel a la vez.
        if (e.code !== 'EEXIST') throw e
      })
      return { huella, yaEstaba: false }
    }
  }

  async leer(huella: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(rutaDe(this.raiz, huella)))
    } catch (e) {
      if (e instanceof HuellaInvalida) throw e
      throw new DocumentoAusente()
    }
  }

  /**
   * Que lo guardado siga siendo lo que dice ser.
   *
   * No es una comprobación de adorno: un disco que se degrada en silencio no avisa,
   * y el día que se discuta un acta de recepción hay que poder decir que el archivo
   * es el mismo que se subió, no parecerlo.
   */
  async intacto(huella: string): Promise<boolean> {
    try {
      const bytes = await this.leer(huella)
      return createHash('sha256').update(bytes).digest('hex') === huella
    } catch {
      return false
    }
  }
}

/**
 * El almacén del proceso.
 *
 * Mismo patrón que la conexión a la base de datos, y por el mismo motivo: no se
 * exporta el objeto, se exporta la función que lo pide. Así no hay forma de acabar
 * con dos almacenes apuntando a sitios distintos según qué archivo importó cuál.
 */
let elAlmacen: Almacen | null = null

export function configurarAlmacen(raiz: string): void {
  elAlmacen = new Almacen(raiz)
}

export class SinAlmacen extends Error {
  constructor() {
    super('no se ha configurado dónde viven los documentos')
    this.name = 'SinAlmacen'
  }
}

export function almacen(): Almacen {
  if (!elAlmacen) throw new SinAlmacen()
  return elAlmacen
}

/**
 * Qué se acepta como evidencia.
 *
 * Una lista cerrada, no una lista de lo prohibido: lo prohibido siempre se queda
 * corto. Son los formatos en que llega de verdad un papel del patio — el PDF del
 * certificado, la foto del móvil, el escaneo del acta.
 *
 * No se acepta ningún formato que un navegador pueda ejecutar. Aunque el documento
 * se sirva siempre como descarga y nunca dentro de la página, basta con que un día
 * alguien cambie esa cabecera para que un .svg o un .html guardado aquí se convierta
 * en código corriendo en el dominio del portal.
 */
export const TIPOS_ACEPTADOS: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tif',
}

export function tipoAceptado(tipo: string): boolean {
  return Object.hasOwn(TIPOS_ACEPTADOS, tipo.toLowerCase().split(';')[0]!.trim())
}
