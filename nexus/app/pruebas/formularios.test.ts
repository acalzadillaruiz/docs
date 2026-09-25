/**
 * Mandar TODOS los formularios sin tocar nada, como los mandaría el navegador.
 *
 * Es la prueba que habría encontrado los dos fallos de `17a0e0b` sin necesidad de
 * buscarlos: un `<select>` deshabilitado no se manda, y el servidor emparejaba el
 * mapeo por posición. Nadie lo vio porque las pruebas escribían la entrada a mano,
 * perfectamente alineada.
 *
 * Lo que se exige de cada formulario, mandado en blanco:
 *
 *   - **No revienta.** Un formulario enviado sin rellenar es lo primero que hace
 *     cualquiera que abre una pantalla nueva, a propósito o sin querer.
 *   - **Si no puede hacerse, lo dice.** Un 400 mudo no lo arregla nadie: hay que
 *     poder leer qué falta.
 *   - **Y no deja nada a medias.** El libro tiene que seguir cuadrado después.
 *
 * No se comprueba que el formulario funcione —eso lo hace la prueba de cada
 * pantalla—: se comprueba que el camino de en medio, el del formulario mal o a
 * medio rellenar, esté atendido en todas.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'
import { formularios, conBasura, BASURA } from './formulario.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'a0b1c2d3-0000-0000-0000-00000000000a'
const YO = 'a0b1c2d3-0000-0000-0000-00000000000d'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLAVE = 'una clave razonable'

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

const PANTALLAS = [
  '/', '/medidas', '/perfil', '/contratos/nuevo', '/importar',
  '/periodos', '/proveedores', '/banco', '/activos', '/reexpresion', '/libros',
] as const

let gps = ''

before(async () => {
  conectar(DESTINO)
  const hash = await cifrarClave(CLAVE)
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`insert into organizacion (id, tipo, nombre, rif)
            values (${G},'gps','GPS Formularios','J-902800000-0')
            on conflict (id) do update set nombre = excluded.nombre`
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto)
            values (${YO}, ${G},'formularios@prueba.test','Interno','clave_2fa',
                    ${hash}, ${SECRETO})
            on conflict (id) do update set clave_hash = excluded.clave_hash`
    await q`select instalar_plan_cuentas(${G}::uuid)`
  })
  gps = await entrar('formularios@prueba.test')
})
after(async () => { await cerrar() })

test('salir funciona: es el único formulario que se queda fuera del barrido', async () => {
  // Se comprueba aparte justamente porque el barrido lo excluye.
  const sesion = await entrar('formularios@prueba.test')
  const h = (await pedir({ ruta: '/', cookie: sesion })).cuerpo ?? ''
  const [salir] = formularios(h).filter((f) => f.accion === '/salir')
  assert.ok(salir, 'la cartera perdió el botón de salir')
  const r = await pedir({ metodo: 'POST', ruta: '/salir', cookie: sesion, campos: salir!.campos })
  assert.equal(r.codigo, 303)
  assert.equal((await pedir({ ruta: '/periodos', cookie: sesion })).codigo, 303,
    'la sesión seguía viva después de salir')
})

test('cada pantalla tiene al menos un formulario, o no pide nada', async () => {
  // Sirve de red: si un cambio deja una pantalla sin su formulario, esta prueba deja
  // de comprobar nada de ella y hay que enterarse.
  const cuenta: Record<string, number> = {}
  for (const ruta of PANTALLAS) {
    const h = (await pedir({ ruta, cookie: gps })).cuerpo ?? ''
    cuenta[ruta] = formularios(h).length
  }
  // Las que sí tienen que pedir algo.
  for (const ruta of ['/contratos/nuevo', '/importar', '/periodos', '/activos',
                      '/reexpresion', '/libros', '/perfil'] as const) {
    assert.ok(cuenta[ruta]! > 0, `${ruta} se quedó sin formulario`)
  }
})

for (const ruta of PANTALLAS) {
  test(`enviar en blanco lo de ${ruta} no revienta, y se explica`, async () => {
    // Sesión propia para cada pantalla. La primera versión de esta prueba usaba una
    // sola: en cuanto mandó el formulario de la cartera —que es el de SALIR— se quedó
    // sin sesión, y todo lo demás pasó en vano contestando 303. Una prueba que pasa
    // sin comprobar nada es peor que una que falla.
    const sesion = await entrar('formularios@prueba.test')
    const pagina = await pedir({ ruta, cookie: sesion })
    const formas = formularios(pagina.cuerpo ?? '')
      .filter((f) => f.metodo === 'POST')
      // Salir funciona y tiene su prueba; aquí solo cerraría la sesión.
      .filter((f) => f.accion !== '/salir')

    for (const f of formas) {
      const destino = f.accion || ruta
      const r = await pedir({
        metodo: 'POST', ruta: destino, cookie: sesion,
        campos: f.campos, repetidos: f.repetidos,
      })
      assert.ok(r.codigo < 500, `${destino} respondió ${r.codigo} a un envío en blanco`)
      assert.notEqual(r.codigo, 303,
        `${destino} echó la sesión; a partir de aquí no se comprobaría nada`)

      // Un 400 mudo no lo arregla nadie: tiene que poder leerse qué falta.
      if (r.codigo === 400 && r.cuerpo) {
        assert.match(r.cuerpo, /class="mal/,
          `${destino} rechazó sin decir por qué`)
      }
    }

    // Y la sesión sigue viva: si no, lo anterior no habría comprobado nada.
    assert.equal((await pedir({ ruta: '/periodos', cookie: sesion })).codigo, 200,
      'la sesión se perdió durante el barrido')
  })
}

test('después de mandarlo todo en blanco, el libro sigue cuadrado', async () => {
  // Lo que no puede pasar es que un formulario a medio rellenar deje medio asiento.
  const [d] = (await dentro((q) => q`
    select ves::text from descuadre(${G}::uuid, current_date)
  `)) as unknown as Array<{ ves: string }>
  assert.equal(Number(d?.ves ?? 0), 0)
})

test('sin el testigo antifalsificación, ninguno pasa', async () => {
  // El testigo va dentro del formulario. Quitarlo es lo que haría un sitio ajeno que
  // manda a alguien a pulsar aquí sin saberlo.
  const sesion = await entrar('formularios@prueba.test')
  const pagina = await pedir({ ruta: '/periodos', cookie: sesion })
  const [f] = formularios(pagina.cuerpo ?? '').filter((x) => x.metodo === 'POST')
  assert.ok(f, 'la pantalla de meses perdió su formulario')
  const { af, ...sinTestigo } = f!.campos
  assert.ok(af, 'el formulario no lleva testigo')
  const r = await pedir({
    metodo: 'POST', ruta: f!.accion || '/periodos', cookie: sesion, campos: sinTestigo,
  })
  assert.equal(r.codigo, 403)
})

test('el navegador manda la PRIMERA opción de un select sin marcar, no una vacía', async () => {
  // Es lo contrario de lo que se supone al escribir una prueba a mano, y por eso
  // está aquí: el alta de contrato tiene un select de tipo sin nada marcado.
  const h = (await pedir({
    ruta: '/contratos/nuevo', cookie: await entrar('formularios@prueba.test'),
  })).cuerpo ?? ''
  const [f] = formularios(h)
  assert.equal(f!.campos['tipo'], 'procura')
  // Y el de cliente sí empieza vacío, porque su primera opción lo está.
  assert.equal(f!.campos['cliente'], '')
})

// ===========================================================================
// El mismo barrido, pero con los formularios RELLENOS DE BASURA.
//
// Enviar en blanco ya está cubierto. Esto es el otro lado: lo que pasa cuando la
// casilla lleva algo, pero algo que no vale. Son los cuatro errores que de verdad se
// cometen delante de una pantalla, y el que más daño hace no es el más raro: es el
// texto donde va un número, porque `Number('hola')` no falla, devuelve NaN, y un NaN
// metido en una cuenta la envenena sin que salte nada.

for (const cual of ['numero', 'fecha', 'negativo', 'largo'] as const) {
  test(`con «${cual}» en cada casilla, ninguna pantalla revienta ni escribe a medias`, async () => {
    const sesion = await entrar('formularios@prueba.test')
    let mandados = 0

    for (const ruta of PANTALLAS) {
      const pagina = await pedir({ ruta, cookie: sesion })
      const formas = formularios(pagina.cuerpo ?? '')
        .filter((f) => f.metodo === 'POST')
        .filter((f) => f.accion !== '/salir')

      for (const f of formas) {
        const destino = f.accion || ruta
        const r = await pedir({
          metodo: 'POST', ruta: destino, cookie: sesion,
          campos: conBasura(f, cual), repetidos: f.repetidos,
        })
        mandados++
        assert.ok(r.codigo < 500,
          `${destino} respondió ${r.codigo} con «${cual}» dentro`)
        assert.notEqual(r.codigo, 303, `${destino} echó la sesión`)

        // Si lo rechaza, que se lea por qué. Un 400 mudo no lo arregla nadie.
        if (r.codigo === 400 && r.cuerpo) {
          assert.match(r.cuerpo, /class="mal/, `${destino} rechazó sin decir por qué`)
        }
        // Y nunca devuelve la basura convertida en «NaN» o en una fecha imposible.
        if (r.cuerpo) {
          assert.doesNotMatch(r.cuerpo, /\bNaN\b/, `${destino} enseña NaN`)
          assert.doesNotMatch(r.cuerpo, /0001-01-01/, `${destino} enseña una fecha imposible`)
        }
      }
    }

    // La afirmación que impide que este barrido pase en vano. Ya pasó una vez.
    assert.ok(mandados >= 5, `solo se mandaron ${mandados} formularios: el barrido no barrió`)
    assert.equal((await pedir({ ruta: '/periodos', cookie: sesion })).codigo, 200,
      'la sesión se perdió durante el barrido')
  })
}

test('después de toda la basura, el libro sigue cuadrado', async () => {
  // Es la comprobación que de verdad importa: que nada de lo anterior dejó medio
  // asiento escrito. Un descuadre aquí valdría por todas las demás juntas.
  const [d] = (await dentro((q) => q`
    select ves::text from descuadre(${G}::uuid, current_date)
  `)) as unknown as Array<{ ves: string }>
  assert.equal(Number(d?.ves ?? 0), 0)
})

test('nada de lo escrito con basura llegó a la base de datos', async () => {
  // Ni un contrato con el título de 5.000 letras, ni un periodo del año -999999.
  const [n] = (await dentro((q) => q`
    select (select count(*) from contrato where organizacion_id = ${G}::uuid)
         + (select count(*) from documento_fiscal where organizacion_id = ${G}::uuid)
         + (select count(*) from periodo
             where organizacion_id = ${G}::uuid and (anio < 2000 or anio > 2100))
      as n
  `)) as unknown as Array<{ n: number }>
  assert.equal(Number(n!.n), 0, 'la basura entró en la base de datos')
})

test('un texto larguísimo se corta o se rechaza, pero NO se guarda entero', async () => {
  // Alguien pega media hoja de cálculo en una casilla. Guardarlo entero es cómo se
  // llena una tabla de basura que luego nadie sabe de dónde salió.
  const sesion = await entrar('formularios@prueba.test')
  const h = (await pedir({ ruta: '/contratos/nuevo', cookie: sesion })).cuerpo ?? ''
  const [f] = formularios(h)
  const r = await pedir({
    metodo: 'POST', ruta: '/contratos/nuevo', cookie: sesion,
    campos: { ...f!.campos, titulo_es: BASURA.largo, accion: 'crear' },
  })
  assert.ok(r.codigo < 500)
  const [largo] = (await dentro((q) => q`
    select coalesce(max(length(titulo_es)), 0)::int as n from contrato
     where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.ok(Number(largo!.n) < 5000, `se guardó un título de ${largo!.n} letras`)
})
