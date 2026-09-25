/**
 * El día 1: una empresa recién creada, con la base de datos vacía.
 *
 * Es el estado en el que nadie prueba nada y en el que todo el mundo empieza. Una
 * pantalla que se cae porque no hay ni un contrato, o que enseña «undefined» donde
 * debería decir «todavía no hay nada», no es un detalle estético: es lo primero que
 * ve quien va a decidir si esto se usa o se vuelve a Excel.
 *
 * Por eso esta prueba NO carga datos. Crea la empresa, crea a la persona, y entra.
 * Ni plan de cuentas, ni periodos, ni tasa del BCV: lo que hay el primer día.
 *
 * Lo que se exige de cada pantalla:
 *   - Responde 200. No se cae.
 *   - No suelta 'undefined', 'NaN', 'null' ni '[object Object]' por la cara.
 *   - Tiene su título y una salida: una pantalla sin vuelta atrás es un callejón.
 *   - Y en los dos idiomas, porque el portal es bilingüe desde el primer día.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'
import { pantallasDelCodigo, AL_MENOS } from './pantallas.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '7d8e9f0a-0000-0000-0000-00000000000a'
const C = '7d8e9f0a-0000-0000-0000-00000000000b'
const YO = '7d8e9f0a-0000-0000-0000-00000000000d'
const ING = '7d8e9f0a-0000-0000-0000-00000000000e'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLAVE = 'una clave razonable'

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

/**
 * Lo que nunca puede ver el cliente.
 *
 * Sale del código igual que la lista de pantallas: es todo, salvo lo poco que es
 * suyo. Así una pantalla nueva entra sola por el lado que le toque.
 */
const DEL_CLIENTE = new Set(['/', '/perfil'])

const PANTALLAS = await pantallasDelCodigo()
const SOLO_DENTRO = PANTALLAS.filter((r) => !DEL_CLIENTE.has(r))

test('el barrido mira TODAS las pantallas, no las que alguien copió a mano', async () => {
  // La afirmación que falla si el barrido dejó de mirar. La copia a mano tenía diez
  // y la aplicación ya iba por dieciocho: ocho pantallas sin probar en una empresa
  // vacía, y nadie se habría enterado hasta que un cliente nuevo las abriera.
  assert.ok(PANTALLAS.length >= AL_MENOS,
    `el barrido solo encontró ${PANTALLAS.length} pantallas: ${PANTALLAS.join(', ')}`)
  for (const nueva of ['/gerencia', '/estados', '/diario', '/mayor', '/libros',
                       '/caja', '/pagar', '/logistica']) {
    assert.ok(PANTALLAS.includes(nueva), `${nueva} se quedó fuera del barrido`)
  }
})

let gps = ''
let cli = ''

