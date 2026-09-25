/**
 * El icono de la aplicación, dibujado aquí.
 *
 * No es un archivo binario metido en el repositorio: es código que produce los
 * píxeles. Un PNG en git es un objeto que nadie puede revisar ni explicar — se
 * cambia y el diff dice «binario». Esto se lee, se discute y se prueba.
 *
 * **El dibujo es la tesis del producto.** Es la misma barra que sale en cada
 * contrato: el tramo sólido es lo verificado y el rayado es lo que alguien declaró
 * y todavía no se puede demostrar. Si el icono del teléfono dice eso, dice lo único
 * que hay que entender de este sistema.
 */

import { deflateSync } from 'node:zlib'

const NAVY = [0x0b, 0x21, 0x37] as const
const VERDE = [0x07, 0x73, 0x4a] as const
const AMBAR = [0x94, 0x63, 0x07] as const

/** CRC-32, que es lo que exige cada trozo de un PNG. */
function crc32(datos: Uint8Array): number {
  let c = 0xffffffff
  for (const b of datos) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (c ^ 0xffffffff) >>> 0
}

function trozo(tipo: string, datos: Uint8Array): Buffer {
  const cabecera = Buffer.alloc(8)
  cabecera.writeUInt32BE(datos.length, 0)
  cabecera.write(tipo, 4, 'ascii')
  const cuerpo = Buffer.concat([cabecera.subarray(4), datos])
  const cola = Buffer.alloc(4)
  cola.writeUInt32BE(crc32(cuerpo), 0)
  return Buffer.concat([cabecera, datos, cola])
}

/**
 * El PNG del icono, del tamaño que se pida.
 *
 * Se dibuja con la zona segura de un icono enmascarable: los bordes se los puede
 * comer un recorte circular, así que la barra vive en el 60% central.
 */
export function iconoPng(lado = 180): Buffer {
  const fila = (y: number): Uint8Array => {
    const px = new Uint8Array(lado * 3)
    // La barra: alto ~10% del lado, centrada.
    const alto = Math.max(4, Math.round(lado * 0.1))
    const y0 = Math.round((lado - alto) / 2)
    const x0 = Math.round(lado * 0.22)
    const x1 = Math.round(lado * 0.78)
    const corte = Math.round(x0 + (x1 - x0) * 0.62)

    for (let x = 0; x < lado; x++) {
      let c: readonly number[] = NAVY
      if (y >= y0 && y < y0 + alto && x >= x0 && x < x1) {
        // Sólido lo verificado; rayado lo declarado sin demostrar, igual que en la
        // pantalla. El rayado se hace con la diagonal, no con un color más flojo:
        // un color más flojo parecería lo mismo pero menos importante, y no es eso.
        c = x < corte ? VERDE : ((x + y) % 8 < 4 ? AMBAR : NAVY)
      }
      px[x * 3] = c[0]!
      px[x * 3 + 1] = c[1]!
      px[x * 3 + 2] = c[2]!
    }
    return px
  }

  const crudo = Buffer.alloc(lado * (lado * 3 + 1))
  for (let y = 0; y < lado; y++) {
    const inicio = y * (lado * 3 + 1)
    crudo[inicio] = 0 // filtro «ninguno»
    crudo.set(fila(y), inicio + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(lado, 0)
  ihdr.writeUInt32BE(lado, 4)
  ihdr[8] = 8   // ocho bits por canal
  ihdr[9] = 2   // color verdadero, sin transparencia
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(crudo, { level: 9 })),
    trozo('IEND', new Uint8Array()),
  ])
}

/** El mismo dibujo en vectorial, que es lo que prefiere un navegador moderno. */
export function iconoSvg(): string {
  const hex = (c: readonly number[]) =>
    `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">
<rect width="180" height="180" fill="${hex(NAVY)}"/>
<defs><pattern id="r" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
<rect width="4" height="8" fill="${hex(AMBAR)}"/></pattern></defs>
<rect x="40" y="81" width="60" height="18" fill="${hex(VERDE)}"/>
<rect x="100" y="81" width="40" height="18" fill="url(#r)"/>
</svg>`
}
