/**
 * Las rutas de entrada.
 *
 * Se escribe contra `node:http` directo, sin armazón. No es purismo: el camino de
 * entrada es la parte más atacada de cualquier aplicación, y cada dependencia que se
 * mete ahí es código de otro que hay que vigilar, actualizar y entender cuando algo
 * falla a las tres de la madrugada. Son doscientas líneas.
 *
 * Tres cosas que aquí NO se hacen, y suelen hacerse mal:
 *
 *   - No se envía el testigo en la dirección ni en el cuerpo de la respuesta. Va en
 *     una cookie HttpOnly y en ningún otro sitio.
 *   - No se responde 401 con el detalle de qué falló. La pantalla dice lo mismo
 *     siempre, y el registro guarda el detalle.
 *   - No se sirve ninguna página con datos sin haber resuelto antes quién pregunta.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { comoPersona, type Consulta } from '../db/conexion.ts'
import { iniciar, completar, quienEs } from '../dominio/sesion.ts'
import { pintarEntrada } from '../pantallas/entrada.ts'
import { pintarCartera } from '../pantallas/cartera.ts'
import { pintarContrato } from '../pantallas/contrato.ts'
import { cartera } from '../dominio/cartera.ts'
import { bandeja } from '../dominio/bandeja.ts'
import { ficha, ContratoNoAlcanzable } from '../dominio/contrato.ts'
import {
  hojaDeValuacion, cabeceraDeValuacion, objecionesDe, ValuacionNoAlcanzable,
} from '../dominio/valuacion.ts'
import { aprobar, objetar, responder } from '../dominio/aprobacion.ts'
import {
  avanceDelRenglon, cabeceraDelRenglon, porRevisar, HitoNoAlcanzable,
} from '../dominio/evidencia.ts'
import { pintarPaginaAvance, pintarPorRevisar } from '../pantallas/evidencia.ts'
import { testigoAnti, testigoAntiValido } from './csrf.ts'
import { pintarValuacion } from '../pantallas/valuacion.ts'
import { ponerCookie, borrarCookie, leerCookie, idiomaPedido } from './cookies.ts'
import { fecha as formatearFecha, t, type Idioma } from '../i18n/t.ts'

const MAX_CUERPO = 8 * 1024   // un formulario de entrada no pesa más

export type Peticion = {
  readonly metodo: string
  readonly ruta: string
  readonly campos: Readonly<Record<string, string>>
  readonly cookie: string | null
  readonly idioma: Idioma
  readonly origen: string
}

export type Respuesta = {
  readonly codigo: number
  readonly cuerpo?: string
  readonly cabeceras?: Readonly<Record<string, string>>
}

/**
 * Cabeceras que van en TODA respuesta.
 *
 * `frame-ancestors 'none'` y `X-Frame-Options` impiden que otra web meta el portal
 * dentro de un marco invisible y le robe las pulsaciones al usuario.
 */
export const CABECERAS_BASE: Readonly<Record<string, string>> = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'none'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    'font-src https://fonts.gstatic.com; ' +
    "img-src 'self' data:; " +
    "form-action 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'none'",
  'Cache-Control': 'no-store',
}

const html = (codigo: number, cuerpo: string, extra: Record<string, string> = {}): Respuesta =>
  ({ codigo, cuerpo, cabeceras: { ...CABECERAS_BASE, ...extra } })

const aOtroSitio = (destino: string, extra: Record<string, string> = {}): Respuesta =>
  ({ codigo: 303, cabeceras: { ...CABECERAS_BASE, Location: destino, ...extra } })

/**
 * Resuelve una petición. Está separada del servidor de red a propósito: así se puede
 * probar el flujo entero sin abrir un puerto.
 */
