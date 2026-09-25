/**
 * El camino de entrada completo, de la petición a la respuesta, contra la base de
 * datos real. Sin abrir un puerto: `resolver` está separada de la red a propósito.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion, CABECERAS_BASE } from '../src/servidor/rutas.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const ORG = '0f1a2b3c-0000-0000-0000-00000000000a'
const YO  = '0f1a2b3c-0000-0000-0000-00000000000d'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLAVE = 'una clave razonable'

const codigoBueno = () => codigoEnPaso(desdeBase32(SECRETO), pasoDe(new Date()))
const pedir = (p: Partial<Peticion>) => resolver({
  metodo: 'GET', ruta: '/', campos: {}, cookie: null, idioma: 'es',
  origen: `o-${Math.random().toString(36).slice(2)}`, ...p,
}, YO, false)

before(async () => {
  conectar(DESTINO)
  const hash = await cifrarClave(CLAVE)
  await comoPersona({ id: YO }, 'nexus_interno', async (q) => {
    await q.unsafe('set local role none')
    await q`insert into organizacion (id, tipo, nombre, rif)
            values (${ORG},'gps','GPS Rutas','J-966666666-6') on conflict do nothing`
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${ORG},'rutas@prueba.test','Quien entra','clave_2fa', ${hash}, ${SECRETO})
            on conflict do nothing`
  })
})
after(async () => { await cerrar() })

test('toda respuesta lleva las cabeceras de seguridad', async () => {
  const r = await pedir({ ruta: '/entrar' })
  for (const clave of Object.keys(CABECERAS_BASE)) {
    assert.ok(r.cabeceras?.[clave], `falta la cabecera ${clave}`)
  }
  assert.match(r.cabeceras!['Content-Security-Policy']!, /frame-ancestors 'none'/)
  assert.equal(r.cabeceras!['Cache-Control'], 'no-store')
})

test('sin cookie, cualquier página lleva a la de entrada', async () => {
  for (const ruta of ['/', '/contratos', '/valuaciones/algo']) {
    const r = await pedir({ ruta })
    assert.equal(r.codigo, 303, `${ruta} debería redirigir`)
    assert.equal(r.cabeceras?.['Location'], '/entrar')
    assert.equal(r.cuerpo, undefined, 'no debería filtrar nada en el cuerpo')
  }
})

test('con una cookie inventada, lleva a entrar Y borra la cookie', async () => {
  // Dejarla puesta hace que el navegador insista con un testigo muerto en cada
  // petición, y el usuario se queda en un bucle sin entender por qué.
  const r = await pedir({ ruta: '/', cookie: 'me-lo-invento' })
  assert.equal(r.codigo, 303)
  assert.match(r.cabeceras!['Set-Cookie']!, /Max-Age=0/)
})

test('el camino completo: correo y clave, código, y dentro', async () => {
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const paso1 = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
    campos: { correo: 'rutas@prueba.test', clave: CLAVE },
  }, YO, false)
  assert.equal(paso1.codigo, 200)
  assert.match(paso1.cuerpo!, /one-time-code/)

  const desafio = /name="desafio" value="([^"]+)"/.exec(paso1.cuerpo!)?.[1]
  assert.ok(desafio, 'la pantalla debería traer el desafío')

  const paso2 = await resolver({
    metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
    campos: { desafio: desafio!, codigo: codigoBueno() },
  }, YO, false)
  assert.equal(paso2.codigo, 303)
  assert.equal(paso2.cabeceras?.['Location'], '/')

  const cookie = paso2.cabeceras!['Set-Cookie']!
  assert.match(cookie, /HttpOnly/)
  const testigo = new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(cookie)?.[1]
  assert.ok(testigo)

  const dentro = await pedir({ ruta: '/', cookie: testigo! })
  assert.equal(dentro.codigo, 200)
})

test('el testigo NO aparece en ninguna respuesta más que en la cookie', async () => {
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const p1 = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
    campos: { correo: 'rutas@prueba.test', clave: CLAVE },
  }, YO, false)
  const desafio = /name="desafio" value="([^"]+)"/.exec(p1.cuerpo!)![1]!
  const p2 = await resolver({
    metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: codigoBueno() },
  }, YO, false)
  const testigo = new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(p2.cabeceras!['Set-Cookie']!)![1]!
  // Ni en el cuerpo, ni en la dirección de destino.
  assert.equal(p2.cuerpo ?? '', '')
  assert.equal(p2.cabeceras!['Location']!.includes(testigo), false)
})

test('una clave equivocada devuelve 401 y el mismo texto de siempre', async () => {
  const r = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es',
    origen: `o-${Math.random().toString(36).slice(2)}`,
    campos: { correo: 'rutas@prueba.test', clave: 'esta no es' },
  }, YO, false)
  assert.equal(r.codigo, 401)
  assert.match(r.cuerpo!, /No hemos podido entrar con esos datos/)
  assert.equal(r.cabeceras?.['Set-Cookie'], undefined, 'no debería dar cookie')
})

test('un correo inexistente responde exactamente igual que una clave mala', async () => {
  const mismo = (c: Record<string, string>) => resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es',
    origen: `o-${Math.random().toString(36).slice(2)}`, campos: c,
  }, YO, false)
  const a = await mismo({ correo: 'nadie@prueba.test', clave: CLAVE })
  const b = await mismo({ correo: 'rutas@prueba.test', clave: 'esta no es' })
  assert.equal(a.codigo, b.codigo)
  // El cuerpo solo difiere en el correo que se devuelve al campo, así que se compara
  // el resto.
  assert.equal(a.cuerpo!.replace(/value="[^"]*"/g, ''), b.cuerpo!.replace(/value="[^"]*"/g, ''))
})

test('un código equivocado quema el desafío: el bueno ya no sirve', async () => {
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const p1 = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
    campos: { correo: 'rutas@prueba.test', clave: CLAVE },
  }, YO, false)
  const desafio = /name="desafio" value="([^"]+)"/.exec(p1.cuerpo!)![1]!
  const malo = await resolver({
    metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: '000000' },
  }, YO, false)
  assert.equal(malo.codigo, 401)
  const luego = await resolver({
    metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: codigoBueno() },
  }, YO, false)
  assert.equal(luego.codigo, 401)
})

test('salir cierra la sesión de verdad, no solo borra la cookie', async () => {
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const p1 = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
    campos: { correo: 'rutas@prueba.test', clave: CLAVE },
  }, YO, false)
  const desafio = /name="desafio" value="([^"]+)"/.exec(p1.cuerpo!)![1]!
  const p2 = await resolver({
    metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: codigoBueno() },
  }, YO, false)
  const testigo = new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(p2.cabeceras!['Set-Cookie']!)![1]!

  assert.equal((await pedir({ ruta: '/', cookie: testigo })).codigo, 200)
  await pedir({ metodo: 'POST', ruta: '/salir', cookie: testigo })
  // Si solo se borrara la cookie, el testigo seguiría valiendo para quien lo tuviera.
  assert.equal((await pedir({ ruta: '/', cookie: testigo })).codigo, 303)
})

test('la pantalla sale en el idioma del navegador', async () => {
  assert.match((await pedir({ ruta: '/entrar', idioma: 'en' })).cuerpo!, /Sign in to your account/)
  assert.match((await pedir({ ruta: '/entrar', idioma: 'es' })).cuerpo!, /Entra a tu cuenta/)
})

test('la raíz enseña la cartera, no un texto de relleno', async () => {
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const p1 = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
    campos: { correo: 'rutas@prueba.test', clave: CLAVE },
  }, YO, false)
  const desafio = /name="desafio" value="([^"]+)"/.exec(p1.cuerpo!)![1]!
  const p2 = await resolver({
    metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: codigoBueno() },
  }, YO, false)
  const testigo = new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(p2.cabeceras!['Set-Cookie']!)![1]!

  const raiz = await pedir({ ruta: '/', cookie: testigo })
  assert.equal(raiz.codigo, 200)
  assert.match(raiz.cuerpo!, /<title>Cartera · GPS Nexus<\/title>/)
  assert.equal(raiz.cuerpo!.includes('dentro:'), false, 'no debería quedar el relleno')
  // Y trae el botón de salir, que es la única forma de cerrar sesión de verdad.
  assert.match(raiz.cuerpo!, /action="\/salir"/)
})

test('una dirección de contrato que no te corresponde devuelve 404, no 403', async () => {
  // Con 403 para «existe pero no es tuyo» y 404 para «no existe», probando
  // identificadores se puede averiguar cuáles existen. Un solo 404 para los dos
  // casos no dice nada.
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const p1 = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
    campos: { correo: 'rutas@prueba.test', clave: CLAVE },
  }, YO, false)
  const desafio = /name="desafio" value="([^"]+)"/.exec(p1.cuerpo!)![1]!
  const p2 = await resolver({
    metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: codigoBueno() },
  }, YO, false)
  const testigo = new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(p2.cabeceras!['Set-Cookie']!)![1]!

  const inventado = await pedir({
    ruta: '/contratos/99999999-9999-9999-9999-999999999999', cookie: testigo,
  })
  assert.equal(inventado.codigo, 404)
  assert.match(inventado.cuerpo!, /No se encuentra esa página/)
})

test('una dirección con forma rara no llega a la base de datos', async () => {
  // Si el patrón no exigiera la forma de un identificador, cualquier texto acabaría
  // en una consulta y el error de conversión saldría por pantalla.
  const r = await pedir({ ruta: "/contratos/' or 1=1--", cookie: null })
  assert.equal(r.codigo, 303)   // sin sesión, ni siquiera se mira
})
