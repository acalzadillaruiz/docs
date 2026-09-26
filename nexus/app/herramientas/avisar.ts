/**
 * Vacía la cola de avisos, y hace la limpieza de la casa. Se llama desde fuera, una
 * vez cada pocos minutos.
 *
 * Lo segundo va aquí y no en un segundo servicio por lo mismo que existe `bucle.ts`:
 * dos cosas que instalar son dos cosas que se pueden olvidar de instalar, y el
 * mantenimiento llegó aquí precisamente porque se olvidó. `caducar_sesiones()` y
 * `limpiar_peticiones_sso()` llevaban meses escritas y **sin que nadie las llamara**.
 * Se hace una vez por hora, no cada vuelta: una sesión vencida que se cierra una hora
 * tarde no la nota nadie.
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
 *     node --experimental-strip-types herramientas/avisar.ts [--parados] [--repetir=180]
 *
 * Con `--repetir=<segundos>` no termina: se queda dando vueltas. Es lo que se pone
 * bajo systemd y se olvida. Sin él hace una pasada y sale, que es lo que quiere cron.
 * Se prefiere lo primero: una línea de cron mal escrita no da error, simplemente no
 * avisa, y eso no se descubre hasta que alguien se queja de que no le llegó nada.
 *
 * Se para con Ctrl-C o con `systemctl stop`: termina la vuelta que tenga a medias y
 * entonces sale. Cortar a mitad de un envío dejaría avisos tomados y sin mandar.
 *
 * Sin buzón configurado escribe en el registro lo que habría mandado, para poder
 * arrancar el primer día sin tener el correo listo. Un sistema que no arranca sin el
 * correo configurado es un sistema que no arranca.
 */

import { conectar, cerrar, comoPersona, type Destino } from '../src/db/conexion.ts'
import { vaciarCola, encolarLoParado, type Resultado } from '../src/dominio/avisos.ts'
import { limpiar, tocaLimpiar, type Limpieza } from '../src/dominio/mantenimiento.ts'
import { CorreoSmtp, CorreoAlRegistro } from '../src/servidor/correo.ts'
import { repetir } from '../src/servidor/bucle.ts'

/**
 * Una variable de entorno que hace falta, o nos vamos diciendo CUÁL falta.
 *
 * Antes eran dos constantes y un `if` que salía nombrando las dos, así que quien se
 * olvidaba de una leía las dos y las miraba las dos. Y de paso: este archivo nunca se
 * comprobó con TypeScript —`tsconfig.json` solo incluía `src/` y `pruebas/`— y el
 * estrechamiento del `if` no llegaba al interior de las funciones, así que había once
 * errores de tipos escondidos en el servicio de avisos, que es uno de los cinco que
 * levanta el despliegue.
 */
function exigir(nombre: string): string {
  const v = process.env[nombre]
  if (!v) {
    console.error(`falta la variable de entorno ${nombre}`)
    process.exit(1)
  }
  return v
}

const SERVICIO = exigir('NEXUS_PERSONA_SERVICIO')
const BASE = exigir('NEXUS_BASE')

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

// --repetir=<segundos>. Sin valor, tres minutos. Un valor que no sea un número se
// rechaza en vez de caer en NaN: `--repetir=tres` daría un bucle sin espera.
const bandera = process.argv.find((a) => a === '--repetir' || a.startsWith('--repetir='))
let repetirCada: number | null = null
if (bandera) {
  const dicho = bandera.includes('=') ? bandera.split('=')[1]! : '180'
  const segundos = Number(dicho)
  if (!Number.isFinite(segundos) || segundos <= 0) {
    console.error(`--repetir quiere segundos, y le llegó «${dicho}»`)
    process.exit(1)
  }
  repetirCada = Math.max(segundos, 10) * 1000
}

conectar(BD)

/**
 * Cuándo se limpió por última vez. Vive en memoria a propósito: si el proceso se
 * reinicia, limpiar una vez de más no cuesta nada, y guardarlo en la base de datos
 * sería una tabla más que mantener para ahorrar un borrado que no borra nada.
 */
let ultimaLimpieza: number | null = null

/** Lo que devuelve una pasada. Escrito, porque sin el tipo puesto a mano la llamada a
 *  `comoPersona` no lo dedujo y todo lo de dentro quedaba en `unknown`. */
type Pasada = Resultado & {
  readonly parados: number
  readonly casa: Limpieza | null
}

/** Una pasada: encolar lo parado si toca, vaciar la cola, y limpiar si toca. */
async function pasada() {
  const r = await comoPersona<Pasada>({ id: SERVICIO }, 'nexus_interno', async (q) => {
    // Una vez al día se le pide además que encole lo que lleva parado. Un documento
    // sin revisar no es un suceso: es la ausencia de uno, y nadie encola nada cuando
    // algo NO pasa.
    const parados = process.argv.includes('--parados')
      ? await encolarLoParado(q, Number(process.env.NEXUS_DIAS_PARADO ?? 3))
      : 0
    const cola = await vaciarCola(q, transporte, BASE)

    // El mantenimiento va aquí y no en un segundo servicio porque dos cosas que
    // instalar son dos cosas que se pueden olvidar de instalar — y este trozo existe
    // justamente porque se olvidaron. Una vez por hora, no cada vuelta: una sesión
    // vencida que se cierra una hora tarde no la nota nadie.
    const ahora = Date.now()
    const casa = tocaLimpiar(ultimaLimpieza, ahora) ? await limpiar(q) : null
    if (casa) ultimaLimpieza = ahora

    return { parados, ...cola, casa }
  })
  // En marcha continua no se escribe una línea cada tres minutos por no decir nada:
  // un registro lleno de ceros es un registro que nadie lee, y entonces tampoco se
  // lee la línea del día que sí falló.
  if (!repetirCada || r.enviados > 0 || r.fallidos > 0 || r.parados > 0) {
    console.log(`avisos: ${r.enviados} enviados, ${r.fallidos} fallidos` +
      (r.parados ? `, ${r.parados} encolados por llevar días parados` : ''))
  }
  const c = r.casa
  if (c && (c.sesiones > 0 || c.peticiones > 0 || c.intentos > 0)) {
    console.log(`mantenimiento: ${c.sesiones} sesiones caducadas, ` +
      `${c.peticiones} peticiones de SSO, ${c.intentos} intentos de entrada`)
  }
  return r
}

try {
  if (repetirCada === null) {
    const r = await pasada()
    // Una pasada suelta avisa con el código de salida: es lo que mira cron.
    if (r.fallidos > 0) process.exitCode = 1
  } else {
    // En marcha continua, un fallo NO es motivo para salir: el bucle lo anota y
    // vuelve a intentarlo. Salir dejaría de mandar todo lo demás.
    let vivo = true
    const parar = (senal: string) => {
      if (!vivo) return
      vivo = false
      console.log(`avisos: ${senal} recibido, termino la vuelta y salgo`)
    }
    process.on('SIGINT', () => parar('SIGINT'))
    process.on('SIGTERM', () => parar('SIGTERM'))

    console.log(`avisos: en marcha, una vuelta cada ${repetirCada / 1000} s`)
    await repetir({
      cada: repetirCada,
      seguir: () => vivo,
      trabajo: async () => { await pasada() },
      fallo: (e, seguidos) =>
        console.error(`avisos: vuelta fallida (${seguidos} seguidas): ` +
          String((e as Error).message ?? e)),
    })
  }
} finally {
  await cerrar()
}
