/**
 * Segundo factor: códigos TOTP de seis dígitos, los del Google Authenticator.
 *
 * Se implementa aquí, con la criptografía que trae Node, en vez de traer una
 * biblioteca: son cuarenta líneas, el algoritmo está congelado desde 2011 (RFC 6238),
 * y una dependencia menos en el camino del inicio de sesión es una superficie menos
 * que vigilar.
 *
 * Las dos decisiones que importan:
 *
 *   - Se acepta el código del paso anterior y el del siguiente, además del actual.
 *     Sin eso, alguien con el reloj treinta segundos desfasado no entra nunca, y ese
 *     alguien acaba pidiendo que se le quite el doble factor.
 *
 *   - La comparación es de tiempo constante. Comparar con === filtra, por lo que
 *     tarda, cuántos dígitos iniciales acertó quien lo intenta.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const PASO_SEGUNDOS = 30
const DIGITOS = 6

/** Decodifica el secreto en base32, que es como lo guardan las aplicaciones de códigos. */
export function desdeBase32(secreto: string): Buffer {
  const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const limpio = secreto.toUpperCase().replace(/[=\s]/g, '')
  let bits = 0
  let valor = 0
  const salida: number[] = []
  for (const c of limpio) {
    const i = ALFABETO.indexOf(c)
    if (i === -1) throw new SecretoInvalido(c)
    valor = (valor << 5) | i
    bits += 5
    if (bits >= 8) {
      salida.push((valor >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(salida)
}

export class SecretoInvalido extends Error {
  readonly caracter: string
  constructor(caracter: string) {
    super('El secreto del segundo factor no es un base32 válido')
    this.name = 'SecretoInvalido'
    this.caracter = caracter
  }
}

/** El código de seis dígitos que corresponde a un paso de tiempo. */
export function codigoEnPaso(secreto: Buffer, paso: number): string {
  const contador = Buffer.alloc(8)
  contador.writeBigUInt64BE(BigInt(paso))
  const mac = createHmac('sha1', secreto).update(contador).digest()
  const desplazamiento = mac[mac.length - 1]! & 0x0f
  const truncado =
    ((mac[desplazamiento]! & 0x7f) << 24) |
    ((mac[desplazamiento + 1]! & 0xff) << 16) |
    ((mac[desplazamiento + 2]! & 0xff) << 8) |
    (mac[desplazamiento + 3]! & 0xff)
  return String(truncado % 10 ** DIGITOS).padStart(DIGITOS, '0')
}

export function pasoDe(ahora: Date): number {
  return Math.floor(ahora.getTime() / 1000 / PASO_SEGUNDOS)
}

/**
 * ¿Es válido este código?
 *
 * `ventana` son los pasos de tolerancia a cada lado. Uno son treinta segundos antes
 * y treinta después, que es lo que recomienda el RFC y lo que hace falta para que un
 * teléfono con el reloj algo desfasado siga sirviendo.
 */
export function verificar(
  secretoBase32: string,
  codigo: string,
  ahora: Date = new Date(),
  ventana = 1,
): boolean {
  const limpio = codigo.replace(/\s/g, '')
  if (!/^\d{6}$/.test(limpio)) return false

  const secreto = desdeBase32(secretoBase32)
  const paso = pasoDe(ahora)
  const esperado = Buffer.from(limpio, 'utf-8')

  let valido = false
  for (let d = -ventana; d <= ventana; d++) {
    const candidato = Buffer.from(codigoEnPaso(secreto, paso + d), 'utf-8')
    // Sin cortocircuito: se recorren todos los pasos siempre, para que el tiempo
    // que tarda no revele en cuál acertó.
    if (candidato.length === esperado.length && timingSafeEqual(candidato, esperado)) {
      valido = true
    }
  }
  return valido
}