export async function resolver(
  p: Peticion,
  personaServicio: string,
  seguro = true,
): Promise<Respuesta> {
  const dentro = <T>(f: (q: Consulta) => Promise<T>) =>
    comoPersona<T>({ id: personaServicio }, 'nexus_interno', f)

  // --------------------------------------------------------------- entrar
  if (p.ruta === '/entrar' && p.metodo === 'GET') {
    return html(200, pintarEntrada({ paso: 'ingreso' }, p.idioma))
  }

  if (p.ruta === '/entrar' && p.metodo === 'POST') {
    const correo = p.campos['correo'] ?? ''
    const clave = p.campos['clave'] ?? ''
    if (!correo || !clave) {
      return html(400, pintarEntrada({ paso: 'ingreso', error: 'rechazado' }, p.idioma))
    }
    const r = await dentro((q) => iniciar(q, { correo, clave, origen: p.origen }))
    switch (r.estado) {
      case 'falta_segundo_factor':
        return html(200, pintarEntrada({ paso: 'segundo_factor', desafio: r.desafio }, p.idioma))
      case 'espera':
        return html(429, pintarEntrada({ paso: 'espera', segundos: r.segundos }, p.idioma))
      case 'usa_tu_empresa':
        return html(200, pintarEntrada({ paso: 'empresa', metodo: r.metodo }, p.idioma))
      default:
        // El mismo 401 y el mismo texto, falle lo que falle.
        return html(401, pintarEntrada({ paso: 'ingreso', correo, error: 'rechazado' }, p.idioma))
    }
  }

  if (p.ruta === '/entrar/codigo' && p.metodo === 'POST') {
    const desafio = p.campos['desafio'] ?? ''
    const codigo = p.campos['codigo'] ?? ''
    if (!desafio) return aOtroSitio('/entrar')

    const r = await dentro((q) => completar(q, desafio, codigo, p.origen))
    switch (r.estado) {
      case 'dentro':
        // El testigo va SOLO en la cookie. Ni en la dirección, ni en el cuerpo.
        return aOtroSitio('/', { 'Set-Cookie': ponerCookie(r.testigo, seguro) })
      case 'espera':
        return html(429, pintarEntrada({ paso: 'espera', segundos: r.segundos }, p.idioma))
      default:
        // El desafío ya está quemado, así que se vuelve al principio.
        return html(401, pintarEntrada({ paso: 'ingreso', error: 'rechazado' }, p.idioma))
    }
  }

  if (p.ruta === '/entrar/recuperacion' && p.metodo === 'GET') {
    return html(200, pintarEntrada({ paso: 'recuperacion' }, p.idioma))
  }

  if (p.ruta === '/salir' && p.metodo === 'POST') {
    const testigo = p.cookie
    if (testigo) {
      await dentro(async (q) => {
        await q`update sesion set cerrada_en = now(), motivo_cierre = 'salida'
                 where huella = ${huellaDe(testigo)} and cerrada_en is null`
      })
    }
    return aOtroSitio('/entrar', { 'Set-Cookie': borrarCookie(seguro) })
  }

  // --------------------------------------------------------------- con sesión
  const testigo = p.cookie
  if (!testigo) return aOtroSitio('/entrar')

  const personaId = await dentro((q) => quienEs(q, testigo))
  if (!personaId) {
    // La cookie se borra: dejarla puesta hace que el navegador insista con un
    // testigo muerto en cada petición.
    return aOtroSitio('/entrar', { 'Set-Cookie': borrarCookie(seguro) })
  }

  // A partir de aquí se consulta COMO la persona, no como el servicio: es lo que
  // hace que las políticas de fila devuelvan lo que a ella le toca y nada más.
  const [quien] = (await dentro((q) => q`
    select o.tipo = 'operadora' as es_cliente from persona pe
      join organizacion o on o.id = pe.organizacion_id where pe.id = ${personaId}::uuid
  `)) as unknown as Array<{ es_cliente: boolean }>
  // Ante la duda se trata como cliente, que es el alcance más estrecho. Equivocarse
  // hacia adentro enseña de más; equivocarse hacia afuera solo enseña de menos.
  const esCliente = quien?.es_cliente ?? true
  const comoQuien = <T>(f: (q: Consulta) => Promise<T>) =>
    comoPersona<T>({ id: personaId }, esCliente ? 'nexus_cliente' : 'nexus_interno', f)

  if (p.ruta === '/') {
    const datos = await comoQuien(async (q) => ({
      lista: await cartera(q, p.idioma),
      // La bandeja solo tiene sentido desde dentro: es lo que espera a GPS.
      pendientes: esCliente ? [] : await bandeja(q, p.idioma),
      // Revisar es de GPS. Al cliente no se le pide ni se le enseña.
      cola: esCliente ? [] : await porRevisar(q, p.idioma),
    }))
    return html(200, pintarCartera(
      datos.lista, p.idioma, esCliente, datos.pendientes, datos.cola,
    ))
  }

  const contrato = /^\/contratos\/([0-9a-f-]{36})$/.exec(p.ruta)
  if (contrato && p.metodo === 'GET') {
    try {
      const f = await comoQuien((q) => ficha(q, contrato[1]!, p.idioma, !esCliente))
      return html(200, pintarContrato(f, p.idioma, esCliente))
    } catch (e) {
      if (e instanceof ContratoNoAlcanzable) return noEncontrado(p.idioma)
      throw e
    }
  }

  // El avance de un renglón, abierto: de dónde sale el número, hito por hito, hasta
  // el documento. Se llega pulsando sobre la barra del renglón, que es la única
  // razón por la que alguien querría entrar aquí.
  const renglon = /^\/renglones\/([0-9a-f-]{36})$/.exec(p.ruta)
  if (renglon && p.metodo === 'GET') {
    try {
      const datos = await comoQuien(async (q) => ({
        cabecera: await cabeceraDelRenglon(q, renglon[1]!, p.idioma),
        avance: await avanceDelRenglon(q, renglon[1]!, p.idioma),
      }))
      return html(200, pintarPaginaAvance(datos.avance, datos.cabecera, p.idioma))
    } catch (e) {
      if (e instanceof HitoNoAlcanzable) return noEncontrado(p.idioma)
      throw e
    }
  }

  const valuacion = /^\/valuaciones\/([0-9a-f-]{36})$/.exec(p.ruta)
  if (valuacion && p.metodo === 'GET') {
    try {
      const datos = await comoQuien(async (q) => {
        // La cabecera primero: de ahí sale la moneda con la que se formatea la hoja.
        const cab = await cabeceraDeValuacion(q, valuacion[1]!)
        const lineas = await hojaDeValuacion(q, valuacion[1]!, p.idioma, cab.moneda, esCliente)
        const objeciones = await objecionesDe(q, valuacion[1]!)
        return { cab, lineas, objeciones }
      })
      // El botón solo aparece si de verdad se puede pulsar. Enseñar uno que va a
      // rebotar enseña que la acción existe y esconde que no te corresponde.
      const puedeDecidir = esCliente &&
        (datos.cab.estado === 'presentada' || datos.cab.estado === 'objetada')
      return html(200, pintarValuacion({
        id: valuacion[1]!,
        contratoId: datos.cab.contratoId,
        contrato: datos.cab.contrato,
        cliente: datos.cab.cliente,
        numero: datos.cab.numero,
        desde: formatearFecha(p.idioma, datos.cab.desde),
        hasta: formatearFecha(p.idioma, datos.cab.hasta),
        moneda: datos.cab.moneda,
        estado: t(p.idioma, `valuacion.estado.${datos.cab.estado}` as never),
        estadoCrudo: datos.cab.estado,
        lineas: datos.lineas,
        puedeDecidir,
        // Responder es de dentro, y solo tiene sentido si hay algo sin responder.
        puedeResponder: !esCliente,
        antifalsificacion: testigoAnti(testigo),
        objeciones: datos.objeciones.map((o) => ({
          id: o.id,
          motivo: o.motivo,
          cuando: formatearFecha(p.idioma, o.cuando),
          respuesta: o.respuesta,
          respondidaEn: o.respondidaEn ? formatearFecha(p.idioma, o.respondidaEn) : null,
        })),
      }, p.idioma))
    } catch (e) {
      if (e instanceof ValuacionNoAlcanzable) return noEncontrado(p.idioma)
      throw e
    }
  }

  const responderObj = /^\/objeciones\/([0-9a-f-]{36})\/responder$/.exec(p.ruta)
  if (responderObj && p.metodo === 'POST') {
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    const r = await comoQuien((q) =>
      responder(q, responderObj[1]!, personaId, !esCliente, p.campos['respuesta'] ?? ''))
    if (!r.hecho && r.motivo === 'no_alcanzable') return noEncontrado(p.idioma)
    if (!r.hecho) return { codigo: 409, cabeceras: CABECERAS_BASE, cuerpo: '' }
    return aOtroSitio(destinoSeguro(p.campos['volver']))
  }

  const decidir = /^\/valuaciones\/([0-9a-f-]{36})\/(aprobar|objetar)$/.exec(p.ruta)
  if (decidir && p.metodo === 'POST') {
    // Toda ruta que escribe exige el testigo antifalsificación. Va antes que nada:
    // si la petición no viene de nuestra propia pantalla, no se mira ni qué pedía.
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    const idVal = decidir[1]!
    const accion = decidir[2]!
    const r = await comoQuien((q) =>
      accion === 'aprobar'
        ? aprobar(q, idVal, personaId, esCliente)
        : objetar(q, idVal, personaId, esCliente, p.campos['motivo'] ?? ''))

    if (!r.hecho && r.motivo === 'no_alcanzable') return noEncontrado(p.idioma)
    if (!r.hecho) return { codigo: 409, cabeceras: CABECERAS_BASE, cuerpo: '' }
    // Después de escribir se redirige, nunca se responde con la página. Si no,
    // recargar repetiría la acción y el navegador avisaría con un diálogo feo.
    return aOtroSitio(`/valuaciones/${idVal}`)
  }

  return noEncontrado(p.idioma)
}

