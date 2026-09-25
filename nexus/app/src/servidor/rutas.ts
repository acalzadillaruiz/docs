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
import { iniciar, completar, quienEs, abrirSesionDe } from '../dominio/sesion.ts'
import { empresaDe, preparar, volver } from '../dominio/sso.ts'
import { proveedores, cambiarCodigo } from './proveedores.ts'
import { Claves, verificarFirma, partes, traerPorLaRed } from './jwks.ts'
import { pintarEntrada } from '../pantallas/entrada.ts'
import { pintarCartera } from '../pantallas/cartera.ts'
import { pintarContrato } from '../pantallas/contrato.ts'
import { cartera, cuantosContratos } from '../dominio/cartera.ts'
import { bandeja } from '../dominio/bandeja.ts'
import { ficha, ContratoNoAlcanzable } from '../dominio/contrato.ts'
import {
  hojaDeValuacion, cabeceraDeValuacion, objecionesDe, ValuacionNoAlcanzable,
} from '../dominio/valuacion.ts'
import { aprobar, objetar, responder } from '../dominio/aprobacion.ts'
import {
  avanceDelRenglon, cabeceraDelRenglon, porRevisar, subir, verificar, rechazar,
  HitoNoAlcanzable, DocumentoVacio, type Clase, CLASES,
} from '../dominio/evidencia.ts'
import { pintarPaginaAvance } from '../pantallas/evidencia.ts'
import { medidas } from '../dominio/medidas.ts'
import { perfil, guardarPerfil } from '../dominio/perfil.ts'
import {
  crearContrato, clientes, activar, TIPOS,
  type ContratoNuevo, type RenglonNuevo, type TipoContrato,
} from '../dominio/alta.ts'
import { pintarAlta, type Traido } from '../pantallas/alta.ts'
import {
  proponer, emitir, presentar, facturar, facturaDe, emitirNota, ContratoNoValuable,
} from '../dominio/valuar.ts'
import {
  cargar, proponerMapeo, guardarMapeo, validar, confirmar, lotes, mapeoGuardado,
  CAMPOS, DESTINOS, HojaRepetida, type Campo, type Destino,
} from '../dominio/importar.ts'
import { pintarSubirHoja, pintarMapeo } from '../pantallas/importar.ts'
import { estadoDeCobro, registrarCobro, NoCobrable, type Medio } from '../dominio/cobrar.ts'
import { pintarCobrar } from '../pantallas/cobrar.ts'
import { meses, abrirMes, cerrarMes } from '../dominio/periodos.ts'
import {
  facturasDeProveedor, conceptosIslr, retener, esAgenteDeRetencion,
} from '../dominio/proveedores.ts'
import { pintarProveedores } from '../pantallas/proveedores.ts'
import { conciliacion, casar, aceptarConNota } from '../dominio/banco.ts'
import { pintarBanco } from '../pantallas/banco.ts'
import { equipos, depreciarMes } from '../dominio/activos.ts'
import { pintarActivos } from '../pantallas/activos.ts'
import { cuadro, asentarMes } from '../dominio/reexpresion.ts'
import { cajas, cuentasDeGasto, contratosAbiertos, porContrato,
         anotarVale, reponer, cerrar as cerrarCaja, abrirCaja } from '../dominio/caja.ts'
import { pintarCaja } from '../pantallas/caja.ts'
import { iconoPng, iconoSvg } from './icono.ts'
import { porPagar, registrarPago, mediosTraducidos } from '../dominio/pagar.ts'
import { pintarPagar } from '../pantallas/pagar.ts'
import { pintarReexpresion } from '../pantallas/reexpresion.ts'
import { libro, libroCrudo, aFilas } from '../dominio/libros.ts'
import { pintarLibro } from '../pantallas/libros.ts'
import { mes as mesGerencia } from '../dominio/gerencia.ts'
import { pintarGerencia } from '../pantallas/gerencia.ts'
import { estados } from '../dominio/estados.ts'
import { pintarEstados } from '../pantallas/estados.ts'
import { diario, reversar } from '../dominio/diario.ts'
import { pintarDiario } from '../pantallas/diario.ts'
import { mayor } from '../dominio/mayor.ts'
import { pintarMayor } from '../pantallas/mayor.ts'
import { escribirHoja } from './csv.ts'
import { pintarPeriodos } from '../pantallas/periodos.ts'
import { HojaVacia, HojaDemasiadoGrande } from './csv.ts'
import { pintarValuar } from '../pantallas/valuar.ts'
import { pintarPerfil } from '../pantallas/perfil.ts'
import { pintarMedidas } from '../pantallas/medidas.ts'
import { testigoAnti, testigoAntiValido } from './csrf.ts'
import {
  almacen, tipoAceptado, DocumentoAusente, HuellaInvalida,
} from './almacen.ts'
import {
  partir, campos as camposDe, repetidos as repetidosDe, archivo as archivoDe,
  frontera, LIMITES,
} from './multipart.ts'
import { pintarValuacion } from '../pantallas/valuacion.ts'
import { ponerCookie, borrarCookie, leerCookie, idiomaPedido } from './cookies.ts'
import { fecha as formatearFecha, t, type Clave, type Idioma } from '../i18n/t.ts'

const MAX_CUERPO = 8 * 1024   // un formulario de entrada no pesa más

/**
 * Los proveedores de identidad y el juego de claves, uno por proceso.
 *
 * Se leen del entorno al arrancar: si no están configurados, la entrada con la
 * cuenta de la empresa simplemente no se ofrece, y el resto sigue funcionando. Un
 * sistema que no arranca sin SSO configurado es un sistema que no arranca.
 */
const PROVEEDORES = proveedores(process.env)
const CLAVES = new Claves(traerPorLaRed)

/**
 * A dónde vuelve el proveedor. Tiene que ser EXACTAMENTE la misma dirección que se
 * registró en el proveedor y que se mandó al pedir el código: si difiere en una
 * barra, el proveedor rechaza el cambio, y el mensaje que devuelve no lo dice.
 */
function vueltaDe(): string {
  return `${process.env['NEXUS_BASE'] ?? ''}/entrar/empresa/vuelta`
}

export type Peticion = {
  readonly metodo: string
  readonly ruta: string
  readonly campos: Readonly<Record<string, string>>
  /**
   * Los campos que pueden venir repetidos, como las casillas de un grupo. Un
   * formulario manda `aviso=a&aviso=b`, y `campos` solo guarda el último: leer las
   * casillas de ahí dejaría marcada siempre una sola. Van aparte para que quien
   * lee una casilla tenga que mirar aquí y no se equivoque en silencio.
   */
  readonly repetidos?: Readonly<Record<string, readonly string[]>>
  readonly cookie: string | null
  readonly idioma: Idioma
  readonly origen: string
  /** El archivo, si la petición venía con uno. Solo las rutas que lo esperan lo miran. */
  readonly archivo?: {
    readonly archivo: string
    readonly tipoMime: string
    readonly contenido: Uint8Array
  } | null
}

