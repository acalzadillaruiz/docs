/**
 * Una INSTANTANEA NAVEGABLE de la aplicacion.
 *
 * No es la aplicacion funcionando: es cada pantalla tal como la genera el servidor,
 * guardada en un archivo, con los enlaces reescritos para que lleven de una a otra.
 * Se puede recorrer entera pinchando, sin servidor y sin base de datos.
 *
 * Lo que NO hace, y va escrito en la propia pagina para que nadie se confunda: los
 * formularios no envian nada. Una instantanea que finge ser la aplicacion es peor que
 * ninguna, porque el que la mira cree que ha probado algo que no ha probado.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { sembrar, MUESTRA } from './sembrar.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'
import { iconoSvg, iconoPng } from '../src/servidor/icono.ts'

const G = 'c8d9e0f1-0000-0000-0000-00000000000a'
const YO = 'c8d9e0f1-0000-0000-0000-00000000000d'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLAVE = 'una clave razonable'
// Donde se escribe. Se pasa por la linea de ordenes; el valor de por defecto vive
// fuera del repositorio a proposito: una instantanea no es codigo fuente.
const SALIDA = process.argv[2] ?? '/var/tmp/nexus-recorrido'
mkdirSync(SALIDA, { recursive: true })

conectar({ host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' })
const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)
const pedir = (p: Partial<Peticion>) => resolver({
  metodo: 'GET', ruta: '/', campos: {}, cookie: null, idioma: 'es', archivo: null,
  origen: `o-${Math.random().toString(36).slice(2)}`, ...p }, YO, false)

// La empresa de muestra: se siembra si no esta, asi la instantanea nunca sale vacia.
await sembrar()
const origen = 'o-export'
const p1 = await resolver({ metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
  campos: { correo: 'muestra@prueba.test', clave: CLAVE } }, YO, false)
const desafio = /name="desafio" value="([^"]+)"/.exec(p1.cuerpo!)![1]!
const p2 = await resolver({ metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
  campos: { desafio, codigo: codigoEnPaso(desdeBase32(SECRETO), pasoDe(new Date())) } }, YO, false)
const gps = new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(p2.cabeceras!['Set-Cookie']!)![1]!

/**
 * Y la sesion de alguien de la OPERADORA.
 *
 * Sin esto, la mitad del producto no salia en la instantanea: todas las paginas se pedian
 * como GPS, asi que el portal del cliente —lo que ve el que paga— no se habia podido ver
 * nunca. Y es justo la mitad de la que se discute si se usara o no.
 */
async function entrarComo(correo: string): Promise<string> {
  const o = `o-export-${correo}`
  const a = await resolver({ metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es',
    origen: o, campos: { correo, clave: CLAVE } }, YO, false)
  const d = /name="desafio" value="([^"]+)"/.exec(a.cuerpo!)![1]!
  const b = await resolver({ metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es',
    origen: o, campos: { desafio: d,
      codigo: codigoEnPaso(desdeBase32(SECRETO), pasoDe(new Date())) } }, YO, false)
  return new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(b.cabeceras!['Set-Cookie']!)![1]!
}
const cliente = await entrarComo(MUESTRA.correoCliente)

// TODOS los contratos: una instantanea con un tercio de los enlaces apagados no es
// navegable, y hace dudar de lo que si funciona.
const contratos = (await dentro((q) => q`
  select id, codigo from contrato where organizacion_id = ${G}::uuid
   order by codigo
`)) as unknown as Array<{ id: string; codigo: string }>

// Los renglones y las valuaciones. Son las dos pantallas MAS enlazadas de todo el
// recorrido —162 y 40 enlaces— y hasta ahora salian apagadas: la instantanea ensenaba
// la contabilidad entera y no dejaba abrir un solo renglon, que es donde vive la tesis
// del producto (el avance sale de los hitos verificados, no de una casilla).
//
// Solo los que TIENEN hitos, y no es un atajo: un renglon sin hitos contesta 404 a
// proposito —no hay avance que ensenar y no se distingue de uno que no te toca—, y es
// exactamente lo que el bloque «a que renglones se les olvido crear los hitos» de
// /medidas senala. Pedirlos daria sesenta lineas de «SALTADA» que no dicen nada.
const renglones = (await dentro((q) => q`
  select rg.id, ct.codigo as contrato, rg.numero
    from renglon rg join contrato ct on ct.id = rg.contrato_id
   where ct.organizacion_id = ${G}::uuid
     and exists (select 1 from hito h where h.renglon_id = rg.id)
   order by ct.codigo, rg.numero
`)) as unknown as Array<{ id: string; contrato: string; numero: number }>