/**
 * Adonde volver despues de escribir, saneado.
 *
 * Aceptar el destino tal cual seria una puerta abierta: bastaria con un formulario
 * en otra web que mandara `volver=https://sitio-falso`, y el portal de GPS estaria
 * mandando a sus propios clientes a una pagina de otro. Es la clase de fallo que
 * convierte un dominio de confianza en el trampolin de quien lo ataca.
 *
 * Solo se aceptan rutas propias: una barra, y no dos —'//otro.sitio' el navegador
 * lo entiende como una direccion completa— y sin dos puntos, que abririan esquemas
 * como 'javascript:'.
 */
function destinoSeguro(pedido: string | undefined): string {
  if (!pedido) return '/'
  if (!pedido.startsWith('/')) return '/'
  if (pedido.startsWith('//')) return '/'
  if (pedido.includes(':')) return '/'
  if (pedido.includes('\\')) return '/'
  return pedido
}

/**
 * Una sola respuesta para «no existe» y para «no te corresponde».
 *
 * Distinguirlas convertiría las direcciones en un detector de contratos ajenos:
 * probando identificadores, un 403 diría «este existe» y un 404 «este no».
 */
function noEncontrado(idioma: Idioma): Respuesta {
  return html(404, `<!doctype html><html lang="${idioma}"><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>404 · GPS Nexus</title>` +
    `<p style="font-family:system-ui;padding:40px;text-align:center">` +
    (idioma === 'es' ? 'No se encuentra esa página.' : 'That page was not found.') +
    ` <a href="/">${idioma === 'es' ? 'Volver' : 'Back'}</a>`)
}