export type Respuesta = {
  readonly codigo: number
  readonly cuerpo?: string
  /** Para servir un documento. Va aparte del texto: convertirlo a cadena lo rompería. */
  readonly bytes?: Uint8Array
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
    // El manifiesto hace falta declararlo aparte: con 'default-src none' el
    // navegador lo pide y se lo niega a si mismo, sin decir por que.
    "manifest-src 'self'; " +
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
        // El correo se arrastra: sin él, el paso siguiente no sabe de quién es.
        return html(200, pintarEntrada({ paso: 'empresa', metodo: r.metodo, correo }, p.idioma))
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

  // ------------------------------------------------- con la cuenta de la empresa
  // Lo que compra esto: cuando la operadora da de baja al ingeniero, pierde el
  // acceso el mismo día sin que nadie de GPS tenga que acordarse.
  if (p.ruta === '/entrar/empresa' && p.metodo === 'POST') {
    const correo = p.campos['correo'] ?? ''
    const metodo = p.campos['metodo'] === 'google' ? 'google' : 'microsoft'
    const prov = PROVEEDORES[metodo]
    const org = await dentro((q) => empresaDe(q, correo))

    // Si falta el proveedor, la empresa o el método, se responde lo mismo que a un
    // correo que no existe: la pantalla de entrada no es un buscador de empresas.
    if (!prov || !org || !org.metodos.includes(metodo) || !org.inquilino) {
      return html(401, pintarEntrada({ paso: 'ingreso', correo, error: 'rechazado' }, p.idioma))
    }

    const ida = await dentro((q) =>
      preparar(q, org, prov, destinoSeguro(p.campos['volver']), p.origen, vueltaDe()))
    // Se sale del sitio, así que la respuesta no lleva cuerpo ni cabeceras nuestras
    // que puedan acabar en el proveedor.
    return { codigo: 303, cabeceras: { ...CABECERAS_BASE, Location: ida.adonde } }
  }

  if (p.ruta === '/entrar/empresa/vuelta' && p.metodo === 'GET') {
    // Llegan en la dirección, no en el cuerpo: es una vuelta de navegador.
    const estado = p.campos['state'] ?? ''
    const codigo = p.campos['code'] ?? ''
    if (!estado || !codigo) return aOtroSitio('/entrar')

    const [peticion] = (await dentro((q) => q`
      select ps.metodo::text, o.idp_tenant
        from peticion_sso ps join organizacion o on o.id = ps.organizacion_id
       where ps.estado = ${estado} and ps.usada_en is null
    `)) as unknown as Array<{ metodo: string; idp_tenant: string | null }>
    if (!peticion?.idp_tenant) return aOtroSitio('/entrar')

    const prov = PROVEEDORES[peticion.metodo === 'google' ? 'google' : 'microsoft']
    if (!prov) return aOtroSitio('/entrar')

    const inquilino = peticion.idp_tenant
    const r = await dentro((q) => volver(q, estado, codigo, prov,
      (pr, c, v) => cambiarCodigo(pr, c, v, inquilino),
      async (testigo, urlClaves) => {
        const { cabecera } = partes(testigo)
        const juego = await CLAVES.de(
          urlClaves.replace('{inquilino}', inquilino), String(cabecera['kid'] ?? ''))
        return verificarFirma(testigo, juego) as never
      },
      vueltaDe()))

    if (!r.entra) {
      // Todos los motivos dan el mismo mensaje. Decir cuál falló convierte esta
      // pantalla en un banco de pruebas para quien esté intentando entrar.
      return html(401, pintarEntrada({ paso: 'ingreso', error: 'rechazado' }, p.idioma))
    }

    const testigoSesion = await dentro<string>((q) => abrirSesionDe(q, r.personaId, p.origen))
    return aOtroSitio(destinoSeguro(r.destino), { 'Set-Cookie': ponerCookie(testigoSesion, seguro) })
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

  // ------------------------------------------------------------ instalable
  //
  // Las tres piezas que convierten esto en algo que se instala en un telefono. Van
  // ANTES de cualquier comprobacion de sesion a proposito: el navegador pide el
  // manifiesto y el icono sin cookies, y si se le contesta 404 no ofrece instalar.
  if (p.ruta === '/manifest.webmanifest' && p.metodo === 'GET') {
    const es = p.idioma === 'es'
    const manifiesto = {
      name: es ? 'GPS Nexus · ejecución de contratos' : 'GPS Nexus · contract execution',
      short_name: 'GPS Nexus',
      description: es
        ? 'El avance sale de lo que se puede demostrar, no de lo que alguien escribe.'
        : 'Progress comes from what can be proven, not from what somebody types.',
      lang: p.idioma,
      dir: 'ltr',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#F1F2F0',
      theme_color: '#0B2137',
      icons: [
        { src: '/icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/icono-180.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
        { src: '/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }
    return {
      codigo: 200,
      cabeceras: {
        ...CABECERAS_BASE,
        'Content-Type': 'application/manifest+json; charset=utf-8',
        // Esto no lleva nada de nadie dentro: se puede guardar.
        'Cache-Control': 'public, max-age=86400',
      },
      cuerpo: JSON.stringify(manifiesto, null, 2),
    }
  }

  if (p.ruta === '/icono.svg' && p.metodo === 'GET') {
    return {
      codigo: 200,
      cabeceras: {
        ...CABECERAS_BASE,
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
      cuerpo: iconoSvg(),
    }
  }

  const png = /^\/icono-(180|512)\.png$/.exec(p.ruta)
  if (png && p.metodo === 'GET') {
    const bytes = iconoPng(Number(png[1]))
    return {
      codigo: 200,
      cabeceras: {
        ...CABECERAS_BASE,
        'Content-Type': 'image/png',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'public, max-age=86400',
      },
      bytes,
    }
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
    // De cincuenta en cincuenta. Con mil contratos dentro esta pagina pesaba 514 KB
    // —medido— y es lo primero que se abre, muchas veces desde un telefono.
    const pedido = entero(p.campos['desde'])
    const desde = pedido !== null && pedido >= 0 ? pedido : 0
    const datos = await comoQuien(async (q) => ({
      lista: await cartera(q, p.idioma, desde),
      total: await cuantosContratos(q),
      // La bandeja solo tiene sentido desde dentro: es lo que espera a GPS.
      pendientes: esCliente ? [] : await bandeja(q, p.idioma),
      // Revisar es de GPS. Al cliente no se le pide ni se le enseña.
      cola: esCliente ? [] : await porRevisar(q, p.idioma),
    }))
    return html(200, pintarCartera(
      datos.lista, p.idioma, esCliente, datos.pendientes, datos.cola,
      { desde, total: datos.total },
    ))
  }

  // Las tres cifras. Solo de dentro, y no por pudor: son el margen de GPS mirado
  // desde otro ángulo. Un cliente que llegara aquí vería 404, igual que a un
  // contrato que no es suyo.
  if (p.ruta === '/medidas' && p.metodo === 'GET') {
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>
    const m = await comoQuien((q) => medidas(q, org!.organizacion_id, p.idioma))
    return html(200, pintarMedidas(m, p.idioma))
  }

  // El perfil. Poco, y lo que decide que los avisos sobrevivan: un aviso del que no
  // puedes salir acaba marcado como correo no deseado, y con él todos los demás.
  if (p.ruta === '/perfil' && p.metodo === 'GET') {
    const datos = await comoQuien((q) => perfil(q, personaId, p.idioma, esCliente))
    return html(200, pintarPerfil(datos, p.idioma, testigoAnti(testigo)))
  }

  if (p.ruta === '/perfil' && p.metodo === 'POST') {
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    // Un formulario con casillas manda SOLO las marcadas. Lo que no viene está
    // desmarcado, y eso hay que escribirlo: guardar solo lo que vino dejaría
    // imposible quitarse un aviso de encima.
    const marcados = p.repetidos?.['aviso'] ?? (p.campos['aviso'] ? [p.campos['aviso']] : [])
    const idioma: Idioma = p.campos['idioma'] === 'en' ? 'en' : 'es'
    await comoQuien((q) => guardarPerfil(q, personaId, idioma, marcados, esCliente))
    const datos = await comoQuien((q) => perfil(q, personaId, idioma, esCliente))
    return html(200, pintarPerfil(datos, idioma, testigoAnti(testigo), true))
  }

  // Dar de alta un contrato. Solo de dentro: GPS contrata, el cliente no se da de
  // alta contratos a sí mismo.
  if (p.ruta === '/contratos/nuevo' && p.metodo === 'GET') {
    if (esCliente) return noEncontrado(p.idioma)
    const lista = await comoQuien((q) => clientes(q))
    return html(200, pintarAlta(lista, p.idioma, testigoAnti(testigo)))
  }

  if (p.ruta === '/contratos/nuevo' && p.metodo === 'POST') {
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)

    const traido = altaTraida(p)
    const lista = await comoQuien((q) => clientes(q))
    const filas = Math.max(Number(p.campos['filas'] ?? 3) || 3, 3)

    // Pedir más filas no es enviar el formulario: se vuelve a pintar con lo escrito
    // y cinco huecos más. Sin esto haría falta JavaScript, y la política de
    // seguridad de esta aplicación no deja ejecutar ninguno.
    if (p.campos['accion'] === 'mas') {
      return html(200, pintarAlta(lista, p.idioma, testigoAnti(testigo), [], traido, filas + 5))
    }

    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    const r = await comoQuien((q) =>
      crearContrato(q, contratoDesdeFormulario(traido), personaId, org!.organizacion_id, p.idioma))

    if (!r.hecho) {
      // Lo escrito se devuelve escrito. Un formulario que se vacía al fallar es la
      // forma más rápida de que nadie lo vuelva a usar.
      return html(400, pintarAlta(lista, p.idioma, testigoAnti(testigo), r.errores, traido, filas))
    }
    return aOtroSitio(`/contratos/${r.contratoId}`)
  }

  // ------------------------------------------------------------------ importar
  // Es la pantalla que decide si esto se usa o se abandona: hoy la contabilidad
  // vive en hojas de cálculo, y si sacarla de ahí cuesta más que quedarse, se queda.
  if (p.ruta === '/importar' && p.metodo === 'GET') {
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>
    const lista = await comoQuien((q) => lotes(q, org!.organizacion_id))
    return html(200, pintarSubirHoja(p.idioma, testigoAnti(testigo), lista))
  }

  if (p.ruta === '/importar' && p.metodo === 'POST') {
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    const a = p.archivo
    const listaDe = () => comoQuien((q) => lotes(q, org!.organizacion_id))
    if (!a) {
      return html(400, pintarSubirHoja(p.idioma, testigoAnti(testigo), await listaDe(),
        t(p.idioma, 'importar.error.sin_hoja')))
    }
    // El destino llega del formulario, así que se comprueba contra la lista en vez de
    // pasarlo tal cual: un valor inventado acabaría en la columna `destino` del lote y
    // se quedaría ahí para siempre sin que nada lo materialice.
    const pedido = p.campos['destino']
    const destino: Destino = DESTINOS.includes(pedido as Destino)
      ? (pedido as Destino)
      : 'facturas_recibidas'

    try {
      const r = await comoQuien((q) => cargar(q, org!.organizacion_id, personaId,
        a.archivo, a.contenido, destino))
      // El mapeo propuesto se guarda de una vez: así la pantalla siguiente enseña
      // lo mismo que se va a usar, y no una sugerencia que todavía no existe.
      const propuestas = proponerMapeo(r.cabeceras, r.muestras, destino)
      await comoQuien((q) => guardarMapeo(q, r.loteId, propuestas))
      return aOtroSitio(`/importar/${r.loteId}`)
    } catch (e) {
      if (e instanceof HojaRepetida) {
        return html(409, pintarSubirHoja(p.idioma, testigoAnti(testigo), await listaDe(),
          t(p.idioma, 'importar.error.ya')))
      }
      if (e instanceof HojaVacia || e instanceof HojaDemasiadoGrande) {
        return html(400, pintarSubirHoja(p.idioma, testigoAnti(testigo), await listaDe(),
          (e as Error).message))
      }
      throw e
    }
  }

  const lote = /^\/importar\/([0-9a-f-]{36})$/.exec(p.ruta)
  if (lote && (p.metodo === 'GET' || p.metodo === 'POST')) {
    if (p.metodo === 'POST' && !testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)

    const datos = await comoQuien(async (q) => {
      const [l] = (await q`
        select archivo, estado::text, destino from lote_importacion
         where id = ${lote[1]!}::uuid
      `) as unknown as Array<{ archivo: string; estado: string; destino: string }>
      return l
    })
    if (!datos) return noEncontrado(p.idioma)

    // Lo que el humano acaba de corregir se guarda antes de comprobar nada: si no,
    // se validaría el mapeo viejo y los errores no cuadrarían con lo que se ve.
    if (p.metodo === 'POST') {
      const suyo: Destino = DESTINOS.includes(datos.destino as Destino)
        ? (datos.destino as Destino)
        : 'facturas_recibidas'
      const columnas = mapeoDelFormulario(p, suyo)
      await comoQuien((q) => guardarMapeo(q, lote[1]!, columnas))
    }

    let revision = null
    let error = ''
    if (p.metodo === 'POST') {
      try {
        revision = await comoQuien((q) => validar(q, lote[1]!))
      } catch (e) {
        // Faltar una columna obligatoria por mapear no es un fallo de una fila: es
        // del lote entero, y la base de datos lo dice con los nombres dentro.
        error = String((e as Error).message ?? e)
      }
      if (revision && p.campos['accion'] === 'confirmar') {
        const c = await comoQuien((q) => confirmar(q, lote[1]!, personaId, p.idioma))
        if (c.hecho) return aOtroSitio('/importar')
        error = c.motivo
      }
    }

    const propuestas = await comoQuien((q) => mapeoGuardado(q, lote[1]!))
    return html(error === '' ? 200 : 400, pintarMapeo(
      lote[1]!, datos.archivo, propuestas, p.idioma, testigoAnti(testigo), revision, error))
  }

  // Los meses contables. La pantalla más aburrida y una de las que más bloquean:
  // el día 1, sin el mes nuevo abierto, no entra ni una factura ni un cobro.
  if (p.ruta === '/periodos' && (p.metodo === 'GET' || p.metodo === 'POST')) {
    if (p.metodo === 'POST' && !testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    let errores: readonly string[] = []
    if (p.metodo === 'POST') {
      const cuando = anioMes(p)
      if (cuando === null) {
        errores = [t(p.idioma, 'periodo.error.fecha')]
      } else {
        const { anio, mes } = cuando
        const r = p.campos['accion'] === 'cerrar'
          ? await comoQuien((q) => cerrarMes(q, org!.organizacion_id, anio, mes, personaId, p.idioma))
          : await comoQuien((q) => abrirMes(q, org!.organizacion_id, anio, mes, p.idioma))
        if (!r.hecho) errores = [r.motivo]
      }
    }

    const m = await comoQuien((q) => meses(q, org!.organizacion_id, p.idioma))
    return html(errores.length === 0 ? 200 : 400,
      pintarPeriodos(m, p.idioma, testigoAnti(testigo), errores))
  }

  // Las retenciones a proveedores. GPS es agente de retención: no retener cuando
  // toca lo paga GPS de su bolsillo, con multa.
  if (p.ruta === '/proveedores' && (p.metodo === 'GET' || p.metodo === 'POST')) {
    if (p.metodo === 'POST' && !testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    let errores: readonly string[] = []
    if (p.metodo === 'POST') {
      const doc = p.campos['documento'] ?? ''
      if (!/^[0-9a-f-]{36}$/.test(doc)) return noEncontrado(p.idioma)
      const r = await comoQuien((q) => retener(q, doc,
        p.campos['clase'] === 'islr' ? 'islr' : 'iva',
        p.campos['concepto'] ?? '', personaId, p.idioma))
      if (!r.hecho) errores = [r.motivo]
    }

    const datos = await comoQuien(async (q) => ({
      lista: await facturasDeProveedor(q, org!.organizacion_id, p.idioma),
      conceptos: await conceptosIslr(q, p.idioma),
      esAgente: await esAgenteDeRetencion(q, org!.organizacion_id),
    }))
    return html(errores.length === 0 ? 200 : 400, pintarProveedores(
      datos.lista, datos.conceptos, p.idioma, testigoAnti(testigo), errores, datos.esAgente))
  }

  // Conciliación bancaria. La máquina propone; casar lo hace una persona.
  if (p.ruta === '/banco' && (p.metodo === 'GET' || p.metodo === 'POST')) {
    if (p.metodo === 'POST' && !testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    const hoy = new Date().toISOString().slice(0, 10)
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(p.campos['desde'] ?? '')
      ? p.campos['desde']! : `${hoy.slice(0, 7)}-01`
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(p.campos['hasta'] ?? '')
      ? p.campos['hasta']! : hoy

    let errores: readonly string[] = []
    if (p.metodo === 'POST') {
      const mov = p.campos['movimiento'] ?? ''
      if (!/^[0-9a-f-]{36}$/.test(mov)) return noEncontrado(p.idioma)
      const r = p.campos['accion'] === 'nota'
        ? await comoQuien((q) => aceptarConNota(q, mov, p.campos['nota'] ?? '',
            personaId, p.idioma))
        : await comoQuien((q) => casar(q, mov,
            p.campos['clase'] === 'pago' ? 'pago' : 'cobro',
            p.campos['candidato'] ?? '', personaId, p.idioma))
      if (!r.hecho) errores = [r.motivo]
    }

    const c = await comoQuien((q) =>
      conciliacion(q, org!.organizacion_id, desde, hasta, p.idioma))
    return html(errores.length === 0 ? 200 : 400,
      pintarBanco(c, p.idioma, testigoAnti(testigo), errores))
  }

  // Los equipos. Alquiler es uno de los cinco tipos de contrato, y un equipo
  // alquilado genera ingreso y se gasta al mismo tiempo.
  if (p.ruta === '/activos' && (p.metodo === 'GET' || p.metodo === 'POST')) {
    if (p.metodo === 'POST' && !testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    // Mirando, un año que no se entiende se resuelve con el mes en curso. Pero al
    // DEPRECIAR no: ahí hay que decirlo, porque depreciar el mes equivocado deja un
    // asiento que hay que reversar a mano.
    const hoy = new Date()
    const cuando = anioMes(p)
    const anio = cuando?.anio ?? hoy.getUTCFullYear()
    const mes = cuando?.mes ?? hoy.getUTCMonth() + 1

    let errores: readonly string[] = []
    if (p.metodo === 'POST') {
      if (cuando === null) {
        errores = [t(p.idioma, 'periodo.error.fecha')]
      } else {
        const r = await comoQuien((q) =>
          depreciarMes(q, org!.organizacion_id, anio, mes, personaId, p.idioma))
        if (!r.hecho) errores = [r.motivo]
      }
    }

    const lista = await comoQuien((q) => equipos(q, org!.organizacion_id, p.idioma))
    return html(errores.length === 0 ? 200 : 400,
      pintarActivos(lista, p.idioma, testigoAnti(testigo), anio, mes, errores))
  }

  // Lo que toca pagar, y el sitio donde se paga. Estaban la tabla y el generador y
  // no habia forma de llegar a ellos: entraban facturas y no salia nunca un pago.
  if (p.ruta === '/pagar' && (p.metodo === 'GET' || p.metodo === 'POST')) {
    if (p.metodo === 'POST' && !testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>
    const orgId = org!.organizacion_id

    let errores: readonly string[] = []
    if (p.metodo === 'POST') {
      const monto = decimal(p.campos['monto'])
      if (monto === null) errores = [t(p.idioma, 'pago.error.monto')]
      else {
        const r = await comoQuien((q) => registrarPago(q, {
          documento: (p.campos['documento'] ?? '').trim(),
          fecha: (p.campos['fecha'] ?? '').trim(),
          medio: (p.campos['medio'] ?? '').trim(),
          moneda: p.campos['moneda'] === 'USD' ? 'USD' : 'VES',
          monto,
          referencia: (p.campos['referencia'] ?? '').trim() || null,
        }, personaId, p.idioma))
        if (!r.hecho) errores = [r.motivo]
      }
    }

    // Aqui solo se MIRA la fecha, asi que una ilegible se resuelve con hoy en vez de
    // parar. Al PAGAR no: ahi la fecha manda en el asiento y se comprueba de verdad.
    const hoy = new Date().toISOString().slice(0, 10)
    const pedida = (p.campos['al'] ?? '').trim()
    const al = /^\d{4}-\d{2}-\d{2}$/.test(pedida) && !Number.isNaN(Date.parse(pedida))
      ? pedida : hoy

    const deudas = await comoQuien((q) => porPagar(q, orgId, p.idioma, al))
    return html(errores.length === 0 ? 200 : 400,
      pintarPagar({ deudas, medios: mediosTraducidos(p.idioma), hoy, al },
        p.idioma, testigoAnti(testigo), errores))
  }

  // La caja chica. Nunca la ve el cliente: lleva dentro a quien se le pago, por que
  // concepto y a que contrato se imputo — lo que cuesta de verdad un contrato.
  if (p.ruta === '/caja' && (p.metodo === 'GET' || p.metodo === 'POST')) {
    if (p.metodo === 'POST' && !testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>
    const orgId = org!.organizacion_id
    const hoy = new Date().toISOString().slice(0, 10)

    let errores: readonly string[] = []
    if (p.metodo === 'POST') {
      const caja = (p.campos['caja'] ?? '').trim()
      const fecha = (p.campos['fecha'] ?? '').trim()
      const que = p.campos['que']
      // Un identificador que no tiene forma de identificador no llega a la base de
      // datos: alli seria un error de servidor, y aqui es un «eso no vale».
      const esId = /^[0-9a-f-]{36}$/i.test(caja)

      if (que === 'abrir') {
        const fondo = decimal(p.campos['fondo'])
        const mon = p.campos['moneda'] === 'USD' ? 'USD' : 'VES'
        if (fondo === null) errores = [t(p.idioma, 'caja.error.monto')]
        else {
          const r = await comoQuien((q) => abrirCaja(q, orgId, p.campos['nombre'] ?? '',
            mon, fondo, personaId, fecha, personaId, p.idioma))
          if (!r.hecho) errores = [r.motivo]
        }
      } else if (!esId) {
        errores = [t(p.idioma, 'caja.error.no_existe')]
      } else if (que === 'vale') {
        const monto = decimal(p.campos['monto'])
        const contrato = (p.campos['contrato'] ?? '').trim()
        if (monto === null) errores = [t(p.idioma, 'caja.error.monto')]
        else {
          const r = await comoQuien((q) => anotarVale(q, {
            cajaId: caja, fecha, concepto: p.campos['concepto'] ?? '', monto,
            cuenta: (p.campos['cuenta'] ?? '').trim(),
            contratoId: /^[0-9a-f-]{36}$/i.test(contrato) ? contrato : null,
            beneficiario: (p.campos['beneficiario'] ?? '').trim() || null,
            soporte: (p.campos['soporte'] ?? '').trim() || null,
          }, personaId, p.idioma))
          if (!r.hecho) errores = [r.motivo]
        }
      } else if (que === 'reponer') {
        const r = await comoQuien((q) => reponer(q, caja, fecha, personaId, p.idioma))
        if (!r.hecho) errores = [r.motivo]
      } else if (que === 'cerrar') {
        const r = await comoQuien((q) => cerrarCaja(q, caja, fecha, personaId, p.idioma))
        if (!r.hecho) errores = [r.motivo]
      }
    }

    const [lista, cuentas, contratos, porCtr] = await Promise.all([
      comoQuien((q) => cajas(q, orgId, p.idioma)),
      comoQuien((q) => cuentasDeGasto(q, orgId, p.idioma)),
      comoQuien((q) => contratosAbiertos(q, orgId)),
      comoQuien((q) => porContrato(q, orgId, `${hoy.slice(0, 4)}-01-01`, hoy, p.idioma)),
    ])
    return html(errores.length === 0 ? 200 : 400,
      pintarCaja({ cajas: lista, cuentas, contratos, porContrato: porCtr, hoy },
        p.idioma, testigoAnti(testigo), errores))
  }

  // La reexpresion por inflacion. Nunca la ve el cliente: es contabilidad.
  if (p.ruta === '/reexpresion' && (p.metodo === 'GET' || p.metodo === 'POST')) {
    if (p.metodo === 'POST' && !testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    const hoy = new Date()
    const cuando = anioMes(p)
    const anio = cuando?.anio ?? hoy.getUTCFullYear()
    const mes = cuando?.mes ?? hoy.getUTCMonth() + 1

    let errores: readonly string[] = []
    if (p.metodo === 'POST') {
      if (cuando === null) {
        errores = [t(p.idioma, 'periodo.error.fecha')]
      } else {
        const r = await comoQuien((q) =>
          asentarMes(q, org!.organizacion_id, anio, mes, personaId, p.idioma))
        if (!r.hecho) errores = [r.motivo]
      }
    }

    // El cuadro se mira al ultimo dia del mes elegido, no a hoy: comparar contra hoy
    // mientras se cierra un mes anterior da una cifra que no cuadra con nada.
    const al = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10)
    const c = await comoQuien((q) => cuadro(q, org!.organizacion_id, p.idioma, al))
    return html(errores.length === 0 ? 200 : 400,
      pintarReexpresion(c, p.idioma, testigoAnti(testigo), anio, mes, errores))
  }

  // El mayor de una cuenta: por que el banco tiene exactamente este saldo.
  if (p.ruta === '/mayor' && p.metodo === 'GET') {
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    // Aqui solo se MIRA, asi que una fecha ilegible se resuelve con un rango
    // razonable en vez de parar: el año en curso.
    const hoy = new Date()
    const buena = (v: string | undefined, porDefecto: string) => {
      const t = (v ?? '').trim()
      return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t)) ? t : porDefecto
    }
    const desde = buena(p.campos['desde'], `${hoy.getUTCFullYear()}-01-01`)
    const hasta = buena(p.campos['hasta'], hoy.toISOString().slice(0, 10))
    // El codigo de cuenta viene de un desplegable, pero llega por la direccion: se
    // comprueba la FORMA antes de usarlo, y la existencia la comprueba el dominio.
    const pedida = (p.campos['cuenta'] ?? '').trim()
    const cuenta = /^[0-9.]{1,20}$/.test(pedida) ? pedida : ''

    const m = await comoQuien((q) =>
      mayor(q, org!.organizacion_id, cuenta, desde, hasta, p.idioma))
    return html(200, pintarMayor(m, p.idioma, testigoAnti(testigo)))
  }

  // El libro diario: donde termina de abrirse cualquier cifra del sistema.
  if (p.ruta === '/diario' && (p.metodo === 'GET' || p.metodo === 'POST')) {
    if (p.metodo === 'POST' && !testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    const hoy = new Date()
    const cuando = anioMes(p)
    const anio = cuando?.anio ?? hoy.getUTCFullYear()
    const mes = cuando?.mes ?? hoy.getUTCMonth() + 1

    // Reversar es lo unico que se ESCRIBE desde el diario. Todo el sistema dice
    // «registra su reverso» y hasta ahora no habia ni un sitio donde registrarlo.
    let errores: readonly string[] = []
    if (p.metodo === 'POST') {
      const r = await comoQuien((q) => reversar(q, org!.organizacion_id,
        (p.campos['asiento'] ?? '').trim(), p.campos['motivo'] ?? '', personaId, p.idioma))
      if (!r.hecho) errores = [r.motivo]
    }

    const d = await comoQuien((q) => diario(q, org!.organizacion_id, anio, mes, p.idioma))
    return html(errores.length === 0 ? 200 : 400,
      pintarDiario(d, p.idioma, testigoAnti(testigo), errores))
  }

  // Los estados contables: el balance que pide un banco, el detalle donde mira un
  // contador, y lo que se cobra y se paga. Nunca lo ve el cliente.
  if (p.ruta === '/estados' && p.metodo === 'GET') {
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    // Una fecha que no se entiende se resuelve con hoy: aqui solo se MIRA, no se
    // escribe nada, asi que adivinar no cuesta un asiento mal puesto.
    const pedido = (p.campos['al'] ?? '').trim()
    const al = /^\d{4}-\d{2}-\d{2}$/.test(pedido) && !Number.isNaN(Date.parse(pedido))
      ? pedido
      : new Date().toISOString().slice(0, 10)

    const e = await comoQuien((q) => estados(q, org!.organizacion_id, p.idioma, al))
    return html(200, pintarEstados(e, p.idioma, testigoAnti(testigo)))
  }

  // «Como va el mes». Nunca lo ve el cliente: es la contabilidad de GPS.
  if (p.ruta === '/gerencia' && p.metodo === 'GET') {
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    const hoy = new Date()
    const cuando = anioMes(p)
    const anio = cuando?.anio ?? hoy.getUTCFullYear()
    const mes = cuando?.mes ?? hoy.getUTCMonth() + 1
    const m = await comoQuien((q) => mesGerencia(q, org!.organizacion_id, anio, mes, p.idioma))
    return html(200, pintarGerencia(m, p.idioma, testigoAnti(testigo)))
  }

  // Los libros de ventas y compras. Es lo unico de esta aplicacion que sale de la
  // empresa con destino al SENIAT, y nunca lo ve el cliente.
  if ((p.ruta === '/libros' || p.ruta === '/libros/hoja') && p.metodo === 'GET') {
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    const hoy = new Date()
    const cual: 'ventas' | 'compras' = p.campos['cual'] === 'compras' ? 'compras' : 'ventas'
    const cuando = anioMes(p)
    const anio = cuando?.anio ?? hoy.getUTCFullYear()
    const mes = cuando?.mes ?? hoy.getUTCMonth() + 1

    if (p.ruta === '/libros') {
      const l = await comoQuien((q) => libro(q, org!.organizacion_id, cual, anio, mes, p.idioma))
      return html(200, pintarLibro(l, p.idioma, testigoAnti(testigo)))
    }

    // La hoja. Los importes van SIN formatear: esto lo abre una hoja de calculo, y
    // «1.234,56» leido por una hoja en ingles se convierte en otra cosa. Quien lo
    // lee es una maquina, no una persona.
    const l = await comoQuien((q) => libro(q, org!.organizacion_id, cual, anio, mes, p.idioma))
    const crudos = await comoQuien((q) => libroCrudo(q, org!.organizacion_id, cual, anio, mes))
    const { cabeceras, filas } = aFilas(l, p.idioma, crudos)
    const texto = escribirHoja([cabeceras, ...filas])
    const bytes = new TextEncoder().encode(texto)
    const nombre = `libro-${cual}-${anio}-${String(mes).padStart(2, '0')}.csv`
    return {
      codigo: 200,
      bytes,
      cabeceras: {
        ...CABECERAS_BASE,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        'Content-Length': String(bytes.length),
      },
    }
  }

  const contrato = /^\/contratos\/([0-9a-f-]{36})$/.exec(p.ruta)
  if (contrato && p.metodo === 'GET') {
    try {
      const f = await comoQuien((q) => ficha(q, contrato[1]!, p.idioma, !esCliente))
      return html(200, pintarContrato(f, p.idioma, esCliente, testigoAnti(testigo), porque(p)))
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
      // Subir y revisar es de dentro. Al cliente no se le esconden los botones:
      // es que sin esto no hay nada que pintar, así que no pueden salir por descuido.
      return html(200, pintarPaginaAvance(datos.avance, datos.cabecera, p.idioma,
        esCliente ? null : { antifalsificacion: testigoAnti(testigo), volver: p.ruta },
        porque(p)))
    } catch (e) {
      if (e instanceof HitoNoAlcanzable) return noEncontrado(p.idioma)
      throw e
    }
  }

  // ------------------------------------------------------------------ evidencia

  // Subir el documento que respalda un hito. Solo de dentro: si el cliente pudiera
  // subir su propia evidencia, el avance volvería a ser lo que alguien diga — solo
  // que ahora lo diría el otro lado.
  const subirEvi = /^\/hitos\/([0-9a-f-]{36})\/evidencia$/.exec(p.ruta)
  if (subirEvi && p.metodo === 'POST') {
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)

    // Todo lo que rechaza una subida vuelve a la pagina con el motivo. Contestar 400
    // con el cuerpo vacio dejaba a quien sube un acta viendo una pagina en blanco, sin
    // saber si el problema era el archivo, el tipo o la clase.
    const volverA = destinoSeguro(p.campos['volver'])
    const a = p.archivo
    if (!a) return aOtroSitio(conFallo(volverA, 'subir.error.sin_archivo'))
    // El tipo se comprueba contra una lista cerrada ANTES de tocar el disco. Escribir
    // primero y comprobar después deja el archivo puesto aunque se rechace.
    if (!tipoAceptado(a.tipoMime)) return aOtroSitio(conFallo(volverA, 'subir.error.tipo'))
    const clase = p.campos['clase'] ?? ''
    if (!(CLASES as readonly string[]).includes(clase)) {
      return aOtroSitio(conFallo(volverA, 'subir.error.clase'))
    }

    try {
      // Los bytes al almacén primero, la fila después. Al revés quedaría una fila
      // apuntando a un documento que no está, que es peor que no tener la fila:
      // la pantalla diría que el papel existe.
      await almacen().guardar(a.contenido)
      await comoQuien((q) => subir(q, {
        hitoId: subirEvi[1]!,
        clase: clase as Clase,
        nombre: a.archivo,
        tipoMime: a.tipoMime,
        contenido: a.contenido,
        ocurridoEn: p.campos['ocurrido_en'] || null,
      }, personaId, p.idioma))
    } catch (e) {
      if (e instanceof HitoNoAlcanzable) return noEncontrado(p.idioma)
      if (e instanceof DocumentoVacio) return aOtroSitio(conFallo(volverA, 'subir.error.vacio'))
      throw e
    }
    return aOtroSitio(destinoSeguro(p.campos['volver']))
  }

  // Revisar es de GPS, siempre. Rechazar exige motivo, y el motivo se comprueba aquí
  // y no solo en la base de datos: que la pantalla deje pulsar y luego reviente es
  // la forma más rápida de que alguien deje de usar el botón.
  const revisar = /^\/evidencia\/([0-9a-f-]{36})\/(verificar|rechazar)$/.exec(p.ruta)
  if (revisar && p.metodo === 'POST') {
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)

    const r = revisar[2] === 'verificar'
      ? await comoQuien((q) => verificar(q, revisar[1]!, personaId))
      : await comoQuien((q) => rechazar(q, revisar[1]!, personaId, p.campos['motivo'] ?? ''))

    if (!r.hecho && r.motivo === 'no_alcanzable') return noEncontrado(p.idioma)
    if (!r.hecho) return aOtroSitio(conFallo(destinoSeguro(p.campos['volver']), r.motivo))
    return aOtroSitio(destinoSeguro(p.campos['volver']))
  }

  // Descargar el documento. La fila se pide COMO la persona, así que las políticas
  // de fila deciden si le toca — y la factura del proveedor no le toca a un cliente.
  // Los bytes solo se leen si la fila vino.
  const bajarEvi = /^\/evidencia\/([0-9a-f-]{36})\/archivo$/.exec(p.ruta)
  if (bajarEvi && p.metodo === 'GET') {
    const [fila] = (await comoQuien((q) => q`
      select huella, nombre, tipo_mime from evidencia where id = ${bajarEvi[1]!}::uuid
    `)) as unknown as Array<{ huella: string; nombre: string; tipo_mime: string }>
    if (!fila) return noEncontrado(p.idioma)

    try {
      const bytes = await almacen().leer(fila.huella)
      return {
        codigo: 200,
        bytes,
        cabeceras: {
          ...CABECERAS_BASE,
          // El tipo se vuelve a filtrar por la lista cerrada al SALIR, no solo al
          // entrar: si algún día se cuela una fila con otro tipo, aquí no sale.
          'Content-Type': tipoAceptado(fila.tipo_mime)
            ? fila.tipo_mime : 'application/octet-stream',
          // Descarga, nunca dentro de la página. Un documento subido por otro que se
          // abriera en el dominio del portal es código de otro corriendo aquí.
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fila.nombre)}`,
          'Content-Length': String(bytes.length),
        },
      }
    } catch (e) {
      // Falta en el disco o la huella está torcida: las dos cosas se responden igual,
      // porque distinguirlas solo le sirve a quien esté probando.
      if (e instanceof DocumentoAusente || e instanceof HuellaInvalida) {
        return noEncontrado(p.idioma)
      }
      throw e
    }
  }

  // Proponer una valuación desde lo verificado. Solo de dentro: GPS factura.
  const valuar = /^\/contratos\/([0-9a-f-]{36})\/valuar$/.exec(p.ruta)
  if (valuar && p.metodo === 'GET') {
    if (esCliente) return noEncontrado(p.idioma)
    try {
      const hoy = new Date().toISOString().slice(0, 10)
      const prop = await comoQuien((q) => proponer(q, valuar[1]!, hoy, p.idioma))
      return html(200, pintarValuar(prop, p.idioma, testigoAnti(testigo),
        primeroDelMes(hoy), hoy))
    } catch (e) {
      if (e instanceof ContratoNoValuable) return noEncontrado(p.idioma)
      throw e
    }
  }

  if (valuar && p.metodo === 'POST') {
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)

    const hoy = new Date().toISOString().slice(0, 10)
    const desde = p.campos['desde'] || primeroDelMes(hoy)
    const hasta = p.campos['hasta'] || hoy
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>

    try {
      const r = await comoQuien((q) => emitir(q, {
        contratoId: valuar[1]!,
        desde,
        hasta,
        retieneIva: p.campos['ret_iva'] === '1',
        pagaEnDivisa: p.campos['divisa'] === '1',
      }, personaId, org!.organizacion_id, p.idioma))

      if (!r.hecho) {
        const prop = await comoQuien((q) => proponer(q, valuar[1]!, hasta, p.idioma))
        return html(400, pintarValuar(prop, p.idioma, testigoAnti(testigo),
          desde, hasta, r.errores))
      }
      return aOtroSitio(`/valuaciones/${r.valuacionId}`)
    } catch (e) {
      if (e instanceof ContratoNoValuable) return noEncontrado(p.idioma)
      throw e
    }
  }

  // Poner un contrato en vigor. Es el segundo acto deliberado: hasta aquí era un
  // borrador que el cliente no veía, erratas incluidas.
  const activarCtr = /^\/contratos\/([0-9a-f-]{36})\/activar$/.exec(p.ruta)
  if (activarCtr && p.metodo === 'POST') {
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)
    const [org] = (await dentro((q) => q`
      select organizacion_id from persona where id = ${personaId}::uuid
    `)) as unknown as Array<{ organizacion_id: string }>
    const r = await comoQuien((q) => activar(q, activarCtr[1]!, org!.organizacion_id))
    if (!r.hecho && r.motivo === 'no_alcanzable') return noEncontrado(p.idioma)
    // Un 409 con el cuerpo vacio era una pagina en blanco: el motivo existia, estaba
    // escrito en el diccionario, y no llegaba a ninguna parte. Vuelve a la ficha con
    // el motivo puesto, que es donde esta el boton que se acaba de pulsar.
    if (!r.hecho) {
      return aOtroSitio(conFallo(`/contratos/${activarCtr[1]!}`,
        r.motivo === 'estado_equivocado' ? 'ya_vigente' : r.motivo))
    }
    return aOtroSitio(`/contratos/${activarCtr[1]!}`)
  }

  // Presentar la valuación: el momento en que sale de GPS. El aviso por correo lo
  // encola la base de datos sola, en la misma transacción que el cambio de estado.
  const presentarVal = /^\/valuaciones\/([0-9a-f-]{36})\/presentar$/.exec(p.ruta)
  if (presentarVal && p.metodo === 'POST') {
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    const r = await comoQuien((q) => presentar(q, presentarVal[1]!, esCliente))
    if (!r.hecho && r.motivo === 'no_alcanzable') return noEncontrado(p.idioma)
    if (!r.hecho) return aOtroSitio(conFallo(`/valuaciones/${presentarVal[1]!}`, r.motivo))
    return aOtroSitio(`/valuaciones/${presentarVal[1]!}`)
  }

  const valuacion = /^\/valuaciones\/([0-9a-f-]{36})$/.exec(p.ruta)
  if (valuacion && p.metodo === 'GET') {
    try {
      const datos = await comoQuien(async (q) => {
        // La cabecera primero: de ahí sale la moneda con la que se formatea la hoja.
        const cab = await cabeceraDeValuacion(q, valuacion[1]!)
        const lineas = await hojaDeValuacion(q, valuacion[1]!, p.idioma, cab.moneda, esCliente)
        const objeciones = await objecionesDe(q, valuacion[1]!)
        const factura = await facturaDe(q, valuacion[1]!, p.idioma)
        return { cab, lineas, objeciones, factura }
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
        // Presentar también, y solo mientras siga siendo un borrador.
        puedePresentar: !esCliente && datos.cab.estado === 'borrador',
        // Y cobrar, solo cuando ya hay algo que cobrar.
        puedeCobrar: !esCliente &&
          ['aprobada', 'facturada', 'cobrada'].includes(datos.cab.estado),
        // Facturar, solo una vez aprobada y sin objeciones abiertas.
        puedeFacturar: !esCliente && datos.cab.estado === 'aprobada' &&
          !datos.objeciones.some((o) => o.respondidaEn === null),
        factura: datos.factura,
        // Corregir una factura es de dentro, y solo tiene sentido si existe.
        puedeCorregir: !esCliente && datos.factura !== null,
        antifalsificacion: testigoAnti(testigo),
        objeciones: datos.objeciones.map((o) => ({
          id: o.id,
          motivo: o.motivo,
          cuando: formatearFecha(p.idioma, o.cuando),
          respuesta: o.respuesta,
          respondidaEn: o.respondidaEn ? formatearFecha(p.idioma, o.respondidaEn) : null,
        })),
      }, p.idioma, porque(p)))
    } catch (e) {
      if (e instanceof ValuacionNoAlcanzable) return noEncontrado(p.idioma)
      throw e
    }
  }

  // Registrar un cobro. Cierra el ciclo: valuación → asiento → cobro → asiento.
  const cobrarVal = /^\/valuaciones\/([0-9a-f-]{36})\/cobrar$/.exec(p.ruta)
  if (cobrarVal && (p.metodo === 'GET' || p.metodo === 'POST')) {
    if (p.metodo === 'POST' && !testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    const hoy = new Date().toISOString().slice(0, 10)
    try {
      let errores: readonly string[] = []
      if (p.metodo === 'POST') {
        const [org] = (await dentro((q) => q`
          select organizacion_id from persona where id = ${personaId}::uuid
        `)) as unknown as Array<{ organizacion_id: string }>
        const r = await comoQuien((q) => registrarCobro(q, {
          valuacionId: cobrarVal[1]!,
          fecha: p.campos['fecha'] || hoy,
          medio: (p.campos['medio'] ?? 'transferencia') as Medio,
          monto: Number((p.campos['monto'] ?? '0').replace(',', '.')),
          referencia: p.campos['referencia'] ?? '',
        }, personaId, org!.organizacion_id, p.idioma))
        if (r.hecho) return aOtroSitio(`/valuaciones/${cobrarVal[1]!}`)
        errores = r.errores
      }
      const e = await comoQuien((q) => estadoDeCobro(q, cobrarVal[1]!, p.idioma))
      return html(errores.length === 0 ? 200 : 400,
        pintarCobrar(e, p.idioma, testigoAnti(testigo), hoy, errores))
    } catch (e) {
      if (e instanceof NoCobrable) return noEncontrado(p.idioma)
      throw e
    }
  }

  // Emitir la factura. El correlativo lo pone la base de datos, no una persona.
  const facturarVal = /^\/valuaciones\/([0-9a-f-]{36})\/facturar$/.exec(p.ruta)
  if (facturarVal && p.metodo === 'POST') {
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)
    const r = await comoQuien((q) =>
      facturar(q, facturarVal[1]!, personaId, esCliente, p.idioma))
    if (!r.hecho) return aOtroSitio(conFallo(`/valuaciones/${facturarVal[1]!}`, r.motivo))
    return aOtroSitio(`/valuaciones/${facturarVal[1]!}`)
  }

  // Corregir una factura con una nota. La factura no se toca: ya la tiene el cliente
  // y ya está declarada.
  const notaVal = /^\/valuaciones\/([0-9a-f-]{36})\/nota$/.exec(p.ruta)
  if (notaVal && p.metodo === 'POST') {
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    if (esCliente) return noEncontrado(p.idioma)

    const f = await comoQuien((q) => facturaDe(q, notaVal[1]!, p.idioma))
    if (!f) return noEncontrado(p.idioma)

    const r = await comoQuien((q) => emitirNota(q, {
      facturaId: f.id,
      tipo: p.campos['tipo'] === 'nota_debito' ? 'nota_debito' : 'nota_credito',
      base: Number((p.campos['base'] ?? '0').replace(',', '.')),
      motivo: p.campos['motivo'] ?? '',
    }, personaId, esCliente, p.idioma))
    if (!r.hecho) return aOtroSitio(conFallo(`/valuaciones/${notaVal[1]!}`, r.motivo))
    return aOtroSitio(`/valuaciones/${notaVal[1]!}`)
  }

  const responderObj = /^\/objeciones\/([0-9a-f-]{36})\/responder$/.exec(p.ruta)
  if (responderObj && p.metodo === 'POST') {
    if (!testigoAntiValido(testigo, p.campos['af'])) {
      return { codigo: 403, cabeceras: CABECERAS_BASE, cuerpo: '' }
    }
    const r = await comoQuien((q) =>
      responder(q, responderObj[1]!, personaId, !esCliente, p.campos['respuesta'] ?? ''))
    if (!r.hecho && r.motivo === 'no_alcanzable') return noEncontrado(p.idioma)
    if (!r.hecho) return aOtroSitio(conFallo(destinoSeguro(p.campos['volver']), r.motivo))
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
    // Esta es la que ve EL CLIENTE. Aprobar una valuación que ya no está presentada
    // —porque alguien la movió mientras él tenía la página abierta— le contestaba con
    // una página en blanco, y el cliente no tiene a quién preguntarle qué pasó.
    if (!r.hecho) return aOtroSitio(conFallo(`/valuaciones/${idVal}`, r.motivo))
    // Después de escribir se redirige, nunca se responde con la página. Si no,
    // recargar repetiría la acción y el navegador avisaría con un diálogo feo.
    return aOtroSitio(`/valuaciones/${idVal}`)
  }

  return noEncontrado(p.idioma)
}

/**
 * Lo que salio mal en una accion, dicho con palabras.
 *
 * Una accion que no se puede hacer contestaba `409` con el cuerpo vacio: una PAGINA
 * EN BLANCO. El motivo existia —estaba escrito en el diccionario— y no llegaba a
 * ninguna parte. Ahora la ruta vuelve a la pagina de donde se pulso, con el motivo
 * en la direccion, y la pagina lo pinta.
 *
 * Lo que llega por la direccion NO se pinta tal cual: solo ELIGE una de estas
 * claves. Si se pintara lo que llega, cualquiera podria escribir lo que quisiera en
 * la pantalla de otro mandandole un enlace.
 */
const PORQUE: Record<string, Clave> = {
  sin_hitos: 'accion.error.sin_hitos',
  estado_equivocado: 'accion.error.estado',
  no_eres_el_cliente: 'accion.error.no_te_toca',
  sin_motivo: 'accion.error.sin_motivo',
  ya_revisada: 'accion.error.ya_revisada',
  ya_vigente: 'accion.error.ya_vigente',
  'facturar.error.ya': 'facturar.error.ya',
  'facturar.error.sin_aprobar': 'facturar.error.sin_aprobar',
  'facturar.error.objecion': 'facturar.error.objecion',
  'nota.error.sin_factura': 'nota.error.sin_factura',
  'nota.error.base': 'nota.error.base',
  'nota.error.motivo': 'nota.error.motivo',
  'nota.error.pasa': 'nota.error.pasa',
  'valuar.error.contrato': 'valuar.error.contrato',
  'valuar.error.nada': 'valuar.error.nada',
  'subir.error.sin_archivo': 'subir.error.sin_archivo',
  'subir.error.tipo': 'subir.error.tipo',
  'subir.error.clase': 'subir.error.clase',
  'subir.error.vacio': 'subir.error.vacio',
}

/** El motivo que viene de vuelta, ya traducido, o nada. */
function porque(p: Peticion): readonly string[] {
  const c = p.campos['fallo']
  const clave = c === undefined ? undefined : PORQUE[c]
  return clave === undefined ? [] : [t(p.idioma, clave)]
}

/** Una direccion con el motivo pegado, respetando lo que ya llevara. */
function conFallo(destino: string, motivo: string): string {
  return `${destino}${destino.includes('?') ? '&' : '?'}fallo=${encodeURIComponent(motivo)}`
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

/** Lo que el humano dejó en los desplegables del mapeo, columna por columna. */
/**
 * El mapeo tal como lo devolvió el formulario.
 *
 * Cada casilla lleva el número de su columna en el NOMBRE: `campo_3`, `formato_3`.
 * Antes iban en tres listas paralelas que se emparejaban por posición, y eso se
 * rompía solo: un `<select>` deshabilitado —el del formato, en las columnas de
 * texto— no lo manda el navegador, así que llegaban menos formatos que campos y a
 * partir de ahí cada formato caía en la columna equivocada. La fecha de una factura
 * se leía con el formato de otra columna, y una fecha ilegible entraba como
 * «0001-01-01» sin que nadie viera nada.
 *
 * El tipo de cada campo se busca en la lista del DESTINO de esa hoja, no en una fija.
 * Estaba fija en «facturas_recibidas», y funcionaba por casualidad: los campos del
 * histórico de ventas que llevan fecha o número se llaman igual en los dos destinos.
 * El día que un destino traiga un campo numérico que el otro no tenga, el mapeo se
 * guardaría como texto y la validación comprobaría otra cosa —sin avisar de nada,
 * que es lo peor que puede hacer una validación.
 */
/**
 * Un entero venido de un formulario, o nada.
 *
 * `Number('hola')` no falla: devuelve `NaN`. Y `NaN` no es un número pero SÍ llega
 * hasta la base de datos, que contesta `invalid input syntax for type integer:
 * "NaN"` — un error de servidor, no un «eso no vale». La comprobación va aquí y no
 * allí porque el sitio donde se explica un dato mal escrito es la pantalla.
 *
 * Se exige la forma entera: ni «12.5», ni «12abc», ni «1e9». Un año se escribe con
 * cuatro cifras y ya está.
 */
function entero(v: string | undefined): number | null {
  if (v === undefined) return null
  const t = v.trim()
  return /^-?\d{1,9}$/.test(t) ? Number(t) : null
}

/**
 * Un importe venido de un formulario, o nada.
 *
 * El hermano decimal de `entero()`, y con el mismo motivo: `Number('')` es CERO, no
 * `NaN`, así que una casilla vacía se colaría como un importe de cero. Se acepta la
 * coma además del punto porque en castellano el decimal es la coma y quien teclea
 * «12,50» no está escribiendo mal.
 */
function decimal(v: string | undefined): number | null {
  if (v === undefined) return null
  const t = v.trim().replace(',', '.')
  if (!/^\d{1,15}(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Año y mes de un formulario; `null` si alguno no se entiende o no existe. */
function anioMes(p: Peticion): { anio: number; mes: number } | null {
  const anio = entero(p.campos['anio'])
  const mes = entero(p.campos['mes'])
  if (anio === null || mes === null) return null
  if (anio < 2000 || anio > 2100 || mes < 1 || mes > 12) return null
  return { anio, mes }
}

function mapeoDelFormulario(p: Peticion, destino: Destino): Array<{
  columna: number; campo: Campo | null; tipo: string; formato: string | null
}> {
  const col = (n: string) => p.repetidos?.[n] ?? (p.campos[n] ? [p.campos[n]!] : [])
  const columnas = col('columna')
  const tipoDe = (campo: string) =>
    CAMPOS[destino].find((c) => c.campo === campo)?.tipo ?? 'texto'

  return columnas.map((c) => {
    const n = Number(c)
    const campo = (p.campos[`campo_${n}`] ?? '') as Campo | ''
    return {
      columna: n,
      campo: campo === '' ? null : campo,
      tipo: campo === '' ? 'texto' : tipoDe(campo),
      formato: (p.campos[`formato_${n}`] ?? '') || null,
    }
  })
}

/** El primero del mes de una fecha. El periodo por omisión es el mes en curso. */
function primeroDelMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`
}

/**
 * Lo que vino del formulario de alta, tal cual, para poder devolverlo escrito.
 *
 * Las columnas de los renglones llegan como campos repetidos: `r_desc_es` cinco
 * veces, `r_cantidad` cinco veces. Se vuelven a cruzar por posición, que es como el
 * navegador las manda — en el mismo orden en que están en la página.
 */
function altaTraida(p: Peticion): Traido {
  const col = (n: string) => p.repetidos?.[n] ?? (p.campos[n] ? [p.campos[n]!] : [])
  const desc = col('r_desc_es')
  const renglones = desc.map((_, i) => ({
    desc_es: col('r_desc_es')[i] ?? '',
    desc_en: col('r_desc_en')[i] ?? '',
    cantidad: col('r_cantidad')[i] ?? '',
    unidad: col('r_unidad')[i] ?? '',
    norma: col('r_norma')[i] ?? '',
    espec: col('r_espec')[i] ?? '',
    precio: col('r_precio')[i] ?? '',
    costo: col('r_costo')[i] ?? '',
  }))
  const campos: Record<string, string> = {}
  for (const k of ['cliente', 'codigo', 'tipo', 'moneda', 'titulo_es', 'titulo_en',
                   'firmado_el', 'inicio', 'fin_previsto', 'anticipo_pct',
                   'amortiza_pct', 'garantia_pct']) {
    campos[k] = p.campos[k] ?? ''
  }
  return { campos, renglones }
}

/** Del texto del formulario a lo que el dominio entiende. */
function contratoDesdeFormulario(tr: Traido): ContratoNuevo {
  const num = (v: string | undefined) => {
    const n = Number((v ?? '').replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  const c = tr.campos ?? {}
  const tipo = (c['tipo'] ?? '') as TipoContrato
  return {
    clienteId: c['cliente'] ?? '',
    codigo: c['codigo'] ?? '',
    tipo: TIPOS.includes(tipo) ? tipo : ('procura' as TipoContrato),
    tituloEs: c['titulo_es'] ?? '',
    tituloEn: c['titulo_en'] ?? '',
    moneda: c['moneda'] === 'VES' ? 'VES' : 'USD',
    firmadoEl: c['firmado_el'] || null,
    inicio: c['inicio'] || null,
    finPrevisto: c['fin_previsto'] || null,
    anticipoPct: num(c['anticipo_pct']),
    amortizaPct: num(c['amortiza_pct']),
    garantiaPct: num(c['garantia_pct']),
    // Las filas vacías se tiran aquí: el formulario pinta huecos de más a propósito,
    // y guardarlos crearía renglones fantasma con cantidad cero.
    renglones: (tr.renglones ?? [])
      .filter((r) => (r['desc_es'] ?? '').trim() !== '' || (r['precio'] ?? '').trim() !== '')
      .map((r): RenglonNuevo => ({
        descripcionEs: r['desc_es'] ?? '',
        descripcionEn: (r['desc_en'] ?? '').trim() || (r['desc_es'] ?? ''),
        cantidad: num(r['cantidad']),
        unidad: r['unidad'] ?? '',
        norma: (r['norma'] ?? '').trim() || null,
        especificacion: (r['espec'] ?? '').trim() || null,
        precioUnitario: num(r['precio']),
        costoUnitario: (r['costo'] ?? '').trim() === '' ? null : num(r['costo']),
      })),
  }
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
export async function leerCampos(
  req: IncomingMessage,
): Promise<{ campos: Record<string, string>; repetidos: Record<string, string[]> }> {
  const trozos: Buffer[] = []
  let total = 0
  for await (const t of req) {
    total += (t as Buffer).length
    if (total > MAX_CUERPO) throw new CuerpoDemasiadoGrande(total)
    trozos.push(t as Buffer)
  }
  const texto = Buffer.concat(trozos).toString('utf-8')
  const campos: Record<string, string> = {}
  const repetidos: Record<string, string[]> = {}
  for (const [k, v] of new URLSearchParams(texto)) {
    campos[k] = v
    ;(repetidos[k] ??= []).push(v)
  }
  return { campos, repetidos }
}

export class CuerpoDemasiadoGrande extends Error {
  readonly bytes: number
  constructor(bytes: number) {
    super('El cuerpo de la petición es demasiado grande')
    this.name = 'CuerpoDemasiadoGrande'
    this.bytes = bytes
  }
}

/** Lee el cuerpo entero, con tope. El tope se comprueba MIENTRAS llega, no al final. */
async function leerBytes(req: IncomingMessage, tope: number): Promise<Buffer> {
  const trozos: Buffer[] = []
  let total = 0
  for await (const t of req) {
    total += (t as Buffer).length
    if (total > tope) throw new CuerpoDemasiadoGrande(total)
    trozos.push(t as Buffer)
  }
  return Buffer.concat(trozos)
}

/** Adapta una petición de red al tipo que entiende `resolver`. */
export async function desdeHttp(req: IncomingMessage): Promise<Peticion> {
  const url = new URL(req.url ?? '/', 'http://interno')

  // Un formulario con archivo pesa otra cosa que uno de texto, así que el tope es
  // otro. El de texto se queda como estaba: un formulario de entrada no pesa más.
  const limite = frontera(req.headers['content-type'])
  let campos: Record<string, string> = {}
  let repetidos: Record<string, readonly string[]> = {}
  let archivo: Peticion['archivo'] = null
  // Los parámetros de la dirección valen para todos los métodos: la vuelta de un
  // proveedor de identidad llega por GET con el estado y el código dentro.
  for (const [k, v] of url.searchParams) campos[k] = v

  if (req.method === 'POST') {
    if (limite) {
      const partes = partir(await leerBytes(req, LIMITES.maxBytes), limite)
      // Lo del cuerpo pisa a lo de la dirección: un formulario que manda 'af' gana
      // a un 'af' colado en la dirección por quien enlazó la página.
      campos = { ...campos, ...camposDe(partes) }
      repetidos = repetidosDe(partes)
      const a = archivoDe(partes, 'documento')
      archivo = a ? { archivo: a.archivo, tipoMime: a.tipoMime, contenido: a.contenido } : null
    } else {
      const leido = await leerCampos(req)
      campos = { ...campos, ...leido.campos }
      repetidos = leido.repetidos
    }
  }

  return {
    metodo: req.method ?? 'GET',
    ruta: url.pathname,
    campos,
    repetidos,
    archivo,
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
  // Los bytes van tal cual. Pasarlos por una cadena los rompería: un PDF no es texto
  // en UTF-8, y convertirlo y desconvertirlo cambia la huella.
  res.end(r.bytes ? Buffer.from(r.bytes) : (r.cuerpo ?? ''))
}
