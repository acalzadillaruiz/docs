/**
 * Las plantillas de hitos: en qué pasos se divide un renglón, y cuánto pesa cada uno.
 *
 * Es la pieza de la que cuelga la tesis entera. De la plantilla salen los hitos de todos
 * los renglones, y de los hitos **verificados** sale el avance. Cambiar una plantilla
 * cambia cómo se mide el trabajo de GPS.
 *
 * Y la escribía solo el archivo de esquema que la sembró el primer día: `/medidas` decía
 * «ese tipo de contrato todavía no tiene plantilla de hitos» y no había forma de hacer
 * una. Última tabla de las que la aplicación no escribía y era una pantalla mandando algo
 * imposible.
 *
 * **La suma tiene que dar 100**, y eso es lo que de verdad se vigila aquí. Si una
 * plantilla suma 90, un renglón con todos sus hitos verificados se queda para siempre en
 * el 90 % y nadie ve un error: se ve un contrato que no acaba de avanzar. No se prohíbe
 * guardar una plantilla a medias —montarla pasa por ahí— pero se dice a gritos, y usarla
 * está prohibido.
 */

import type { Consulta } from '../db/conexion.ts'
import { numero, t, type Clave, type Idioma } from '../i18n/t.ts'
import { TIPOS, type TipoContrato } from './alta.ts'

/** Las clases de evidencia que un hito puede exigir. Salen del enum de la base. */
export const CLASES_EVIDENCIA = [
  'foto', 'acta', 'certificado', 'conocimiento', 'aduana', 'factura', 'informe', 'firma',
] as const
export type ClaseEvidencia = typeof CLASES_EVIDENCIA[number]

export type PasoPlantilla = {
  readonly orden: number
  readonly clave: string
  readonly nombreEs: string
  readonly nombreEn: string
  readonly peso: string
  readonly pesoCrudo: number
  readonly exige: readonly string[]
}

export type Plantilla = {
  readonly tipo: TipoContrato
  readonly nombre: string
  readonly pasos: readonly PasoPlantilla[]
  readonly suma: string
  readonly sumaCruda: number
  /** Si se puede usar. Falso mientras no sume 100, y entonces no se crean hitos. */
  readonly sirve: boolean
  /** Cuántos renglones ya tienen hitos hechos con ella. Cambiarla no los toca. */
  readonly renglones: number
}

export async function plantillas(
  q: Consulta, idioma: Idioma,
): Promise<readonly Plantilla[]> {
  const pasos = (await q`
    select tipo::text, orden, clave, nombre_es, nombre_en, peso::text as peso, exige
      from plantilla_hito order by tipo, orden
  `) as unknown as Array<{
    tipo: string; orden: number; clave: string; nombre_es: string
    nombre_en: string; peso: string; exige: string[]
  }>

  // Cuántos renglones usan cada tipo. Es el número que dice si cambiar esta plantilla
  // afecta a algo vivo: los hitos ya creados NO se rehacen, y saberlo antes evita la
  // sorpresa de tocar una plantilla esperando que se arreglen contratos en marcha.
  const usos = (await q`
    select ct.tipo::text, count(distinct rg.id)::int as n
      from renglon rg
      join contrato ct on ct.id = rg.contrato_id
     where exists (select 1 from hito h where h.renglon_id = rg.id)
     group by ct.tipo
  `) as unknown as Array<{ tipo: string; n: number }>
  const porTipo = new Map(usos.map((u) => [u.tipo, Number(u.n)]))

  return TIPOS.map((tipo): Plantilla => {
    const mios = pasos.filter((p) => p.tipo === tipo)
    const suma = mios.reduce((n, p) => n + Number(p.peso), 0)
    return {
      tipo,
      nombre: t(idioma, `contrato.tipo.${tipo}` as Clave),
      pasos: mios.map((p): PasoPlantilla => ({
        orden: Number(p.orden),
        clave: p.clave,
        nombreEs: p.nombre_es,
        nombreEn: p.nombre_en,
        peso: numero(idioma, Number(p.peso), 2),
        pesoCrudo: Number(p.peso),
        exige: p.exige ?? [],
      })),
      suma: numero(idioma, suma, 2),
      sumaCruda: Math.round(suma * 100) / 100,
      sirve: Math.round(suma * 100) === 10000,
      renglones: porTipo.get(tipo) ?? 0,
    }
  })
}

export type Hecho =
  | { readonly hecho: true }
  | { readonly hecho: false; readonly errores: readonly string[] }

export type PasoNuevo = {
  readonly tipo: string
  readonly orden: number
  readonly clave: string
  readonly nombreEs: string
  readonly nombreEn: string
  readonly peso: number
  readonly exige: readonly string[]
}

const CLAVE_BUENA = /^[a-z][a-z0-9_]{1,29}$/

/**
 * Añade o corrige un paso de una plantilla.
 *
 * La clave es la que llevan los hitos ya creados, así que tiene forma estricta: minúscula
 * sin espacios. Un `Orden de compra` como clave sale en la base, en los avisos y en el
 * exportador del contador, y renombrarla después no cambia los hitos que ya existen.
 */
