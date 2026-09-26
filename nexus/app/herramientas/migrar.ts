/**
 * Cargar el esquema en una base de datos DE VERDAD.
 *
 * `probar.sh` borra la base y la crea entera en cada pasada, y para probar está bien.
 * En un servidor no: ahí hay datos, y cargar dos veces un archivo que hace
 * `create table` falla a la mitad y deja el esquema en un estado que no es ni el viejo
 * ni el nuevo.
 *
 * Así que esto lleva la cuenta. Aplica cada archivo de `db/schema` una sola vez, en
 * orden, y lo anota. Se ejecuta en cada despliegue y la segunda vez no hace nada.
 *
 *   NEXUS_BD=postgres://… node --experimental-strip-types herramientas/migrar.ts
 *
 * **Y si un archivo ya aplicado ha cambiado, se para y lo dice.** No lo aplica otra vez
 * —volver a correr un `create table` fallaría— ni lo salta en silencio, que es peor:
 * el servidor se quedaría con un esquema distinto del que dice el repositorio y nadie
 * se enteraría hasta que algo reventara. Un cambio en el esquema de una base con datos
 * se hace en un archivo NUEVO con el número siguiente. Eso es la disciplina que
 * separa un repositorio que se puede desplegar de uno que solo se puede probar.
 */

import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { conectar, cerrar, comoDueno } from '../src/db/conexion.ts'

const CARPETA = new URL('../../db/schema/', import.meta.url)

const BD = process.env.NEXUS_BD_SOCKET
  ? {
      host: process.env.NEXUS_BD_SOCKET,
      port: Number(process.env.NEXUS_BD_PUERTO ?? 5432),
      database: process.env.NEXUS_BD_NOMBRE ?? 'nexus',
      username: process.env.NEXUS_BD_USUARIO ?? 'nexus',
    }
  : process.env.NEXUS_BD
if (!BD) {
  console.error('falta NEXUS_BD o NEXUS_BD_SOCKET')
  process.exit(1)
}

conectar(BD)

const huella = (t: string) => createHash('sha256').update(t, 'utf-8').digest('hex').slice(0, 16)

/** Lo ya aplicado, y la tabla de control si es la primera vez. */
async function yaAplicado(): Promise<Map<string, string>> {
  return comoDueno(async (q) => {
    // Se crea ella misma, con `if not exists` para que la primera vez y la centésima
    // hagan lo mismo.
    await q.unsafe(`
      create table if not exists migracion (
        archivo     text primary key,
        huella      text not null,
        aplicada_en timestamptz not null default now()
      )`)
    const filas = (await q`select archivo, huella from migracion`) as unknown as
      Array<{ archivo: string; huella: string }>
    return new Map(filas.map((f) => [f.archivo, f.huella]))
  })
}

try {
  const aplicadas = await yaAplicado()
  const archivos = (await readdir(CARPETA))
    .filter((f) => /^[0-9].*\.sql$/.test(f))
    .sort()

  let nuevas = 0
  const cambiadas: string[] = []

  for (const archivo of archivos) {
    const texto = await readFile(new URL(archivo, CARPETA), 'utf8')
    const h = huella(texto)
    const ya = aplicadas.get(archivo)
    if (ya === h) continue
    if (ya !== undefined) { cambiadas.push(archivo); continue }

    // El archivo y su apunte, en la MISMA transacción. Si se apuntara aparte y el
    // proceso muriera en medio, el despliegue siguiente volvería a aplicarlo y
    // fallaría — o peor, lo daría por aplicado sin estarlo.
    await comoDueno(async (q) => {
      await q.unsafe(texto).simple()
      await q`insert into migracion (archivo, huella) values (${archivo}, ${h})`
    })
    console.log(`  aplicado  ${archivo}`)
    nuevas++
  }

  if (cambiadas.length > 0) {
    console.error('\nESQUEMA CAMBIADO DESPUÉS DE APLICARLO · no se toca nada')
    for (const f of cambiadas) console.error(`  ${f}`)
    console.error(
      '\nEsta base ya tiene esos archivos aplicados con otro contenido. Volver a\n' +
      'aplicarlos fallaría, y saltarlos dejaría el servidor con un esquema distinto\n' +
      'del que dice el repositorio sin que nadie se enterara.\n\n' +
      'El cambio va en un archivo NUEVO con el número siguiente, con los `alter` que\n' +
      'hagan falta. Si de verdad son equivalentes y solo cambió un comentario, se\n' +
      "reconoce a mano:  update migracion set huella = '…' where archivo = '…';")
    process.exitCode = 1
  } else {
    console.log(nuevas === 0
      ? `esquema al día (${archivos.length} archivos, nada que aplicar)`
      : `esquema al día (${nuevas} archivo(s) aplicados de ${archivos.length})`)
  }
} finally {
  await cerrar()
}
