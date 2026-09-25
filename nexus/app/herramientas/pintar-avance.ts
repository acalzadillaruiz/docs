/**
 * Genera la pantalla del avance de un renglón a partir de la base de datos de verdad.
 *
 * No es parte de la aplicación: es la herramienta que permite mirar una pantalla sin
 * desplegar nada, para revisar diseño y para enseñar avance.
 *
 *   NEXUS_PERSONA=<uuid> node --experimental-strip-types \
 *     herramientas/pintar-avance.ts <renglon> <es|en> <salida.html> [cliente]
 */

import { writeFileSync } from 'node:fs'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { avanceDelRenglon, cabeceraDelRenglon } from '../src/dominio/evidencia.ts'
import { pintarPaginaAvance } from '../src/pantallas/evidencia.ts'
import type { Idioma } from '../src/i18n/t.ts'

const [renglonId, idiomaArg, salida, comoCliente] = process.argv.slice(2)
if (!renglonId || !idiomaArg || !salida) {
  console.error('uso: pintar-avance.ts <renglon> <es|en> <salida.html> [cliente]')
  process.exit(1)
}
const idioma = idiomaArg as Idioma
const esCliente = comoCliente === 'cliente'

const persona = process.env.NEXUS_PERSONA
if (!persona) { console.error('falta NEXUS_PERSONA'); process.exit(1) }

conectar({ host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' })

try {
  const html = await comoPersona(
    { id: persona }, esCliente ? 'nexus_cliente' : 'nexus_interno',
    async (q) => pintarPaginaAvance(
      await avanceDelRenglon(q, renglonId, idioma),
      await cabeceraDelRenglon(q, renglonId, idioma),
      idioma,
      esCliente ? null : { antifalsificacion: 'ejemplo-para-mirar', volver: '/' },
    ),
  )
  writeFileSync(salida, html, 'utf-8')
  console.log(`escrito ${salida}`)
} finally {
  await cerrar()
}
