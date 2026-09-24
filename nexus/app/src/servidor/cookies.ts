/**
 * Cookies de sesión.
 *
 * Los cuatro atributos que la hacen segura, y qué pasa si falta cada uno:
 *
 *   HttpOnly  — sin él, cualquier guion de la página puede leer el testigo. Un solo
 *               fallo de escapado en cualquier pantalla se convierte en robo de sesión.
 *   Secure    — sin él, la cookie viaja en claro si alguien fuerza http://.
 *   SameSite  — sin él, otra web puede hacer que el navegador envíe la cookie en una
 *               petición que el usuario no pidió. Es el ataque de petición cruzada.
 *   Path      — acota dónde se envía.
 *
 * No se usa `Expires` a propósito: la cookie muere al cerrar el navegador, y la
 * caducidad de verdad vive en la base de datos, donde no se puede falsificar.
 */

export const NOMBRE_COOKIE = 'nexus_sesion'

export function ponerCookie(testigo: string, seguro = true): string {
  const partes = [`${NOMBRE_COOKIE}=${testigo}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (seguro) partes.push('Secure')
  return partes.join('; ')
}

export function borrarCookie(seguro = true): string {
  const partes = [`${NOMBRE_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (seguro) partes.push('Secure')
  return partes.join('; ')
}

/** Lee el testigo de la cabecera Cookie, si está. */
export function leerCookie(cabecera: string | undefined): string | null {
  if (!cabecera) return null
  for (const trozo of cabecera.split(';')) {
    const i = trozo.indexOf('=')
    if (i === -1) continue
    if (trozo.slice(0, i).trim() === NOMBRE_COOKIE) {
      const v = trozo.slice(i + 1).trim()
      return v === '' ? null : v
    }
  }
  return null
}

/**
 * El idioma que quiere quien pide la página.
 *
 * Se mira primero la preferencia guardada y después la cabecera del navegador. Así
 * el ingeniero de la operadora ve el portal en su idioma la primera vez que entra,
 * sin tener que buscar un selector.
 */
export function idiomaPedido(
  acceptLanguage: string | undefined, guardado?: 'es' | 'en' | null,
): 'es' | 'en' {
  if (guardado === 'es' || guardado === 'en') return guardado
  if (!acceptLanguage) return 'es'
  // Se recorre por orden de preferencia declarada, no por orden de aparición.
  const idiomas = acceptLanguage
    .split(',')
    .map((t) => {
      const [etiqueta, ...resto] = t.trim().split(';')
      const q = resto.find((r) => r.trim().startsWith('q='))
      return { etiqueta: (etiqueta ?? '').trim().toLowerCase(), q: q ? Number(q.split('=')[1]) : 1 }
    })
    .sort((a, b) => b.q - a.q)
  for (const { etiqueta } of idiomas) {
    if (etiqueta.startsWith('es')) return 'es'
    if (etiqueta.startsWith('en')) return 'en'
  }
  return 'es'
}
