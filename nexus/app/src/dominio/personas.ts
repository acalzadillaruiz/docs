/**
 * Las personas, y cómo entra una nueva.
 *
 * La pantalla de «Crea tu clave» existía desde el primer día y mandaba el formulario
 * a `/invitacion`, una ruta que **no existía**. Y nada, en ninguna parte, creaba una
 * fila en `persona`: la única forma de dar de alta a alguien era escribir SQL a mano.
 *
 * Un portal multiempresa en el que no se puede invitar a nadie. La puerta de entrada
 * del producto entero, sin construir.
 *
 * Tres reglas que no son de programación sino de cómo se pierde una cuenta:
 *
 *   1. **Se guarda la huella del testigo, nunca el testigo.** Igual que con las
 *      sesiones: quien lea esta tabla no puede entrar con lo que encuentre.
 *   2. **La invitación caduca.** Un enlace de alta que vale para siempre es una
 *      llave olvidada en el correo de alguien durante años.
 *   3. **El secreto del segundo factor y los códigos de recuperación se enseñan una
 *      sola vez**, al aceptarla. Después ya no existen en ninguna parte legible.
 */

import { randomBytes, createHash } from 'node:crypto'
import type { Consulta } from '../db/conexion.ts'
import { t, type Idioma } from '../i18n/t.ts'
import { cifrarClave, generarCodigosRecuperacion, huellaCodigo } from './clave.ts'

/** Cuántos días vale una invitación. Una semana: lo que tarda alguien en leer el correo. */
export const DIAS_INVITACION = 7

const ALFABETO32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** El testigo que viaja en el enlace. Se enseña una vez y se guarda su huella. */
function nuevaFicha(): string {
  const b = randomBytes(24)
  let s = ''
  for (const x of b) s += ALFABETO32[x % 32]
  return s
}

const huellaFicha = (f: string) =>
  createHash('sha256').update(f.trim(), 'utf-8').digest('base64')

/** Un secreto TOTP en base32, que es lo que entiende una aplicación de códigos. */
function nuevoSecreto(): string {
  const b = randomBytes(20)
  let s = ''
  for (const x of b) s += ALFABETO32[x % 32]
  return s
}

export type Persona = {
  readonly id: string
  readonly nombre: string
  readonly correo: string
  readonly organizacion: string
  readonly interna: boolean
  readonly metodo: string
  readonly activa: boolean
  readonly ultimoAcceso: string | null
  /** Por qué se la dio de baja, para quien tenga que revisarlo. */
  readonly bajaMotivo: string | null
}

export type Pendiente = {
  readonly id: string
  readonly nombre: string
  readonly correo: string
  readonly organizacion: string
  readonly caduca: string
  readonly caducada: boolean
}

export async function personas(q: Consulta): Promise<readonly Persona[]> {
  const filas = (await q`
    select p.id, p.nombre, p.correo, o.nombre as organizacion, (o.tipo = 'gps') as interna,
           p.metodo::text, p.activa, p.ultimo_acceso, p.baja_motivo
      from persona p join organizacion o on o.id = p.organizacion_id
     order by o.tipo <> 'gps', o.nombre, p.nombre
  `) as unknown as Array<Record<string, unknown>>
  return filas.map((f): Persona => ({
    id: f['id'] as string,
    nombre: f['nombre'] as string,
    correo: f['correo'] as string,
    organizacion: f['organizacion'] as string,
    interna: f['interna'] === true,
    metodo: f['metodo'] as string,
    activa: f['activa'] === true,
    ultimoAcceso: f['ultimo_acceso']
      ? (f['ultimo_acceso'] as Date).toISOString().slice(0, 10) : null,
    bajaMotivo: (f['baja_motivo'] as string | null) ?? null,
  }))
}

export async function pendientes(q: Consulta): Promise<readonly Pendiente[]> {
  const filas = (await q`
    select i.id, i.nombre, i.correo, o.nombre as organizacion, i.caduca_en,
           (i.caduca_en < now()) as caducada
      from invitacion i join organizacion o on o.id = i.organizacion_id
     where i.aceptada_en is null and i.revocada_en is null
     order by i.creada_en desc
  `) as unknown as Array<Record<string, unknown>>
  return filas.map((f): Pendiente => ({
    id: f['id'] as string,
    nombre: f['nombre'] as string,
    correo: f['correo'] as string,
    organizacion: f['organizacion'] as string,
    caduca: (f['caduca_en'] as Date).toISOString().slice(0, 10),
    caducada: f['caducada'] === true,
  }))
}

