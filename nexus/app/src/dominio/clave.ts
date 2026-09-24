/**
 * Claves y códigos de recuperación.
 *
 * Se usa scrypt, que viene dentro de Node. Argon2id sería la primera opción hoy,
 * pero exige una dependencia nativa que hay que compilar en cada despliegue, y
 * scrypt es una función de derivación de memoria dura, aceptada por la norma
 * (NIST SP 800-63B) y sin nada que compilar. En el camino del inicio de sesión,
 * una pieza que no se puede romper al desplegar vale más que la teóricamente mejor.
 *
 * Parámetros: N = 2^15 (32.768). Cuesta unos 32 MB y decenas de milisegundos por
 * intento, que es despreciable para quien entra una vez y carísimo para quien
 * prueba millones de claves.
 *
 * GPS nunca ve una clave. Guarda la huella y la sal, nada más. Y con Microsoft o
 * Google ni siquiera eso: ahí no hay clave que guardar.
 */

import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const derivar = promisify(scrypt) as (
  clave: string, sal: Buffer, largo: number, opciones: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

const N = 2 ** 15
const PARAMS = { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const LARGO = 64

/** Devuelve la huella en un solo texto, con sus parámetros dentro. */
export async function cifrarClave(clave: string): Promise<string> {
  if (clave.length < 12) throw new ClaveDemasiadoCorta(clave.length)
  const sal = randomBytes(16)
  const huella = await derivar(clave.normalize('NFKC'), sal, LARGO, PARAMS)
  // Los parámetros van dentro para poder subirlos más adelante sin invalidar lo ya
  // guardado: cada huella recuerda con qué coste se calculó.
  return `scrypt$${N}$${PARAMS.r}$${PARAMS.p}$${sal.toString('base64')}$${huella.toString('base64')}`
}

export async function verificarClave(clave: string, guardada: string): Promise<boolean> {
  const partes = guardada.split('$')
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false
  const [, n, r, p, salB64, huellaB64] = partes
  const sal = Buffer.from(salB64!, 'base64')
  const esperada = Buffer.from(huellaB64!, 'base64')
  const calculada = await derivar(clave.normalize('NFKC'), sal, esperada.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  })
  return calculada.length === esperada.length && timingSafeEqual(calculada, esperada)
}

export class ClaveDemasiadoCorta extends Error {
  readonly largo: number
  constructor(largo: number) {
    super('La clave debe tener al menos 12 caracteres')
    this.name = 'ClaveDemasiadoCorta'
    this.largo = largo
  }
}

/**
 * Códigos de recuperación: diez, de un solo uso, para cuando se pierde el teléfono.
 *
 * Se enseñan UNA vez al generarlos y no se vuelven a mostrar: en la base de datos
 * solo queda su huella. Si alguien lee la base de datos entera, no puede entrar
 * con ellos.
 *
 * Se descartan las letras y cifras que se confunden al copiarlas a mano —0/O, 1/I/L—
 * porque estos códigos se apuntan en papel, y un código mal transcrito en el peor
 * momento es lo que hace que la gente desactive el doble factor.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generarCodigosRecuperacion(cuantos = 10): string[] {
  const codigos: string[] = []
  for (let i = 0; i < cuantos; i++) {
    const bytes = randomBytes(10)
    let c = ''
    for (const b of bytes) c += ALFABETO[b % ALFABETO.length]
    codigos.push(`${c.slice(0, 5)}-${c.slice(5)}`)
  }
  return codigos
}

/** La huella que se guarda. Es determinista: el mismo código da la misma huella. */
export function huellaCodigo(codigo: string): string {
  return createHash('sha256')
    .update(codigo.toUpperCase().replace(/[\s-]/g, ''), 'utf-8')
    .digest('base64')
}

export function codigoCoincide(codigo: string, huellaGuardada: string): boolean {
  const a = Buffer.from(huellaCodigo(codigo), 'utf-8')
  const b = Buffer.from(huellaGuardada, 'utf-8')
  return a.length === b.length && timingSafeEqual(a, b)
}
