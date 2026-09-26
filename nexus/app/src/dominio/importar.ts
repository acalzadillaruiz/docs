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

export type Destino =
  | 'facturas_recibidas' | 'facturas_emitidas' | 'movimientos_banco' | 'saldos_iniciales'

export const DESTINOS: readonly Destino[] = [
  'facturas_recibidas', 'facturas_emitidas', 'movimientos_banco', 'saldos_iniciales',
]

/** Los destinos que necesitan la fecha de corte del formulario, no de la hoja. */
export const PIDEN_FECHA: readonly Destino[] = ['saldos_iniciales']

export type Campo =
  | 'fecha' | 'proveedor' | 'proveedor_nombre' | 'cliente' | 'cliente_nombre'
  | 'numero' | 'control' | 'base' | 'iva' | 'contrato'
  | 'monto' | 'descripcion' | 'referencia' | 'cuenta' | 'moneda'
  | 'debe' | 'haber'

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
  // El histórico de ventas. Al revés que al emitir una factura nueva, el número NO lo
  // pone la base de datos: estas facturas ya existen, ya las tiene el cliente y ya se
  // declararon. Inventarles un correlativo sería crear una segunda versión de un
  // documento que ya está en la calle.
  facturas_emitidas: [
    { campo: 'fecha', tipo: 'fecha', obligatorio: true },
    { campo: 'cliente', tipo: 'texto', obligatorio: true },
    { campo: 'cliente_nombre', tipo: 'texto', obligatorio: false },
    { campo: 'numero', tipo: 'texto', obligatorio: true },
    { campo: 'control', tipo: 'texto', obligatorio: false },
    { campo: 'base', tipo: 'numero', obligatorio: true },
    { campo: 'iva', tipo: 'numero', obligatorio: false },
    { campo: 'contrato', tipo: 'texto', obligatorio: false },
  ],
  // El extracto del banco. Solo hacen falta dos cosas: cuándo y cuánto. El signo lo
  // trae el importe —positivo entra, negativo sale— porque es como lo da el banco.
  //
  // La cuenta y la moneda se pueden mapear, pero lo normal es que no vengan: un
  // extracto es de UNA cuenta. Sin ellas se usan la cuenta de banco de la empresa y
  // bolívares.
  movimientos_banco: [
    { campo: 'fecha', tipo: 'fecha', obligatorio: true },
    { campo: 'monto', tipo: 'numero', obligatorio: true },
    { campo: 'descripcion', tipo: 'texto', obligatorio: false },
    { campo: 'referencia', tipo: 'texto', obligatorio: false },
    { campo: 'cuenta', tipo: 'texto', obligatorio: false },
    { campo: 'moneda', tipo: 'texto', obligatorio: false },
  ],
  // Con qué saldos empieza una empresa que ya existe. Sin esto no había ninguna puerta
  // —este producto no tiene pantalla para teclear un asiento a mano, a propósito—, así que
  // el capital, el banco y lo que ya te deben no tenían por dónde entrar, y el balance
  // salía como si la empresa hubiera nacido el día de la instalación.
  //
  // El DEBE y el HABER van en dos columnas y ninguna es obligatoria, porque cada línea de
  // un balance de comprobación trae una de las dos y la otra viene vacía. Lo que sí se
  // exige —y se comprueba antes de escribir— es que esté mapeada al menos una, y que el
  // debe menos el haber sume cero: un balance que no suma cero no es un balance.
  //
  // El importe no va en una sola columna con signo. Podría, y sería menos trabajo aquí;
  // pero ningún sistema contable exporta así, y la hoja que hay que pedirle a la gente es
  // la que ya tiene.
  saldos_iniciales: [
    { campo: 'cuenta', tipo: 'texto', obligatorio: true },
    { campo: 'debe', tipo: 'numero', obligatorio: false },
    { campo: 'haber', tipo: 'numero', obligatorio: false },
    { campo: 'descripcion', tipo: 'texto', obligatorio: false },
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
  cliente: ['rif', 'r.i.f', 'nit', 'tax id', 'identificacion', 'identificación'],
  cliente_nombre: ['cliente', 'client', 'customer', 'razon social', 'razón social', 'operadora', 'nombre'],
  numero: ['factura', 'numero', 'número', 'nro', 'n°', 'invoice', 'documento'],
  control: ['control', 'nro control', 'n° control'],
  base: ['base', 'monto', 'subtotal', 'neto', 'importe', 'amount'],
  iva: ['iva', 'impuesto', 'vat', 'tax'],
  contrato: ['contrato', 'contract', 'obra', 'proyecto', 'oc', 'orden'],
  // Las cabeceras que traen de verdad los extractos de los bancos venezolanos.
  monto: ['monto', 'importe', 'amount', 'valor', 'credito', 'crédito', 'debito', 'débito'],
  descripcion: ['descripcion', 'descripción', 'concepto', 'detalle', 'description', 'memo'],
  referencia: ['referencia', 'ref', 'reference', 'documento', 'nro. operacion', 'operacion'],
  cuenta: ['cuenta', 'account', 'nro cuenta', 'codigo', 'código', 'code'],
  moneda: ['moneda', 'currency', 'divisa'],
  // Las cabeceras de un balance de comprobación, que es lo que trae cualquier sistema
  // contable cuando se le pide «saldos al cierre».
  debe: ['debe', 'debito', 'débito', 'debit', 'cargo'],
  haber: ['haber', 'credito', 'crédito', 'credit', 'abono'],
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
  // La fecha de corte de un balance de apertura. Va aquí y no en la hoja: un balance de
  // apertura tiene UNA fecha para todas sus líneas, y pedirla repetida en cada fila obliga
  // a quien exporta del sistema viejo a añadir una columna que su sistema no tiene. Se
  // añade al final a propósito: es un parámetro más en una función que ya se llama desde
  // varios sitios, y meterlo en medio corre los posicionales de todos.
  fechaCorte: string | null = null,
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
                                  huella, cabeceras, cargado_por, fecha_corte)
    values (${orgId}::uuid, ${archivo}, ${destino}, 'cargado', ${datos.length},
            ${huella}, ${cabeceras ?? []}, ${personaId}::uuid,
            ${fechaCorte && fechaCorte !== '' ? fechaCorte : null})
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
  /** Los meses de la hoja cuyo periodo contable no está abierto. */
  readonly mesesSinPeriodo: readonly { anio: number; mes: number; filas: number }[]
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

  const meses = (await q`
    select anio, mes, filas from meses_sin_periodo(${loteId}::uuid)
  `) as unknown as Array<{ anio: number; mes: number; filas: number }>

  return {
    filas: Number(r?.filas ?? 0),
    buenas: Number(r?.buenas ?? 0),
    malas: Number(r?.malas ?? 0),
    errores,
    proveedoresFaltan: faltan,
    mesesSinPeriodo: meses,
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

  const [dest] = (await q`
    select destino from lote_importacion where id = ${loteId}::uuid
  `) as unknown as Array<{ destino: string }>
  const ventas = dest?.destino === 'facturas_emitidas'

  // Sin plan de cuentas no hay dónde asentar, y una factura registrada y sin asentar
  // es el peor sitio donde dejarla: parece que cuenta y no cuenta. Se dice antes de
  // crear nada, no a mitad. El concepto que hace falta no es el mismo según a dónde
  // vaya la hoja: una compra necesita cuenta de gasto y una venta, de ingreso.
  const concepto = ventas ? 'ingreso_obra' : 'gasto'
  const [plan] = (await q`
    select count(*)::int as n from mapa_cuenta
     where organizacion_id = (select organizacion_id from lote_importacion
                               where id = ${loteId}::uuid)
       and concepto = ${concepto}
  `) as unknown as Array<{ n: number }>
  if (Number(plan?.n ?? 0) === 0) {
    return { hecho: false, motivo: t(idioma, 'importar.error.sin_plan') }
  }

  // Un asiento en un mes que no existe es un asiento que nadie va a encontrar
  // cuando lo busque. Y descubrirlo a mitad de la carga deja media hoja dentro.
  const meses = (await q`
    select anio, mes from meses_sin_periodo(${loteId}::uuid)
  `) as unknown as Array<{ anio: number; mes: number }>
  if (meses.length > 0) {
    const lista = meses.map((m) => `${String(m.mes).padStart(2, '0')}/${m.anio}`).join(', ')
    return {
      hecho: false,
      motivo: `${t(idioma, 'importar.error.sin_periodo')}: ${lista}. ${
        t(idioma, 'importar.abrir_periodo')}`,
    }
  }

  // Crear empresas desde una hoja es como se acaba con el mismo proveedor —o el mismo
  // cliente— tres veces escrito de tres maneras. Se dice quiénes faltan y se para.
  const faltan = ventas
    ? ((await q`select rif from clientes_desconocidos(${loteId}::uuid)`) as unknown as
        Array<{ rif: string }>)
    : ((await q`select rif from proveedores_desconocidos(${loteId}::uuid)`) as unknown as
        Array<{ rif: string }>)
  if (faltan.length > 0) {
    const cual = ventas ? 'importar.error.clientes' : 'importar.error.proveedores'
    return {
      hecho: false,
      motivo: `${t(idioma, cual)}: ${faltan.map((f) => f.rif).join(', ')}`,
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

/**
 * El mapeo tal como está guardado, con las cabeceras de la hoja original.
 *
 * La cabecera es lo que el humano reconoce. Enseñarle «columna 5» en vez de «Base»
 * le obliga a abrir el Excel al lado para contar columnas, y ahí se abandona.
 */
export async function mapeoGuardado(q: Consulta, loteId: string): Promise<Propuesta[]> {
  const [l] = (await q`
    select cabeceras from lote_importacion where id = ${loteId}::uuid
  `) as unknown as Array<{ cabeceras: string[] | null }>
  const cabeceras = l?.cabeceras ?? []

  const [primera] = (await q`
    select celdas from fila_cruda where lote_id = ${loteId}::uuid order by fila limit 1
  `) as unknown as Array<{ celdas: string[] }>
  const muestra = primera?.celdas ?? []

  const mapeo = (await q`
    select columna, campo, tipo, formato from mapeo_columna
     where lote_id = ${loteId}::uuid order by columna
  `) as unknown as Array<{ columna: number; campo: string; tipo: string; formato: string | null }>
  const por = new Map(mapeo.map((m) => [Number(m.columna), m]))

  // Se recorre por el ancho de la hoja y no por lo mapeado: una columna sin campo
  // tiene que seguir saliendo, o no habría forma de asignársela.
  const ancho = Math.max(cabeceras.length, muestra.length, 0)
  return Array.from({ length: ancho }, (_, i): Propuesta => {
    const m = por.get(i + 1)
    return {
      columna: i + 1,
      cabecera: cabeceras[i] ?? `${i + 1}`,
      muestra: muestra[i] ?? '',
      campo: (m?.campo ?? null) as Propuesta['campo'],
      tipo: (m?.tipo ?? 'texto') as Propuesta['tipo'],
      formato: m?.formato ?? null,
    }
  })
}

export type Revertido =
  | { readonly hecho: true; readonly asientos: number }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Deshacer una carga.
 *
 * El propio importador lo mandaba hacer —«el lote ya está confirmado; para rehacerlo,
 * reviértelo antes»— y **no había una sola pantalla desde donde revertir nada**. Es
 * la misma forma de fallo que ya apareció tres veces: existe la regla, existe el
 * texto, y no existe el camino.
 *
 * Revertir no borra los asientos: **registra su reverso**, que es lo único que se
 * puede hacer con un hecho que ocurrió. Los movimientos del banco sí se borran, pero
 * solo los que nadie ha conciliado todavía.
 *
 * El motivo es obligatorio. Una carga deshecha sin motivo, leída dentro de un año, es
 * indistinguible de un error.
 */
export async function revertir(
  q: Consulta, loteId: string, motivo: string, personaId: string, idioma: Idioma,
): Promise<Revertido> {
  if (motivo.trim().length < 3) {
    return { hecho: false, motivo: t(idioma, 'importar.error.motivo') }
  }
  if (!/^[0-9a-f-]{36}$/i.test(loteId)) {
    return { hecho: false, motivo: t(idioma, 'importar.error.no_existe') }
  }

  const [l] = (await q`
    select estado::text from lote_importacion where id = ${loteId}::uuid
  `) as unknown as Array<{ estado: string }>
  if (!l) return { hecho: false, motivo: t(idioma, 'importar.error.no_existe') }
  if (l.estado === 'revertido') {
    return { hecho: false, motivo: t(idioma, 'importar.error.ya_revertido') }
  }

  // Los asientos del lote viven en el mes en que ocurrieron, así que el reverso entra
  // ahí también. Si ese mes está cerrado, no entra: se comprueba antes de llamar,
  // porque la excepción abortaría la transacción entera.
  //
  // Y se buscan como los busca `revertir_lote`: por los documentos que el lote selló.
  // Los asientos de una carga NO llevan el lote como origen —los crea el generador de
  // la factura, que los marca con la factura— y buscarlos por el lote era justo el
  // fallo que hacía que revertir no reversara nada.
  const [cerrado] = (await q`
    select a.anio, a.mes from asiento a
      left join periodo pe on pe.organizacion_id = a.organizacion_id
                          and pe.anio = a.anio and pe.mes = a.mes
     where a.reversa_a is null
       and not exists (select 1 from asiento r where r.reversa_a = a.id)
       and ((a.origen_tipo = 'importacion_excel' and a.origen_id = ${loteId}::uuid)
            or a.origen_id in (select df.id from documento_fiscal df
                                where df.lote_id = ${loteId}::uuid))
       and (pe.estado is null or pe.estado <> 'abierto')
     limit 1
  `) as unknown as Array<{ anio: number; mes: number }>
  if (cerrado) {
    return {
      hecho: false,
      motivo: t(idioma, 'importar.error.mes_cerrado')
        .replace('{m}', `${cerrado.anio}-${String(cerrado.mes).padStart(2, '0')}`),
    }
  }

  const [r] = (await q`
    select revertir_lote(${loteId}::uuid, ${personaId}::uuid, ${motivo.trim()}) as n
  `) as unknown as Array<{ n: number }>
  return { hecho: true, asientos: Number(r?.n ?? 0) }
}
