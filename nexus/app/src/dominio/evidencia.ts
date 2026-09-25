/**
 * La evidencia, por arriba.
 *
 * La base de datos ya se niega a dar por bueno un hito sin su documento. Lo que
 * falta aquí es el camino humano: subir el archivo, calcular su huella, ponerlo en
 * la cola de revisión, y que alguien lo acepte o lo rechace diciendo por qué.
 *
 * Tres decisiones que no son de estilo:
 *
 *   1. LA HUELLA SE CALCULA AQUÍ, no se recibe. Si el cliente del navegador enviara
 *      la huella, bastaría con mentir en un campo para que un archivo cualquiera
 *      pasara por el certificado de colada. Se calcula sobre los bytes que llegan.
 *
 *   2. EL MISMO DOCUMENTO NO ENTRA DOS VECES en el mismo hito. La huella es la
 *      identidad: el mismo PDF con dos nombres distintos es el mismo PDF. Y no es
 *      un error — se devuelve la evidencia que ya estaba, porque quien lo sube otra
 *      vez normalmente es alguien que no sabía que ya estaba.
 *
 *   3. EL ESTADO DEL HITO NO SE ESCRIBE DESDE AQUÍ. Se llama a `recalcular_hito()`
 *      y la base de datos lo deriva. Escribirlo aquí sería tener dos verdades sobre
 *      lo mismo, y la que se equivocara sería siempre esta.
 */

import { createHash } from 'node:crypto'
import type { Consulta } from '../db/conexion.ts'
import { t, numero, type Idioma } from '../i18n/t.ts'

export type Clase =
  | 'foto' | 'acta' | 'certificado' | 'conocimiento'
  | 'aduana' | 'factura' | 'informe' | 'firma'

export type EstadoHito = 'pendiente' | 'declarado' | 'evidenciado' | 'verificado'

export const CLASES: readonly Clase[] = [
  'foto', 'acta', 'certificado', 'conocimiento', 'aduana', 'factura', 'informe', 'firma',
]

export class HitoNoAlcanzable extends Error {
  constructor() {
    // El mismo texto tanto si el hito no existe como si es de otro cliente. Dos
    // mensajes distintos convierten esta ruta en un buscador de identificadores.
    super('el hito no existe o no te corresponde')
    this.name = 'HitoNoAlcanzable'
  }
}

export class DocumentoVacio extends Error {
  constructor() {
    super('un documento sin contenido no prueba nada')
    this.name = 'DocumentoVacio'
  }
}

