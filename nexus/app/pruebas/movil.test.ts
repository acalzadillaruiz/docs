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
