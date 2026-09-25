/**
 * Comprobar la firma del testigo de identidad.
 *
 * Es la mitad de la entrada con la cuenta de la empresa que necesita red, y por eso
 * vive aquí y no en el dominio: `empresa.ts` valida lo que DICE el testigo, esto
 * comprueba que lo dice quien dice decirlo. Separarlas permite probar a fondo la
 * primera sin red, que es donde están los errores que dejan entrar a quien no debe.
 *
 * Lo que impone, y ninguna es opcional:
 *
 *   1. SOLO RS256. Se rechaza el algoritmo que venga en el testigo si no es ese. El
 *      ataque clásico contra JWT es mandar `alg: none` o cambiar RS256 por HS256 y
 *      firmar con la clave pública, que es pública. Aquí el algoritmo lo decide
 *      quien verifica, no quien firma.
 *
 *   2. LA CLAVE SE BUSCA POR SU `kid`, y si el testigo no trae `kid` se rechaza. Sin
 *      eso habría que probar todas las claves, y probar todas las claves es cómo se
 *      acaba aceptando una clave retirada.
 *
 *   3. EL JUEGO DE CLAVES SE GUARDA UN RATO, pero se vuelve a pedir cuando aparece
 *      un `kid` desconocido. Los proveedores rotan sus claves sin avisar: sin ese
 *      reintento, el día de la rotación nadie entra.
 */

import { createPublicKey, createVerify, timingSafeEqual } from 'node:crypto'

export type Jwk = {
  readonly kty: string
  readonly kid?: string
  readonly alg?: string
  readonly use?: string
  readonly n?: string
  readonly e?: string
}

export type JuegoDeClaves = { readonly keys: readonly Jwk[] }

export class FirmaInvalida extends Error {
  readonly motivo: string
  constructor(motivo: string) {
    // El mensaje no lleva nada del testigo dentro: un testigo en un registro es una
    // sesión de otro en manos de quien lea el registro.
    super(`el testigo de identidad no es de fiar: ${motivo}`)
    this.name = 'FirmaInvalida'
    this.motivo = motivo
  }
}

/** Las tres partes de un JWT, sin verificar todavía nada. */
export function partes(testigo: string): {
  cabecera: Record<string, unknown>
  cuerpo: Record<string, unknown>
  firmado: string
  firma: Buffer
} {
  const trozos = testigo.split('.')
  if (trozos.length !== 3) throw new FirmaInvalida('no tiene tres partes')
  const [c, p, f] = trozos as [string, string, string]

  let cabecera: Record<string, unknown>
  let cuerpo: Record<string, unknown>
  try {
    cabecera = JSON.parse(Buffer.from(c, 'base64url').toString('utf-8'))
    cuerpo = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'))
  } catch {
    throw new FirmaInvalida('no se entiende')
  }
  if (!cabecera || typeof cabecera !== 'object') throw new FirmaInvalida('cabecera rara')
  if (!cuerpo || typeof cuerpo !== 'object') throw new FirmaInvalida('cuerpo raro')

  return { cabecera, cuerpo, firmado: `${c}.${p}`, firma: Buffer.from(f, 'base64url') }
}

/**
 * Comprueba la firma contra el juego de claves.
 *
 * Devuelve el cuerpo solo si la firma cuadra. Nunca devuelve el cuerpo «para que
 * alguien lo mire antes»: un cuerpo sin firma comprobada es texto que escribió
 * cualquiera, y en cuanto sale de esta función alguien lo va a usar.
 */
export function verificarFirma(testigo: string, juego: JuegoDeClaves): Record<string, unknown> {
  const { cabecera, cuerpo, firmado, firma } = partes(testigo)

  // El algoritmo lo decide quien verifica, no quien firma. Aceptar el que venga
  // dentro es el ataque clásico contra JWT.
  if (cabecera['alg'] !== 'RS256') {
    throw new FirmaInvalida(`algoritmo ${String(cabecera['alg'])}, solo se acepta RS256`)
  }
  const kid = cabecera['kid']
  if (typeof kid !== 'string' || kid === '') throw new FirmaInvalida('sin kid')

  const clave = juego.keys.find((k) => k.kid === kid)
  if (!clave) throw new FirmaInvalida('kid desconocido')
  if (clave.kty !== 'RSA') throw new FirmaInvalida('la clave no es RSA')
  if (clave.alg && clave.alg !== 'RS256') throw new FirmaInvalida('la clave no es de RS256')

  let publica
  try {
    publica = createPublicKey({ key: clave as never, format: 'jwk' })
  } catch {
    throw new FirmaInvalida('la clave no se puede leer')
  }

  const v = createVerify('RSA-SHA256')
  v.update(firmado)
  v.end()
  if (!v.verify(publica, firma)) throw new FirmaInvalida('la firma no cuadra')

  return cuerpo
}

/** Compara dos cadenas en tiempo constante. Para el estado y el nonce. */
export function mismaCadena(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf-8')
  const y = Buffer.from(b, 'utf-8')
  return x.length === y.length && timingSafeEqual(x, y)
}

type EnCache = { juego: JuegoDeClaves; pedido: number }

/**
 * El juego de claves de un proveedor, guardado un rato.
 *
 * Se guarda porque pedirlo en cada entrada convierte al proveedor en un punto de
 * fallo de nuestra pantalla de acceso. Y se vuelve a pedir cuando aparece un `kid`
 * desconocido, porque los proveedores rotan sus claves sin avisar: sin ese reintento,
 * el día de la rotación nadie entra.
 */
export class Claves {
  private cache = new Map<string, EnCache>()
  private readonly vidaMs: number
  private readonly traer: (url: string) => Promise<JuegoDeClaves>

  constructor(
    traer: (url: string) => Promise<JuegoDeClaves>,
    vidaMs = 6 * 60 * 60 * 1000,
  ) {
    this.traer = traer
    this.vidaMs = vidaMs
  }

  async de(url: string, kid?: string, ahora = Date.now()): Promise<JuegoDeClaves> {
    const guardado = this.cache.get(url)
    const fresco = guardado && ahora - guardado.pedido < this.vidaMs
    const tieneLaClave = !kid || guardado?.juego.keys.some((k) => k.kid === kid)

    if (guardado && fresco && tieneLaClave) return guardado.juego

    const juego = await this.traer(url)
    this.cache.set(url, { juego, pedido: ahora })
    return juego
  }
}

/**
 * Trae el juego de claves por la red.
 *
 * Con tope de tamaño y de tiempo: un proveedor que responde despacio o devuelve algo
 * enorme no puede dejar colgada la pantalla de entrada.
 */
export async function traerPorLaRed(url: string): Promise<JuegoDeClaves> {
  const corte = AbortSignal.timeout(5000)
  const r = await fetch(url, { signal: corte, redirect: 'error' })
  if (!r.ok) throw new FirmaInvalida(`el proveedor respondió ${r.status}`)
  const texto = (await r.text()).slice(0, 256 * 1024)
  const juego = JSON.parse(texto) as JuegoDeClaves
  if (!juego || !Array.isArray(juego.keys)) throw new FirmaInvalida('el juego de claves no vale')
  return juego
}
