/**
 * Bajarse la hoja de valuación.
 *
 * No la podía bajar nadie —ni GPS ni el cliente— aunque la máquina estaba entera:
 * `hoja_valuacion()` devuelve la hoja línea a línea y la pantalla la pinta. Lo que faltaba era
 * poder llevársela.
 *
 * Y no es comodidad. El proceso interno de una operadora pide un documento para autorizar un
 * pago; si el portal no lo produce, alguien pide un Excel por correo, y desde ese momento las
 * cifras viajan fuera del sistema y el portal deja de ser de donde sale la verdad. Es el mismo
 * argumento por el que existe la bandeja.
 *
 * El riesgo de un archivo que repite lo que ya hay en una pantalla es que se separe de ella:
 * dos consultas parecidas que un día dejan de decir lo mismo. Por eso la ruta llama a la MISMA
 * función que pinta la pantalla, y por eso lo que más se comprueba aquí es que las cifras del
 * archivo son exactamente las de la página.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'ccf10000-0000-0000-0000-0000000000a1'
const C = 'ccf10000-0000-0000-0000-0000000000a2'
const C2 = 'ccf10000-0000-0000-0000-0000000000a3'
const YO = 'ccf10000-0000-0000-0000-0000000000a4'
const ING = 'ccf10000-0000-0000-0000-0000000000a5'
const ING2 = 'ccf10000-0000-0000-0000-0000000000a6'
const TASA = 'ccf10000-0000-0000-0000-0000000000a7'
const IVA = 'ccf10000-0000-0000-0000-0000000000a8'
const CTR = 'ccf10000-0000-0000-0000-0000000000b1'
const CTR2 = 'ccf10000-0000-0000-0000-0000000000b2'
const VAL = 'ccf10000-0000-0000-0000-0000000000d1'
const VAL_AJENA = 'ccf10000-0000-0000-0000-0000000000d2'
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

let gps = ''
let cli = ''
let cli2 = ''

before(async () => {
  const hash = await cifrarClave(CLAVE)
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Hoja','J-909100000-1'),
        ('${C}','operadora','Operadora Hoja','J-909200000-2'),
        ('${C2}','operadora','Otra Hoja','J-909300000-3')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash,
                                 totp_secreto) values
              (${YO}, ${G},'hoja@prueba.test','Interno','clave_2fa', ${hash}, ${SECRETO}),
              (${ING}, ${C},'hoja-cli@prueba.test','De la operadora','clave_2fa',
               ${hash}, ${SECRETO}),
              (${ING2}, ${C2},'hoja-cli2@prueba.test','De la otra','clave_2fa',
               ${hash}, ${SECRETO})
            on conflict (id) do update set clave_hash = excluded.clave_hash,
              totp_secreto = excluded.totp_secreto`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2019-08-21', 38.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2018-01-20') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2018-01-20', 9.00)
        on conflict (vigente_desde) do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje,
                                 factor_ut, minimo_ut, vigente_desde)
        values ('HJ-SERV','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,
                '2018-01-20') on conflict (codigo) do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es,
                            titulo_en, estado, moneda, monto, tasa_id, creado_por) values
        ('${CTR}','${G}','${C}','HOJA-001','servicio','Servicio','Service',
         'vigente','VES', 2000000.00,'${TASA}','${YO}'),
        ('${CTR2}','${G}','${C2}','HOJA-002','servicio','De la otra','Of the other',
         'vigente','VES', 800000.00,'${TASA}','${YO}')
        on conflict (id) do update set estado = 'vigente';

      delete from valuacion where id in ('${VAL}','${VAL_AJENA}');
      insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde,
        periodo_hasta, obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
        concepto_islr, ret_iva_pct, estado, presentada_el, creada_por) values
        ('${VAL}','${G}','${CTR}', 7,'2026-05-01','2026-05-31', 300000.00,'VES','${TASA}',
         10, 5,'${IVA}','HJ-SERV', 75,'presentada','2026-06-02','${YO}'),
        ('${VAL_AJENA}','${G}','${CTR2}', 1,'2026-05-01','2026-05-31', 90000.00,'VES',
         '${TASA}', 0, 0,'${IVA}','HJ-SERV', 0,'presentada','2026-06-02','${YO}');
    `)
  })
  gps = await entrar('hoja@prueba.test')
  cli = await entrar('hoja-cli@prueba.test')
  cli2 = await entrar('hoja-cli2@prueba.test')
})
after(async () => { await cerrar() })

/** El CSV como texto, sin la marca de orden de bytes. */
const texto = (bytes: Uint8Array | undefined) =>
  new TextDecoder().decode(bytes ?? new Uint8Array()).replace(/^﻿/, '')