export type Hecho =
  | {
      readonly hecho: true
      readonly ficha?: string
      /**
       * Cuántas sesiones abiertas se cortaron al dar de baja.
       *
       * La función de la base lo devuelve y ese número se tiraba. Importa por dos cosas:
       * quien da de baja a alguien quiere saber si estaba dentro en ese momento, y —lo que
       * lo hace más que cortesía— esta misma cuenta estuvo rota, devolviendo cero siempre,
       * y nadie lo vio precisamente porque nadie la miraba.
       */
      readonly sesiones?: number
    }
  | { readonly hecho: false; readonly motivo: string }

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Invita a una persona. Devuelve la ficha, **que se enseña una sola vez**.
 *
 * No se manda el correo desde aquí a propósito: el enlace se enseña en pantalla y lo
 * envía quien invita, por el canal que quiera. Mandar un correo con una llave dentro
 * sin saber si el buzón es el correcto es como se regala una cuenta.
 */
export async function invitar(
  q: Consulta, datos: { orgId: string; correo: string; nombre: string; idioma: Idioma },
  quien: string, idioma: Idioma,
): Promise<Hecho> {
  const correo = datos.correo.trim().toLowerCase()
  if (!CORREO.test(correo)) return { hecho: false, motivo: t(idioma, 'persona.error.correo') }
  if (datos.nombre.trim().length < 2) {
    return { hecho: false, motivo: t(idioma, 'persona.error.nombre') }
  }
  if (!/^[0-9a-f-]{36}$/i.test(datos.orgId)) {
    return { hecho: false, motivo: t(idioma, 'persona.error.empresa') }
  }

  const [ya] = (await q`
    select 1 as x from persona where lower(correo) = ${correo}
  `) as unknown as Array<{ x: number }>
  if (ya) return { hecho: false, motivo: t(idioma, 'persona.error.ya_existe') }

  const [abierta] = (await q`
    select 1 as x from invitacion
     where lower(correo) = ${correo} and aceptada_en is null and revocada_en is null
       and caduca_en > now()
  `) as unknown as Array<{ x: number }>
  if (abierta) return { hecho: false, motivo: t(idioma, 'persona.error.ya_invitada') }

  const ficha = nuevaFicha()
  await q`
    insert into invitacion (organizacion_id, correo, nombre, idioma, huella,
                            caduca_en, invitada_por)
    values (${datos.orgId}::uuid, ${correo}, ${datos.nombre.trim()}, ${datos.idioma},
            ${huellaFicha(ficha)},
            now() + ${`${DIAS_INVITACION} days`}::interval, ${quien}::uuid)`
  return { hecho: true, ficha }
}

export async function revocar(
  q: Consulta, invitacionId: string, motivo: string, idioma: Idioma,
): Promise<Hecho> {
  if (motivo.trim().length < 3) {
    return { hecho: false, motivo: t(idioma, 'persona.error.motivo') }
  }
  if (!/^[0-9a-f-]{36}$/i.test(invitacionId)) {
    return { hecho: false, motivo: t(idioma, 'persona.error.no_existe') }
  }
  const filas = await q`
    update invitacion set revocada_en = now(), motivo_revocacion = ${motivo.trim()}
     where id = ${invitacionId}::uuid and aceptada_en is null and revocada_en is null
     returning id`
  if (filas.length === 0) return { hecho: false, motivo: t(idioma, 'persona.error.no_existe') }
  return { hecho: true }
}

/**
 * Dar de baja: la cuenta se marca inactiva y se le cierra la sesión en el acto.
 *
 * Pide el motivo escrito, igual que anular una invitación. No es burocracia: la
 * primera versión de esta pantalla daba de baja con un botón solo, con el
 * identificador de la persona ya puesto en un campo escondido. El barrido que manda
 * todos los formularios en blanco lo pilló desactivando a la gente de otras pruebas
 * — y un navegador manda formularios en blanco igual que ese barrido.
 */