before(async () => {
  conectar(DESTINO)
  const hash = await cifrarClave(CLAVE)
  await comoPersona({ id: YO }, 'nexus_interno', async (q) => {
    await q.unsafe('set local role none')
    await q`insert into organizacion (id, tipo, nombre, rif) values
              (${G},'gps','GPS Día Uno','J-902200000-0'),
              (${C},'operadora','Operadora Día Uno','J-902300000-0')
            on conflict (id) do update set nombre = excluded.nombre`
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto) values
              (${YO}, ${G},'dia-uno@prueba.test','Interno','clave_2fa', ${hash}, ${SECRETO}),
              (${ING}, ${C},'dia-uno-cli@prueba.test','Ingeniero','clave_2fa', ${hash}, ${SECRETO})
            on conflict (id) do nothing`
  })
  gps = await entrar('dia-uno@prueba.test')
  cli = await entrar('dia-uno-cli@prueba.test')
})
after(async () => { await cerrar() })

/** Lo que nunca debe salir impreso en una pantalla. */
const BASURA = [
  ['undefined', /\bundefined\b/],
  ['NaN', /\bNaN\b/],
  ['[object Object]', /\[object Object\]/],
  ['null', />\s*null\s*</],
] as const

for (const ruta of PANTALLAS) {
  test(`día 1 · ${ruta} responde y no enseña basura, en español`, async () => {
    const r = await pedir({ ruta, cookie: gps, idioma: 'es' })
    assert.equal(r.codigo, 200, `${ruta} devolvió ${r.codigo}`)
    const h = r.cuerpo ?? ''
    for (const [nombre, patron] of BASURA) {
      assert.doesNotMatch(h, patron, `${ruta} enseña «${nombre}»`)
    }
    assert.match(h, /<h1[^>]*>/, `${ruta} no tiene título`)
    assert.ok(h.length > 500, `${ruta} salió prácticamente vacía`)
  })

  test(`día 1 · ${ruta} responde y no enseña basura, en inglés`, async () => {
    const r = await pedir({ ruta, cookie: gps, idioma: 'en' })
    assert.equal(r.codigo, 200, `${ruta} devolvió ${r.codigo}`)
    const h = r.cuerpo ?? ''
    for (const [nombre, patron] of BASURA) {
      assert.doesNotMatch(h, patron, `${ruta} enseña «${nombre}»`)
    }
    assert.match(h, /<html lang="en"/, `${ruta} no se declara en inglés`)
  })
}

test('toda pantalla interior tiene salida: ninguna es un callejón', async () => {
  // Menos la cartera, que ES la salida de las demás.
  for (const ruta of PANTALLAS.filter((r) => r !== '/')) {
    const h = (await pedir({ ruta, cookie: gps })).cuerpo ?? ''
    assert.match(h, /href="\/"/, `${ruta} no tiene por dónde volver`)
  }
})

test('el cliente no llega a la contabilidad, y recibe el MISMO 404 que a lo inexistente', async () => {
  // Un 403 confirmaría que la pantalla existe. Un 404 no dice nada, que es el punto.
  const inventada = await pedir({ ruta: '/no-existe-esta-pantalla', cookie: cli })
  for (const ruta of SOLO_DENTRO) {
    const r = await pedir({ ruta, cookie: cli })
    assert.equal(r.codigo, 404, `el cliente entró en ${ruta}`)
    assert.equal(r.codigo, inventada.codigo)
  }
})

test('sin cookie no se entra en ninguna: todas piden identificarse', async () => {
  for (const ruta of PANTALLAS) {
    const r = await pedir({ ruta, cookie: null })
    assert.ok(r.codigo === 303 || r.codigo === 200,
      `${ruta} respondió ${r.codigo} a quien no ha entrado`)
    if (r.codigo === 200) {
      assert.match(r.cuerpo ?? '', /name="clave"/,
        `${ruta} enseñó contenido a quien no ha entrado`)
    }
  }
})

test('todas caben en un móvil: ningún ancho FIJO por encima de la pantalla', async () => {
  // El portal se usa en el patio, en un teléfono. Lo que rompe ahí es un ancho fijo:
  // obliga a arrastrar la página de lado y no hay forma de leerla.
  //
  // Un `max-width` en el contenedor centrado y un `min-width` en un elemento que
  // envuelve NO son eso —son justamente la forma correcta de que quepa—, así que la
  // comprobación mira el ancho a secas y deja los otros dos en paz.
  for (const ruta of PANTALLAS) {
    const h = (await pedir({ ruta, cookie: gps })).cuerpo ?? ''
    assert.match(h, /name="viewport"[^>]*width=device-width/, `${ruta} no declara el móvil`)
    const anchos = h.match(/(?<![a-z-])width:\s*(\d{3,})px/g) ?? []
    for (const a of anchos) {
      const px = Number(/(\d+)/.exec(a)![1])
      assert.ok(px <= 360, `${ruta} declara ${a} fijo, que no cabe en un móvil`)
    }
  }
})

test('la anchura del contenedor la pone UNA sola hoja: base.ts', async () => {
  // Dos pantallas del mismo sistema con la caja a distinto ancho se notan al pasar de
  // una a otra, y nadie sabe decir por qué «se mueve». Ya pasó: la valuación se había
  // quedado en 780 mientras el resto iba a 760.
  const { ESTILOS_BASE } = await import('../src/pantallas/base.ts')
  assert.match(ESTILOS_BASE, /\.wrap\{[^}]*max-width:760px/)

  const { readdir, readFile } = await import('node:fs/promises')
  const dir = new URL('../src/pantallas/', import.meta.url)
  for (const archivo of await readdir(dir)) {
    if (!archivo.endsWith('.ts') || archivo === 'base.ts') continue
    const codigo = await readFile(new URL(archivo, dir), 'utf8')
    // `.hd .wrap` es otra cosa: coloca lo de dentro de la cabecera, no la caja.
    assert.doesNotMatch(codigo, /(?<![a-z .])\.wrap\{/,
      `${archivo} redefine la anchura del contenedor`)
  }
})
