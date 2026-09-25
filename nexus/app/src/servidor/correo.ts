/**
 * Por dónde sale el correo.
 *
 * SMTP escrito contra el protocolo, sin dependencia. El motivo es el mismo que en el
 * resto del servidor: son doscientas líneas, el protocolo lleva congelado desde 1982
 * (RFC 5321), y una dependencia aquí es código de otro que hay que entender el día
 * que un correo no llega y el cliente dice que nadie le avisó.
 *
 * Lo que hace y lo que no:
 *
 *   - Habla TLS desde el primer byte (SMTPS, puerto 465) o levanta TLS con STARTTLS
 *     (puerto 587). **Nunca manda la contraseña en claro**: si el servidor no ofrece
 *     STARTTLS y la conexión no era ya cifrada, se corta. Un servidor de correo que
 *     no ofrece cifrado no es un servidor con el que negociar: es un error de
 *     configuración, y seguir adelante mandaría la clave del buzón por la red.
 *   - Un correo por conexión. Es más lento y es deliberado: reutilizar la conexión
 *     obliga a llevar su estado, y la cola manda doce correos al día, no doce mil.
 *   - Solo texto. Nada de HTML, nada de adjuntos. El aviso es un empujón hacia la
 *     aplicación, no el contenido.
 */

import { connect as conectarTls, type TLSSocket } from 'node:tls'
import { connect as conectarPlano, type Socket } from 'node:net'
import type { Redactado, Transporte } from '../dominio/avisos.ts'

export type Buzon = {
  readonly anfitrion: string
  readonly puerto: number
  readonly usuario: string
  readonly clave: string
  /** El remitente que ve quien lo recibe. */
  readonly desde: string
  readonly nombreDesde: string
}

export class CorreoRechazado extends Error {
  readonly codigo: number
  constructor(paso: string, codigo: number, texto: string) {
    super(`el servidor de correo rechazó ${paso}: ${codigo} ${texto}`)
    this.name = 'CorreoRechazado'
    this.codigo = codigo
  }
}

/** Una conversación SMTP: se escribe una orden y se espera su respuesta. */
class Conversacion {
  private enchufe: Socket | TLSSocket
  private pendiente = ''
  private esperando: ((linea: string) => void) | null = null

  constructor(enchufe: Socket | TLSSocket) {
    this.enchufe = enchufe
    this.enchufe.setEncoding('utf-8')
    this.enchufe.on('data', (t: string) => this.recibir(t))
  }

  private recibir(texto: string): void {
    this.pendiente += texto
    // Una respuesta puede ocupar varias líneas. La última es la que lleva un espacio
    // después del código; las intermedias llevan un guion. Contestar a la primera
    // dejaría el resto encolado y descuadraría todas las órdenes siguientes.
    //
    // Y se devuelven TODAS las líneas, no solo la última. Lo que el servidor sabe
    // hacer —STARTTLS, por ejemplo— viene en las intermedias, así que quedarse con
    // la última es no enterarse de que ofrece cifrado y acabar mandando la clave en
    // claro, o cortando una conversación que sí se podía tener.
    const lineas = this.pendiente.split('\r\n')
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i]!
      if (/^\d{3} /.test(l)) {
        const entera = lineas.slice(0, i + 1).join('\r\n')
        this.pendiente = lineas.slice(i + 1).join('\r\n')
        const quien = this.esperando
        this.esperando = null
        quien?.(entera)
        return
      }
    }
  }

  respuesta(paso: string, espera: number): Promise<string> {
    return new Promise((cumplir, fallar) => {
      const reloj = setTimeout(() => fallar(new Error(`sin respuesta tras ${paso}`)), 30_000)
      this.esperando = (entera) => {
        clearTimeout(reloj)
        // El código que cuenta es el de la ÚLTIMA línea: las intermedias solo
        // enumeran lo que el servidor sabe hacer.
        const ultima = entera.split('\r\n').filter((l) => /^\d{3} /.test(l)).pop() ?? entera
        const codigo = Number(ultima.slice(0, 3))
        if (Math.floor(codigo / 100) !== espera) {
          fallar(new CorreoRechazado(paso, codigo, ultima.slice(4)))
          return
        }
        cumplir(entera)
      }
    })
  }

  async decir(orden: string, paso: string, espera = 2): Promise<string> {
    this.enchufe.write(orden + '\r\n')
    return this.respuesta(paso, espera)
  }

  escribir(texto: string): void {
    this.enchufe.write(texto)
  }

  get bruto(): Socket | TLSSocket { return this.enchufe }

  cerrar(): void {
    this.enchufe.removeAllListeners('data')
    this.enchufe.end()
  }

  cambiar(nuevo: TLSSocket): void {
    this.enchufe.removeAllListeners('data')
    this.enchufe = nuevo
    this.pendiente = ''
    this.esperando = null
    nuevo.setEncoding('utf-8')
    nuevo.on('data', (t: string) => this.recibir(t))
  }
}

