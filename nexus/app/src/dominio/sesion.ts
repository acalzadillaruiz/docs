/**
 * El flujo de entrada, de principio a fin.
 *
 * Tres decisiones que no son de estilo:
 *
 *   1. El mensaje es el mismo si el correo no existe, si la clave está mal, o si la
 *      cuenta está desactivada. Distinguirlos convierte la pantalla de entrada en un
 *      buscador de correos válidos, que es como se prepara un ataque de verdad.
 *
 *   2. Cuando el correo no existe, igualmente se gasta el tiempo de verificar una
 *      clave contra una huella falsa. Si no, responder rápido ya diría «ese correo
 *      no está», por muy igual que sea el texto.
 *
 *   3. El testigo de sesión se genera aquí y se devuelve una sola vez. En la base de
 *      datos solo queda su huella: quien lea esa tabla no puede suplantar a nadie.
 */

import { randomBytes, createHash } from 'node:crypto'
import type { Consulta } from '../db/conexion.ts'
import { verificarClave } from './clave.ts'
import { verificar as verificarTotp } from './totp.ts'

export type Credenciales = {
  readonly correo: string
  readonly clave: string
  readonly origen: string
}

export type Resultado =
  | { readonly estado: 'falta_segundo_factor'; readonly desafio: string }
  | { readonly estado: 'dentro'; readonly testigo: string; readonly personaId: string }
  | { readonly estado: 'espera'; readonly segundos: number }
  | { readonly estado: 'rechazado' }
  | { readonly estado: 'usa_tu_empresa'; readonly metodo: 'microsoft' | 'google' }

/** Huella válida que no corresponde a ninguna clave. Sirve para gastar el mismo tiempo. */
const HUELLA_SENUELO =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  Buffer.alloc(64, 7).toString('base64')

const HORAS_SESION = 12

export function huellaTestigo(testigo: string): string {
  return createHash('sha256').update(testigo, 'utf-8').digest('base64')
}

type FilaPersona = {
  id: string
  activa: boolean
  metodo: 'clave_2fa' | 'microsoft' | 'google'
  clave_hash: string | null
  totp_secreto: string | null
  org_activa: boolean
}

/**
 * Primer paso: correo y clave. Nunca devuelve una sesión por sí solo — si la cuenta
 * usa clave, siempre hace falta el segundo factor.
 */
export async function iniciar(q: Consulta, c: Credenciales): Promise<Resultado> {
  const [espera] = (await q`
    select espera_requerida(${c.correo}, ${c.origen}) as segundos
  `) as unknown as Array<{ segundos: number }>

  if (espera && espera.segundos > 0) {
    await q`select anotar_intento(${c.correo}, ${c.origen}, false, 'clave')`
    return { estado: 'espera', segundos: espera.segundos }
  }

  const [p] = (await q`
    select p.id, p.activa, p.metodo, p.clave_hash, p.totp_secreto,
           o.activa as org_activa
      from persona p join organizacion o on o.id = p.organizacion_id
     where lower(p.correo) = lower(${c.correo})
  `) as unknown as FilaPersona[]

  // Quien entra por Microsoft o Google no tiene clave que comprobar. Aquí sí se
  // dice cuál es el método: es una indicación que el propio botón ya da, y sin
  // ella la persona se queda escribiendo una clave que no existe.
  if (p && p.activa && p.org_activa && p.metodo !== 'clave_2fa') {
    return { estado: 'usa_tu_empresa', metodo: p.metodo }
  }

  const huella = p?.clave_hash ?? HUELLA_SENUELO
  const claveCorrecta = await verificarClave(c.clave, huella)
  const puedeEntrar = Boolean(p) && p!.activa && p!.org_activa && claveCorrecta

  await q`select anotar_intento(${c.correo}, ${c.origen}, ${puedeEntrar}, 'clave')`
  if (!puedeEntrar) return { estado: 'rechazado' }

  // El desafío ata el segundo paso al primero: sin él, alguien podría saltarse la
  // clave y presentar solo un código.
  const desafio = randomBytes(32).toString('base64url')
  await q`
    insert into sesion (persona_id, huella, origen, expira_en)
    values (${p!.id}, ${huellaTestigo(desafio)}, ${c.origen}, now() + interval '5 minutes')
  `
  return { estado: 'falta_segundo_factor', desafio }
}

