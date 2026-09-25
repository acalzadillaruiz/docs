/**
 * Microsoft y Google, configurados.
 *
 * Las direcciones son públicas y llevan años igual; el identificador de cliente
 * también es público (viaja en cada dirección de entrada). **Lo único secreto es el
 * `client_secret`, y sale de una variable de entorno**: escribirlo en el código es
 * escribirlo en el historial del repositorio para siempre, y un secreto que estuvo
 * en un repositorio está quemado aunque se borre después.
 */

import { FirmaInvalida } from './jwks.ts'
import type { Proveedor } from '../dominio/sso.ts'

export type Configurado = { readonly microsoft?: Proveedor; readonly google?: Proveedor }

export function proveedores(env: Record<string, string | undefined>): Configurado {
  const c: { microsoft?: Proveedor; google?: Proveedor } = {}

  if (env['NEXUS_MS_CLIENTE'] && env['NEXUS_MS_SECRETO']) {
    c.microsoft = {
      metodo: 'microsoft',
      autorizar: 'https://login.microsoftonline.com/{inquilino}/oauth2/v2.0/authorize',
      testigo: 'https://login.microsoftonline.com/{inquilino}/oauth2/v2.0/token',
      claves: 'https://login.microsoftonline.com/{inquilino}/discovery/v2.0/keys',
      emisor: (i) => `https://login.microsoftonline.com/${i}/v2.0`,
      clienteId: env['NEXUS_MS_CLIENTE'],
      clienteSecreto: env['NEXUS_MS_SECRETO'],
    }
  }
  if (env['NEXUS_GOOGLE_CLIENTE'] && env['NEXUS_GOOGLE_SECRETO']) {
    c.google = {
      metodo: 'google',
      autorizar: 'https://accounts.google.com/o/oauth2/v2/auth',
      testigo: 'https://oauth2.googleapis.com/token',
      claves: 'https://www.googleapis.com/oauth2/v3/certs',
      // Google usa el mismo emisor para todos, y el inquilino va en 'hd'.
      emisor: () => 'https://accounts.google.com',
      clienteId: env['NEXUS_GOOGLE_CLIENTE'],
      clienteSecreto: env['NEXUS_GOOGLE_SECRETO'],
    }
  }
  return c
}

/**
 * Cambia el código por el testigo, hablando con el proveedor.
 *
 * Va aquí y no en el dominio porque necesita red. El dominio lo recibe como
 * argumento, que es lo que permite probar el camino entero sin salir a internet.
 *
 * El `client_secret` viaja en el cuerpo y nunca en la dirección: una dirección
 * acaba en el registro del servidor, en el del proxy y en el historial del
 * navegador.
 */
export async function cambiarCodigo(
  prov: Proveedor, codigo: string, vuelta: string, inquilino: string,
): Promise<string> {
  const cuerpo = new URLSearchParams({
    grant_type: 'authorization_code',
    code: codigo,
    redirect_uri: vuelta,
    client_id: prov.clienteId,
    client_secret: prov.clienteSecreto,
  })

  const r = await fetch(prov.testigo.replace('{inquilino}', inquilino), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: cuerpo.toString(),
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  })
  if (!r.ok) {
    // El cuerpo de la respuesta NO se propaga: puede llevar dentro el código, y un
    // código en un registro es una sesión a medio abrir en manos de quien lo lea.
    throw new FirmaInvalida(`el proveedor rechazó el código (${r.status})`)
  }
  const datos = (await r.json()) as { id_token?: string }
  if (!datos.id_token) throw new FirmaInvalida('el proveedor no devolvió un testigo')
  return datos.id_token
}
