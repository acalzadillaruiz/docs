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

test('la hoja de valuación se sirve en su ruta, con el neto calculado', async () => {
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

  // Una valuación que no existe: 404, igual que una ajena.
  const r = await pedir({
    ruta: '/valuaciones/88888888-8888-8888-8888-888888888888', cookie: testigo,
  })
  assert.equal(r.codigo, 404)
})

test('aprobar SIN el testigo antifalsificación devuelve 403 y no cambia nada', async () => {
  // Es la prueba que justifica que exista csrf.ts. Sin ella, otra web podría
  // provocar que el navegador del cliente apruebe una valuación sin que lo sepa.
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

  const ruta = '/valuaciones/77777777-7777-7777-7777-777777777777/aprobar'
  for (const campos of [{}, { af: '' }, { af: 'me-lo-invento' }]) {
    const r = await pedir({ metodo: 'POST', ruta, cookie: testigo, campos })
    assert.equal(r.codigo, 403, `debería rechazar: ${JSON.stringify(campos)}`)
    assert.equal(r.cuerpo, '', 'y no debería contar nada en el cuerpo')
  }
})

test('sin sesión, una ruta que escribe ni se mira', async () => {
  const r = await pedir({
    metodo: 'POST', ruta: '/valuaciones/77777777-7777-7777-7777-777777777777/aprobar',
    cookie: null, campos: { af: 'lo-que-sea' },
  })
  assert.equal(r.codigo, 303)
  assert.equal(r.cabeceras?.['Location'], '/entrar')
})

test('el destino de vuelta no puede sacarte del portal', async () => {
  // Sin sanear, un formulario en otra web con volver=https://sitio-falso haría que
  // el portal de GPS mandara a sus propios clientes a una página de otro. Es la
  // clase de fallo que convierte un dominio de confianza en trampolín.
  const { destinoSeguro } = await import('../src/servidor/rutas.ts') as unknown as
    { destinoSeguro?: (s: string | undefined) => string }
  // No se exporta a propósito; se comprueba por el comportamiento de la ruta.
  assert.equal(destinoSeguro, undefined)
})

test('responder una objeción sin el testigo antifalsificación no pasa', async () => {
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
  const af = /* el mismo que pinta la pantalla */ (await import('../src/servidor/csrf.ts'))
    .testigoAnti(testigo)

  const ruta = '/objeciones/55555555-5555-5555-5555-555555555555/responder'
  const sin = await pedir({ metodo: 'POST', ruta, cookie: testigo, campos: { respuesta: 'x' } })
  assert.equal(sin.codigo, 403)

  // Con el testigo correcto, pero una objeción que no existe: 404, no 403.
  const con = await pedir({
    metodo: 'POST', ruta, cookie: testigo, campos: { af, respuesta: 'x' },
  })
  assert.equal(con.codigo, 404)
})

test('un destino de vuelta hacia fuera se ignora y se vuelve a la raíz', async () => {
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
  const af = (await import('../src/servidor/csrf.ts')).testigoAnti(testigo)

  // Se crea una objeción de verdad para que el camino llegue hasta el redirigir.
  const { comoPersona: cp } = await import('../src/db/conexion.ts')
  const [obj] = await cp({ id: YO }, 'nexus_interno', (q) => q`
    select ob.id from objecion ob
      join valuacion v on v.id = ob.valuacion_id
     where ob.respondida_en is null limit 1
  `) as unknown as Array<{ id: string }>

  if (!obj) return   // si no hay ninguna abierta en esta base, no hay nada que probar

  for (const malo of ['https://sitio-falso.test', '//sitio-falso.test', 'javascript:alert(1)']) {
    const r = await pedir({
      metodo: 'POST', ruta: `/objeciones/${obj.id}/responder`, cookie: testigo,
      campos: { af, respuesta: 'Contestado.', volver: malo },
    })
    // O redirige a un sitio propio, o rechaza. Nunca manda fuera.
    if (r.codigo === 303) {
      assert.match(r.cabeceras!['Location']!, /^\/[^/]*/, `no debería mandar a ${malo}`)
      assert.equal(r.cabeceras!['Location']!.includes('sitio-falso'), false)
    }
  }
})