/** La huella del contenido. Es la identidad del documento. */
export function huellaDe(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export type Documento = {
  readonly id: string
  readonly clase: Clase
  readonly huella: string
  readonly nombre: string
  readonly bytes: number
  readonly tipoMime: string
  readonly ocurridoEn: string | null
  readonly subidaEn: string
  readonly estado: 'sin_revisar' | 'verificada' | 'rechazada'
  readonly motivoRechazo: string | null
}

export type Hito = {
  readonly id: string
  readonly renglonId: string
  readonly orden: number
  readonly clave: string
  readonly nombre: string
  readonly peso: number
  readonly estado: EstadoHito
  readonly exige: readonly Clase[]
  readonly falta: readonly Clase[]
  readonly planificada: string | null
  readonly pronosticada: string | null
  readonly ocurridoEn: string | null
  readonly registradoEn: string | null
  readonly documentos: readonly Documento[]
}

export type Avance = {
  readonly renglonId: string
  readonly verificado: number
  readonly declarado: number
  /** Lo declarado que hoy no se podría demostrar. Es la brecha, en puntos. */
  readonly brecha: number
  readonly hitos: readonly Hito[]
}

type FilaHito = {
  id: string; renglon_id: string; orden: number; clave: string
  nombre: string; peso: string; estado: EstadoHito
  exige: Clase[]; falta: Clase[] | null
  planificada: string | null; pronosticada: string | null
  ocurrido_en: string | null; registrado_en: string | null
}

type FilaDoc = {
  id: string; hito_id: string; clase: Clase; huella: string; nombre: string
  bytes: string; tipo_mime: string; ocurrido_en: string | null
  subida_en: string
  verificada_en: string | null; rechazada_en: string | null
  motivo_rechazo: string | null
}

// Las columnas se nombran una a una y no se pide 'e.*'. El cliente tiene permiso
// sobre estas y no sobre la tabla entera, asi que un asterisco haria que la misma
// consulta funcionara desde dentro y fallara desde fuera — y la unica forma de
// arreglarlo entonces seria partir la funcion en dos, que es justo lo que no se
// quiere: dos consultas que algun dia dejarian de decir lo mismo.
const CAMPOS_DOC = [
  'id', 'hito_id', 'clase', 'huella', 'nombre', 'bytes', 'tipo_mime',
  'ocurrido_en', 'subida_en', 'verificada_en', 'rechazada_en', 'motivo_rechazo',
] as const

/** Las columnas, con el alias de la tabla si la consulta lo usa. */
const columnas = (alias = '') =>
  CAMPOS_DOC.map((c) => (alias ? `${alias}.${c}` : c)).join(', ')

function documento(f: FilaDoc): Documento {
  return {
    id: f.id,
    clase: f.clase,
    huella: f.huella,
    nombre: f.nombre,
    bytes: Number(f.bytes),
    tipoMime: f.tipo_mime,
    ocurridoEn: f.ocurrido_en,
    subidaEn: f.subida_en,
    estado: f.rechazada_en ? 'rechazada' : f.verificada_en ? 'verificada' : 'sin_revisar',
    motivoRechazo: f.motivo_rechazo ?? null,
  }
}

/**
 * El avance de un renglón, con los hitos de los que sale y el documento que
 * sostiene cada uno.
 *
 * No devuelve un porcentaje suelto. Un porcentaje suelto no se puede discutir: o
 * se cree o no se cree. Esto se puede abrir hito por hito hasta el PDF.
 */
export async function avanceDelRenglon(
  q: Consulta, renglonId: string, idioma: Idioma,
): Promise<Avance> {
  const hitos = (await q`
    select h.id, h.renglon_id, h.orden, h.clave,
           case when ${idioma} = 'es' then h.nombre_es else h.nombre_en end as nombre,
           h.peso::text as peso, h.estado, h.exige, falta_al_hito(h.id) as falta,
           h.planificada, h.pronosticada, h.ocurrido_en, h.registrado_en
      from hito h
     where h.renglon_id = ${renglonId}::uuid
     order by h.orden
  `) as unknown as FilaHito[]

  // Sin hitos no se distingue "no existe" de "no es tuyo", y no hace falta: las dos
  // cosas se responden igual.
  if (hitos.length === 0) throw new HitoNoAlcanzable()

  const docs = (await q`
    select ${q.unsafe(columnas('e'))} from evidencia e
      join hito h on h.id = e.hito_id
     where h.renglon_id = ${renglonId}::uuid
     order by e.subida_en desc
  `) as unknown as FilaDoc[]

  const porHito = new Map<string, FilaDoc[]>()
  for (const d of docs) {
    const lista = porHito.get(d.hito_id)
    if (lista) lista.push(d)
    else porHito.set(d.hito_id, [d])
  }

  const salida = hitos.map((h): Hito => ({
    id: h.id,
    renglonId: h.renglon_id,
    orden: h.orden,
    clave: h.clave,
    nombre: h.nombre,
    peso: Number(h.peso),
    estado: h.estado,
    exige: h.exige,
    falta: h.falta ?? [],
    planificada: h.planificada,
    pronosticada: h.pronosticada,
    ocurridoEn: h.ocurrido_en,
    registradoEn: h.registrado_en,
    documentos: (porHito.get(h.id) ?? []).map(documento),
  }))

  // Los dos porcentajes se suman aquí desde los mismos hitos que se acaban de
  // devolver, y no con otra consulta: si se pidieran aparte podrían contradecir a
  // la lista que se está enseñando, y la pantalla mostraría un total que no cuadra
  // con sus propias líneas.
  const verificado = salida
    .filter((h) => h.estado === 'verificado')
    .reduce((s, h) => s + h.peso, 0)
  const declarado = salida
    .filter((h) => h.estado !== 'pendiente')
    .reduce((s, h) => s + h.peso, 0)

  return {
    renglonId,
    verificado: Math.round(verificado * 100) / 100,
    declarado: Math.round(declarado * 100) / 100,
    brecha: Math.round((declarado - verificado) * 100) / 100,
    hitos: salida,
  }
}

export type Subida = {
  readonly hitoId: string
  readonly clase: Clase
  readonly nombre: string
  readonly tipoMime: string
  readonly contenido: Uint8Array
  /** Cuándo se tomó la foto o se firmó el acta, que no es cuándo se sube. */
  readonly ocurridoEn?: string | null
}

export type ResultadoSubida = {
  readonly documento: Documento
  /** Verdadero si ese mismo archivo ya estaba en ese hito. No es un error. */
  readonly yaEstaba: boolean
  /** El estado en que queda el hito después de subir, derivado por la base de datos. */
  readonly estadoHito: EstadoHito
}

/**
 * Subir un documento y dejar que el hito se recalcule.
 *
 * El archivo no se guarda aquí: se guarda su huella, su nombre, su tamaño y su
 * tipo. Dónde vivan los bytes es una decisión de almacenamiento que puede cambiar
 * sin tocar nada de esto, precisamente porque la identidad del documento es la
 * huella y no una ruta.
 */
export async function subir(
  q: Consulta, s: Subida, personaId: string,
): Promise<ResultadoSubida> {
  if (s.contenido.length === 0) throw new DocumentoVacio()

  const [h] = (await q`
    select id from hito where id = ${s.hitoId}::uuid
  `) as unknown as Array<{ id: string }>
  if (!h) throw new HitoNoAlcanzable()

  const huella = huellaDe(s.contenido)

  const [ya] = (await q`
    select ${q.unsafe(columnas())} from evidencia
     where hito_id = ${s.hitoId}::uuid and huella = ${huella}
       and rechazada_en is null
     limit 1
  `) as unknown as FilaDoc[]

  if (ya) {
    // El mismo archivo, otra vez. Se devuelve el que ya estaba en vez de crear un
    // duplicado: quien lo sube de nuevo casi siempre es alguien que no sabía.
    const estado = await recalcular(q, s.hitoId)
    return { documento: documento(ya), yaEstaba: true, estadoHito: estado }
  }

  const [fila] = (await q`
    insert into evidencia (hito_id, clase, huella, nombre, bytes, tipo_mime,
                           ocurrido_en, subida_por)
    values (${s.hitoId}::uuid, ${s.clase}, ${huella}, ${s.nombre},
            ${s.contenido.length}, ${s.tipoMime},
            ${s.ocurridoEn ?? null}, ${personaId}::uuid)
    returning ${q.unsafe(columnas())}
  `) as unknown as FilaDoc[]

  // Cuando el documento trae la fecha del hecho y el hito todavia no la tenia, se
  // anota, junto con el momento en que se ha sabido aqui. La diferencia entre las
  // dos ES el tiempo hasta la verdad, y si nadie la escribe la medida no existe.
  // 'registrado_en' no se toca si ya estaba: es cuando se supo la PRIMERA vez, y
  // volver a ponerlo hoy borraria justo el retraso que se quiere medir.
  if (s.ocurridoEn) {
    await q`
      update hito
         set ocurrido_en   = coalesce(ocurrido_en, ${s.ocurridoEn}::date),
             registrado_en = coalesce(registrado_en, now()),
             registrado_por = coalesce(registrado_por, ${personaId}::uuid)
       where id = ${s.hitoId}::uuid`
  }

  const estado = await recalcular(q, s.hitoId)
  return { documento: documento(fila!), yaEstaba: false, estadoHito: estado }
}

export type Revision =
  | { readonly hecho: true; readonly estadoHito: EstadoHito }
  | { readonly hecho: false; readonly motivo: 'no_alcanzable' | 'ya_revisada' | 'sin_motivo' }

/** Aceptar un documento. A partir de aquí el hito puede contar para el avance. */
export async function verificar(
  q: Consulta, evidenciaId: string, personaId: string,
): Promise<Revision> {
  const filas = (await q`
    update evidencia
       set verificada_en = now(), verificada_por = ${personaId}::uuid
     where id = ${evidenciaId}::uuid
       and verificada_en is null and rechazada_en is null
    returning hito_id
  `) as unknown as Array<{ hito_id: string }>

  if (filas.length === 0) return await porQueNoSePudo(q, evidenciaId)
  return { hecho: true, estadoHito: await recalcular(q, filas[0]!.hito_id) }
}

/**
 * Rechazar un documento, diciendo por qué.
 *
 * El motivo no es burocracia: quien subió el acta equivocada tiene que saber cuál
 * traer. Un rechazo sin motivo obliga a preguntar por teléfono, y lo que se arregla
 * por teléfono no queda escrito en ninguna parte.
 */
export async function rechazar(
  q: Consulta, evidenciaId: string, personaId: string, motivo: string,
): Promise<Revision> {
  if (motivo.trim() === '') return { hecho: false, motivo: 'sin_motivo' }

  const filas = (await q`
    update evidencia
       set rechazada_en = now(), rechazada_por = ${personaId}::uuid,
           motivo_rechazo = ${motivo.trim()},
           -- Si el papel ya estaba verificado, esa verificacion deja de ser cierta.
           -- Dejarla puesta seria guardar a la vez que vale y que no vale.
           verificada_en = null, verificada_por = null
     where id = ${evidenciaId}::uuid
       and rechazada_en is null
    returning hito_id
  `) as unknown as Array<{ hito_id: string }>

  if (filas.length === 0) return await porQueNoSePudo(q, evidenciaId)
  // Rechazar puede hacer CAER el hito, y eso es deliberado: si el certificado que
  // sostenía el avance resulta no valer, el avance tampoco vale.
  return { hecho: true, estadoHito: await recalcular(q, filas[0]!.hito_id) }
}

async function porQueNoSePudo(q: Consulta, evidenciaId: string): Promise<Revision> {
  const [e] = (await q`
    select id from evidencia where id = ${evidenciaId}::uuid
  `) as unknown as Array<{ id: string }>
  return { hecho: false, motivo: e ? 'ya_revisada' : 'no_alcanzable' }
}

async function recalcular(q: Consulta, hitoId: string): Promise<EstadoHito> {
  const [r] = (await q`
    select recalcular_hito(${hitoId}::uuid)::text as estado
  `) as unknown as Array<{ estado: EstadoHito }>
  return r!.estado
}

export type PorRevisar = {
  readonly evidenciaId: string
  readonly hitoId: string
  readonly contratoId: string
  readonly contrato: string
  readonly cliente: string
  readonly hito: string
  readonly clase: Clase
  readonly nombre: string
  readonly dias: number
}

/**
 * La cola de revisión, lo que lleva más tiempo esperando primero.
 *
 * Es el cuello de botella del sistema entero: mientras un documento está en esta
 * cola, el avance que sostiene no cuenta, y el contrato parece más atrasado de lo
 * que está. Por eso se ordena por antigüedad y no por importe — lo que lleva dos
 * semanas ahí es lo que está falseando el informe.
 */
export async function porRevisar(
  q: Consulta, idioma: Idioma,
): Promise<readonly PorRevisar[]> {
  const filas = (await q`
    select e.id as evidencia_id, h.id as hito_id, ct.id as contrato_id,
           ct.codigo as contrato, o.nombre as cliente,
           case when ${idioma} = 'es' then h.nombre_es else h.nombre_en end as hito,
           e.clase, e.nombre,
           (current_date - e.subida_en::date) as dias
      from evidencia e
      join hito h on h.id = e.hito_id
      join renglon rg on rg.id = h.renglon_id
      join contrato ct on ct.id = rg.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where e.verificada_en is null and e.rechazada_en is null
     order by 9 desc, ct.codigo
  `) as unknown as Array<Record<string, string | number>>

  return filas.map((f): PorRevisar => ({
    evidenciaId: f.evidencia_id as string,
    hitoId: f.hito_id as string,
    contratoId: f.contrato_id as string,
    contrato: f.contrato as string,
    cliente: f.cliente as string,
    hito: f.hito as string,
    clase: f.clase as Clase,
    nombre: f.nombre as string,
    dias: Number(f.dias),
  }))
}

/** El nombre de una clase de evidencia en el idioma de quien mira. */
export function nombreClase(idioma: Idioma, clase: Clase): string {
  return t(idioma, `evidencia.clase.${clase}` as Parameters<typeof t>[1])
}

/** El estado de un hito, dicho en palabras y no en jerga de base de datos. */
export function nombreEstado(idioma: Idioma, estado: EstadoHito): string {
  return t(idioma, `hito.estado.${estado}` as Parameters<typeof t>[1])
}

/** El porcentaje, formateado en el idioma de quien mira. */
export function porcentaje(idioma: Idioma, valor: number): string {
  return `${numero(idioma, valor, valor % 1 === 0 ? 0 : 2)} %`
}