export async function guardarPaso(
  q: Consulta, p: PasoNuevo, idioma: Idioma,
): Promise<Hecho> {
  const mal: string[] = []
  const clave = p.clave.trim().toLowerCase()

  if (!TIPOS.includes(p.tipo as TipoContrato)) mal.push(t(idioma, 'plantilla.error.tipo'))
  if (!CLAVE_BUENA.test(clave)) mal.push(t(idioma, 'plantilla.error.clave'))
  if (p.nombreEs.trim() === '' || p.nombreEn.trim() === '') {
    mal.push(t(idioma, 'plantilla.error.nombre'))
  }
  // Se pregunta por lo que TIENE que ser: con `<= 0`, un NaN pasa.
  if (!(p.peso > 0 && p.peso <= 100)) mal.push(t(idioma, 'plantilla.error.peso'))
  if (!Number.isInteger(p.orden) || p.orden < 1 || p.orden > 99) {
    mal.push(t(idioma, 'plantilla.error.orden'))
  }
  for (const c of p.exige) {
    if (!CLASES_EVIDENCIA.includes(c as ClaseEvidencia)) {
      mal.push(t(idioma, 'plantilla.error.clase'))
      break
    }
  }

  if (mal.length === 0) {
    // La clave es única por tipo, igual que el orden. Si la clave ya está en OTRO orden,
    // insertar por orden la duplicaría: se dice en vez de dejar que reviente.
    const [choca] = (await q`
      select orden from plantilla_hito
       where tipo = ${p.tipo}::tipo_contrato and clave = ${clave} and orden <> ${p.orden}
    `) as unknown as Array<{ orden: number }>
    if (choca) mal.push(t(idioma, 'plantilla.error.clave_repetida'))
  }

  if (mal.length > 0) return { hecho: false, errores: mal }

  await q`
    insert into plantilla_hito (tipo, orden, clave, nombre_es, nombre_en, peso, exige)
    values (${p.tipo}::tipo_contrato, ${p.orden}, ${clave}, ${p.nombreEs.trim()},
            ${p.nombreEn.trim()}, ${p.peso},
            ${p.exige as unknown as string[]}::clase_evidencia[])
    on conflict (tipo, orden) do update
      set clave = excluded.clave, nombre_es = excluded.nombre_es,
          nombre_en = excluded.nombre_en, peso = excluded.peso, exige = excluded.exige`
  return { hecho: true }
}

export async function quitarPaso(
  q: Consulta, tipo: string, orden: number, confirmacion: string, idioma: Idioma,
): Promise<Hecho> {
  if (!TIPOS.includes(tipo as TipoContrato) || !Number.isInteger(orden)) {
    return { hecho: false, errores: [t(idioma, 'plantilla.error.no_existe')] }
  }
  const [paso] = (await q`
    select clave from plantilla_hito
     where tipo = ${tipo}::tipo_contrato and orden = ${orden}
  `) as unknown as Array<{ clave: string }>
  if (!paso) {
    return { hecho: false, errores: [t(idioma, 'plantilla.error.no_existe')] }
  }
  // La clave escrita a mano, y no un botón solo. La primera versión de esta pantalla
  // ponía un botón por paso con el tipo y el orden ya metidos en campos escondidos: el
  // barrido de formularios en blanco mandó los veintiuno y dejó la tabla vacía. Y vacía
  // no es un desperfecto de pruebas — es que no se puede dar de alta ni un contrato,
  // porque los hitos salen de aquí.
  if (confirmacion.trim().toLowerCase() !== paso.clave) {
    return { hecho: false, errores: [t(idioma, 'plantilla.error.confirmar')] }
  }
  await q`
    delete from plantilla_hito
     where tipo = ${tipo}::tipo_contrato and orden = ${orden}`
  return { hecho: true }
}

/**
 * Si la plantilla de un tipo se puede usar, y por qué no.
 *
 * Se llama ANTES de crear los hitos, en los dos sitios que los crean: el alta de un
 * contrato y el botón de `/medidas`. La base de datos también lo comprueba y levanta una
 * excepción, pero una excepción dentro de una transacción la aborta entera y deja a quien
 * pulsó sin nada que leer. Las dos cosas: el mensaje aquí, la cerradura allí.
 */
export async function plantillaUsable(
  q: Consulta, tipo: string, idioma: Idioma,
): Promise<{ readonly sirve: true } | { readonly sirve: false; readonly motivo: string }> {
  const [r] = (await q`
    select suma_plantilla(${tipo}::tipo_contrato)::text as suma
  `) as unknown as Array<{ suma: string }>
  const suma = Number(r?.suma ?? 0)
  if (suma === 0) {
    return { sirve: false, motivo: t(idioma, 'plantilla.error.sin_plantilla') }
  }
  if (Math.round(suma * 100) !== 10000) {
    return {
      sirve: false,
      motivo: t(idioma, 'plantilla.error.no_suma')
        .replace('{s}', numero(idioma, suma, 2)),
    }
  }
  return { sirve: true }
}
