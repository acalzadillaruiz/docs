/** Genera la pantalla de la cartera desde la base de datos real, sin desplegar nada. */
import { writeFileSync } from 'node:fs'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { cartera } from '../src/dominio/cartera.ts'
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
  const lista = await comoPersona({ id: personaId }, rol, (q) => cartera(q, idiomaArg as Idioma))
  writeFileSync(salida, pintarCartera(lista, idiomaArg as Idioma, rol === 'nexus_cliente'), 'utf-8')
  console.log(`escrito ${salida} · ${lista.length} contrato(s)`)
} finally { await cerrar() }
