/** Genera las pantallas de entrada para poder mirarlas sin desplegar nada. */
import { writeFileSync } from 'node:fs'
import { pintarEntrada, type PasoEntrada } from '../src/pantallas/entrada.ts'
import type { Idioma } from '../src/i18n/t.ts'

const [paso, idiomaArg, salida, extra] = process.argv.slice(2)
if (!paso || !idiomaArg || !salida) {
  console.error('uso: entrada.ts <ingreso|segundo_factor|recuperacion|espera|empresa|invitacion> <es|en> <salida.html> [extra]')
  process.exit(1)
}
const idioma = idiomaArg as Idioma

const pasos: Record<string, PasoEntrada> = {
  ingreso: { paso: 'ingreso' },
  segundo_factor: { paso: 'segundo_factor', desafio: 'ejemplo' },
  recuperacion: { paso: 'recuperacion', desafio: 'ejemplo' },
  espera: { paso: 'espera', segundos: Number(extra ?? 16) },
  empresa: { paso: 'empresa', metodo: (extra as 'microsoft' | 'google') ?? 'microsoft' },
  invitacion: { paso: 'invitacion', nombre: extra ?? 'Ana Márquez', ficha: 'ejemplo' },
}

const p = pasos[paso]
if (!p) { console.error(`paso desconocido: ${paso}`); process.exit(1) }
writeFileSync(salida, pintarEntrada(p, idioma), 'utf-8')
console.log(`escrito ${salida}`)
