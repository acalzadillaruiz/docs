/**
 * El barrido de aislamiento: TODAS las rutas, recorridas como cliente.
 *
 * GPS va a trabajar con varias operadoras a la vez, y cada una tiene que ver lo suyo
 * y nada más. Eso ya está sujeto por la base de datos —políticas de fila y permisos
 * por columna—, pero hay una capa por encima que no: **la ruta**. Una pantalla nueva
 * a la que se le olvide la línea `if (esCliente) return noEncontrado(...)` deja la
 * contabilidad de GPS abierta a cualquiera que escriba la dirección.
 *
 * Es un olvido de UNA LÍNEA, y hoy mismo he añadido cinco pantallas.
 *
 * Por eso esta prueba **no lleva la lista de rutas escrita**: la saca del código
 * fuente. Una ruta nueva entra sola en el barrido; si se le olvidó la línea, falla
 * aquí el mismo día. Una lista escrita a mano se queda vieja justo cuando hace falta,
 * y da la seguridad de una comprobación sin serlo.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'a6b7c8d9-0000-0000-0000-00000000000a'
const OP_A = 'a6b7c8d9-0000-0000-0000-00000000000b'
const OP_B = 'a6b7c8d9-0000-0000-0000-00000000000c'
const YO = 'a6b7c8d9-0000-0000-0000-00000000000d'
const ING_A = 'a6b7c8d9-0000-0000-0000-00000000000e'
const ING_B = 'a6b7c8d9-0000-0000-0000-00000000000f'
const TASA = 'a6b7c8d9-1111-0000-0000-00000000000a'
const CTR_A = 'a6b7c8d9-2222-0000-0000-00000000000a'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLAVE = 'una clave razonable'

/**
 * Lo que un cliente SÍ puede abrir. Todo lo demás tiene que contestarle 404.
 *
 * La lista es corta a propósito y hay que justificar cada línea que se le añada: es
 * la superficie que ve alguien de fuera de GPS.
 */
const PERMITIDAS = new Set([
  '/',                        // su cartera, ya filtrada por la base de datos
  '/entrar', '/entrar/codigo', '/entrar/empresa', '/entrar/empresa/vuelta',
  '/entrar/recuperacion', '/salir',
  '/perfil',                  // lo suyo: su idioma y sus avisos
  // Su estado de cuenta: lo que se le ha facturado, lo que ha pagado y lo que queda. Es
  // suyo y solo suyo —la función que lo calcula comprueba quién pregunta antes de mirar
  // nada—, no lleva ni un costo ni un margen, y la suma de lo pagado sale de una tabla que
  // él no puede leer justamente para que la referencia bancaria de GPS no salga de GPS.
  '/cuenta',
])

/**
 * Lo público que NO lleva datos de nadie: el manifiesto y los iconos.
 *
 * Van en una lista aparte y no engordando la de arriba, porque no son lo mismo. La
 * de arriba es **la superficie con datos dentro** —lo que hay que justificar una por
 * una—, y esta es un dibujo y un archivo de texto iguales para todo el mundo. El
 * navegador los pide SIN cookies, y contestarles 404 hace que no ofrezca instalar la
 * aplicación.
 *
 * Lo que sí hay que vigilar de esta lista es que solo entren cosas así. Por eso hay
 * una prueba que las pide como cliente y comprueba que lo que devuelven no cambia
 * según quién pregunte.
 */
const PUBLICAS = new Set([
  '/manifest.webmanifest', '/icono.svg', '/icono-180.png', '/icono-512.png',
])

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

const pedir = (p: Partial<Peticion>) => resolver({
  metodo: 'GET', ruta: '/', campos: {}, cookie: null, idioma: 'es', archivo: null,
  origen: `o-${Math.random().toString(36).slice(2)}`, ...p,
}, YO, false)

async function entrar(correo: string): Promise<string> {
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const p1 = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
    campos: { correo, clave: CLAVE },
  }, YO, false)
  const desafio = /name="desafio" value="([^"]+)"/.exec(p1.cuerpo!)![1]!
  const p2 = await resolver({
    metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: codigoEnPaso(desdeBase32(SECRETO), pasoDe(new Date())) },
  }, YO, false)
  return new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(p2.cabeceras!['Set-Cookie']!)![1]!
}

/** Las rutas tal como están escritas en el servidor. No una copia a mano. */
async function rutasDelCodigo(): Promise<string[]> {
  const fuente = await readFile(new URL('../src/servidor/rutas.ts', import.meta.url), 'utf8')
  // El juego de caracteres lleva el punto y el guion, y no es un detalle: con solo
  // letras y barras, '/manifest.webmanifest' y '/icono.svg' eran INVISIBLES para este
  // barrido. Se añadieron tres rutas públicas y el barrido dijo que todo estaba bien.
  // Una comprobación de seguridad con un punto ciego es peor que no tenerla: da
  // tranquilidad sin darla.
  const encontradas = [...fuente.matchAll(/p\.ruta === '(\/[a-z0-9./-]*)'/g)].map((m) => m[1]!)
  return [...new Set(encontradas)].sort()
}

let cli = ''

before(async () => {
  conectar(DESTINO)
  const hash = await cifrarClave(CLAVE)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Aislamiento','J-903600000-0'),
        ('${OP_A}','operadora','Operadora A','J-903700000-0'),
        ('${OP_B}','operadora','Operadora B','J-903800000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto) values
              (${YO}, ${G},'aisl@prueba.test','Interno','clave_2fa', ${hash}, ${SECRETO}),
              (${ING_A}, ${OP_A},'aisl-a@prueba.test','De A','clave_2fa', ${hash}, ${SECRETO}),
              (${ING_B}, ${OP_B},'aisl-b@prueba.test','De B','clave_2fa', ${hash}, ${SECRETO})
            on conflict (id) do update set clave_hash = excluded.clave_hash`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2027-02-01', 65.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      select instalar_plan_cuentas('${G}');
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es,
                            titulo_en, estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR_A}','${G}','${OP_A}','AISL-A','servicio','De la A','A''s',
                'vigente','VES', 1000000.00,'${TASA}','${YO}')
        on conflict (id) do update set codigo = excluded.codigo;
    `)
  })
  cli = await entrar('aisl-b@prueba.test')
})
after(async () => { await cerrar() })

