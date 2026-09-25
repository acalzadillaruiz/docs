/**
 * Las pantallas DIBUJADAS: en un teléfono, y con los colores medidos.
 *
 * Todas las demás pruebas leen el HTML. Esta lo dibuja en un Chromium de verdad a
 * 360 × 740, que es un teléfono corriente, y mide lo que sale.
 *
 * Hacía falta: la cartera —lo PRIMERO que se ve al entrar— medía **1077 px de ancho
 * sobre una pantalla de 360**. Los diez enlaces de la cabecera se fueron añadiendo de
 * uno en uno y la fila nunca se partía. Dos meses así, y ninguna prueba podía verlo,
 * porque leyendo el HTML no hay anchura: la anchura la decide el navegador.
 *
 * Se dibuja SIN RED: las fuentes de Google se cortan a propósito. El portal se usa en
 * el patio con mala cobertura, así que lo que hay que comprobar es cómo queda cuando
 * las fuentes no llegan — no cuando todo va bien.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, type Browser } from 'playwright-core'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'b1c2d3e4-0000-0000-0000-00000000000a'
const YO = 'b1c2d3e4-0000-0000-0000-00000000000d'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLAVE = 'una clave razonable'

/** Un teléfono corriente. Ni el más pequeño ni el más grande. */
const TELEFONO = { width: 360, height: 740 }

/**
 * El Chromium que ya está instalado en la máquina.
 *
 * No se descarga ninguno: la carpeta se busca, y si no está se dice qué falta en vez
 * de saltarse la prueba en silencio. Una prueba que se salta sola cuando no encuentra
 * algo es una prueba que un día deja de comprobar y nadie se entera — que es
 * exactamente lo que dejó pasar los 1077 px durante dos meses.
 */
function buscarChrome(): string {
  const raiz = process.env['PLAYWRIGHT_BROWSERS_PATH'] || '/opt/pw-browsers'
  const candidatos = readdirSync(raiz)
    .filter((d) => d.startsWith('chromium-'))
    .map((d) => join(raiz, d, 'chrome-linux', 'chrome'))
    .filter((f) => existsSync(f))
  if (candidatos.length === 0) {
    throw new Error(
      `No hay un Chromium en ${raiz}. Esta prueba dibuja las pantallas de verdad, ` +
      'así que necesita uno. En esta máquina viene puesto; en otra, instálalo ' +
      'antes de ejecutarla.')
  }
  return candidatos[0]!
}

const PANTALLAS = [
  '/', '/medidas', '/perfil', '/contratos/nuevo', '/importar',
  '/periodos', '/proveedores', '/banco', '/activos', '/reexpresion', '/libros',
] as const

const pedir = (p: Partial<Peticion>) => resolver({
  metodo: 'GET', ruta: '/', campos: {}, cookie: null, idioma: 'es', archivo: null,
  origen: `o-${Math.random().toString(36).slice(2)}`, ...p,
}, YO, false)

let nav: Browser
let gps = ''

