/**
 * Traer una hoja de Excel.
 *
 * Es la pantalla que decide si esto se usa o se abandona. Hoy la contabilidad de
 * GPS vive en hojas de cálculo; si sacarla de ahí cuesta más que quedarse, se queda.
 *
 * El camino tiene cuatro pasos y ninguno se salta:
 *
 *   1. La hoja entra TAL CUAL. Las celdas se guardan como texto, porque convertir
 *      demasiado pronto es como se pierde información sin enterarse.
 *   2. La aplicación PROPONE cómo entendió cada columna, y lo enseña. El humano
 *      corrige. Adivinar sin enseñar es como entra un importe con tres órdenes de
 *      magnitud de más.
 *   3. Se valida SIN ESCRIBIR NADA, y se dice fila por fila qué está mal y por qué.
 *   4. Solo entonces se confirma. Y nunca a medias: si queda una fila con error, no
 *      entra ninguna.
 */

import { createHash } from 'node:crypto'
import type { Consulta } from '../db/conexion.ts'
import { leerHoja } from '../servidor/csv.ts'
import { t, type Clave, type Idioma } from '../i18n/t.ts'

export type Destino = 'facturas_recibidas'

export type Campo =
  | 'fecha' | 'proveedor' | 'proveedor_nombre' | 'numero' | 'control'
  | 'base' | 'iva' | 'contrato'

/** Los campos de cada destino, y cuáles no pueden faltar. */
export const CAMPOS: Record<Destino, readonly { campo: Campo; tipo: 'texto' | 'fecha' | 'numero'; obligatorio: boolean }[]> = {
  facturas_recibidas: [
    { campo: 'fecha', tipo: 'fecha', obligatorio: true },
    { campo: 'proveedor', tipo: 'texto', obligatorio: true },
    { campo: 'proveedor_nombre', tipo: 'texto', obligatorio: false },
    { campo: 'numero', tipo: 'texto', obligatorio: true },
    { campo: 'control', tipo: 'texto', obligatorio: false },
    { campo: 'base', tipo: 'numero', obligatorio: true },
    { campo: 'iva', tipo: 'numero', obligatorio: false },
    { campo: 'contrato', tipo: 'texto', obligatorio: false },
  ],
}

/**
 * Cómo se llama esa columna en la hoja, en cristiano.
 *
 * Se busca por palabras que la gente escribe de verdad en una cabecera, no por el
 * nombre técnico del campo. Nadie escribe «base_imponible» en una hoja: escribe
 * «Base», «Monto», «Subtotal» o «Neto».
 */
const PISTAS: Record<Campo, readonly string[]> = {
  fecha: ['fecha', 'date', 'emision', 'emisión', 'f. factura'],
  proveedor: ['rif', 'r.i.f', 'nit', 'tax id', 'identificacion', 'identificación'],
  proveedor_nombre: ['proveedor', 'supplier', 'razon social', 'razón social', 'vendor', 'nombre'],
  numero: ['factura', 'numero', 'número', 'nro', 'n°', 'invoice', 'documento'],
  control: ['control', 'nro control', 'n° control'],
  base: ['base', 'monto', 'subtotal', 'neto', 'importe', 'amount'],
  iva: ['iva', 'impuesto', 'vat', 'tax'],
  contrato: ['contrato', 'contract', 'obra', 'proyecto', 'oc', 'orden'],
}

export type Propuesta = {
  readonly columna: number
  readonly cabecera: string
  readonly muestra: string
  readonly campo: Campo | null
  readonly tipo: 'texto' | 'fecha' | 'numero'
  readonly formato: string | null
}

/**
 * Qué campo parece cada columna.
 *
 * Se propone y se enseña; no se aplica a ciegas. Una propuesta equivocada que el
 * humano ve se corrige en diez segundos; una aplicada en silencio se descubre
 * cuando el balance no cuadra tres meses después.
 */
export function proponerMapeo(
  cabeceras: readonly string[], muestras: readonly string[], destino: Destino,
): Propuesta[] {
  const campos = CAMPOS[destino]
  const usados = new Set<Campo>()

  return cabeceras.map((cab, i): Propuesta => {
    const limpio = cab.toLowerCase().trim()
    let elegido: Campo | null = null

    // Se recorre en el orden declarado, que va de lo más específico a lo más
    // genérico: 'control' antes que 'numero', porque «Nro control» lleva las dos.
    for (const { campo } of campos) {
      if (usados.has(campo)) continue
      if (PISTAS[campo].some((p) => limpio.includes(p))) { elegido = campo; break }
    }
    if (elegido) usados.add(elegido)

    const tipo = campos.find((c) => c.campo === elegido)?.tipo ?? 'texto'
    const muestra = muestras[i] ?? ''
    return {
      columna: i + 1,
      cabecera: cab,
      muestra,
      campo: elegido,
      tipo,
      // El formato se propone mirando el dato, no la cabecera: es lo único que lo
      // dice. Y aun así se enseña, porque una hoja mezclada existe.
      formato: tipo === 'fecha' ? formatoFecha(muestra)
        : tipo === 'numero' ? formatoNumero(muestra) : null,
    }
  })
}

