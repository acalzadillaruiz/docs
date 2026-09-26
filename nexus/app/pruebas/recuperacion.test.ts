/**
 * Perder el teléfono y volver a entrar.
 *
 * Esto NO FUNCIONABA, y es lo más grave que ha salido de todos los barridos. La
 * pantalla de «Perdí el teléfono» estaba escrita desde el primer día y mandaba el
 * formulario a `/entrar/recuperacion`. Esa ruta **solo respondía a GET**: el POST se
 * caía por la puerta de sesión y devolvía a la pantalla de entrada sin una palabra.
 * `gastar_codigo()` existía en la base de datos, probada, y no la llamaba nadie.
 *
 * O sea: se generan diez códigos, se enseñan una sola vez, se pide guardarlos en
 * papel «para cuando pierdas el teléfono», y quien perdía el teléfono se quedaba
 * fuera para siempre con los diez códigos en el bolsillo.
 *
 * Las otras ocho máquinas sin puerta estorbaban. Ésta cerraba la puerta.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { cifrarClave, generarCodigosRecuperacion, huellaCodigo } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'ee000000-0000-0000-0000-0000000000a1'
const YO = 'ee000000-0000-0000-0000-0000000000a2'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLAVE = 'una clave razonable'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

const pedir = (p: Partial<Peticion>) => resolver({
  metodo: 'GET', ruta: '/', campos: {}, cookie: null, idioma: 'es', archivo: null,
  origen: `o-${Math.random().toString(36).slice(2)}`, ...p,
}, YO, false)

/** Llega hasta el paso del segundo factor y devuelve el desafío que quedó abierto. */
async function hastaElDesafio(origen: string): Promise<string> {
  const r = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
    campos: { correo: 'recup@prueba.test', clave: CLAVE },
  }, YO, false)
  return /name="desafio" value="([^"]+)"/.exec(r.cuerpo!)![1]!
}

/** Diez códigos nuevos, guardados como se guardan: por su huella. */
async function ponerCodigos(): Promise<string[]> {
  const codigos = generarCodigosRecuperacion()
  await dentro(async (q) => {
    await q`delete from codigo_recuperacion where persona_id = ${YO}::uuid`
    for (const c of codigos) {
      await q`insert into codigo_recuperacion (persona_id, huella)
              values (${YO}::uuid, ${huellaCodigo(c)})`
    }
  })
  return codigos
}

