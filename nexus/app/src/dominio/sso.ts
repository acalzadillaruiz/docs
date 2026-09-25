/**
 * Entrar con la cuenta de la empresa, de punta a punta.
 *
 * Lo que compra esto no es ahorrarle una clave al ingeniero de la operadora: es que
 * **cuando su empresa lo da de baja, pierde el acceso el mismo día**, sin que nadie
 * de GPS tenga que acordarse. Ese es el único motivo por el que vale la pena.
 *
 * El camino tiene dos peticiones separadas y entre ellas el usuario está en
 * Microsoft o en Google. Lo que hay que recordar —el estado y el nonce— vive en la
 * base de datos y **se quema al usarse**: una petición reutilizable es un testigo
 * reutilizable.
 *
 * La comprobación de firma vive en `servidor/jwks.ts` y la de afirmaciones en
 * `dominio/empresa.ts`. Aquí se pegan las dos y se abre la sesión.
 */

import type { Consulta } from '../db/conexion.ts'
import {
  iniciarPeticion, validar, huellaSujeto,
  type Metodo, type Afirmaciones, type Motivo,
} from './empresa.ts'

export type Proveedor = {
  readonly metodo: Metodo
  /** A dónde se manda al usuario. */
  readonly autorizar: string
  /** Dónde se cambia el código por el testigo. */
  readonly testigo: string
  /** Dónde están las claves públicas. */
  readonly claves: string
  readonly emisor: (inquilino: string) => string
  readonly clienteId: string
  readonly clienteSecreto: string
}

export type Organizacion = {
  readonly id: string
  readonly nombre: string
  readonly metodos: readonly string[]
  readonly inquilino: string | null
}

/** Qué empresa hay detrás de un correo, y con qué método entra. */
export async function empresaDe(q: Consulta, correo: string): Promise<Organizacion | null> {
  const limpio = correo.trim().toLowerCase()
  if (!limpio.includes('@')) return null

  // Se busca por la persona, no por el dominio del correo. Dos empresas distintas
  // pueden usar el mismo dominio de correo —pasa con los grupos— y adivinar por
  // dominio metería a alguien en la empresa equivocada.
  const [p] = (await q`
    select o.id, o.nombre, o.metodos::text[] as metodos, o.idp_tenant
      from persona pe join organizacion o on o.id = pe.organizacion_id
     where lower(pe.correo) = ${limpio} and pe.activa
  `) as unknown as Array<{
    id: string; nombre: string; metodos: string[]; idp_tenant: string | null
  }>
  if (!p) return null
  return { id: p.id, nombre: p.nombre, metodos: p.metodos, inquilino: p.idp_tenant }
}

export type Ida = {
  readonly adonde: string
  readonly estado: string
}

/**
 * Prepara la ida: guarda el estado y el nonce, y devuelve la dirección del proveedor.
 *
 * El `prompt=select_account` no es cosmético: sin él, quien tenga otra sesión abierta
 * en ese proveedor entra con ella sin enterarse, y acaba viendo el portal como otra
 * persona.
 */
export async function preparar(
  q: Consulta, org: Organizacion, prov: Proveedor, destino: string, origen: string,
  vuelta: string,
): Promise<Ida> {
  if (!org.inquilino) throw new Error('esa empresa no tiene configurado su inquilino')

  const p = iniciarPeticion(prov.metodo)
  await q`
    insert into peticion_sso (estado, nonce, metodo, organizacion_id, destino, origen)
    values (${p.estado}, ${p.nonce}, ${prov.metodo}, ${org.id}::uuid, ${destino}, ${origen})`

  const u = new URL(prov.autorizar.replace('{inquilino}', org.inquilino))
  u.searchParams.set('client_id', prov.clienteId)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', vuelta)
  u.searchParams.set('scope', 'openid email profile')
  u.searchParams.set('state', p.estado)
  u.searchParams.set('nonce', p.nonce)
  u.searchParams.set('prompt', 'select_account')
  return { adonde: u.toString(), estado: p.estado }
}

export type Vuelta =
  | { readonly entra: true; readonly personaId: string; readonly destino: string }
  | { readonly entra: false; readonly motivo: Motivo | 'peticion_caducada' | 'sin_cuenta' }

/** Lo que hace falta para cambiar el código por el testigo. Se pasa para poder probar. */
export type Cambiador = (prov: Proveedor, codigo: string, vuelta: string) => Promise<string>

/**
 * La vuelta: comprueba todo y dice quién entra.
 *
 * Nada de lo que llega en la dirección se cree. El estado se busca en la base de
 * datos y se quema; el testigo se comprueba contra las claves del proveedor; las
 * afirmaciones se validan una a una. Solo entonces se busca a la persona.
 */
export async function volver(
  q: Consulta, estado: string, codigo: string, prov: Proveedor,
  cambiar: Cambiador, verificar: (testigo: string, claves: string) => Promise<Afirmaciones>,
  vuelta: string, ahora = new Date(),
): Promise<Vuelta> {
  const [p] = (await q`
    select * from tomar_peticion_sso(${estado})
  `) as unknown as Array<{
    id: string; nonce: string; metodo: Metodo; organizacion_id: string
    destino: string | null; origen: string
  }>
  // Una petición que no está, que ya se usó o que caducó: las tres se responden
  // igual. Distinguirlas diría a quien esté probando cuál de las tres era.
  if (!p) return { entra: false, motivo: 'peticion_caducada' }

  const [org] = (await q`
    select idp_tenant from organizacion where id = ${p.organizacion_id}::uuid
  `) as unknown as Array<{ idp_tenant: string | null }>
  if (!org?.idp_tenant) return { entra: false, motivo: 'inquilino_distinto' }

  const testigo = await cambiar(prov, codigo, vuelta)
  const afirmaciones = await verificar(testigo, prov.claves)

  const v = validar(afirmaciones, {
    emisor: prov.emisor(org.idp_tenant),
    destinatario: prov.clienteId,
    inquilino: org.idp_tenant,
    metodo: p.metodo,
  }, p.nonce, ahora)
  if (!v.valido) return { entra: false, motivo: v.motivo }

  // La persona se busca por su huella de sujeto si ya entró alguna vez, y por su
  // correo la primera. El sujeto manda sobre el correo: un correo se puede cambiar
  // en el directorio de la empresa y seguir siendo la misma persona.
  const huella = huellaSujeto(prov.emisor(org.idp_tenant), v.sujeto)
  const [persona] = (await q`
    select id, idp_sujeto from persona
     where organizacion_id = ${p.organizacion_id}::uuid
       and activa
       and (idp_sujeto = ${huella} or lower(correo) = ${v.correo})
     order by (idp_sujeto = ${huella}) desc
     limit 1
  `) as unknown as Array<{ id: string; idp_sujeto: string | null }>

  // No se crea la persona sola. Que alguien de la operadora tenga cuenta en
  // Microsoft no significa que GPS le haya dado acceso a este contrato: darlo de
  // alta es una decisión, y aquí se descubriría demasiado tarde.
  if (!persona) return { entra: false, motivo: 'sin_cuenta' }

  if (persona.idp_sujeto !== huella) {
    await q`update persona set idp_sujeto = ${huella} where id = ${persona.id}::uuid`
  }

  return { entra: true, personaId: persona.id, destino: p.destino ?? '/' }
}
