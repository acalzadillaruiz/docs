/**
 * Protección contra peticiones cruzadas.
 *
 * `SameSite=Lax` ya impide que otra web provoque un POST con nuestra cookie, y en
 * navegadores actuales basta. Aun así aquí hay una segunda cerradura, porque la
 * primera depende de que el navegador se porte bien y de que nadie cambie el
 * atributo en el futuro por alguna necesidad de integración.
 *
 * El testigo antifalsificación se deriva del testigo de sesión, que vive en una
 * cookie HttpOnly. Quien no puede leer la cookie no puede calcularlo, así que no
 * hace falta guardarlo en ningún sitio: se recalcula y se compara.
 *
 * Se deriva con HMAC y no con un hash a secas: sin clave, cualquiera que viera un
 * testigo antifalsificación podría dar marcha atrás y obtener el de sesión si este
 * tuviera poca entropía. Con clave, no.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * La clave del servidor. Si no se declara, se inventa una al arrancar: así funciona
 * en desarrollo, y en producción falta declararla solo obliga a que las sesiones
 * abiertas se reinicien al desplegar, no a que nada sea inseguro.
 */
let clave: Buffer = Buffer.from(
  process.env.NEXUS_CLAVE_CSRF ?? Math.random().toString(36) + Date.now().toString(36),
  'utf-8',
)

export function fijarClave(nueva: string): void {
  clave = Buffer.from(nueva, 'utf-8')
}

export function testigoAnti(testigoSesion: string): string {
  return createHmac('sha256', clave).update(testigoSesion, 'utf-8').digest('base64url')
}

export function testigoAntiValido(testigoSesion: string | null, enviado: unknown): boolean {
  if (!testigoSesion || typeof enviado !== 'string' || enviado === '') return false
  const esperado = Buffer.from(testigoAnti(testigoSesion), 'utf-8')
  const recibido = Buffer.from(enviado, 'utf-8')
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido)
}