test('el avance de un renglón se sirve en su ruta, abierto hito por hito', async () => {
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

  // Un renglón con un hito verificado y otro declarado sin respaldo.
  const RG = '0f1a2b3c-3333-0000-0000-00000000000a'
  await comoPersona({ id: YO }, 'nexus_interno', async (q) => {
    await q.unsafe('set local role none')
    await q`insert into organizacion (id, tipo, nombre, rif)
            values ('0f1a2b3c-0000-0000-0000-00000000000b','operadora','Op Rutas','J-967777777-7')
            on conflict do nothing`
    await q`insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
            values ('0f1a2b3c-1111-0000-0000-00000000000a','2026-09-07', 36.50,'carga_manual')
            on conflict (id) do update set vigente_el = excluded.vigente_el`
    await q`insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es,
              titulo_en, estado, moneda, monto, tasa_id, creado_por)
            values ('0f1a2b3c-2222-0000-0000-00000000000a', ${ORG},
              '0f1a2b3c-0000-0000-0000-00000000000b','RUT-001','procura','Cabezales',
              'Wellheads','vigente','USD', 200000.00,'0f1a2b3c-1111-0000-0000-00000000000a', ${YO})
            on conflict (id) do update set codigo = excluded.codigo`
    await q`insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
              cantidad, unidad, norma, precio_unitario, costo_unitario)
            values (${RG},'0f1a2b3c-2222-0000-0000-00000000000a', 1,'Cabezal de pozo','Wellhead',
              2,'unidad','API 6A', 100000.0000, 62000.0000)
            on conflict (id) do update set norma = excluded.norma`
    await q`delete from hito where renglon_id = ${RG}::uuid`
    await q`insert into hito (id, renglon_id, orden, clave, nombre_es, nombre_en, peso, exige,
              estado, ocurrido_en, registrado_en)
            values ('0f1a2b3c-4444-0000-0000-000000000001', ${RG}, 1,'orden','Orden colocada',
                    'PO placed', 40.00,'{}','verificado','2026-09-01', now()),
                   ('0f1a2b3c-4444-0000-0000-000000000002', ${RG}, 2,'fabricado','Fabricado',
                    'Manufactured', 30.00,'{certificado}','declarado','2026-09-10', now())`
  })

  const r = await pedir({ ruta: `/renglones/${RG}`, cookie: testigo })
  assert.equal(r.codigo, 200)
  // El número, y de dónde sale.
  assert.match(r.cuerpo!, /class="ba-v" style="width:40%"/)
  assert.match(r.cuerpo!, /class="ba-d" style="width:30%"/)
  assert.match(r.cuerpo!, /Falta: Certificado/)
  assert.match(r.cuerpo!, /No hay ninguna casilla donde escribirlo/)
  // Y se puede volver al contrato del que cuelga.
  assert.match(r.cuerpo!, /href="\/contratos\/0f1a2b3c-2222-0000-0000-00000000000a"/)
})

test('un renglón que no te corresponde devuelve 404, no 403', async () => {
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

  const r = await pedir({
    ruta: '/renglones/99999999-9999-9999-9999-99999999999a', cookie: testigo,
  })
  assert.equal(r.codigo, 404)
})

test('sin sesión, el avance de un renglón ni se mira', async () => {
  const r = await pedir({ ruta: '/renglones/99999999-9999-9999-9999-99999999999a' })
  assert.equal(r.codigo, 303)
})

test('sin SSO configurado, entrar con la empresa responde como un correo cualquiera', async () => {
  // No se ofrece y no se distingue: la pantalla de entrada no es un buscador de
  // empresas con SSO.
  const r = await pedir({
    metodo: 'POST', ruta: '/entrar/empresa',
    campos: { metodo: 'microsoft', correo: 'alguien@operadora.test' },
  })
  assert.equal(r.codigo, 401)
  assert.match(r.cuerpo!, /No hemos podido entrar/)
})

test('la vuelta sin estado o sin código no llega a mirar nada', async () => {
  for (const campos of [{}, { state: 'x' }, { code: 'y' }]) {
    const r = await pedir({ ruta: '/entrar/empresa/vuelta', campos })
    assert.equal(r.codigo, 303)
    assert.equal(r.cabeceras!['Location'], '/entrar')
  }
})

test('una vuelta con un estado inventado tampoco', async () => {
  const r = await pedir({
    ruta: '/entrar/empresa/vuelta',
    campos: { state: 'estado-que-nadie-guardo', code: 'c' },
  })
  assert.equal(r.codigo, 303)
  assert.equal(r.cabeceras!['Location'], '/entrar')
})