test('se baja, con su nombre y su tipo de archivo', async () => {
  const r = await pedir({ ruta: `/valuaciones/${VAL}/hoja`, cookie: gps })
  assert.equal(r.codigo, 200)
  assert.match(r.cabeceras!['Content-Type']!, /text\/csv/)
  // El nombre lleva el contrato y el número: un archivo llamado «hoja.csv» en la carpeta de
  // descargas, junto a otros cuatro, no se sabe de qué valuación es.
  assert.match(r.cabeceras!['Content-Disposition']!, /valuacion-HOJA-001-7\.csv/)
  assert.equal(r.cabeceras!['Content-Length'], String(r.bytes!.length))
})

test('las cifras del archivo son EXACTAMENTE las de la pantalla', async () => {
  // Es lo que se rompe con el tiempo: dos consultas parecidas que un día dejan de decir lo
  // mismo, y entonces el papel que el cliente archiva no es el que vio al firmar. La ruta
  // llama a la misma función que pinta la página; esto lo comprueba.
  const pagina = await pedir({ ruta: `/valuaciones/${VAL}`, cookie: gps })
  const hoja = texto((await pedir({ ruta: `/valuaciones/${VAL}/hoja`, cookie: gps })).bytes)

  // Los importes de la página, tal como salen pintados.
  const enPagina = [...pagina.cuerpo!.matchAll(/<div class="mt"[^>]*>([^<]+)</g)]
    .map((m) => m[1]!.trim()).filter((v) => v !== '' && v !== 'VES')
  assert.ok(enPagina.length >= 8, `solo se leyeron ${enPagina.length} importes de la página`)

  for (const importe of enPagina) {
    assert.ok(hoja.includes(importe),
      `la página dice ${importe} y el archivo no lo lleva`)
  }
})

test('el archivo se entiende solo: dice de qué valuación es y en qué estado', async () => {
  const hoja = texto((await pedir({ ruta: `/valuaciones/${VAL}/hoja`, cookie: gps })).bytes)
  assert.match(hoja, /HOJA-001/, 'no dice de qué contrato es')
  assert.match(hoja, /Presentada|presentada/, 'no dice en qué estado está')
  assert.match(hoja, /2026/, 'no dice de qué periodo es')
  // Y la primera columna lleva los conceptos, no las claves del diccionario.
  assert.equal(hoja.includes('valuacion.obra'), false,
    'salió la clave del diccionario en vez del texto')
})

test('el cliente se baja la suya, y dice lo mismo que SU pantalla', async () => {
  // El invariante que se sostiene pase lo que pase: el archivo del cliente dice lo mismo que la
  // página del cliente. Comparar su archivo con el de GPS sería comparar dos audiencias, y eso
  // dejaría de valer el día que una línea se marque interna: entonces desaparecería de lo del
  // cliente —de su pantalla y de su archivo— y seguiría en lo de GPS, que es lo correcto. Lo
  // comprobé marcando una línea como interna a propósito: la versión anterior de esta prueba,
  // que comparaba con la de GPS, se ponía roja sin que nada estuviera mal.
  const pagina = await pedir({ ruta: `/valuaciones/${VAL}`, cookie: cli })
  assert.equal(pagina.codigo, 200)
  const hoja = texto((await pedir({ ruta: `/valuaciones/${VAL}/hoja`, cookie: cli })).bytes)

  const enPagina = [...pagina.cuerpo!.matchAll(/<div class="mt"[^>]*>([^<]+)</g)]
    .map((m) => m[1]!.trim()).filter((v) => v !== '' && v !== 'VES')
  assert.ok(enPagina.length >= 8, `solo se leyeron ${enPagina.length} importes de su página`)
  for (const importe of enPagina) {
    assert.ok(hoja.includes(importe), `su página dice ${importe} y su archivo no lo lleva`)
  }
  assert.match(hoja, /HOJA-001/)
})