/**
 * Si la coma va detrás del punto, es venezolano. Si no, anglosajón.
 *
 * `1.234,56` tiene la coma al final; `1,234.56` tiene el punto. Cuando solo hay uno
 * de los dos no se puede saber, y se supone venezolano — que es lo que sale de un
 * Excel configurado en Venezuela, que es donde está la contabilidad de GPS.
 */
export function formatoNumero(muestra: string): 'ven' | 'ang' {
  const coma = muestra.lastIndexOf(',')
  const punto = muestra.lastIndexOf('.')
  if (coma >= 0 && punto >= 0) return coma > punto ? 'ven' : 'ang'
  return 'ven'
}

/**
 * Si el primer número pasa de doce, es el día: no hay un mes trece.
 *
 * Con `03/04/2026` no se puede saber, y se supone día/mes, que es como se escribe
 * en Venezuela. Por eso se enseña siempre: es la única forma de que alguien lo
 * corrija cuando la hoja viene de una casa matriz en Houston.
 */
export function formatoFecha(muestra: string): 'dmy' | 'mdy' | 'iso' {
  const t = muestra.trim()
  if (/^\d{4}[-/]/.test(t)) return 'iso'
  const m = /^(\d{1,2})[-/.](\d{1,2})/.exec(t)
  if (m && Number(m[1]) > 12) return 'dmy'
  if (m && Number(m[2]) > 12) return 'mdy'
  return 'dmy'
}

export type Lote = {
  readonly id: string
  readonly archivo: string
  readonly destino: string
  readonly estado: string
  readonly filas: number
  readonly cargadoEn: string
}

export class HojaRepetida extends Error {
  readonly loteId: string
  constructor(loteId: string) {
    super('esa misma hoja ya se trajo antes')
    this.name = 'HojaRepetida'
    this.loteId = loteId
  }
}

/**
 * Mete la hoja tal cual y devuelve el lote.
 *
 * La huella del archivo se guarda: subir dos veces exactamente la misma hoja se
 * detecta y se avisa. No se prohíbe —puede ser deliberado— pero no se hace en
 * silencio, que es como entran los importes por duplicado.
 */
export async function cargar(
  q: Consulta, orgId: string, personaId: string,
  archivo: string, contenido: Uint8Array, destino: Destino,
): Promise<{ loteId: string; cabeceras: string[]; muestras: string[]; filas: number }> {
  const texto = new TextDecoder('utf-8').decode(contenido)
  const hoja = leerHoja(texto)
  const huella = createHash('sha256').update(contenido).digest('hex')

  const [ya] = (await q`
    select id from lote_importacion
     where organizacion_id = ${orgId}::uuid and huella = ${huella}
       and estado <> 'revertido'
     limit 1
  `) as unknown as Array<{ id: string }>
  if (ya) throw new HojaRepetida(ya.id)

  // La primera fila es la cabecera y no es un dato. Se guarda aparte del resto.
  const [cabeceras, ...datos] = hoja.filas as string[][]

  const [lote] = (await q`
    insert into lote_importacion (organizacion_id, archivo, destino, estado, filas,
                                  huella, cargado_por)
    values (${orgId}::uuid, ${archivo}, ${destino}, 'cargado', ${datos.length},
            ${huella}, ${personaId}::uuid)
    returning id
  `) as unknown as Array<{ id: string }>

  for (let i = 0; i < datos.length; i++) {
    await q`
      insert into fila_cruda (lote_id, fila, celdas)
      values (${lote!.id}::uuid, ${i + 1}, ${datos[i]!})`
  }

  return {
    loteId: lote!.id,
    cabeceras: cabeceras ?? [],
    muestras: (datos[0] ?? []) as string[],
    filas: datos.length,
  }
}

