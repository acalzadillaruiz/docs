/**
 * Los valores fiscales con fecha: la tasa del BCV, la UT, el IVA, el IGTF y los
 * conceptos de ISLR.
 *
 * El archivo de esquema lo dice en su primera línea: «ningún porcentaje se escribe dentro
 * del código; todos viven aquí como filas con fecha de vigencia». Y las cinco tablas
 * donde viven **no las escribía nada**. Las llenaba el sembrador de la empresa de
 * muestra, que es por lo que el barrido de tablas sin puerta las daba por atendidas
 * durante meses: el barrido que existe para encontrar pantallas que faltan lo estaba
 * contentando un fixture.
 *
 * Lo que eso significaba en uso real, y por orden de gravedad:
 *
 *   1. **La tasa del BCV no se podía cargar.** Cambia todos los días, y de ella cuelga
 *      cada contrato, cada valuación y cada cobro: `valuar.ts` se para con «no hay tasa
 *      vigente» y no hay ninguna pantalla donde ponerla. El sistema dejaba de servir al
 *      día siguiente de arrancar.
 *   2. Sin UT no se calcula el sustraendo del ISLR; sin alícuota de IVA no se emite una
 *      valuación; sin alícuota de IGTF, `calcular_igtf` levanta excepción.
 *
 * Corregir un valor de ayer **no reescribe el pasado**, y eso no es un descuido: cada
 * retención emitida congela el porcentaje, el sustraendo, el monto y la UT que usó, y
 * cada documento guarda el `alicuota_iva_id` que se le aplicó. Por eso aquí se puede
 * corregir un dedo gordo de la semana pasada sin que se muevan los papeles ya emitidos.
 * Lo que sí hace falta es que la consecuencia se vea antes: cada lista dice cuántos
 * documentos usaron ya cada valor.
 */