const valuaciones = (await dentro((q) => q`
  select va.id, ct.codigo as contrato, va.numero
    from valuacion va join contrato ct on ct.id = va.contrato_id
   where va.organizacion_id = ${G}::uuid
   order by ct.codigo, va.numero
`)) as unknown as Array<{ id: string; contrato: string; numero: number }>

/** Una invitacion viva, para poder ensenar la pantalla de alta de cuenta. */
const ficha = await (async () => {
  const { invitar } = await import('../src/dominio/personas.ts')
  const r = await dentro((q) => invitar(q, {
    orgId: G, correo: `muestra-${Date.now()}@ejemplo.test`,
    nombre: 'Persona invitada', idioma: 'es',
  }, YO, 'es'))
  return r.hecho ? (r.ficha ?? '') : ''
})()

/** Y un desafio abierto, para la pantalla de «perdi el telefono». */
const desafioAbierto = await (async () => {
  const r = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen: 'o-export-rec',
    campos: { correo: 'muestra@prueba.test', clave: CLAVE },
  }, YO, false)
  return /name="desafio" value="([^"]+)"/.exec(r.cuerpo ?? '')?.[1] ?? ''
})()

type Pagina = {
  archivo: string
  ruta: string
  campos?: Record<string, string>
  metodo?: 'GET' | 'POST'
  /** Sin sesion: las pantallas de antes de entrar. */
  fuera?: boolean
  /** Pedida como alguien de la operadora, no como GPS: el portal del cliente. */
  comoCliente?: boolean
}

const PAGINAS: Array<Pagina> = [
  // La cartera NO se llama 'index': en el sitio donde se publica la instantanea, ese
  // nombre esta reservado para la portada que explica que es esto y que no es.
  { archivo: 'cartera', ruta: '/' },
  // La misma cartera vista por la OPERADORA: su bandeja de lo que le espera, sus contratos,
  // y sin nada de la contabilidad ni del margen. Es la mitad del producto que no se habia
  // podido ver nunca en la instantanea, porque todo se pedia como GPS.
  { archivo: 'cliente-cartera', ruta: '/', comoCliente: true },
  { archivo: 'gerencia', ruta: '/gerencia', campos: { anio: '2027', mes: '3' } },
  { archivo: 'medidas', ruta: '/medidas' },
  { archivo: 'estados', ruta: '/estados', campos: { al: '2027-03-31' } },
  { archivo: 'diario', ruta: '/diario', campos: { anio: '2027', mes: '3' } },
  { archivo: 'mayor', ruta: '/mayor', campos: { cuenta: '1.1.02.01', desde: '2027-03-01', hasta: '2027-03-31' } },
  { archivo: 'libros', ruta: '/libros', campos: { cual: 'ventas', anio: '2027', mes: '3' } },
  { archivo: 'libros-compras', ruta: '/libros', campos: { cual: 'compras', anio: '2027', mes: '3' } },
  { archivo: 'periodos', ruta: '/periodos' },
  { archivo: 'activos', ruta: '/activos' },
  { archivo: 'reexpresion', ruta: '/reexpresion' },
  { archivo: 'proveedores', ruta: '/proveedores' },
  { archivo: 'banco', ruta: '/banco' },
  { archivo: 'caja', ruta: '/caja' },
  { archivo: 'logistica', ruta: '/logistica' },
  { archivo: 'pagar', ruta: '/pagar', campos: { al: '2027-12-31' } },
  { archivo: 'importar', ruta: '/importar' },
  { archivo: 'contratos-nuevo', ruta: '/contratos/nuevo' },
  { archivo: 'personas', ruta: '/personas' },
  { archivo: 'plantillas', ruta: '/plantillas' },
  { archivo: 'fiscales', ruta: '/fiscales' },
  { archivo: 'perfil', ruta: '/perfil' },
  // Lo de antes de entrar. Va sin sesion a proposito: es lo que ve alguien que
  // todavia no tiene cuenta, y es la mitad del producto que nadie habia visto.
  { archivo: 'entrar', ruta: '/entrar', fuera: true },
  { archivo: 'recuperacion', ruta: '/entrar/recuperacion', fuera: true,
    campos: { d: desafioAbierto } },
  { archivo: 'invitacion', ruta: '/invitacion', fuera: true, campos: { f: ficha } },
  // La pantalla que se ve UNA sola vez: el secreto del segundo factor y los diez
  // codigos de recuperacion. Aqui es de una cuenta de muestra, en una base de datos
  // desechable, asi que no hay nada que guardar.
  { archivo: 'cuenta-creada', ruta: '/invitacion', metodo: 'POST', fuera: true,
    campos: { ficha, clave: 'una clave de muestra' } },
]
for (const c of contratos) {
  PAGINAS.push({ archivo: `valuar-${c.codigo}`, ruta: `/contratos/${c.id}/valuar` })
}
for (const v of valuaciones) {
  PAGINAS.push({ archivo: `valuacion-${v.contrato}-${v.numero}`, ruta: `/valuaciones/${v.id}` })
  PAGINAS.push({ archivo: `cobrar-${v.contrato}-${v.numero}`, ruta: `/valuaciones/${v.id}/cobrar` })
}
for (const r of renglones) {
  PAGINAS.push({ archivo: `renglon-${r.contrato}-${r.numero}`, ruta: `/renglones/${r.id}` })
}
for (const c of contratos) {
  PAGINAS.push({ archivo: `contrato-${c.codigo}`, ruta: `/contratos/${c.id}` })
}
// El estado de CADA contrato. Con uno solo, el exportador contaba catorce enlaces
// apagados: la ficha de cada contrato enlaza al suyo, y una instantanea con enlaces muertos
// es una instantanea que se rompe justo donde alguien pincha.
for (const c of contratos) {
  PAGINAS.push({ archivo: `estado-${c.codigo}`, ruta: `/contratos/${c.id}/estado` })
}

