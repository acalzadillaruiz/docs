/**
 * Vacía la cola de avisos. Se llama desde fuera, una vez cada pocos minutos.
 *
 * Va aparte del servidor web a propósito. Mandar correo dentro del proceso que
 * atiende peticiones significa que un servidor de correo lento hace lenta la
 * aplicación, y que reiniciar el servidor a mitad de un envío deja la cola a medias.
 * Separado, lo peor que pasa es que los avisos salgan unos minutos más tarde.
 *
 *   NEXUS_PERSONA_SERVICIO=<uuid> NEXUS_BASE=https://nexus.gps \
 *   NEXUS_BD_SOCKET=/var/run/postgresql \
 *   [NEXUS_SMTP=anfitrion:puerto NEXUS_SMTP_USUARIO=… NEXUS_SMTP_CLAVE=… \
 *    NEXUS_SMTP_DESDE=avisos@…] \
 *     node --experimental-strip-types herramientas/avisar.ts [--parados]
 *
 * Sin buzón configurado escribe en el registro lo que habría mandado, para poder
 * arrancar el primer día sin tener el correo listo. Un sistema que no arranca sin el
 * correo configurado es un sistema que no arranca.
 */

import { conectar, cerrar, comoPersona, type Destino } from '../src/db/conexion.ts'
import { vaciarCola, encolarLoParado } from '../src/dominio/avisos.ts'
import { CorreoSmtp, CorreoAlRegistro } from '../src/servidor/correo.ts'

const SERVICIO = process.env.NEXUS_PERSONA_SERVICIO
const BASE = process.env.NEXUS_BASE
if (!SERVICIO || !BASE) {
  console.error('faltan NEXUS_PERSONA_SERVICIO y NEXUS_BASE')
  process.exit(1)
}

const BD: Destino | undefined = process.env.NEXUS_BD_SOCKET
  ? {
      host: process.env.NEXUS_BD_SOCKET,
      port: Number(process.env.NEXUS_BD_PUERTO ?? 5432),
      database: process.env.NEXUS_BD_NOMBRE ?? 'nexus',
      username: process.env.NEXUS_BD_USUARIO ?? 'nexus',
    }
  : process.env.NEXUS_BD
if (!BD) { console.error('falta NEXUS_BD o NEXUS_BD_SOCKET'); process.exit(1) }

const smtp = process.env.NEXUS_SMTP
const transporte = smtp
  ? new CorreoSmtp({
      anfitrion: smtp.split(':')[0]!,
      puerto: Number(smtp.split(':')[1] ?? 587),
      usuario: process.env.NEXUS_SMTP_USUARIO ?? '',
      clave: process.env.NEXUS_SMTP_CLAVE ?? '',
      desde: process.env.NEXUS_SMTP_DESDE ?? 'avisos@gps-nexus',
      nombreDesde: process.env.NEXUS_SMTP_NOMBRE ?? 'GPS Nexus',
    })
  : new CorreoAlRegistro()

conectar(BD)

try {
  const r = await comoPersona({ id: SERVICIO }, 'nexus_interno', async (q) => {
    // Una vez al día se le pide además que encole lo que lleva parado. Un documento
    // sin revisar no es un suceso: es la ausencia de uno, y nadie encola nada cuando
    // algo NO pasa.
    const parados = process.argv.includes('--parados')
      ? await encolarLoParado(q, Number(process.env.NEXUS_DIAS_PARADO ?? 3))
      : 0
    const cola = await vaciarCola(q, transporte, BASE)
    return { parados, ...cola }
  })
  console.log(`avisos: ${r.enviados} enviados, ${r.fallidos} fallidos` +
    (r.parados ? `, ${r.parados} encolados por llevar días parados` : ''))
  if (r.fallidos > 0) process.exitCode = 1
} finally {
  await cerrar()
}