// Se importa aquí abajo para no crear un ciclo con sesion.ts.
import { huellaTestigo as huellaDe } from '../dominio/sesion.ts'

/** Lee el cuerpo de un formulario, con tope. Sin tope, una petición gigante ahoga el proceso. */
export async function leerCampos(req: IncomingMessage): Promise<Record<string, string>> {
  const trozos: Buffer[] = []
  let total = 0
  for await (const t of req) {
    total += (t as Buffer).length
    if (total > MAX_CUERPO) throw new CuerpoDemasiadoGrande(total)
    trozos.push(t as Buffer)
  }
  const texto = Buffer.concat(trozos).toString('utf-8')
  const campos: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(texto)) campos[k] = v
  return campos
}

export class CuerpoDemasiadoGrande extends Error {
  readonly bytes: number
  constructor(bytes: number) {
    super('El cuerpo de la petición es demasiado grande')
    this.name = 'CuerpoDemasiadoGrande'
    this.bytes = bytes
  }
}

/** Adapta una petición de red al tipo que entiende `resolver`. */
export async function desdeHttp(req: IncomingMessage): Promise<Peticion> {
  const url = new URL(req.url ?? '/', 'http://interno')
  const campos = req.method === 'POST' ? await leerCampos(req) : {}
  return {
    metodo: req.method ?? 'GET',
    ruta: url.pathname,
    campos,
    cookie: leerCookie(req.headers.cookie),
    idioma: idiomaPedido(req.headers['accept-language']),
    // Detrás de un proxy, la dirección real llega en una cabecera. Se toma solo el
    // primer valor: los siguientes los puede poner cualquiera.
    origen: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress ?? 'desconocido',
  }
}

export function escribir(res: ServerResponse, r: Respuesta): void {
  res.writeHead(r.codigo, r.cabeceras)
  res.end(r.cuerpo ?? '')
}