/** Segundo paso: el código de seis dígitos. */
export async function completar(
  q: Consulta, desafio: string, codigo: string, origen: string, ahora: Date = new Date(),
): Promise<Resultado> {
  const [s] = (await q`
    select s.id, s.persona_id, p.totp_secreto, p.correo, p.activa
      from sesion s join persona p on p.id = s.persona_id
     where s.huella = ${huellaTestigo(desafio)}
       and s.cerrada_en is null
       and s.expira_en > now()
  `) as unknown as Array<{
    id: string; persona_id: string; totp_secreto: string; correo: string; activa: boolean
  }>

  if (!s || !s.activa) return { estado: 'rechazado' }

  const espera = (await q`
    select espera_requerida(${s.correo}, ${origen}) as segundos
  `) as unknown as Array<{ segundos: number }>
  if (espera[0] && espera[0].segundos > 0) {
    return { estado: 'espera', segundos: espera[0].segundos }
  }

  const bien = verificarTotp(s.totp_secreto, codigo, ahora)
  await q`select anotar_intento(${s.correo}, ${origen}, ${bien}, 'segundo_factor')`

  if (!bien) {
    // El desafío se quema al primer código equivocado. Dejarlo vivo permitiría
    // probar los diez mil códigos posibles con una sola verificación de clave.
    await q`
      update sesion set cerrada_en = now(), motivo_cierre = 'segundo factor incorrecto'
       where id = ${s.id}::uuid
    `
    return { estado: 'rechazado' }
  }

  const testigo = randomBytes(32).toString('base64url')
  await q`
    update sesion
       set huella = ${huellaTestigo(testigo)},
           expira_en = now() + ${`${HORAS_SESION} hours`}::interval,
           ultima_en = now()
     where id = ${s.id}::uuid
  `
  await q`update persona set ultimo_acceso = now() where id = ${s.persona_id}::uuid`
  return { estado: 'dentro', testigo, personaId: s.persona_id }
}

/** Quién es el dueño de un testigo, si sigue siendo válido. */
export async function quienEs(q: Consulta, testigo: string): Promise<string | null> {
  const [s] = (await q`
    select s.id, s.persona_id from sesion s join persona p on p.id = s.persona_id
     where s.huella = ${huellaTestigo(testigo)}
       and s.cerrada_en is null and s.expira_en > now() and p.activa
  `) as unknown as Array<{ id: string; persona_id: string }>
  if (!s) return null
  await q`update sesion set ultima_en = now() where id = ${s.id}::uuid`
  return s.persona_id
}

/**
 * Abre una sesión sin pasar por clave ni por segundo factor.
 *
 * Se usa cuando quien autentica es el directorio de la empresa: ahí el segundo
 * factor lo pone el proveedor, y exigirlo otra vez aquí sería pedirle a alguien que
 * demuestre dos veces lo mismo — que es como se consigue que la gente desactive el
 * doble factor.
 *
 * No tiene ninguna otra forma de llamarse desde fuera del camino de SSO: quien la
 * llame ya ha comprobado la firma del proveedor, el inquilino y el nonce.
 */
export async function abrirSesionDe(
  q: Consulta, personaId: string, origen: string,
): Promise<string> {
  const testigo = randomBytes(32).toString('base64url')
  await q`
    insert into sesion (persona_id, huella, origen, expira_en)
    values (${personaId}::uuid, ${huellaTestigo(testigo)}, ${origen},
            now() + ${`${HORAS_SESION} hours`}::interval)`
  await q`update persona set ultimo_acceso = now() where id = ${personaId}::uuid`
  return testigo
}