import type { Consulta } from '../db/conexion.ts'
import { numero, t, type Clave, type Idioma } from '../i18n/t.ts'

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Una fecha que existe de verdad: `2026-02-31` pasa el patrón y no es un día. */
function fechaBuena(s: string): boolean {
  if (!ISO.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const hoy = (): string => new Date().toISOString().slice(0, 10)

/** Días entre dos fechas ISO, positivo si la primera es posterior. */
function diasDesdeHoy(s: string): number {
  return Math.round(
    (Date.parse(`${s}T00:00:00Z`) - Date.parse(`${hoy()}T00:00:00Z`)) / 86400000)
}

export type Hecho =
  | { readonly hecho: true }
  | { readonly hecho: false; readonly errores: readonly string[] }

// ---------------------------------------------------------------------------
// La tasa del BCV

export type Tasa = {
  readonly id: string
  readonly vigenteEl: string
  readonly vesPorUsd: string
  readonly fuente: string
  /** Qué tanto por ciento subió o bajó respecto de la tasa del día anterior. */
  readonly variacion: string | null
  /** Sustituida por una rectificación posterior: sigue ahí y ya no la usa nadie nuevo. */
  readonly sustituida: boolean
  /** Cuántos documentos, valuaciones y retenciones apuntan a ESTA fila. */
  readonly usos: number
}

/**
 * Las últimas tasas, la más reciente primero.
 *
 * Trae las sustituidas también, y a propósito: una rectificación del BCV es justo lo que
 * alguien va a querer entender mirando esta pantalla, y esconder la fila vieja es
 * esconder que hubo dos.
 */
export async function tasas(
  q: Consulta, idioma: Idioma, limite = 30,
): Promise<readonly Tasa[]> {
  const filas = (await q`
    select t.id, t.vigente_el, t.ves_por_usd::text as ves, t.fuente,
           t.sustituida_por is not null as sustituida,
           (select count(*)::int from documento_fiscal d where d.tasa_id = t.id)
           + (select count(*)::int from valuacion v where v.tasa_id = t.id)
           + (select count(*)::int from retencion r where r.tasa_id = t.id) as usos,
           (select t2.ves_por_usd::text from tasa_bcv t2
             where t2.vigente_el < t.vigente_el and t2.sustituida_por is null
             order by t2.vigente_el desc limit 1) as previa
      from tasa_bcv t
     order by t.vigente_el desc, t.registrada_en desc
     limit ${limite}
  `) as unknown as Array<{
    id: string; vigente_el: Date; ves: string; fuente: string
    sustituida: boolean; usos: number; previa: string | null
  }>
  return filas.map((f): Tasa => {
    const v = Number(f.ves)
    const p = f.previa === null ? null : Number(f.previa)
    return {
      id: f.id,
      vigenteEl: f.vigente_el.toISOString().slice(0, 10),
      vesPorUsd: numero(idioma, v, 4),
      fuente: f.fuente,
      variacion: p === null || !(p > 0)
        ? null
        : numero(idioma, ((v - p) / p) * 100, 2),
      sustituida: f.sustituida === true,
      usos: Number(f.usos),
    }
  })
}

export type TasaNueva = {
  readonly vigenteEl: string
  readonly vesPorUsd: number
  /** Rectificar la tasa que ya hay para ese día, en vez de chocar con ella. */
  readonly rectifica: boolean
}

/**
 * Carga la tasa de un día, o rectifica la que ya estaba.
 *
 * El esquema ya traía el mecanismo entero y nadie lo usaba: `sustituida_por`, y un índice
 * único sobre `vigente_el` **de las no sustituidas**. Es decir, un día tiene una sola
 * tasa vigente, pero puede tener varias filas, y lo ya asentado sigue apuntando a la que
 * se usó ese día. Rectificar no es corregir el pasado: es añadir la buena y marcar la
 * otra.
 *
 * Y rectificar **tiene que pedirse**, no pasar solo. Sin la casilla marcada, cargar una
 * tasa de un día que ya tiene una es un error con su frase, no una sustitución callada:
 * lo normal, cuando alguien teclea un día que ya estaba, es que se haya equivocado de
 * día.
 */
export async function guardarTasa(
  q: Consulta, tn: TasaNueva, personaId: string, idioma: Idioma,
): Promise<Hecho> {
  const mal: string[] = []

  if (!fechaBuena(tn.vigenteEl)) mal.push(t(idioma, 'fiscal.error.fecha'))
  // Se pregunta por lo que TIENE que ser. Con `<= 0`, un NaN pasa: toda comparación con
  // NaN es falsa, y una tasa NaN convierte cada importe del sistema en NaN.
  if (!(tn.vesPorUsd > 0)) mal.push(t(idioma, 'fiscal.error.tasa'))

  // Una tasa de dentro de tres años es un dedo gordo en el año, no una previsión. El BCV
  // publica la del día siguiente, así que mañana es legítimo y se deja pasar.
  if (fechaBuena(tn.vigenteEl) && diasDesdeHoy(tn.vigenteEl) > 30) {
    mal.push(t(idioma, 'fiscal.error.futuro'))
  }

  if (mal.length > 0) return { hecho: false, errores: mal }

  const [ya] = (await q`
    select id from tasa_bcv
     where vigente_el = ${tn.vigenteEl}::date and sustituida_por is null
  `) as unknown as Array<{ id: string }>

  if (ya && !tn.rectifica) {
    return { hecho: false, errores: [t(idioma, 'fiscal.error.tasa_repetida')] }
  }

  // El orden de estos tres pasos no es indiferente, y la primera versión lo tenía mal.
  //
  // El índice único del esquema es PARCIAL: un día, una sola tasa **de las no
  // sustituidas**. Así que insertar la nueva antes de marcar la vieja choca contra él, con
  // un error de base de datos en vez de una frase. Y marcar la vieja primero tampoco se
  // puede directamente: `sustituida_por` es una clave ajena a esta misma tabla y la fila
  // nueva todavía no existe.
  //
  // De ahí el paso de en medio: la vieja se marca sustituida por SÍ MISMA, que satisface
  // la clave ajena y ya la saca del índice parcial; entonces la nueva entra sin chocar; y
  // al final la vieja apunta a la nueva. Los tres pasos van en la misma transacción, así
  // que ese estado intermedio raro no lo ve nadie — y si algo fallara, no queda nada.
  if (ya) {
    await q`update tasa_bcv set sustituida_por = id where id = ${ya.id}::uuid`
  }

  const [nueva] = (await q`
    insert into tasa_bcv (vigente_el, ves_por_usd, fuente, registrada_por)
    values (${tn.vigenteEl}::date, ${tn.vesPorUsd}, 'carga_manual', ${personaId}::uuid)
    returning id
  `) as unknown as Array<{ id: string }>

  if (ya) {
    await q`update tasa_bcv set sustituida_por = ${nueva!.id}::uuid where id = ${ya.id}::uuid`
  }
  return { hecho: true }
}

// ---------------------------------------------------------------------------
// Los valores con fecha de vigencia: UT, IVA, IGTF

export type Valor = {
  readonly desde: string
  readonly valor: string
  /** La clase, solo en el IVA: general, reducida, adicional, exento. */
  readonly clase: string | null
  readonly nota: string | null
  /** Cuántos papeles se emitieron mientras este tramo regía. */
  readonly usos: number
}

/** La unidad tributaria, de la más reciente a la más vieja. */
export async function unidades(q: Consulta, idioma: Idioma): Promise<readonly Valor[]> {
  const filas = (await q`
    select u.vigente_desde, u.valor_ves::text as valor, u.gaceta,
           (select count(*)::int from retencion r
             where r.clase = 'islr' and r.fecha >= u.vigente_desde
               and r.fecha < coalesce((select min(u2.vigente_desde) from unidad_tributaria u2
                                        where u2.vigente_desde > u.vigente_desde),
                                      'infinity'::date)) as usos
      from unidad_tributaria u order by u.vigente_desde desc
  `) as unknown as Array<{
    vigente_desde: Date; valor: string; gaceta: string | null; usos: number
  }>
  return filas.map((f): Valor => ({
    desde: f.vigente_desde.toISOString().slice(0, 10),
    valor: numero(idioma, Number(f.valor), 2),
    clase: null,
    nota: f.gaceta,
    usos: Number(f.usos),
  }))
}

/** Las alícuotas de IVA, por clase y fecha. */
export async function alicuotasIva(q: Consulta, idioma: Idioma): Promise<readonly Valor[]> {
  const filas = (await q`
    select a.clase, a.vigente_desde, a.porcentaje::text as valor,
           (select count(*)::int from documento_fiscal d
             where d.alicuota_iva_id = a.id) as usos
      from alicuota_iva a order by a.vigente_desde desc, a.clase
  `) as unknown as Array<{
    clase: string; vigente_desde: Date; valor: string; usos: number
  }>
  return filas.map((f): Valor => ({
    desde: f.vigente_desde.toISOString().slice(0, 10),
    valor: numero(idioma, Number(f.valor), 2),
    clase: f.clase,
    nota: null,
    usos: Number(f.usos),
  }))
}

/** La alícuota de IGTF: el 3 % sobre lo pagado en divisa. */
export async function alicuotasIgtf(q: Consulta, idioma: Idioma): Promise<readonly Valor[]> {
  const filas = (await q`
    select g.vigente_desde, g.porcentaje::text as valor,
           -- El IGTF no se guarda en ninguna columna: se calcula al cobrar y se asienta
           -- como una línea del diario. Así que lo que se cuenta aquí es la población a
           -- la que esta alícuota se le aplicó — los cobros en divisa del tramo—, con la
           -- misma condición que usa asentar_cobro, no una parecida.
           (select count(*)::int from cobro c
             where (c.medio = 'divisa_efectivo'
                    or (c.moneda = 'USD' and c.medio <> 'compensacion'))
               and c.fecha >= g.vigente_desde
               and c.fecha < coalesce((select min(g2.vigente_desde) from alicuota_igtf g2
                                        where g2.vigente_desde > g.vigente_desde),
                                      'infinity'::date)) as usos
      from alicuota_igtf g order by g.vigente_desde desc
  `) as unknown as Array<{ vigente_desde: Date; valor: string; usos: number }>
  return filas.map((f): Valor => ({
    desde: f.vigente_desde.toISOString().slice(0, 10),
    valor: numero(idioma, Number(f.valor), 2),
    clase: null,
    nota: null,
    usos: Number(f.usos),
  }))
}

export type ValorNuevo = {
  readonly cual: 'ut' | 'iva' | 'igtf'
  readonly desde: string
  readonly valor: number
  /** La clase del IVA; la gaceta en la UT. */
  readonly extra: string
}

const CLASES_IVA = ['general', 'reducida', 'adicional', 'exento'] as const

/**
 * Guarda un valor fiscal con su fecha de vigencia.
 *
 * Las tres tablas se escriben igual porque son la misma cosa —un número que cambia por
 * gaceta y rige a partir de un día—, y las tres corrigen sobre la misma fecha en vez de
 * duplicarla: dos filas para el mismo día dejarían el valor que rige a merced de qué
 * fila lee primero la consulta.
 */
export async function guardarValor(
  q: Consulta, v: ValorNuevo, idioma: Idioma,
): Promise<Hecho> {
  const mal: string[] = []

  if (!fechaBuena(v.desde)) mal.push(t(idioma, 'fiscal.error.fecha'))

  if (v.cual === 'ut') {
    if (!(v.valor > 0)) mal.push(t(idioma, 'fiscal.error.ut'))
  } else {
    // Un porcentaje de impuesto: cero es legítimo —el IVA exento es cero— y más de cien
    // no lo es en ninguna parte.
    if (!(v.valor >= 0 && v.valor <= 100)) mal.push(t(idioma, 'fiscal.error.porcentaje'))
  }

  if (v.cual === 'iva' && !CLASES_IVA.includes(v.extra as typeof CLASES_IVA[number])) {
    mal.push(t(idioma, 'fiscal.error.clase'))
  }

  if (mal.length > 0) return { hecho: false, errores: mal }

  if (v.cual === 'ut') {
    await q`
      insert into unidad_tributaria (vigente_desde, valor_ves, gaceta)
      values (${v.desde}::date, ${v.valor}, ${v.extra.trim() || null})
      on conflict (vigente_desde) do update
        set valor_ves = excluded.valor_ves, gaceta = excluded.gaceta`
  } else if (v.cual === 'igtf') {
    await q`
      insert into alicuota_igtf (vigente_desde, porcentaje)
      values (${v.desde}::date, ${v.valor})
      on conflict (vigente_desde) do update set porcentaje = excluded.porcentaje`
  } else {
    // `alicuota_iva` lleva `id` propio porque cada documento guarda a cuál se acogió, así
    // que no hay clave natural sobre la que hacer `on conflict`: la corrección va a mano.
    // Y se corrige la fila, no se añade otra, justamente porque los documentos viejos
    // apuntan a su `id` y no se van a mover.
    const [ya] = (await q`
      select id from alicuota_iva
       where clase = ${v.extra} and vigente_desde = ${v.desde}::date
    `) as unknown as Array<{ id: string }>
    if (ya) {
      await q`update alicuota_iva set porcentaje = ${v.valor} where id = ${ya.id}::uuid`
    } else {
      await q`
        insert into alicuota_iva (clase, porcentaje, vigente_desde)
        values (${v.extra}, ${v.valor}, ${v.desde}::date)`
    }
  }
  return { hecho: true }
}

// ---------------------------------------------------------------------------
// Los conceptos de ISLR

export type Concepto = {
  readonly codigo: string
  readonly nombre: string
  readonly sujeto: string
  readonly porcentaje: string
  readonly factorUt: string
  readonly minimoUt: string
  readonly desde: string
  readonly retenciones: number
}

export async function conceptos(q: Consulta, idioma: Idioma): Promise<readonly Concepto[]> {
  const filas = (await q`
    select c.codigo, c.nombre_es, c.nombre_en, c.sujeto,
           c.porcentaje::text as pct, c.factor_ut::text as factor,
           c.minimo_ut::text as minimo, c.vigente_desde,
           (select count(*)::int from retencion r
             where r.clase = 'islr' and r.concepto_islr = c.codigo) as retenciones
      from concepto_islr c order by c.codigo
  `) as unknown as Array<{
    codigo: string; nombre_es: string; nombre_en: string; sujeto: string
    pct: string; factor: string; minimo: string
    vigente_desde: Date; retenciones: number
  }>
  return filas.map((f): Concepto => ({
    codigo: f.codigo,
    nombre: idioma === 'es' ? f.nombre_es : f.nombre_en,
    sujeto: f.sujeto,
    porcentaje: numero(idioma, Number(f.pct), 2),
    factorUt: numero(idioma, Number(f.factor), 4),
    minimoUt: numero(idioma, Number(f.minimo), 4),
    desde: f.vigente_desde.toISOString().slice(0, 10),
    retenciones: Number(f.retenciones),
  }))
}

export type ConceptoNuevo = {
  readonly codigo: string
  readonly nombreEs: string
  readonly nombreEn: string
  readonly sujeto: string
  readonly porcentaje: number
  readonly factorUt: number
  readonly minimoUt: number
  readonly desde: string
}

const SUJETOS = [
  'pj_domiciliada', 'pn_residente', 'pj_no_domiciliada', 'pn_no_residente',
] as const

/**
 * Guarda o corrige un concepto de ISLR.
 *
 * Y aquí hay que decir una cosa del esquema, porque desde fuera engaña: `concepto_islr`
 * tiene `vigente_desde` y `vigente_hasta` **pero su clave primaria es el código solo**.
 * O sea que no puede haber dos filas del mismo concepto con fechas distintas, y el
 * histórico con fecha que promete la cabecera del archivo, para el ISLR, no existe.
 *
 * Corregir la fila es entonces lo único posible, y resulta que además es seguro: cada
 * retención emitida congela su porcentaje, su sustraendo y la UT que aplicó, así que
 * cambiar el concepto hoy no mueve ni un comprobante de ayer. La lista dice cuántas
 * retenciones se emitieron con cada concepto para que eso se vea antes de tocarlo.
 */
export async function guardarConcepto(
  q: Consulta, c: ConceptoNuevo, idioma: Idioma,
): Promise<Hecho> {
  const mal: string[] = []
  const codigo = c.codigo.trim().toUpperCase()

  if (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(codigo)) mal.push(t(idioma, 'fiscal.error.codigo'))
  if (c.nombreEs.trim() === '' || c.nombreEn.trim() === '') {
    mal.push(t(idioma, 'fiscal.error.nombre'))
  }
  if (!SUJETOS.includes(c.sujeto as typeof SUJETOS[number])) {
    mal.push(t(idioma, 'fiscal.error.sujeto'))
  }
  if (!(c.porcentaje >= 0 && c.porcentaje <= 100)) mal.push(t(idioma, 'fiscal.error.porcentaje'))
  if (!(c.factorUt >= 0)) mal.push(t(idioma, 'fiscal.error.factor'))
  if (!(c.minimoUt >= 0)) mal.push(t(idioma, 'fiscal.error.minimo'))
  if (!fechaBuena(c.desde)) mal.push(t(idioma, 'fiscal.error.fecha'))

  if (mal.length > 0) return { hecho: false, errores: mal }

  await q`
    insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje,
                               factor_ut, minimo_ut, vigente_desde)
    values (${codigo}, ${c.nombreEs.trim()}, ${c.nombreEn.trim()}, ${c.sujeto},
            ${c.porcentaje}, ${c.factorUt}, ${c.minimoUt}, ${c.desde}::date)
    on conflict (codigo) do update
      set nombre_es = excluded.nombre_es, nombre_en = excluded.nombre_en,
          sujeto = excluded.sujeto, porcentaje = excluded.porcentaje,
          factor_ut = excluded.factor_ut, minimo_ut = excluded.minimo_ut,
          vigente_desde = excluded.vigente_desde`
  return { hecho: true }
}

// ---------------------------------------------------------------------------

/**
 * Lo que falta para que el sistema pueda trabajar HOY, dicho en la propia pantalla.
 *
 * No es un adorno: sin tasa de hoy no se emite una valuación, y el mensaje que sale al
 * intentarlo («no hay tasa vigente») no dice dónde se arregla. Esto lo dice antes.
 */
export async function loQueFalta(
  q: Consulta, idioma: Idioma, al: string | null = null,
): Promise<readonly string[]> {
  // `al` existe para poder probar esto sin pelearse por el día de hoy. Sin él, la única
  // forma de comprobar el aviso era borrar la tasa de hoy y volver a ponerla, y de la
  // tasa de hoy solo cabe UNA: dos archivos de prueba haciéndolo a la vez se pisan. Con
  // la fecha por fuera, la prueba se monta su propio día en 2018 y no toca nada de nadie.
  // La pantalla no lo pasa nunca: lo que le importa es hoy.
  const [f] = (await q`
    select (select count(*)::int from tasa_bcv
             where vigente_el <= coalesce(${al}::date, current_date)
               and sustituida_por is null) as tasa,
           (select count(*)::int from unidad_tributaria
             where vigente_desde <= coalesce(${al}::date, current_date)) as ut,
           (select count(*)::int from alicuota_iva
             where clase = 'general'
               and vigente_desde <= coalesce(${al}::date, current_date)) as iva,
           (select count(*)::int from alicuota_igtf
             where vigente_desde <= coalesce(${al}::date, current_date)) as igtf,
           (select count(*)::int from concepto_islr
             where vigente_desde <= coalesce(${al}::date, current_date)) as islr
  `) as unknown as Array<Record<string, number>>

  const falta: string[] = []
  for (const [campo, clave] of [
    ['tasa', 'fiscal.falta.tasa'], ['ut', 'fiscal.falta.ut'],
    ['iva', 'fiscal.falta.iva'], ['igtf', 'fiscal.falta.igtf'],
    ['islr', 'fiscal.falta.islr'],
  ] as const) {
    if (Number(f?.[campo] ?? 0) === 0) falta.push(t(idioma, clave as Clave))
  }
  return falta
}