export async function guardarMapeo(
  q: Consulta, loteId: string,
  columnas: readonly { columna: number; campo: Campo | null; tipo: string; formato: string | null }[],
): Promise<void> {
  await q`delete from mapeo_columna where lote_id = ${loteId}::uuid`
  for (const c of columnas) {
    // Una columna que no es ningún campo simplemente no se mapea. Las hojas llevan
    // columnas de notas, de colores y de cuentas que no son de nadie.
    if (!c.campo) continue
    await q`
      insert into mapeo_columna (lote_id, columna, campo, tipo, formato)
      values (${loteId}::uuid, ${c.columna}, ${c.campo}, ${c.tipo}, ${c.formato})`
  }
  await q`update lote_importacion set estado = 'mapeado' where id = ${loteId}::uuid`
}

export type Revision = {
  readonly filas: number
  readonly buenas: number
  readonly malas: number
  readonly errores: readonly { fila: number; motivo: string }[]
  readonly proveedoresFaltan: readonly { rif: string; nombre: string; filas: number }[]
}

export async function validar(q: Consulta, loteId: string): Promise<Revision> {
  const [r] = (await q`
    select * from validar_lote(${loteId}::uuid)
  `) as unknown as Array<{ filas: number; buenas: number; malas: number }>

  const errores = (await q`
    select fila, motivo from validacion_fila
     where lote_id = ${loteId}::uuid and not ok order by fila limit 50
  `) as unknown as Array<{ fila: number; motivo: string }>

  const faltan = (await q`
    select rif, nombre, filas from proveedores_desconocidos(${loteId}::uuid)
  `) as unknown as Array<{ rif: string; nombre: string; filas: number }>

  return {
    filas: Number(r?.filas ?? 0),
    buenas: Number(r?.buenas ?? 0),
    malas: Number(r?.malas ?? 0),
    errores,
    proveedoresFaltan: faltan,
  }
}

export type Confirmado =
  | { readonly hecho: true; readonly cuantas: number }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Confirma, tras comprobar las condiciones AQUÍ.
 *
 * No basta con dejar que la base de datos se niegue y recoger el error: una
 * excepción dentro de una transacción la aborta entera, así que lo que se recogiera
 * llegaría con la transacción ya muerta y sin poder decir nada útil. Se comprueba
 * antes, se responde en el idioma de quien mira, y solo entonces se llama.
 */
export async function confirmar(
  q: Consulta, loteId: string, personaId: string, idioma: Idioma = 'es',
): Promise<Confirmado> {
  const [l] = (await q`
    select estado::text from lote_importacion where id = ${loteId}::uuid
  `) as unknown as Array<{ estado: string }>
  if (!l) return { hecho: false, motivo: t(idioma, 'importar.error.sin_validar') }
  if (l.estado === 'confirmado') return { hecho: false, motivo: t(idioma, 'importar.error.ya') }
  if (l.estado !== 'validado') {
    return { hecho: false, motivo: t(idioma, 'importar.error.sin_validar') }
  }

  const [malas] = (await q`
    select count(*)::int as n from validacion_fila
     where lote_id = ${loteId}::uuid and not ok
  `) as unknown as Array<{ n: number }>
  if (Number(malas?.n ?? 0) > 0) {
    return { hecho: false, motivo: t(idioma, 'importar.error.filas_malas') }
  }

  const faltan = (await q`
    select rif from proveedores_desconocidos(${loteId}::uuid)
  `) as unknown as Array<{ rif: string }>
  if (faltan.length > 0) {
    return {
      hecho: false,
      motivo: `${t(idioma, 'importar.error.proveedores')}: ${faltan.map((f) => f.rif).join(', ')}`,
    }
  }

  const [r] = (await q`
    select confirmar_lote(${loteId}::uuid, ${personaId}::uuid) as n
  `) as unknown as Array<{ n: number }>
  return { hecho: true, cuantas: Number(r?.n ?? 0) }
}

export async function lotes(q: Consulta, orgId: string): Promise<readonly Lote[]> {
  const filas = (await q`
    select id, archivo, destino, estado::text, filas, cargado_en
      from lote_importacion where organizacion_id = ${orgId}::uuid
     order by cargado_en desc limit 25
  `) as unknown as Array<{
    id: string; archivo: string; destino: string; estado: string
    filas: number; cargado_en: Date
  }>
  return filas.map((f): Lote => ({
    id: f.id,
    archivo: f.archivo,
    destino: f.destino,
    estado: f.estado,
    filas: Number(f.filas),
    cargadoEn: f.cargado_en.toISOString().slice(0, 10),
  }))
}

export function nombreCampo(idioma: Idioma, campo: Campo): string {
  return t(idioma, `campo.${campo}` as Clave)
}
