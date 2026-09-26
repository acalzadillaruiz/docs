/**
 * El código de seis dígitos de la cuenta de muestra, ahora mismo.
 *
 * Existe porque sin esto la aplicación **no se puede abrir**: la entrada pide segundo
 * factor, y el segundo factor sale de una aplicación de códigos que quien acaba de
 * clonar el repositorio no tiene configurada. Arrancar el servidor y quedarse en la
 * pantalla de «tu código de seis dígitos» es exactamente la clase de puerta cerrada
 * que este proyecto lleva toda la semana abriendo en otros sitios.
 *
 *   node --experimental-strip-types herramientas/codigo.ts
 *
 * Solo sirve para la cuenta de muestra, cuyo secreto está escrito en `sembrar.ts` a la
 * vista de todos. Una cuenta de verdad tiene el suyo, se enseña una sola vez al
 * crearla, y no hay forma de sacarlo de aquí ni de ninguna otra parte.
 */

import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { MUESTRA } from './sembrar.ts'

const ahora = new Date()
const paso = pasoDe(ahora)
const codigo = codigoEnPaso(desdeBase32(MUESTRA.secreto), paso)
// Cuántos segundos le quedan de vida. Un código que caduca en dos segundos se copia,
// se pega y no vale, y entonces parece que la clave está mal.
const quedan = 30 - Math.floor(ahora.getTime() / 1000) % 30

console.log(`
  correo    ${MUESTRA.correo}
  clave     ${MUESTRA.clave}
  código    ${codigo}      (válido ${quedan} s más)
`)
if (quedan <= 5) {
  console.log('  Ese código está a punto de caducar. Vuelve a ejecutar esto.\n')
}
