/** Genera la ficha de un contrato desde la base de datos real. */
import { writeFileSync } from 'node:fs'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { ficha } from '../src/dominio/contrato.ts'
import { pintarContrato } from '../src/pantallas/contrato.ts'
import type { Idioma } from '../src/i18n/t.ts'

const [persona, rolArg, contratoId, idiomaArg, salida] = process.argv.slice(2)
if (!persona || !rolArg || !contratoId || !idiomaArg || !salida) {
  console.error('uso: contrato.ts <persona> <interno|cliente> <contrato> <es|en> <salida.html>')
  process.exit(1)
}
const esCliente = rolArg === 'cliente'
conectar({ host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' })
try {
  const f = await comoPersona({ id: persona }, esCliente ? 'nexus_cliente' : 'nexus_interno',
    (q) => ficha(q, contratoId, idiomaArg as Idioma, !esCliente))
  writeFileSync(salida, pintarContrato(f, idiomaArg as Idioma, esCliente), 'utf-8')
  console.log(`escrito ${salida} · ${f.renglones.length} renglón(es)`)
} finally { await cerrar() }