before(async () => {
  conectar(DESTINO)
  const hash = await cifrarClave(CLAVE)
  await comoPersona({ id: YO }, 'nexus_interno', async (q) => {
    await q.unsafe('set local role none')
    await q`insert into organizacion (id, tipo, nombre, rif)
            values (${G},'gps','GPS Móvil','J-902900000-0')
            on conflict (id) do update set nombre = excluded.nombre`
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto)
            values (${YO}, ${G},'movil@prueba.test','Interno','clave_2fa',
                    ${hash}, ${SECRETO})
            on conflict (id) do update set clave_hash = excluded.clave_hash`
    await q`select instalar_plan_cuentas(${G}::uuid)`
  })
  const origen = 'o-movil'
  const p1 = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
    campos: { correo: 'movil@prueba.test', clave: CLAVE },
  }, YO, false)
  const desafio = /name="desafio" value="([^"]+)"/.exec(p1.cuerpo!)![1]!
  const p2 = await resolver({
    metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: codigoEnPaso(desdeBase32(SECRETO), pasoDe(new Date())) },
  }, YO, false)
  gps = new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(p2.cabeceras!['Set-Cookie']!)![1]!

  nav = await chromium.launch({ executablePath: buscarChrome() })
})
after(async () => {
  await nav?.close()
  await cerrar()
})

/** Dibuja una pantalla en el teléfono y devuelve lo medido. */
async function medir(ruta: string, ancho = TELEFONO.width) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: TELEFONO.height } })
  // Sin red: en el patio la cobertura es mala y las fuentes no llegan. Lo que hay que
  // comprobar es cómo queda ENTONCES.
  await ctx.route('**://**', (r) => r.abort())
  const page = await ctx.newPage()
  const r = await pedir({ ruta, cookie: gps })
  await page.setContent(r.cuerpo ?? '', { waitUntil: 'load' })
  // Esto se ejecuta DENTRO del navegador, no aquí. Va como texto a propósito: si se
  // escribiera como función de TypeScript habría que meterle el `dom` a la
  // configuración de tipos, y entonces el código del servidor podría usar `document`
  // sin que nadie se lo impidiera — en una aplicación cuya política de seguridad es
  // `default-src 'none'` y que no lleva ni una línea de JavaScript en el cliente.
  const m = await page.evaluate(`(() => {
    const desbordan = []
    for (const e of Array.from(document.querySelectorAll('*'))) {
      const c = e.getBoundingClientRect()
      if (c.width === 0) continue
      if (c.right > window.innerWidth + 1 || c.left < -1) {
        // Salirse DENTRO de una caja que se arrastra sola es a proposito: la tabla
        // del libro fiscal tiene nueve columnas porque las pide el SENIAT.
        let p = e.parentElement
        let enCajaQueArrastra = false
        while (p) {
          if (getComputedStyle(p).overflowX === 'auto') { enCajaQueArrastra = true; break }
          p = p.parentElement
        }
        if (!enCajaQueArrastra) {
          desbordan.push(e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 24))
        }
      }
    }
    return {
      anchoPagina: document.documentElement.scrollWidth,
      anchoPantalla: window.innerWidth,
      desbordan,
      textoVisible: (document.body.innerText || '').trim().length,
    }
  })()`) as {
    anchoPagina: number; anchoPantalla: number
    desbordan: string[]; textoVisible: number
  }
  await ctx.close()
  return m
}

for (const ruta of PANTALLAS) {
  test(`${ruta} cabe en un teléfono de 360 px`, async () => {
    const m = await medir(ruta)
    assert.ok(m.textoVisible > 80, `${ruta} salió prácticamente en blanco`)
    assert.ok(m.anchoPagina <= m.anchoPantalla + 1,
      `${ruta} mide ${m.anchoPagina} px sobre una pantalla de ${m.anchoPantalla}: ` +
      'hay que arrastrar la página de lado')
    assert.deepEqual(m.desbordan, [],
      `${ruta} se sale por la derecha: ${m.desbordan.join(', ')}`)
  })
}

test('también en un teléfono pequeño de 320 px', async () => {
  // El iPhone SE y buena parte de los Android baratos que se usan en el campo.
  for (const ruta of PANTALLAS) {
    const m = await medir(ruta, 320)
    assert.ok(m.anchoPagina <= m.anchoPantalla + 1,
      `${ruta} mide ${m.anchoPagina} px sobre una pantalla de ${m.anchoPantalla}`)
  }
})

test('la tabla del libro fiscal se arrastra ELLA, no la página', async () => {
  // Nueve columnas porque las pide el SENIAT. La solución no es quitarlas: es que se
  // arrastre la tabla dentro de su caja y la página se quede quieta.
  const ctx = await nav.newContext({ viewport: TELEFONO })
  await ctx.route('**://**', (r) => r.abort())
  const page = await ctx.newPage()
  const r = await pedir({
    ruta: '/libros', cookie: gps, campos: { cual: 'compras', anio: '2026', mes: '7' },
  })
  await page.setContent(r.cuerpo ?? '', { waitUntil: 'load' })
  const caja = await page.evaluate(`(() => {
    const d = document.querySelector('.ancho')
    return d ? getComputedStyle(d).overflowX : null
  })()`) as string | null
  await ctx.close()
  // Si algún día no hay tabla, no hay caja: entonces tampoco hay nada que arrastrar.
  if (caja !== null) assert.equal(caja, 'auto')
})

test('la cabecera de la cartera NO vuelve a medir 1077 px', async () => {
  // La prueba con nombre y apellidos del fallo que encontró este archivo. Diez
  // enlaces en una fila que no se partía.
  const ctx = await nav.newContext({ viewport: TELEFONO })
  await ctx.route('**://**', (r) => r.abort())
  const page = await ctx.newPage()
  await page.setContent((await pedir({ ruta: '/', cookie: gps })).cuerpo ?? '',
    { waitUntil: 'load' })
  const cabecera = await page.evaluate(`(() => {
    const h = document.querySelector('header .wrap')
    return h ? Math.round(h.getBoundingClientRect().width) : 0
  })()`) as number
  await ctx.close()
  assert.ok(cabecera > 0 && cabecera <= TELEFONO.width,
    `la cabecera mide ${cabecera} px sobre una pantalla de ${TELEFONO.width}`)
})


// ===========================================================================
// El contraste, medido.
//
// Nadie lo había medido nunca: los colores se eligieron mirándolos en una pantalla
// buena, de noche, dentro de casa. Este portal se usa en un patio de Zulia a
// mediodía, y ahí un gris claro sobre fondo claro sencillamente no está.
//
// El umbral es el de la norma de accesibilidad (WCAG AA): 4.5 a 1 para texto normal,
// 3 a 1 para texto grande. No es un gusto: es el punto donde la gente con la vista
// cansada —que en una empresa son unos cuantos— deja de poder leer.
//
// Se mide en los DOS temas. Un color que no cambia con el tema se lee en uno y
// desaparece en el otro, y eso no se ve leyendo el CSS.

/**
 * Calcula el contraste de cada texto contra su fondo real, dentro del navegador.
 *
 * Ojo con las barras: esto es una plantilla de TypeScript, y dentro de una plantilla
 * `\d` se queda en `d`. Hay que escribir `\\d` para que al navegador le llegue `\d`.
 * La primera versión se quedó con `[d.]+`, que no casa con nada: todos los colores
 * salían negros, el contraste daba 1:1 y la prueba «encontró» cien fallos que no
 * existían. Una prueba que falla de mentira cuesta lo mismo que una que pasa en vano.
 */
const MEDIR_CONTRASTE = `(() => {
  const lum = (c) => {
    const m = (c.match(/[\\d.]+/g) || ['0','0','0']).map(Number)
    const f = (v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2])
  }
  // El fondo de verdad: el primero que no sea transparente subiendo por los padres.
  const fondoDe = (e) => {
    let p = e
    while (p) {
      const b = getComputedStyle(p).backgroundColor
      const m = b.match(/[\\d.]+/g)
      if (m && (m.length < 4 || Number(m[3]) > 0.5)) return b
      p = p.parentElement
    }
    return 'rgb(255,255,255)'
  }
  const malos = []
  for (const e of Array.from(document.querySelectorAll('*'))) {
    const tieneTextoPropio = Array.from(e.childNodes)
      .some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!tieneTextoPropio) continue
    const s = getComputedStyle(e)
    const c = e.getBoundingClientRect()
    if (c.width === 0 || c.height === 0 || s.visibility === 'hidden') continue
    const l1 = lum(s.color), l2 = lum(fondoDe(e))
    const razon = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const px = parseFloat(s.fontSize)
    const grande = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700)
    const minimo = grande ? 3 : 4.5
    if (razon < minimo) {
      malos.push((e.textContent || '').trim().slice(0, 24) + ' [' + s.color + ' sobre ' +
        fondoDe(e) + ', ' + px + 'px, ' + (Math.round(razon * 100) / 100) + ':1 < ' + minimo + ']')
    }
  }
  return malos
})()`

for (const tema of ['light', 'dark'] as const) {
  test(`todo el texto se lee, en tema ${tema === 'light' ? 'claro' : 'oscuro'}`, async () => {
    const ctx = await nav.newContext({
      viewport: { width: 1100, height: 900 }, colorScheme: tema,
    })
    await ctx.route('**://**', (r) => r.abort())
    const page = await ctx.newPage()

    let mirados = 0
    const problemas: string[] = []
    for (const ruta of PANTALLAS) {
      const r = await pedir({ ruta, cookie: gps })
      await page.setContent(r.cuerpo ?? '', { waitUntil: 'load' })
      const malos = await page.evaluate(MEDIR_CONTRASTE) as string[]
      mirados++
      for (const m of malos) problemas.push(`${ruta} · ${m}`)
    }
    await ctx.close()

    // La red contra pasar en vano: si no se dibujó nada, esto no comprobó nada.
    assert.equal(mirados, PANTALLAS.length)
    assert.deepEqual(problemas, [],
      `texto que no se lee en tema ${tema}:\n  ${problemas.join('\n  ')}`)
  })
}

test('el color de enlace y el del botón verde CAMBIAN con el tema', async () => {
  // Los dos fallos que encontró esta prueba eran del mismo tipo: un color fijo que se
  // lee en un tema y desaparece en el otro. Un azul marino sobre fondo oscuro, y
  // blanco sobre verde menta. Que el token exista no basta: tiene que cambiar.
  const leer = async (tema: 'light' | 'dark') => {
    const ctx = await nav.newContext({ viewport: TELEFONO, colorScheme: tema })
    await ctx.route('**://**', (r) => r.abort())
    const page = await ctx.newPage()
    await page.setContent((await pedir({ ruta: '/', cookie: gps })).cuerpo ?? '',
      { waitUntil: 'load' })
    const v = await page.evaluate(`(() => {
      const s = getComputedStyle(document.documentElement)
      return [s.getPropertyValue('--enl').trim(), s.getPropertyValue('--sobre-grt').trim()]
    })()`) as string[]
    await ctx.close()
    return v
  }
  const claro = await leer('light')
  const oscuro = await leer('dark')
  assert.ok(claro[0] && oscuro[0], 'falta el color de enlace')
  assert.notEqual(claro[0], oscuro[0], 'el color de enlace no cambia con el tema')
  assert.notEqual(claro[1], oscuro[1], 'el color sobre el verde no cambia con el tema')
})


// ===========================================================================
// El recorrido con el teclado.
//
// Hay gente que no usa el ratón: por costumbre, porque va más rápido rellenando un
// formulario largo, o porque no puede. Todos necesitan lo mismo — ver DÓNDE están.
//
// Hasta esta prueba, casi toda la aplicación se fiaba del anillo que pone el
// navegador por su cuenta: un trazo de 1 px casi negro, que sobre la cabecera azul
// marino no se ve en absoluto. Y los tres campos de fecha del alta de contrato no
// tenían ninguno: un campo de fecha se recorre por dentro —día, mes, año— y mientras
// el foco está en una de sus partes el campo en sí no cuenta como enfocado, así que
// su anillo no llega a pintarse. El que se ve es el de la etiqueta que lo envuelve.
//
// Nada de esto se ve leyendo el CSS. Hay que tabular de verdad.

/** Dónde está el foco y si se ve, mirando también la etiqueta que envuelve. */
const DONDE_ESTA_EL_FOCO = `(() => {
  const a = document.activeElement
  if (!a || a === document.body) return null
  const anillo = (s) => s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1
  const eti = a.closest('label')
  const c = a.getBoundingClientRect()
  return {
    etiqueta: a.tagName.toLowerCase(),
    nombre: (a.getAttribute('name') || (a.textContent || '').trim()).slice(0, 24),
    seVe: anillo(getComputedStyle(a)) || (eti ? anillo(getComputedStyle(eti)) : false),
    visible: c.width > 0 && c.height > 0,
  }
})()`

/** Tabula por una pantalla y devuelve cada parada. */
async function tabular(ruta: string, cookie: string | null, saltos = 40) {
  const ctx = await nav.newContext({ viewport: { width: 1100, height: 900 } })
  await ctx.route('**://**', (r) => r.abort())
  const page = await ctx.newPage()
  await page.setContent((await pedir({ ruta, cookie })).cuerpo ?? '', { waitUntil: 'load' })
  const paradas: Array<{ etiqueta: string; nombre: string; seVe: boolean; visible: boolean }> = []
  for (let i = 0; i < saltos; i++) {
    await page.keyboard.press('Tab')
    const d = await page.evaluate(DONDE_ESTA_EL_FOCO) as typeof paradas[number] | null
    if (!d) break
    paradas.push(d)
  }
  await ctx.close()
  return paradas
}

for (const ruta of ['/entrar', '/', '/contratos/nuevo', '/periodos', '/libros', '/perfil'] as const) {
  test(`tabulando por ${ruta} siempre se ve dónde está el foco`, async () => {
    const paradas = await tabular(ruta, ruta === '/entrar' ? null : gps)
    // La red contra pasar en vano: una pantalla sin paradas no comprobó nada.
    assert.ok(paradas.length >= 2, `${ruta} solo tuvo ${paradas.length} parada(s)`)

    const ciegas = paradas.filter((p) => !p.seVe)
      .map((p) => `${p.etiqueta}[${p.nombre}]`)
    assert.deepEqual(ciegas, [],
      `en ${ruta} el foco desaparece en: ${ciegas.join(', ')}`)

    const escondidas = paradas.filter((p) => !p.visible)
      .map((p) => `${p.etiqueta}[${p.nombre}]`)
    assert.deepEqual(escondidas, [],
      `en ${ruta} el foco para en algo que no se ve: ${escondidas.join(', ')}`)
  })
}

test('se entra ENTERA con el teclado: correo, clave y enviar sin tocar el ratón', async () => {
  // Es la primera pantalla y la que más se teclea. Si aquí hace falta el ratón, da
  // igual lo bien que esté el resto.
  const ctx = await nav.newContext({ viewport: { width: 1100, height: 900 } })
  await ctx.route('**://**', (r) => r.abort())
  const page = await ctx.newPage()
  await page.setContent((await pedir({ ruta: '/entrar' })).cuerpo ?? '', { waitUntil: 'load' })

  await page.keyboard.press('Tab')
  await page.keyboard.type('alguien@ejemplo.test')
  await page.keyboard.press('Tab')
  await page.keyboard.type('una clave')
  const escrito = await page.evaluate(`(() => {
    const c = document.querySelector('input[name=correo]')
    const v = document.querySelector('input[name=clave]')
    return [c ? c.value : '', v ? v.value : '']
  })()`) as string[]
  await ctx.close()

  assert.equal(escrito[0], 'alguien@ejemplo.test', 'el primer salto no llegó al correo')
  assert.equal(escrito[1], 'una clave', 'el segundo salto no llegó a la clave')
})

test('los campos de FECHA también enseñan el foco al tabular', async () => {
  // Es el caso que encontró este archivo, y merece su propia prueba con nombre: se
  // recorren por dentro, y el anillo que se ve es el de la etiqueta.
  const paradas = await tabular('/contratos/nuevo', gps)
  const fechas = paradas.filter((p) => ['firmado_el', 'inicio', 'fin_previsto'].includes(p.nombre))
  assert.ok(fechas.length >= 3, `solo se llegó a ${fechas.length} campo(s) de fecha`)
  for (const f of fechas) assert.ok(f.seVe, `el campo ${f.nombre} no enseña el foco`)
})

test('el anillo de foco de la cabecera es CLARO: la cabecera es azul marino', async () => {
  // La tinta oscura sobre el azul marino de la cabecera no se ve, y la cabecera es
  // azul marino en los dos temas.
  const ctx = await nav.newContext({ viewport: { width: 1100, height: 900 } })
  await ctx.route('**://**', (r) => r.abort())
  const page = await ctx.newPage()
  await page.setContent((await pedir({ ruta: '/', cookie: gps })).cuerpo ?? '', { waitUntil: 'load' })
  await page.keyboard.press('Tab')
  const color = await page.evaluate(`(() => {
    const a = document.activeElement
    return a.closest('.hd') ? getComputedStyle(a).outlineColor : null
  })()`) as string | null
  await ctx.close()
  if (color !== null) {
    const claro = /(\d+)/.exec(color)
    assert.ok(claro && Number(claro[1]) > 180,
      `el anillo de la cabecera es ${color}, demasiado oscuro para el azul marino`)
  }
})


// ===========================================================================
// Lo que se ve AL ABRIR.
//
// Esta clase de fallo no la cogía ninguna prueba, y salió mirando una captura: en un
// teléfono, los diez enlaces de la cabecera de la cartera ocupaban 328 px de los 844
// de la pantalla —un 39%— y dejaban ver contrato y medio de la página más usada del
// sistema. Arreglada, la cabecera mide 90 px.
//
// Las pruebas de móvil medían anchos —que nada se saliera de lado— y los contrastes.
// Ninguna miraba lo más básico: que al abrir haya ALGO ADEMÁS DE LA NAVEGACIÓN.
//
// Una pantalla donde hay que desplazarse para llegar al contenido es una pantalla que
// en el patio, con una mano y guantes, se abandona.

/** Lo primero que NO es cabecera, y a qué altura empieza. */
const DONDE_EMPIEZA_LO_SUYO = `(() => {
  const alto = window.innerHeight
  let mejor = null
  for (const e of Array.from(document.querySelectorAll('main *'))) {
    if (e.closest('header')) continue
    const c = e.getBoundingClientRect()
    if (c.width < 40 || c.height < 12) continue
    const texto = (e.textContent || '').trim()
    if (texto.length < 3) continue
    if (mejor === null || c.top < mejor.top) mejor = { top: c.top, que: texto.slice(0, 30) }
  }
  const cab = document.querySelector('header')
  return {
    alto,
    cabecera: cab ? Math.round(cab.getBoundingClientRect().height) : 0,
    empieza: mejor ? Math.round(mejor.top) : -1,
    que: mejor ? mejor.que : '',
  }
})()`

test('al abrir en un teléfono se ve algo MÁS que el menú', async () => {
  const problemas: string[] = []
  let miradas = 0

  for (const ruta of PANTALLAS) {
    const ctx = await nav.newContext({ viewport: TELEFONO })
    await ctx.route('**://**', (r) => r.abort())
    const page = await ctx.newPage()
    await page.setContent((await pedir({ ruta, cookie: gps })).cuerpo ?? '',
      { waitUntil: 'load' })
    const m = await page.evaluate(DONDE_EMPIEZA_LO_SUYO) as {
      alto: number; cabecera: number; empieza: number; que: string
    }
    await ctx.close()
    miradas++

    if (m.empieza < 0) {
      problemas.push(`${ruta}: no hay nada que no sea cabecera`)
      continue
    }
    // El umbral SALE DE MEDIR, no de una opinión. Con las once pantallas sanas, lo
    // suyo empieza entre el 16% y el 35% de la pantalla; con el menú apilado, la
    // cartera se iba al 48%. El 40% separa las dos cosas con margen por los dos
    // lados.
    //
    // Dos intentos anteriores no valían, y conviene que quede escrito: medir el alto
    // de la CABECERA daba por malas pantallas sanas —el título y su explicación son
    // contenido, no navegación— y un umbral del 50% daba por bueno el estado roto.
    // Esta prueba pasó con el fallo dentro antes de estar bien calibrada.
    if (m.empieza > m.alto * 0.4) {
      problemas.push(`${ruta}: lo suyo («${m.que}») empieza en ${m.empieza} px ` +
        `de ${m.alto} — ${Math.round(m.empieza / m.alto * 100)}% de la pantalla es menú`)
    }
  }

  // La red contra pasar en vano.
  assert.equal(miradas, PANTALLAS.length)
  assert.deepEqual(problemas, [],
    `pantallas donde al abrir no se ve más que el menú:\n  ${problemas.join('\n  ')}`)
})