test('la lista de rutas sale del CÓDIGO, no de una copia a mano', async () => {
  // Es lo que hace que una pantalla nueva entre sola en el barrido. Sin esto, la
  // prueba da la seguridad de una comprobación sin serlo.
  const rutas = await rutasDelCodigo()
  assert.ok(rutas.length >= 20, `solo se leyeron ${rutas.length} rutas del código`)
  // Y las de hoy tienen que estar ahí sin que nadie las haya escrito aquí.
  for (const r of ['/gerencia', '/estados', '/diario', '/mayor', '/libros']) {
    assert.ok(rutas.includes(r), `${r} no se leyó del código`)
  }
})

test('un cliente recibe 404 en TODA ruta que no sea suya', async () => {
  // El olvido es de una sola línea —`if (esCliente) return noEncontrado(...)`— y hoy
  // mismo he añadido cinco pantallas.
  const rutas = await rutasDelCodigo()
  const abiertas: string[] = []
  let miradas = 0

  for (const ruta of rutas) {
    if (PERMITIDAS.has(ruta) || PUBLICAS.has(ruta)) continue
    miradas++
    const r = await pedir({ ruta, cookie: cli })
    if (r.codigo !== 404) abiertas.push(`${ruta} → ${r.codigo}`)
  }

  assert.ok(miradas >= 12, `solo se miraron ${miradas} rutas: el barrido no barrió`)
  assert.deepEqual(abiertas, [],
    `un cliente entra donde no debe:\n  ${abiertas.join('\n  ')}`)
})

test('y el 404 es el MISMO que el de una dirección inventada', async () => {
  // Un 403 confirmaría que la pantalla existe, y eso ya es información.
  const inventada = await pedir({ ruta: '/no-existe-nada-aqui', cookie: cli })
  const contable = await pedir({ ruta: '/diario', cookie: cli })
  assert.equal(inventada.codigo, contable.codigo)
  assert.equal(inventada.cuerpo?.length, contable.cuerpo?.length,
    'la respuesta no es idéntica: la diferencia ya dice que una existe')
})

test('tampoco entra por POST: el 404 no es solo de la puerta de delante', async () => {
  const rutas = await rutasDelCodigo()
  const abiertas: string[] = []
  for (const ruta of rutas) {
    if (PERMITIDAS.has(ruta) || PUBLICAS.has(ruta)) continue
    const r = await pedir({ metodo: 'POST', ruta, cookie: cli, campos: {} })
    // 403 vale aquí: es el testigo antifalsificación parando la petición ANTES de
    // mirar quién es. Lo que no puede salir es un 200.
    if (r.codigo !== 404 && r.codigo !== 403) abiertas.push(`${ruta} → ${r.codigo}`)
  }
  assert.deepEqual(abiertas, [], `un cliente escribe donde no debe: ${abiertas.join(', ')}`)
})

test('un cliente NO ve el contrato de otra operadora, ni sabe que existe', async () => {
  // La prueba de siempre, pero por HTTP: la de B pidiendo lo de A.
  const r = await pedir({ ruta: `/contratos/${CTR_A}`, cookie: cli })
  assert.equal(r.codigo, 404)
  const inventado = await pedir({
    ruta: '/contratos/00000000-0000-0000-0000-000000000000', cookie: cli,
  })
  assert.equal(r.codigo, inventado.codigo)
})

test('la cartera de un cliente no lleva dentro nada de otro', async () => {
  const r = await pedir({ ruta: '/', cookie: cli })
  assert.equal(r.codigo, 200)
  assert.doesNotMatch(r.cuerpo ?? '', /AISL-A/, 'se coló el contrato de la otra operadora')
  assert.doesNotMatch(r.cuerpo ?? '', /Operadora A/)
})

test('y la lista de lo permitido es corta: cada línea hay que justificarla', async () => {
  // Es la superficie que ve alguien de fuera de GPS. Si esta prueba empieza a fallar
  // porque la lista creció, la pregunta no es cómo arreglarla: es por qué creció.
  assert.ok(PERMITIDAS.size <= 9, `la superficie del cliente creció a ${PERMITIDAS.size}`)
})

test('lo público no cambia según quién pregunte: por eso puede ser público', async () => {
  // Es lo que hace que el manifiesto y los iconos puedan servirse sin sesión. Si
  // alguno devolviera algo distinto según la cookie, llevaría datos dentro y esta
  // lista dejaría de ser inocente.
  for (const ruta of PUBLICAS) {
    const sin = await pedir({ ruta })
    const con = await pedir({ ruta, cookie: cli })
    assert.equal(sin.codigo, 200, `${ruta} no se sirve sin sesión`)
    assert.equal(con.codigo, 200, `${ruta} no se sirve al cliente`)
    assert.equal(sin.cuerpo ?? '', con.cuerpo ?? '', `${ruta} cambia según quién pregunte`)
    assert.equal(
      Buffer.from(sin.bytes ?? new Uint8Array()).toString('base64'),
      Buffer.from(con.bytes ?? new Uint8Array()).toString('base64'),
      `${ruta} cambia sus bytes según quién pregunte`,
    )
  }
})
