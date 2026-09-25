/**
 * El mes entero, por HTTP y sin tocar la base de datos.
 *
 * El circuito del contrato ya está probado de punta a punta. Este es el otro camino,
 * el que se recorre el día 1 de cada mes y que nadie enseña en una demostración:
 *
 *   abrir el mes → traer la hoja de facturas → confirmarla → mirar el libro de
 *   compras → bajarlo en hoja de cálculo → cerrar el mes → y comprobar que, cerrado,
 *   ya no entra nada.
 *
 * Cada tramo estaba probado por su lado. Lo que no estaba probado es que encajen: es
 * donde fallan los sistemas que «funcionan» módulo a módulo.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'
import { testigoAnti } from '../src/servidor/csrf.ts'
import { leerHoja } from '../src/servidor/csv.ts'
import { mapeoDe } from './formulario.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '9f0a1b2c-0000-0000-0000-00000000000a'
const C = '9f0a1b2c-0000-0000-0000-00000000000b'
const PR = '9f0a1b2c-0000-0000-0000-00000000000c'
const YO = '9f0a1b2c-0000-0000-0000-00000000000d'
const TASA = '9f0a1b2c-1111-0000-0000-00000000000a'
const IVA = '9f0a1b2c-1111-0000-0000-00000000000b'
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

/** Una hoja de facturas de proveedor de noviembre, como la exporta Excel. */
const HOJA = '﻿' + [
  'Fecha;RIF;Proveedor;Nro Factura;Nro Control;Base;IVA',
  '05/11/2026;J-30666666-6;Suministros Mes;MES-0001;01-00000501;"800.000,00";"128.000,00"',
  '18/11/2026;J-30666666-6;Suministros Mes;MES-0002;01-00000502;"200.000,00";"32.000,00"',
].join('\r\n')

before(async () => {
  conectar(DESTINO)
  const hash = await cifrarClave(CLAVE)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Mes','J-902600000-0'),
        ('${C}','operadora','Operadora Mes','J-902700000-0'),
        ('${PR}','proveedor','Suministros Mes','J-30666666-6')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'mes@prueba.test','Contadora','clave_2fa', ${hash}, ${SECRETO})
            on conflict (id) do update set clave_hash = excluded.clave_hash`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-11-01', 50.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2026-01-01') on conflict do nothing;
      select instalar_plan_cuentas('${G}');
      -- El periodo NO se borra: los asientos de la corrida anterior lo referencian y
      -- un asiento no se borra. Se vuelve a abrir, que es lo que haria una persona.
      update periodo set estado = 'abierto'
       where organizacion_id = '${G}' and anio = 2026 and mes = 11;
      delete from documento_fiscal where organizacion_id = '${G}';
      delete from lote_importacion where organizacion_id = '${G}';
    `)
  })
})
after(async () => { await cerrar() })