test('AVISO: hoy ninguna línea es interna, así que el filtro del cliente no filtra', async () => {
  // Esta prueba existe para avisar, no para comprobar. `hoja_valuacion()` marca cada línea con
  // si el cliente la puede ver desglosada, y hoy las nueve están marcadas visibles: todas están
  // en su factura. O sea que el filtro del archivo NO filtra nada, y lo he comprobado
  // cambiando el «es cliente» por un `false` fijo en la ruta: las ocho pruebas siguen verdes.
  //
  // Así que en vez de dejar un agujero latente, aquí está el hilo que se corta el día que
  // alguien marque una línea como interna: entonces esta prueba falla y dice que hay que
  // volver a mirar la descarga, que es lo único que no se puede comprobar hasta que ese día
  // llegue.
  const marcas = (await dentro((q) => q`
    select orden, visible_cliente from hoja_valuacion(${VAL}::uuid) order by orden
  `)) as unknown as Array<{ orden: number; visible_cliente: boolean }>
  assert.ok(marcas.length >= 9, `la hoja trae ${marcas.length} líneas`)
  const internas = marcas.filter((m) => !m.visible_cliente).map((m) => m.orden)
  assert.deepEqual(internas, [],
    'ya hay líneas internas en la hoja (' + internas.join(', ') + '): hay que comprobar que ' +
    'la descarga del CLIENTE las deja fuera, que hasta hoy no se podía comprobar porque no ' +
    'había ninguna')
})

test('la de OTRO cliente contesta 404, igual que su página', async () => {
  // El mismo 404 que da la página, y por el mismo camino: la función del dominio no encuentra
  // la hoja porque las políticas de fila no le devuelven esa valuación.
  const r = await pedir({ ruta: `/valuaciones/${VAL_AJENA}/hoja`, cookie: cli })
  assert.equal(r.codigo, 404)
  const pagina = await pedir({ ruta: `/valuaciones/${VAL_AJENA}`, cookie: cli })
  assert.equal(pagina.codigo, 404, 'la página y la descarga tienen que contestar lo mismo')

  // Y la suya sí, que si no esto pasaría con la descarga rota del todo.
  assert.equal((await pedir({ ruta: `/valuaciones/${VAL_AJENA}/hoja`, cookie: cli2 })).codigo, 200)
})

test('una valuación que no existe no revienta: contesta 404', async () => {
  const r = await pedir({
    ruta: '/valuaciones/00000000-0000-0000-0000-000000000000/hoja', cookie: gps,
  })
  assert.equal(r.codigo, 404)
})

test('sin sesión no se baja nada', async () => {
  const r = await pedir({ ruta: `/valuaciones/${VAL}/hoja`, cookie: null })
  assert.notEqual(r.codigo, 200)
})

test('y sale en los dos idiomas, con las etiquetas de la pantalla', async () => {
  for (const idioma of ['es', 'en'] as const) {
    const h = texto((await pedir({
      ruta: `/valuaciones/${VAL}/hoja`, cookie: gps, idioma,
    })).bytes)
    assert.equal(h.includes('‹falta:'), false, `${idioma} tiene una clave sin traducir`)
    assert.match(h, idioma === 'es' ? /Concepto/ : /Item/,
      `${idioma}: falta la cabecera de la primera columna`)
  }
})