/** De una ruta de la aplicacion al archivo que le toca en la instantanea. */
const mapa = new Map<string, string>()
for (const p of PAGINAS) {
  const clave = p.ruta === '/' ? '/' : p.ruta
  if (!mapa.has(clave)) mapa.set(clave, `${p.archivo}.html`)
}
// Lo que se escribe como archivo suelto mantiene su enlace vivo.
mapa.set('/icono.svg', 'icono.svg')
mapa.set('/icono-180.png', 'icono-180.png')
mapa.set('/manifest.webmanifest', 'manifest.webmanifest')
mapa.set('/libros/hoja', 'libro-ventas.csv')
mapa.set('/diario/hoja', 'diario.csv')

const AVISO = `
<div style="position:sticky;top:0;z-index:99;background:#946307;color:#fff;
  padding:9px 16px;font:600 13.5px/1.4 Inter,system-ui,sans-serif;text-align:center">
  Instantánea navegable · los enlaces funcionan, los formularios no envían ·
  <a href="cartera.html" style="color:#fff">Volver a la cartera</a>
</div>`

/** Las rutas que quedaron sin archivo: lo que la instantánea todavía no recorre. */
const APAGADOS = new Map<string, number>()

function reescribir(html: string): string {
  let salida = html
  // Los enlaces internos, a su archivo. Lo que no este en la instantanea se apaga en
  // vez de dejarlo roto: un enlace que no lleva a ningun sitio hace dudar de todo.
  salida = salida.replace(/href="(\/[^"]*)"/g, (_m, ruta: string) => {
    const limpio = (ruta as string).split('?')[0]!
    // Todos los documentos van a la misma pagina, que explica por que no estan.
    if (/^\/evidencia\/[0-9a-f-]{36}\/archivo$/.test(limpio)) return 'href="documento.html"'
    const destino = mapa.get(limpio)
    if (destino) return `href="${destino}"`
    APAGADOS.set(limpio, (APAGADOS.get(limpio) ?? 0) + 1)
    return 'href="#" data-sin-destino="1" style="opacity:.45;pointer-events:none"'
  })
  // El aviso, justo despues de abrir el cuerpo o al principio.
  if (salida.includes('<body')) {
    salida = salida.replace(/(<body[^>]*>)/, `$1${AVISO}`)
  } else {
    salida = salida.replace(/(<header)/, `${AVISO}$1`)
  }
  return salida
}

