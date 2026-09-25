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
import { sembrar } from './sembrar.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'

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

// TODOS los contratos: una instantanea con un tercio de los enlaces apagados no es
// navegable, y hace dudar de lo que si funciona.
const contratos = (await dentro((q) => q`
  select id, codigo from contrato where organizacion_id = ${G}::uuid
   order by codigo
`)) as unknown as Array<{ id: string; codigo: string }>

const PAGINAS: Array<{ archivo: string; ruta: string; campos?: Record<string,string> }> = [
  { archivo: 'index', ruta: '/' },
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
  { archivo: 'perfil', ruta: '/perfil' },
  { archivo: 'entrar', ruta: '/entrar' },
]
for (const c of contratos) {
  PAGINAS.push({ archivo: `contrato-${c.codigo}`, ruta: `/contratos/${c.id}` })
}

/** De una ruta de la aplicacion al archivo que le toca en la instantanea. */
const mapa = new Map<string, string>()
for (const p of PAGINAS) {
  const clave = p.ruta === '/' ? '/' : p.ruta
  if (!mapa.has(clave)) mapa.set(clave, `${p.archivo}.html`)
}

const AVISO = `
<div style="position:sticky;top:0;z-index:99;background:#946307;color:#fff;
  padding:9px 16px;font:600 13.5px/1.4 Inter,system-ui,sans-serif;text-align:center">
  Instantánea navegable · los enlaces funcionan, los formularios no envían ·
  <a href="index.html" style="color:#fff">Volver a la cartera</a>
</div>`

function reescribir(html: string): string {
  let salida = html
  // Los enlaces internos, a su archivo. Lo que no este en la instantanea se apaga en
  // vez de dejarlo roto: un enlace que no lleva a ningun sitio hace dudar de todo.
  salida = salida.replace(/href="(\/[^"]*)"/g, (_m, ruta: string) => {
    const limpio = (ruta as string).split('?')[0]!
    const destino = mapa.get(limpio)
    if (destino) return `href="${destino}"`
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

for (const p of PAGINAS) {
  const r = await pedir({ ruta: p.ruta, cookie: p.ruta === '/entrar' ? null : gps,
                          campos: p.campos ?? {} })
  if (r.codigo !== 200 || !r.cuerpo) { console.log('SALTADA', p.ruta, r.codigo); continue }
  writeFileSync(`${SALIDA}/${p.archivo}.html`, reescribir(r.cuerpo))
  console.log(p.archivo.padEnd(22), String(r.cuerpo.length).padStart(7), 'bytes')
}
await cerrar()
