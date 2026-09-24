/**
 * Entrar con la cuenta de la empresa (OpenID Connect, Microsoft y Google).
 *
 * Lo que de verdad compra esto no es ahorrarle una clave al ingeniero de la
 * operadora. Es que **cuando su empresa lo da de baja, pierde el acceso a este portal
 * el mismo día**, sin que nadie de GPS tenga que acordarse. Hoy, si alguien se va de
 * una empresa cliente, nadie avisa, y su cuenta se queda abierta con los documentos
 * del contrato dentro.
 *
 * Aquí está la parte que decide si se entra o no: validar lo que devuelve el
 * proveedor de identidad. Es el sitio donde se cometen los errores clásicos, y por
 * eso está separado de la red y probado pieza a pieza.
 *
 * Las cinco comprobaciones que no se pueden saltar, y por qué:
 *
 *   emisor      — un testigo de otro emisor puede ser perfectamente válido... para
 *                 otro sitio. Sin esta comprobación, cualquiera con una cuenta de un
 *                 inquilino cualquiera entra.
 *   destinatario— un testigo emitido para otra aplicación del mismo emisor tampoco
 *                 vale. Es el mismo error un escalón más abajo.
 *   inquilino   — Microsoft emite para todo el mundo. Si no se exige el inquilino de
 *                 la operadora, entra cualquiera que tenga un Microsoft.
 *   caducidad   — con margen de reloj, pero acotado.
 *   nonce       — ata la respuesta a la petición que la pidió. Sin él, un testigo
 *                 robado de otra sesión sirve.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

export type Metodo = 'microsoft' | 'google'

/** Lo que se guarda mientras el usuario está en el proveedor de identidad. */
export type Peticion = {
  readonly estado: string
  readonly nonce: string
  readonly metodo: Metodo
  readonly creada: Date
}

export function iniciarPeticion(metodo: Metodo, ahora = new Date()): Peticion {
  return {
    estado: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    metodo,
    creada: ahora,
  }
}

export type Afirmaciones = {
  readonly iss?: string
  readonly aud?: string | readonly string[]
  readonly sub?: string
  readonly tid?: string          // inquilino, en Microsoft
  readonly hd?: string           // dominio alojado, en Google
  readonly email?: string
  readonly email_verified?: boolean
  readonly exp?: number
  readonly iat?: number
  readonly nonce?: string
}

export type Esperado = {
  readonly emisor: string
  readonly destinatario: string
  readonly inquilino: string
  readonly metodo: Metodo
}

export type Veredicto =
  | { readonly valido: true; readonly sujeto: string; readonly correo: string }
  | { readonly valido: false; readonly motivo: Motivo }

export type Motivo =
  | 'emisor_distinto' | 'destinatario_distinto' | 'inquilino_distinto'
  | 'caducado' | 'futuro' | 'nonce_distinto'
  | 'sin_sujeto' | 'sin_correo' | 'correo_sin_verificar'

const MARGEN_RELOJ_S = 120

const iguales = (a: string, b: string): boolean => {
  const x = Buffer.from(a, 'utf-8')
  const y = Buffer.from(b, 'utf-8')
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Valida las afirmaciones del testigo de identidad.
 *
 * NO valida la firma: eso lo hace la capa que habla con la red, contra las claves
 * públicas del proveedor. Separarlo es deliberado — la validación de firma necesita
 * red y no se puede probar a fondo sin ella; ésta sí, y es donde están los errores
 * que de verdad dejan entrar a quien no debe.
 */
export function validar(
  a: Afirmaciones, e: Esperado, nonceEsperado: string, ahora = new Date(),
): Veredicto {
  const no = (motivo: Motivo): Veredicto => ({ valido: false, motivo })

  if (!a.iss || !iguales(a.iss, e.emisor)) return no('emisor_distinto')

  const destinatarios = a.aud === undefined ? [] : Array.isArray(a.aud) ? a.aud : [a.aud]
  if (!destinatarios.some((d) => iguales(String(d), e.destinatario))) {
    return no('destinatario_distinto')
  }

  // Microsoft lo llama inquilino y Google dominio alojado. Sin esto, cualquiera con
  // una cuenta personal del mismo proveedor entraría.
  const inquilino = e.metodo === 'microsoft' ? a.tid : a.hd
  if (!inquilino || !iguales(inquilino, e.inquilino)) return no('inquilino_distinto')

  if (!a.nonce || !iguales(a.nonce, nonceEsperado)) return no('nonce_distinto')

  const segundos = Math.floor(ahora.getTime() / 1000)
  if (a.exp === undefined || a.exp + MARGEN_RELOJ_S < segundos) return no('caducado')
  if (a.iat !== undefined && a.iat - MARGEN_RELOJ_S > segundos) return no('futuro')

  if (!a.sub) return no('sin_sujeto')
  if (!a.email) return no('sin_correo')
  // Un correo sin verificar puede ser el de otra persona: en algunos proveedores
  // basta con escribirlo para que aparezca aquí.
  if (a.email_verified === false) return no('correo_sin_verificar')

  return { valido: true, sujeto: a.sub, correo: a.email.toLowerCase() }
}

/** Compara el estado devuelto con el guardado, y comprueba que no haya caducado. */
export function estadoValido(
  p: Peticion, estadoDevuelto: string, ahora = new Date(), minutos = 10,
): boolean {
  if (ahora.getTime() - p.creada.getTime() > minutos * 60_000) return false
  return iguales(p.estado, estadoDevuelto)
}

/** Huella del sujeto, para guardar en `persona.idp_sujeto` sin guardar el valor crudo. */
export function huellaSujeto(emisor: string, sujeto: string): string {
  return createHash('sha256').update(`${emisor}|${sujeto}`, 'utf-8').digest('base64')
}