let escritas = 0
for (const p of PAGINAS) {
  const r = await pedir({
    metodo: p.metodo ?? 'GET',
    ruta: p.ruta,
    cookie: p.fuera ? null : p.comoCliente ? cliente : gps,
    campos: p.campos ?? {},
  })
  if (r.codigo !== 200 || !r.cuerpo) { console.log('SALTADA', p.ruta, r.codigo); continue }
  writeFileSync(`${SALIDA}/${p.archivo}.html`, reescribir(r.cuerpo))
  escritas++
}
console.log(`${escritas} paginas de ${PAGINAS.length}`)

// Lo que no es una pagina pero cuelga de todas. Sin esto, cada una de las ciento
// cuarenta pide tres archivos que no estan, y el navegador ensena el icono de «roto»
// en la pestana todo el rato.
writeFileSync(`${SALIDA}/icono.svg`, iconoSvg())
writeFileSync(`${SALIDA}/icono-180.png`, iconoPng(180))
for (const [archivo, ruta, campos] of [
  ['manifest.webmanifest', '/manifest.webmanifest', {}],
  // Y las dos hojas de calculo: son descargas de verdad, no paginas, y que el enlace
  // baje el archivo es la mitad de lo que hay que poder comprobar de un exportador.
  ['libro-ventas.csv', '/libros/hoja', { cual: 'ventas', anio: '2027', mes: '3' }],
  ['diario.csv', '/diario/hoja', { anio: '2027', mes: '3' }],
] as const) {
  const r = await pedir({ ruta, cookie: gps, campos: campos as Record<string, string> })
  // Una hoja de calculo vuelve en `bytes`, no en `cuerpo`: es una descarga, no una
  // pagina. Mirar solo `cuerpo` las daba por saltadas con un codigo 200 al lado, que
  // es la clase de mensaje que hace perder media hora.
  const contenido = r.cuerpo ?? (r.bytes ? Buffer.from(r.bytes) : null)
  if (r.codigo === 200 && contenido !== null) {
    writeFileSync(`${SALIDA}/${archivo}`, contenido)
  } else {
    console.log('SALTADA', ruta, r.codigo)
  }
}

// El documento de un hito. En la instantanea no hay ninguno de verdad: la evidencia de
// muestra lleva su huella y su nombre, pero detras no hay archivo. Se dice en una
// pagina en vez de dejar 161 enlaces grises, que hacen dudar de los que si funcionan.
writeFileSync(`${SALIDA}/documento.html`, `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>El documento no viaja en la instantánea</title>
<link rel="icon" href="icono.svg"></head>
<body style="margin:0;background:#0B2137;color:#E9F0F6;
  font:16px/1.55 Inter,system-ui,sans-serif;display:grid;place-items:center;
  min-height:100dvh;padding:24px">
<main style="max-width:44ch">
  <h1 style="font-size:23px;letter-spacing:-.02em;margin:0 0 12px">
    Aquí se descargaría el documento</h1>
  <p style="color:#9FB6C9;margin:0 0 10px">En la aplicación, este enlace baja el
  archivo que respalda el hito, con su huella comprobada. En la instantánea no hay
  ninguno: la evidencia de muestra lleva su nombre y su huella, pero detrás no hay
  archivo.</p>
  <p style="color:#9FB6C9;margin:0 0 18px">Se dice aquí en vez de dejar el enlace
  apagado, porque un enlace muerto hace dudar de los que sí funcionan.</p>
  <a href="cartera.html" style="color:#EFC167">← Volver a la cartera</a>
</main></body></html>`)
// Y se dice qué quedó apagado, agrupado por forma de ruta. Una instantánea que se
// calla sus enlaces muertos hace dudar de los que sí funcionan.
const porForma = new Map<string, number>()
for (const [ruta, n] of APAGADOS) {
  const forma = ruta.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')
  porForma.set(forma, (porForma.get(forma) ?? 0) + n)
}
console.log('\nenlaces apagados, por forma de ruta:')
for (const [forma, n] of [...porForma.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${forma}`)
}
await cerrar()
