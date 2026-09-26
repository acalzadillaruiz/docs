/**
 * La primera vez, en un servidor de verdad.
 *
 * Un despliegue recién hecho tiene el esquema puesto y **cero personas**. Invitar a
 * alguien exige una sesión, y abrir una sesión exige ser alguien: sin esto, la
 * aplicación arranca perfectamente y no hay forma de entrar. Es exactamente la clase de
 * puerta cerrada que este proyecto lleva días abriendo en otros sitios, y sería
 * ridículo dejarla en la puerta de la calle.
 *
 *   NEXUS_BD=postgres://… NEXUS_BASE=https://nexus.ejemplo.com \
 *     node --experimental-strip-types herramientas/instalar.ts \
 *       "GPS Supply" J-30123456-7 tu.correo@empresa.com "Tu Nombre"
 *
 * Qué deja hecho:
 *
 *   1. La organización de GPS. Es la interna: la que ve la contabilidad.
 *   2. La cuenta de servicio con la que el servidor consulta la base. **No puede
 *      entrar**: lleva una clave y un segundo factor aleatorios que no se imprimen en
 *      ninguna parte, y queda inactiva, así que ninguna sesión se abre con ella. Eso no
 *      es una convención: lo impide la propia consulta que valida las sesiones.
 *   3. El plan de cuentas propuesto, si la empresa no tenía uno.
 *   4. Una invitación para ti, e imprime el enlace.
 *
 * El enlace es lo único que hay que guardar. Al abrirlo eliges tu clave y recibes tu
 * segundo factor y tus diez códigos de recuperación — una sola vez, como cualquier otra
 * persona. Desde ahí, en Personas y accesos, invitas a los demás.
 *
 * Correrlo dos veces no rompe nada: si ya existe la organización la reutiliza, y si ya
 * hay una invitación viva para ese correo lo dice en vez de crear otra.
 */

import { randomBytes } from 'node:crypto'
import { conectar, cerrar, comoDueno, comoPersona } from '../src/db/conexion.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { invitar } from '../src/dominio/personas.ts'

const [nombre, rif, correo, quien] = process.argv.slice(2)
if (!nombre || !rif || !correo || !quien) {
  console.error(
    'uso: instalar.ts "<nombre de la empresa>" <RIF> <tu correo> "<tu nombre>"\n' +
    '  ejemplo: instalar.ts "GPS Supply" J-30123456-7 ana@gps.com "Ana Pérez"')
  process.exit(1)
}
if (!/^[JGVEP]-\d{8,9}-\d$/i.test(rif)) {
  console.error(`«${rif}» no tiene forma de RIF. Se espera algo como J-30123456-7.`)
  process.exit(1)
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) {
  console.error(`«${correo}» no tiene forma de correo.`)
  process.exit(1)
}

const BASE = process.env.NEXUS_BASE
if (!BASE) {
  console.error('falta NEXUS_BASE, la dirección pública (https://nexus.ejemplo.com):\n' +
    'hace falta para poder imprimir el enlace de alta entero.')
  process.exit(1)
}

const BD = process.env.NEXUS_BD_SOCKET
  ? {
      host: process.env.NEXUS_BD_SOCKET,
      port: Number(process.env.NEXUS_BD_PUERTO ?? 5432),
      database: process.env.NEXUS_BD_NOMBRE ?? 'nexus',
      username: process.env.NEXUS_BD_USUARIO ?? 'nexus',
    }
  : process.env.NEXUS_BD
if (!BD) { console.error('falta NEXUS_BD o NEXUS_BD_SOCKET'); process.exit(1) }

conectar(BD)

/** Un secreto que nadie va a ver. No se imprime ni se guarda fuera de la base. */
const ALFABETO32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const irrepetible = (n: number) => {
  let s = ''
  for (const b of randomBytes(n)) s += ALFABETO32[b % 32]
  return s
}

try {
  const { org, servicio, plan } = await comoDueno(async (q) => {
    const [ya] = (await q`
      select id from organizacion where tipo = 'gps' order by creada_en limit 1
    `) as unknown as Array<{ id: string }>

    let org = ya?.id ?? null
    if (org === null) {
      const [nueva] = (await q`
        insert into organizacion (tipo, nombre, rif) values ('gps', ${nombre}, ${rif})
        returning id`) as unknown as Array<{ id: string }>
      org = nueva!.id
      console.log(`  empresa       ${nombre} · ${rif}`)
    } else {
      console.log(`  empresa       ya existía, se reutiliza`)
    }

    // La cuenta de servicio. Inactiva y con credenciales que nadie tiene: el servidor
    // la usa para consultar, y no hay forma de entrar con ella.
    const [srv] = (await q`
      select id from persona where organizacion_id = ${org}::uuid
        and correo = ${`servicio@${rif.toLowerCase()}`}
    `) as unknown as Array<{ id: string }>
    let servicio = srv?.id ?? null
    if (servicio === null) {
      const [nueva] = (await q`
        insert into persona (organizacion_id, correo, nombre, metodo, clave_hash,
                             totp_secreto, activa)
        values (${org}::uuid, ${`servicio@${rif.toLowerCase()}`}, 'Cuenta de servicio',
                'clave_2fa', ${await cifrarClave(irrepetible(40))}, ${irrepetible(32)},
                false)
        returning id`) as unknown as Array<{ id: string }>
      servicio = nueva!.id
    }

    const [cuentas] = (await q`
      select count(*)::int as n from cuenta where organizacion_id = ${org}::uuid
    `) as unknown as Array<{ n: number }>
    let plan = Number(cuentas?.n ?? 0)
    if (plan === 0) {
      await q`select instalar_plan_cuentas(${org}::uuid)`
      const [despues] = (await q`
        select count(*)::int as n from cuenta where organizacion_id = ${org}::uuid
      `) as unknown as Array<{ n: number }>
      plan = Number(despues?.n ?? 0)
      await q`select marcar_monetarias(${org}::uuid)`
    }
    return { org: org!, servicio: servicio!, plan }
  })

  console.log(`  plan          ${plan} cuentas`)
  console.log(`  servicio      ${servicio}`)

  // La invitación, ya como la cuenta de servicio: así pasa por las mismas reglas que
  // cualquier invitación hecha desde la pantalla, incluidas las políticas de fila.
  const r = await comoPersona({ id: servicio }, 'nexus_interno', (q) =>
    invitar(q, { orgId: org, correo, nombre: quien, idioma: 'es' }, servicio, 'es'))

  if (!r.hecho) {
    console.error(`\nNo se pudo invitar a ${correo}: ${r.motivo}`)
    console.error('Si ya hay una invitación viva, busca el enlace que se imprimió\n' +
      'entonces, o anúlala desde Personas y accesos y vuelve a invitar.')
    process.exitCode = 1
  } else {
    console.log(`
  ────────────────────────────────────────────────────────────────
   Abre este enlace para crear tu cuenta. Caduca en siete días y
   solo sirve una vez:

   ${BASE.replace(/\/+$/, '')}/invitacion?f=${r.ficha}

   Al abrirlo eliges tu clave y recibes tu segundo factor y tus diez
   códigos de recuperación. Se enseñan UNA vez: guárdalos entonces.
  ────────────────────────────────────────────────────────────────

   Y apunta esto en la configuración del servidor, que es la cuenta
   con la que consulta la base de datos:

     NEXUS_PERSONA_SERVICIO=${servicio}
`)
  }
} finally {
  await cerrar()
}