test('el mes entero: abrir, importar, mirar el libro, bajarlo y cerrar', async () => {
  const gps = await entrar('mes@prueba.test')
  const af = testigoAnti(gps)

  // ------------------------------------------------------- 1. abrir el mes
  // Sin esto no entra ni una factura. Es la pantalla más aburrida del sistema y la
  // que bloquea el día 1 si nadie se acuerda.
  //
  // Lo que se comprueba es el RESULTADO —que el mes queda abierto—, no el código de
  // la respuesta: en una segunda corrida el mes ya está, y «ya estaba» no es un
  // fallo, es la misma situación de quien lo abre dos veces sin acordarse.
  await pedir({
    metodo: 'POST', ruta: '/periodos', cookie: gps,
    campos: { af, anio: '2026', mes: '11', accion: 'abrir' },
  })
  const [abierto] = (await dentro((q) => q`
    select estado::text from periodo
     where organizacion_id = ${G}::uuid and anio = 2026 and mes = 11
  `)) as unknown as Array<{ estado: string }>
  assert.equal(abierto?.estado, 'abierto', 'el mes no quedó abierto')

  // ------------------------------------------------------- 2. traer la hoja
  const subida = await pedir({
    metodo: 'POST', ruta: '/importar', cookie: gps,
    campos: { af, destino: 'facturas_recibidas' },
    archivo: {
      archivo: 'compras-noviembre.csv', tipoMime: 'text/csv',
      contenido: new TextEncoder().encode(HOJA),
    },
  })
  assert.equal(subida.codigo, 303, 'la hoja no se aceptó')
  const rutaLote = subida.cabeceras!['Location']!
  assert.match(rutaLote, /^\/importar\/[0-9a-f-]{36}$/)

  // La aplicación dice cómo entendió cada columna ANTES de escribir nada.
  const mapeo = await pedir({ ruta: rutaLote, cookie: gps })
  assert.equal(mapeo.codigo, 200)
  assert.match(mapeo.cuerpo!, /Nro Control/)

  // ------------------------------------------------------- 3. confirmarla
  // Se devuelve el mapeo tal como lo propuso, que es lo que haría quien lo acepta.
  const { columnas, campos } = mapeoDe(mapeo.cuerpo!)
  const confirmar = await pedir({
    metodo: 'POST', ruta: rutaLote, cookie: gps,
    campos: { af, accion: 'confirmar', ...campos },
    repetidos: { columna: columnas },
  })
  assert.equal(confirmar.codigo, 303, confirmar.cuerpo?.slice(0, 600))

  // ------------------------------------------------------- 4. el libro
  const libro = await pedir({
    ruta: '/libros', cookie: gps,
    campos: { cual: 'compras', anio: '2026', mes: '11' },
  })
  assert.equal(libro.codigo, 200)
  assert.match(libro.cuerpo!, /MES-0001/)
  assert.match(libro.cuerpo!, /MES-0002/)
  // Y el total del mes, que es el que se declara: 800.000 + 200.000.
  assert.match(libro.cuerpo!, /1\.000\.000,00/)

  // ------------------------------------------------------- 5. bajarlo
  const hoja = await pedir({
    ruta: '/libros/hoja', cookie: gps,
    campos: { cual: 'compras', anio: '2026', mes: '11' },
  })
  assert.equal(hoja.codigo, 200)
  assert.match(hoja.cabeceras!['Content-Type']!, /text\/csv/)
  assert.match(hoja.cabeceras!['Content-Disposition']!, /libro-compras-2026-11\.csv/)
  const leida = leerHoja(new TextDecoder().decode(hoja.bytes!))
  assert.equal(leida.filas.length, 3, 'cabecera y dos facturas')
  // Sin formatear: lo abre una máquina.
  assert.ok(leida.filas.some((f) => f.includes('800000.00')))

  // ------------------------------------------------------- 6. cerrar el mes
  await pedir({
    metodo: 'POST', ruta: '/periodos', cookie: gps,
    campos: { af, anio: '2026', mes: '11', accion: 'cerrar' },
  })
  const [cerrado] = (await dentro((q) => q`
    select estado::text from periodo
     where organizacion_id = ${G}::uuid and anio = 2026 and mes = 11
  `)) as unknown as Array<{ estado: string }>
  assert.equal(cerrado?.estado, 'cerrado', 'el mes no se cerró')

  // ------------------------------------------------------- 7. cerrado es cerrado
  // Una segunda hoja del mismo mes ya no entra, y lo dice ANTES de crear nada.
  const otra = HOJA.replace(/MES-000/g, 'MES-100')
  const segunda = await pedir({
    metodo: 'POST', ruta: '/importar', cookie: gps,
    campos: { af, destino: 'facturas_recibidas' },
    archivo: {
      archivo: 'compras-noviembre-tarde.csv', tipoMime: 'text/csv',
      contenido: new TextEncoder().encode(otra),
    },
  })
  const rutaLote2 = segunda.cabeceras!['Location']!
  const mapeo2 = await pedir({ ruta: rutaLote2, cookie: gps })
  const m2 = mapeoDe(mapeo2.cuerpo!)

  const rechazo = await pedir({
    metodo: 'POST', ruta: rutaLote2, cookie: gps,
    campos: { af, accion: 'confirmar', ...m2.campos },
    repetidos: { columna: m2.columnas },
  })
  // 400 y en la misma pantalla, con el motivo escrito: no es un error de servidor,
  // es que lo que se pidió no se puede hacer. Lo que importa es que lo DIGA, y que
  // diga qué mes — «no se pudo importar» a secas no lo arregla nadie.
  assert.equal(rechazo.codigo, 400, rechazo.cuerpo?.slice(0, 300))
  assert.match(rechazo.cuerpo!, /11\/2026/, 'no dice QUÉ mes falta')

  // Y lo importante: no creó nada a medias.
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from documento_fiscal
     where organizacion_id = ${G}::uuid and numero like 'MES-100%'
  `)) as unknown as Array<{ n: number }>
  assert.equal(Number(n!.n), 0, 'entró media hoja en un mes cerrado')
})