before(async () => {
  conectar(DESTINO)
  const hash = await cifrarClave(CLAVE)
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`insert into organizacion (id, tipo, nombre, rif)
            values (${G},'gps','GPS Recuperación','J-906700000-0')
            on conflict (id) do update set nombre = excluded.nombre`
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto)
            values (${YO}, ${G},'recup@prueba.test','Perdió el teléfono','clave_2fa',
                    ${hash}, ${SECRETO})
            on conflict (id) do update set clave_hash = excluded.clave_hash, activa = true`
    // La mesa limpia al empezar: el freno cuenta intentos y una pasada anterior
    // dejaría a esta bloqueada sin que se entienda por qué.
    await q`delete from intento_acceso where correo = 'recup@prueba.test'`
    await q`delete from sesion where persona_id = ${YO}::uuid`
  })
})
after(async () => { await cerrar() })

test('la pantalla del segundo factor lleva al de recuperación CON el desafío', async () => {
  // Sin arrastrar el desafío, el formulario no tiene a quién referirse. Era la mitad
  // que faltaba para que el POST pudiera existir.
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const desafio = await hastaElDesafio(origen)
  const r = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen: `o-${Math.random()}`,
    campos: { correo: 'recup@prueba.test', clave: CLAVE },
  }, YO, false)
  assert.match(r.cuerpo ?? '', /\/entrar\/recuperacion\?d=/,
    'el enlace de «perdí el teléfono» no arrastra el desafío')
  assert.ok(desafio.length > 10)
})

test('sin desafío, la pantalla de recuperación no se abre: no sabría de quién es', async () => {
  const r = await pedir({ ruta: '/entrar/recuperacion' })
  assert.equal(r.codigo, 303)
  assert.equal(r.cabeceras?.['Location'], '/entrar')
})

test('con desafío se abre, y el formulario lo lleva dentro', async () => {
  const desafio = await hastaElDesafio(`o-${Math.random().toString(36).slice(2)}`)
  const r = await pedir({ ruta: '/entrar/recuperacion', campos: { d: desafio } })
  assert.equal(r.codigo, 200)
  assert.match(r.cuerpo ?? '', /name="desafio"/)
  assert.match(r.cuerpo ?? '', /Usa un código de recuperación/)
})

test('un código bueno ENTRA: es la prueba de que la puerta existe', async () => {
  const codigos = await ponerCodigos()
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const desafio = await hastaElDesafio(origen)

  const r = await resolver({
    metodo: 'POST', ruta: '/entrar/recuperacion', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: codigos[0]! },
  }, YO, false)
  assert.equal(r.codigo, 200, 'un código bueno no dejó entrar')

  const cookie = new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(
    r.cabeceras?.['Set-Cookie'] ?? '')?.[1]
  assert.ok(cookie, 'entró sin darle sesión')
  // Y la sesión sirve de verdad: se abre la cartera con ella.
  assert.equal((await pedir({ ruta: '/', cookie })).codigo, 200)
})

test('y dice cuántos le quedan, en el momento en que importa', async () => {
  const codigos = await ponerCodigos()
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const desafio = await hastaElDesafio(origen)
  const r = await resolver({
    metodo: 'POST', ruta: '/entrar/recuperacion', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: codigos[3]! },
  }, YO, false)
  // Nueve: gastó uno de los diez. Quien acaba de gastar el noveno tiene que saberlo
  // ahora, no el día que gaste el décimo sin teléfono.
  assert.match(r.cuerpo ?? '', /Te quedan 9/)
})

test('el mismo código no vale dos veces', async () => {
  const codigos = await ponerCodigos()
  const uno = codigos[5]!

  const o1 = `o-${Math.random().toString(36).slice(2)}`
  const d1 = await hastaElDesafio(o1)
  const p1 = await resolver({
    metodo: 'POST', ruta: '/entrar/recuperacion', cookie: null, idioma: 'es', origen: o1,
    campos: { desafio: d1, codigo: uno },
  }, YO, false)
  assert.equal(p1.codigo, 200)

  const o2 = `o-${Math.random().toString(36).slice(2)}`
  const d2 = await hastaElDesafio(o2)
  const p2 = await resolver({
    metodo: 'POST', ruta: '/entrar/recuperacion', cookie: null, idioma: 'es', origen: o2,
    campos: { desafio: d2, codigo: uno },
  }, YO, false)
  assert.equal(p2.codigo, 401, 'un código gastado siguió abriendo la puerta')
})

test('un código inventado no entra, y QUEMA el desafío', async () => {
  // Si el desafío sobreviviera al fallo, se podrían probar códigos en serie con una
  // sola comprobación de clave. Es la misma regla que el código del teléfono.
  await ponerCodigos()
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const desafio = await hastaElDesafio(origen)

  const mal = await resolver({
    metodo: 'POST', ruta: '/entrar/recuperacion', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: 'ZZZZZ-ZZZZZ' },
  }, YO, false)
  assert.equal(mal.codigo, 401)

  const [s] = (await dentro((q) => q`
    select cerrada_en, motivo_cierre from sesion
     where persona_id = ${YO}::uuid order by iniciada_en desc limit 1
  `)) as unknown as Array<{ cerrada_en: Date | null; motivo_cierre: string | null }>
  assert.notEqual(s!.cerrada_en, null, 'el desafío sobrevivió a un código equivocado')
  assert.equal(s!.motivo_cierre, 'código de recuperación incorrecto')
})

test('el código de OTRA persona no entra con tu desafío', async () => {
  const codigos = await ponerCodigos()
  const otra = 'ee000000-0000-0000-0000-0000000000a3'
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto)
            values (${otra}, ${G},'recup-otra@prueba.test','Otra','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q`delete from codigo_recuperacion where persona_id = ${otra}::uuid`
    await q`insert into codigo_recuperacion (persona_id, huella)
            values (${otra}::uuid, ${huellaCodigo('AJENO-CODIG')})`
  })
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const desafio = await hastaElDesafio(origen)
  const r = await resolver({
    metodo: 'POST', ruta: '/entrar/recuperacion', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: 'AJENO-CODIG' },
  }, YO, false)
  assert.equal(r.codigo, 401, 'el código de otra persona abrió esta cuenta')
  // Y sigue sin gastar: no se le quema un código a alguien por el intento de otro.
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from codigo_recuperacion
     where persona_id = ${otra}::uuid and gastado_en is null
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 1)
  assert.ok(codigos.length === 10)
})

test('un desafío inventado tampoco, ni uno ya usado', async () => {
  const codigos = await ponerCodigos()
  const r = await resolver({
    metodo: 'POST', ruta: '/entrar/recuperacion', cookie: null, idioma: 'es',
    origen: `o-${Math.random().toString(36).slice(2)}`,
    campos: { desafio: 'inventado-del-todo', codigo: codigos[7]! },
  }, YO, false)
  assert.equal(r.codigo, 401)
})

test('el código se acepta escrito como lo escribe la gente', async () => {
  // En minúsculas, con espacios, sin el guion. Un código que solo vale escrito
  // exactamente como se enseñó es un código que no se puede usar de pie en el patio.
  const codigos = await ponerCodigos()
  const raro = codigos[9]!.toLowerCase().replace('-', ' ')
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const desafio = await hastaElDesafio(origen)
  const r = await resolver({
    metodo: 'POST', ruta: '/entrar/recuperacion', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: raro },
  }, YO, false)
  assert.equal(r.codigo, 200, `«${raro}» tendría que valer`)
})

test('sin código no se manda nada, y lo dice sin quemar el desafío', async () => {
  await ponerCodigos()
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const desafio = await hastaElDesafio(origen)
  const r = await resolver({
    metodo: 'POST', ruta: '/entrar/recuperacion', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: '   ' },
  }, YO, false)
  assert.equal(r.codigo, 400)
  assert.match(r.cuerpo ?? '', /name="desafio"/, 'perdió el desafío por dejarlo en blanco')
})
