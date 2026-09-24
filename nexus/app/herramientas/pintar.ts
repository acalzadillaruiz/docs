/**
 * Genera la pantalla de una valuación a partir de la base de datos de verdad.
 *
 * No es parte de la aplicación: es la herramienta que permite mirar una pantalla
 * sin tener que desplegar nada. Útil para revisar diseño y para enseñar el avance.
 *
 *   node --experimental-strip-types herramientas/pintar.ts <valuacion> <es|en> <salida.html>
 */

import { writeFileSync } from 'node:fs'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { hojaDeValuacion } from '../src/dominio/valuacion.ts'
import { pintarValuacion } from '../src/pantallas/valuacion.ts'
import { t, fecha as formatearFecha, type Idioma } from '../src/i18n/t.ts'

const [valuacionId, idiomaArg, salida] = process.argv.slice(2)
if (!valuacionId || !idiomaArg || !salida) {
  console.error('uso: pintar.ts <valuacion> <es|en> <salida.html>')
  process.exit(1)
}
const idioma = idiomaArg as Idioma

const persona = process.env.NEXUS_PERSONA
if (!persona) { console.error('falta NEXUS_PERSONA'); process.exit(1) }

conectar({ host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' })

try {
  const html = await comoPersona({ id: persona }, 'nexus_interno', async (q) => {
    const [cab] = (await q`
      select c.codigo as contrato, o.nombre as cliente, v.numero,
             v.periodo_desde, v.periodo_hasta, v.moneda, v.estado
        from valuacion v
        join contrato c on c.id = v.contrato_id
        join organizacion o on o.id = c.cliente_id
       where v.id = ${valuacionId}::uuid
    `) as unknown as Array<{
      contrato: string; cliente: string; numero: number
      periodo_desde: Date; periodo_hasta: Date; moneda: 'VES' | 'USD'; estado: string
    }>
    if (!cab) throw new Error('no se encuentra esa valuación')

    const lineas = await hojaDeValuacion(q, valuacionId, idioma, cab.moneda)
    return pintarValuacion({
      contrato: cab.contrato,
      cliente: cab.cliente,
      numero: cab.numero,
      desde: formatearFecha(idioma, cab.periodo_desde),
      hasta: formatearFecha(idioma, cab.periodo_hasta),
      moneda: cab.moneda,
      estado: t(idioma, `valuacion.estado.${cab.estado}` as never),
      lineas,
    }, idioma)
  })
  writeFileSync(salida, html, 'utf-8')
  console.log(`escrito ${salida} (${html.length} bytes)`)
} finally {
  await cerrar()
}
