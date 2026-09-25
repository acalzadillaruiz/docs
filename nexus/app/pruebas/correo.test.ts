/**
 * El cliente de SMTP, contra un servidor de mentira que habla SMTP de verdad.
 *
 * Es lo único de todo el sistema que habla con una máquina de otro, así que aquí no
 * basta con probar las funciones sueltas: se levanta un servidor que responde como
 * responde uno real y se comprueba la conversación entera, orden por orden.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server, type Socket } from 'node:net'
import { CorreoSmtp, CorreoAlRegistro, cabeceraLimpia, cuerpoEscapado } from '../src/servidor/correo.ts'
import type { Redactado } from '../src/dominio/avisos.ts'

const CARTA: Redactado = {
  para: 'ana@operadora.test',
  asunto: 'Valuación 3 de GPS-2026-014',
  texto: 'Hola Ana,\n\nHay algo esperándote.\n.\nY esta línea empieza por punto.',
  enlace: 'https://nexus.gps/valuaciones/x',
}

/** Un servidor que habla SMTP y apunta todo lo que le dicen. */
function servidorDeMentira(opciones: { starttls?: boolean; rechaza?: string } = {}):
  Promise<{ servidor: Server; puerto: number; dicho: string[] }> {
  const dicho: string[] = []
  return new Promise((cumplir) => {
    const servidor = createServer((s: Socket) => {
      let enDatos = false
      s.setEncoding('utf-8')
      s.write('220 correo.de.mentira ESMTP\r\n')
      s.on('data', (t: string) => {
        for (const linea of t.split('\r\n')) {
          if (linea === '' && !enDatos) continue
          if (enDatos) {
            dicho.push(`DATA:${linea}`)
            if (linea === '.') { enDatos = false; s.write('250 2.0.0 Ok\r\n') }
            continue
          }
          dicho.push(linea)
          const orden = linea.split(' ')[0]?.toUpperCase()
          if (opciones.rechaza && linea.startsWith(opciones.rechaza)) {
            s.write('550 5.1.1 no existe ese buzón\r\n')
            continue
          }
          switch (orden) {
            case 'EHLO':
              s.write('250-correo.de.mentira\r\n250-SIZE 35882577\r\n')
              if (opciones.starttls) s.write('250-STARTTLS\r\n')
              s.write('250 AUTH LOGIN PLAIN\r\n')
              break
            case 'AUTH': s.write('334 VXNlcm5hbWU6\r\n'); break
            case 'MAIL': case 'RCPT': s.write('250 2.1.0 Ok\r\n'); break
            case 'DATA': enDatos = true; s.write('354 adelante\r\n'); break
            case 'QUIT': s.write('221 adiós\r\n'); s.end(); break
            default:
              // El usuario y la clave en base64 llegan como líneas sueltas.
              s.write(dicho.filter((d) => d === 'AUTH LOGIN').length > 0 &&
                      dicho.filter((d) => /^[A-Za-z0-9+/=]+$/.test(d)).length === 1
                ? '334 UGFzc3dvcmQ6\r\n' : '235 2.7.0 autenticado\r\n')
          }
        }
      })
    })
    servidor.listen(0, '127.0.0.1', () => {
      cumplir({ servidor, puerto: (servidor.address() as { port: number }).port, dicho })
    })
  })
}

const buzon = (puerto: number) => ({
  anfitrion: '127.0.0.1', puerto, usuario: 'avisos@gps.test', clave: 'la-del-buzón',
  desde: 'avisos@gps.test', nombreDesde: 'GPS Nexus',
})

test('sin cifrado NO se manda la contraseña: la conversación se corta', async () => {
  // Un servidor de correo que no ofrece cifrado no es un servidor con el que
  // negociar: es un error de configuración, y seguir mandaría la clave por la red.
  const { servidor, puerto, dicho } = await servidorDeMentira({ starttls: false })
  try {
    await assert.rejects(
      new CorreoSmtp(buzon(puerto)).enviar(CARTA),
      /no ofrece cifrado/,
    )
    assert.equal(dicho.some((d) => d.startsWith('AUTH')), false, 'no llegó a autenticar')
    assert.equal(dicho.some((d) => d.includes('MAIL FROM')), false)
  } finally { servidor.close() }
})

test('la conversación va en orden: saludo, cifrado, identificarse, y entonces el correo', async () => {
  const { servidor, puerto, dicho } = await servidorDeMentira({ starttls: true })
  try {
    // El servidor de mentira no levanta TLS de verdad, así que el intento falla
    // DESPUÉS de haber pedido STARTTLS. Lo que importa es el orden hasta ahí.
    await assert.rejects(new CorreoSmtp(buzon(puerto)).enviar(CARTA))
    assert.equal(dicho[0], 'EHLO gps-nexus')
    assert.equal(dicho[1], 'STARTTLS')
    // Y la contraseña no se dijo antes de pedir el cifrado.
    assert.equal(dicho.indexOf('AUTH LOGIN'), -1)
  } finally { servidor.close() }
})

test('una cabecera no puede llevar saltos de línea', () => {
  // Sin esto, un nombre con un salto dentro añade cabeceras propias al correo: un
  // destinatario oculto, otro remitente, lo que quiera quien lo escribió.
  assert.equal(
    cabeceraLimpia('Ana\r\nBcc: espia@otro.sitio'),
    'Ana Bcc: espia@otro.sitio',
  )
  assert.equal(/[\r\n]/.test(cabeceraLimpia('a\nb\rc')), false)
  assert.equal(cabeceraLimpia('x'.repeat(900)).length, 400)
  // Y el nulo tampoco pasa.
  assert.equal(cabeceraLimpia('a\u0000b'), 'a b')
})

test('una línea que sea solo un punto no termina el mensaje a mitad', () => {
  // Es el fallo clásico de quien escribe SMTP a mano: el resto del correo se
  // interpretaría como órdenes del protocolo.
  const escapado = cuerpoEscapado('uno\n.\ndos\n.punto al principio')
  assert.equal(escapado.includes('\r\n.\r\n'), false)
  assert.match(escapado, /\r\n\.\.\r\n/)
  assert.match(escapado, /\r\n\.\.punto al principio/)
})

test('todo salto de línea sale como CRLF, que es lo que exige el protocolo', () => {
  assert.equal(cuerpoEscapado('a\nb\r\nc'), 'a\r\nb\r\nc')
})

test('el transporte al registro no escribe la dirección entera', async () => {
  // Un registro se comparte y se pega en un chat, y un correo es un dato personal.
  const antes = console.log
  const dicho: string[] = []
  console.log = (...a: unknown[]) => { dicho.push(a.join(' ')) }
  try {
    await new CorreoAlRegistro().enviar(CARTA)
  } finally { console.log = antes }
  assert.equal(dicho[0]!.includes('ana@operadora.test'), false)
  assert.match(dicho[0]!, /an…@operadora\.test/)
  assert.match(dicho[0]!, /Valuación 3/)
})
