/** Genera la pantalla de la cartera desde la base de datos real, sin desplegar nada. */
import { writeFileSync } from 'node:fs'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { cartera } from '../src/dominio/cartera.ts'
import { bandeja } from '../src/dominio/bandeja.ts'
import { pintarCartera } from '../src/pantallas/cartera.ts'
import type { Idioma } from '../src/i18n/t.ts'

const [personaId, rolArg, idiomaArg, salida] = process.argv.slice(2)
if (!personaId || !rolArg || !idiomaArg || !salida) {
  console.error('uso: cartera.ts <persona> <interno|cliente> <es|en> <salida.html>')
  process.exit(1)
}
const rol = rolArg === 'cliente' ? 'nexus_cliente' : 'nexus_interno'
conectar({ host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' })
try {
  const d = await comoPersona({ id: personaId }, rol, async (q) => ({
    lista: await cartera(q, idiomaArg as Idioma),
    pendientes: rol === 'nexus_cliente' ? [] : await bandeja(q, idiomaArg as Idioma),
  }))
  writeFileSync(salida, pintarCartera(d.lista, idiomaArg as Idioma,
    rol === 'nexus_cliente', d.pendientes), 'utf-8')
  console.log(`escrito ${salida} · ${d.lista.length} contrato(s), ${d.pendientes.length} pendiente(s)`)
} finally { await cerrar() }