function abrir(b: Buzon): Promise<Socket | TLSSocket> {
  return new Promise((cumplir, fallar) => {
    // 465 habla TLS desde el primer byte. 587 empieza en claro y sube con STARTTLS.
    const s = b.puerto === 465
      ? conectarTls({ host: b.anfitrion, port: b.puerto, servername: b.anfitrion })
      : conectarPlano({ host: b.anfitrion, port: b.puerto })
    s.once('error', fallar)
    s.once(b.puerto === 465 ? 'secureConnect' : 'connect', () => cumplir(s))
  })
}

/**
 * Una cabecera no puede llevar saltos de línea.
 *
 * Sin esto, un nombre con un `\r\n` dentro añade cabeceras propias al correo: un
 * destinatario oculto, otro remitente, lo que quiera quien lo escribió. Es la
 * inyección de cabeceras de toda la vida, y el nombre de una persona viene de la
 * base de datos, que viene de un formulario.
 */
export function cabeceraLimpia(valor: string): string {
  return valor.replace(/[\r\n\u0000]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)
}

/**
 * El punto al principio de una línea se dobla.
 *
 * Una línea que sea solo un punto termina el mensaje. Si el texto trae una, el resto
 * del correo se interpretaría como órdenes SMTP. Lo dice el propio RFC y es el fallo
 * clásico de quien escribe SMTP a mano.
 */
export function cuerpoEscapado(texto: string): string {
  return texto.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
}

function mensaje(b: Buzon, r: Redactado): string {
  const cabeceras = [
    `From: ${cabeceraLimpia(b.nombreDesde)} <${cabeceraLimpia(b.desde)}>`,
    `To: ${cabeceraLimpia(r.para)}`,
    // El asunto puede llevar acentos y eñes. Se codifica para que no llegue roto.
    `Subject: =?UTF-8?B?${Buffer.from(cabeceraLimpia(r.asunto), 'utf-8').toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    // Que los clientes de correo no agrupen avisos distintos en un solo hilo.
    `Message-ID: <${crypto.randomUUID()}@gps-nexus>`,
    'Auto-Submitted: auto-generated',
  ].join('\r\n')
  return `${cabeceras}\r\n\r\n${cuerpoEscapado(r.texto)}\r\n.\r\n`
}

export class CorreoSmtp implements Transporte {
  private buzon: Buzon
  constructor(buzon: Buzon) { this.buzon = buzon }

  async enviar(r: Redactado): Promise<void> {
    const b = this.buzon
    const c = new Conversacion(await abrir(b))
    let cifrado = b.puerto === 465
    try {
      await c.respuesta('el saludo', 2)
      let bienvenida = await c.decir(`EHLO gps-nexus`, 'EHLO')

      if (!cifrado) {
        if (!/STARTTLS/i.test(bienvenida)) {
          // Seguir adelante mandaría la clave del buzón por la red en claro.
          throw new Error('el servidor de correo no ofrece cifrado')
        }
        await c.decir('STARTTLS', 'STARTTLS')
        const seguro = await new Promise<TLSSocket>((cumplir, fallar) => {
          const s = conectarTls({ socket: c.bruto as Socket, servername: b.anfitrion })
          s.once('secureConnect', () => cumplir(s))
          s.once('error', fallar)
        })
        c.cambiar(seguro)
        cifrado = true
        // Tras subir a TLS hay que volver a saludar: lo anunciado antes no vale.
        bienvenida = await c.decir('EHLO gps-nexus', 'EHLO tras STARTTLS')
      }

      await c.decir('AUTH LOGIN', 'AUTH', 3)
      await c.decir(Buffer.from(b.usuario, 'utf-8').toString('base64'), 'el usuario', 3)
      await c.decir(Buffer.from(b.clave, 'utf-8').toString('base64'), 'la contraseña')

      await c.decir(`MAIL FROM:<${cabeceraLimpia(b.desde)}>`, 'el remitente')
      await c.decir(`RCPT TO:<${cabeceraLimpia(r.para)}>`, 'el destinatario')
      await c.decir('DATA', 'DATA', 3)
      c.escribir(mensaje(b, r))
      await c.respuesta('el mensaje', 2)
      await c.decir('QUIT', 'QUIT', 2).catch(() => {})
    } finally {
      c.cerrar()
    }
  }
}

/**
 * El transporte de cuando no hay buzón configurado: escribe en el registro.
 *
 * No es un apaño para pruebas: es lo que hace que se pueda poner esto a andar el
 * primer día, antes de tener un buzón, y ver qué se habría mandado. Un sistema que
 * no arranca sin el correo configurado es un sistema que no arranca.
 */
export class CorreoAlRegistro implements Transporte {
  async enviar(r: Redactado): Promise<void> {
    // La dirección NO se escribe entera: un registro se comparte y se pega en un
    // chat, y un correo es un dato personal.
    const [antes, dominio] = r.para.split('@')
    console.log(`[aviso] ${antes?.slice(0, 2)}…@${dominio} · ${r.asunto} · ${r.enlace}`)
  }
}