export async function desactivar(
  q: Consulta, personaId: string, quien: string, motivo: string, idioma: Idioma,
): Promise<Hecho> {
  if (!/^[0-9a-f-]{36}$/i.test(personaId)) {
    return { hecho: false, motivo: t(idioma, 'persona.error.no_existe') }
  }
  if (motivo.trim().length < 3) {
    return { hecho: false, motivo: t(idioma, 'persona.error.motivo_baja') }
  }
  if (personaId === quien) return { hecho: false, motivo: t(idioma, 'persona.error.tu_mismo') }
  const [p] = (await q`
    select activa from persona where id = ${personaId}::uuid
  `) as unknown as Array<{ activa: boolean }>
  if (!p) return { hecho: false, motivo: t(idioma, 'persona.error.no_existe') }
  if (!p.activa) return { hecho: false, motivo: t(idioma, 'persona.error.ya_baja') }

  const [r] = (await q`
    select desactivar_persona(${personaId}::uuid, ${quien}::uuid, ${motivo.trim()}) as n
  `) as unknown as Array<{ n: number }>
  return { hecho: true, sesiones: Number(r?.n ?? 0) }
}

export async function reactivar(
  q: Consulta, personaId: string, idioma: Idioma,
): Promise<Hecho> {
  if (!/^[0-9a-f-]{36}$/i.test(personaId)) {
    return { hecho: false, motivo: t(idioma, 'persona.error.no_existe') }
  }
  const [r] = (await q`
    select reactivar_persona(${personaId}::uuid) as hecho
  `) as unknown as Array<{ hecho: boolean }>
  if (r?.hecho !== true) return { hecho: false, motivo: t(idioma, 'persona.error.no_existe') }
  return { hecho: true }
}

export type Invitada = {
  readonly nombre: string
  readonly correo: string
  readonly organizacion: string
  readonly idioma: Idioma
}

/** La invitación que hay detrás de una ficha, si sigue viva. */
export async function abrirInvitacion(
  q: Consulta, ficha: string,
): Promise<Invitada | null> {
  if (ficha.trim() === '') return null
  const [i] = (await q`
    select i.nombre, i.correo, i.idioma, o.nombre as organizacion
      from invitacion i join organizacion o on o.id = i.organizacion_id
     where i.huella = ${huellaFicha(ficha)}
       and i.aceptada_en is null and i.revocada_en is null and i.caduca_en > now()
  `) as unknown as Array<Record<string, string>>
  if (!i) return null
  return {
    nombre: i['nombre']!,
    correo: i['correo']!,
    organizacion: i['organizacion']!,
    idioma: i['idioma'] === 'en' ? 'en' : 'es',
  }
}

export type Aceptada =
  | {
      readonly hecho: true
      readonly correo: string
      /** Se enseñan UNA vez. Después ya no existen en ninguna parte legible. */
      readonly secreto: string
      readonly codigos: readonly string[]
    }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Aceptar la invitación: crea la cuenta con su clave, su segundo factor y sus diez
 * códigos de recuperación.
 *
 * Los tres se generan aquí y se enseñan una sola vez. La base de datos guarda el
 * hash de la clave, el secreto del segundo factor —que hace falta para comprobar el
 * código— y **solo la huella** de cada código de recuperación.
 */
export async function aceptar(
  q: Consulta, ficha: string, clave: string, idioma: Idioma,
): Promise<Aceptada> {
  if (clave.length < 12) return { hecho: false, motivo: t(idioma, 'persona.error.clave_corta') }
  const i = await abrirInvitacion(q, ficha)
  if (!i) return { hecho: false, motivo: t(idioma, 'persona.error.ficha') }

  const secreto = nuevoSecreto()
  const [r] = (await q`
    select aceptar_invitacion(${huellaFicha(ficha)}, ${await cifrarClave(clave)},
                              ${secreto}) as id
  `) as unknown as Array<{ id: string }>

  const codigos = generarCodigosRecuperacion()
  for (const c of codigos) {
    await q`insert into codigo_recuperacion (persona_id, huella)
            values (${r!.id}::uuid, ${huellaCodigo(c)})`
  }
  return { hecho: true, correo: i.correo, secreto, codigos }
}

/** Las empresas a las que se puede invitar a alguien. */
export async function empresas(
  q: Consulta,
): Promise<readonly { id: string; nombre: string; interna: boolean }[]> {
  const filas = (await q`
    select id, nombre, (tipo = 'gps') as interna from organizacion
     where tipo in ('gps','operadora')
     order by tipo <> 'gps', nombre
  `) as unknown as Array<{ id: string; nombre: string; interna: boolean }>
  return filas
}
