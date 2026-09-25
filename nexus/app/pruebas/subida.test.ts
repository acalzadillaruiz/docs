/**
 * El circuito entero de un documento, por HTTP.
 *
 * De un formulario con archivo a un avance que sube. Sin abrir un puerto: `resolver`
 * está separada de la red a propósito, así que aquí se le pasa la petición ya
 * montada, igual que haría `desdeHttp`.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { configurarAlmacen, almacen } from '../src/servidor/almacen.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'
import { testigoAnti } from '../src/servidor/csrf.ts'
import { mapeoDe } from './formulario.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const ORG = '3c4d5e6f-0000-0000-0000-00000000000a'
const CLI = '3c4d5e6f-0000-0000-0000-00000000000b'
const YO  = '3c4d5e6f-0000-0000-0000-00000000000d'
const ING = '3c4d5e6f-0000-0000-0000-00000000000e'
const TASA = '3c4d5e6f-1111-0000-0000-00000000000a'
const CTR = '3c4d5e6f-2222-0000-0000-00000000000a'
const RG  = '3c4d5e6f-3333-0000-0000-00000000000a'
const H1  = '3c4d5e6f-4444-0000-0000-000000000001'
const H2  = '3c4d5e6f-4444-0000-0000-000000000002'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLAVE = 'una clave razonable'

let raiz = ''
const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

const pedir = (p: Partial<Peticion>) => resolver({
  metodo: 'GET', ruta: '/', campos: {}, cookie: null, idioma: 'es', archivo: null,
  origen: `o-${Math.random().toString(36).slice(2)}`, ...p,
}, YO, false)

/** Entra de verdad y devuelve la cookie, como haría un navegador. */
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

const bytes = (t: string) => new TextEncoder().encode(t)

/** Deja el renglón con sus dos hitos y sin evidencia, para cada prueba. */
async function limpio(): Promise<void> {
  await dentro(async (q) => {
    await q`delete from evidencia where hito_id in (
      select id from hito where renglon_id = ${RG}::uuid)`
    await q`update hito set estado = 'pendiente', ocurrido_en = null, registrado_en = null,
                            registrado_por = null where renglon_id = ${RG}::uuid`
  })
}

before(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'nexus-subida-'))
  configurarAlmacen(raiz)
  conectar(DESTINO)
  const hash = await cifrarClave(CLAVE)
  await dentro(async (q) => {
    // Las personas van ANTES que el contrato: el contrato apunta a quien lo creó.
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${ORG}','gps','GPS Subida','J-926666666-6'),
        ('${CLI}','operadora','Operadora Subida','J-927777777-7')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${ORG},'sub@prueba.test','Interno','clave_2fa', ${hash}, ${SECRETO}),
                   (${ING}, ${CLI},'sub-cli@prueba.test','Ingeniero','clave_2fa', ${hash}, ${SECRETO})
            on conflict (id) do update set clave_hash = excluded.clave_hash`
    await q.unsafe(`
      set local role none;
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-09-08', 36.50,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR}','${ORG}','${CLI}','SUB-001','procura','Cabezales','Wellheads',
                'vigente','USD', 200000.00,'${TASA}','${YO}')
        on conflict (id) do update set codigo = excluded.codigo;
      insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                           cantidad, unidad, norma, precio_unitario, costo_unitario)
        values ('${RG}','${CTR}', 1,'Cabezal de pozo','Wellhead', 2,'unidad','API 6A',
                100000.0000, 62000.0000)
        on conflict (id) do update set contrato_id = excluded.contrato_id;
      insert into hito (id, renglon_id, orden, clave, nombre_es, nombre_en, peso, exige) values
        ('${H1}','${RG}', 1,'fabricado','Fabricado','Manufactured', 40.00,'{certificado}'),
        ('${H2}','${RG}', 2,'recibido','Recibido','Received', 60.00,'{acta,foto}')
        on conflict (id) do update set peso = excluded.peso, exige = excluded.exige;
      select instalar_plan_cuentas('${ORG}');
      insert into periodo (organizacion_id, anio, mes) values ('${ORG}', 2026, 4)
        on conflict do nothing;
    `)
  })
})
after(async () => {
  await cerrar()
  await rm(raiz, { recursive: true, force: true })
})

test('el circuito entero: subir, verificar, y el avance sube', async () => {
  await limpio()
  const cookie = await entrar('sub@prueba.test')
  const af = testigoAnti(cookie)
  const contenido = bytes('%PDF certificado de colada 44821')

  const subida = await pedir({
    metodo: 'POST', ruta: `/hitos/${H1}/evidencia`, cookie,
    campos: { af, clase: 'certificado', ocurrido_en: '2026-09-10', volver: `/renglones/${RG}` },
    archivo: { archivo: 'mtr.pdf', tipoMime: 'application/pdf', contenido },
  })
  assert.equal(subida.codigo, 303)
  assert.equal(subida.cabeceras!['Location'], `/renglones/${RG}`)

  // Los bytes están en el almacén, bajo su huella.
  const huella = createHash('sha256').update(contenido).digest('hex')
  assert.deepEqual(await almacen().leer(huella), contenido)

  // El hito ya tiene documento, pero el avance sigue en cero: nadie lo ha mirado.
  const antes = await pedir({ ruta: `/renglones/${RG}`, cookie })
  assert.match(antes.cuerpo!, /class="ba-v" style="width:0%"/)
  assert.match(antes.cuerpo!, /Con documento, sin revisar/)

  const [evi] = (await dentro((q) => q`
    select id from evidencia where hito_id = ${H1}::uuid
  `)) as unknown as Array<{ id: string }>

  const rev = await pedir({
    metodo: 'POST', ruta: `/evidencia/${evi!.id}/verificar`, cookie,
    campos: { af, volver: `/renglones/${RG}` },
  })
  assert.equal(rev.codigo, 303)

  const despues = await pedir({ ruta: `/renglones/${RG}`, cookie })
  assert.match(despues.cuerpo!, /class="ba-v" style="width:40%"/)
})

test('el documento se descarga como descarga, nunca dentro de la página', async () => {
  await limpio()
  const cookie = await entrar('sub@prueba.test')
  const af = testigoAnti(cookie)
  const contenido = bytes('%PDF con bytes\x00raros\xff')

  await pedir({
    metodo: 'POST', ruta: `/hitos/${H1}/evidencia`, cookie,
    campos: { af, clase: 'certificado', volver: `/renglones/${RG}` },
    archivo: { archivo: 'mtr raro.pdf', tipoMime: 'application/pdf', contenido },
  })
  const [evi] = (await dentro((q) => q`
    select id from evidencia where hito_id = ${H1}::uuid
  `)) as unknown as Array<{ id: string }>

  const r = await pedir({ ruta: `/evidencia/${evi!.id}/archivo`, cookie })
  assert.equal(r.codigo, 200)
  assert.equal(r.cabeceras!['Content-Type'], 'application/pdf')
  // Un documento subido por otro que se abriera en el dominio del portal es código
  // de otro corriendo aquí.
  assert.match(r.cabeceras!['Content-Disposition']!, /^attachment; filename\*=UTF-8''/)
  assert.equal(r.cabeceras!['X-Content-Type-Options'], 'nosniff')
  // Y los bytes salen exactos: pasarlos por una cadena cambiaría la huella.
  assert.deepEqual(r.bytes, contenido)
})

test('lo que no es un tipo aceptado no llega al disco', async () => {
  await limpio()
  const cookie = await entrar('sub@prueba.test')
  const af = testigoAnti(cookie)
  // Un SVG se ejecuta en el navegador. La lista es cerrada a propósito: lo
  // prohibido siempre se queda corto.
  const r = await pedir({
    metodo: 'POST', ruta: `/hitos/${H1}/evidencia`, cookie,
    campos: { af, clase: 'certificado' },
    archivo: { archivo: 'x.svg', tipoMime: 'image/svg+xml', contenido: bytes('<svg onload=1>') },
  })
  assert.equal(r.codigo, 415)
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from evidencia where hito_id = ${H1}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 0)
})

test('una clase inventada no entra', async () => {
  await limpio()
  const cookie = await entrar('sub@prueba.test')
  const r = await pedir({
    metodo: 'POST', ruta: `/hitos/${H1}/evidencia`, cookie,
    campos: { af: testigoAnti(cookie), clase: 'lo_que_sea' },
    archivo: { archivo: 'a.pdf', tipoMime: 'application/pdf', contenido: bytes('x') },
  })
  assert.equal(r.codigo, 400)
})

test('subir SIN el testigo antifalsificación no pasa, y no escribe nada', async () => {
  await limpio()
  const cookie = await entrar('sub@prueba.test')
  const r = await pedir({
    metodo: 'POST', ruta: `/hitos/${H1}/evidencia`, cookie,
    campos: { clase: 'certificado' },
    archivo: { archivo: 'a.pdf', tipoMime: 'application/pdf', contenido: bytes('x') },
  })
  assert.equal(r.codigo, 403)
})

test('el cliente NO puede subir evidencia', async () => {
  await limpio()
  const cookie = await entrar('sub-cli@prueba.test')
  // Si pudiera, el avance volvería a ser lo que alguien diga — solo que ahora lo
  // diría el otro lado.
  const r = await pedir({
    metodo: 'POST', ruta: `/hitos/${H1}/evidencia`, cookie,
    campos: { af: testigoAnti(cookie), clase: 'certificado' },
    archivo: { archivo: 'mio.pdf', tipoMime: 'application/pdf', contenido: bytes('lo digo yo') },
  })
  assert.equal(r.codigo, 404)
})

test('el cliente NO puede verificar ni rechazar', async () => {
  await limpio()
  const gps = await entrar('sub@prueba.test')
  await pedir({
    metodo: 'POST', ruta: `/hitos/${H1}/evidencia`, cookie: gps,
    campos: { af: testigoAnti(gps), clase: 'certificado' },
    archivo: { archivo: 'mtr.pdf', tipoMime: 'application/pdf', contenido: bytes('colada') },
  })
  const [evi] = (await dentro((q) => q`
    select id from evidencia where hito_id = ${H1}::uuid
  `)) as unknown as Array<{ id: string }>

  const cli = await entrar('sub-cli@prueba.test')
  const r = await pedir({
    metodo: 'POST', ruta: `/evidencia/${evi!.id}/verificar`, cookie: cli,
    campos: { af: testigoAnti(cli) },
  })
  assert.equal(r.codigo, 404)
})

test('el cliente ve los botones de nadie: la pantalla no se los pinta', async () => {
  await limpio()
  const cli = await entrar('sub-cli@prueba.test')
  const r = await pedir({ ruta: `/renglones/${RG}`, cookie: cli })
  assert.equal(r.codigo, 200)
  assert.equal(r.cuerpo!.includes('/evidencia'), false)
  assert.equal(r.cuerpo!.includes('multipart/form-data'), false)
})

test('de dentro sí salen el formulario de subir y los dos botones', async () => {
  await limpio()
  const cookie = await entrar('sub@prueba.test')
  const af = testigoAnti(cookie)
  await pedir({
    metodo: 'POST', ruta: `/hitos/${H1}/evidencia`, cookie,
    campos: { af, clase: 'certificado' },
    archivo: { archivo: 'mtr.pdf', tipoMime: 'application/pdf', contenido: bytes('colada') },
  })
  const r = await pedir({ ruta: `/renglones/${RG}`, cookie })
  assert.match(r.cuerpo!, /enctype="multipart\/form-data"/)
  assert.match(r.cuerpo!, /\/verificar"/)
  assert.match(r.cuerpo!, /\/rechazar"/)
  // Y todo formulario que escribe lleva el testigo.
  assert.equal((r.cuerpo!.match(/name="af"/g) ?? []).length >= 3, true)
})

test('rechazar exige motivo, y el avance cae', async () => {
  await limpio()
  const cookie = await entrar('sub@prueba.test')
  const af = testigoAnti(cookie)
  await pedir({
    metodo: 'POST', ruta: `/hitos/${H1}/evidencia`, cookie,
    campos: { af, clase: 'certificado', ocurrido_en: '2026-09-10' },
    archivo: { archivo: 'mtr.pdf', tipoMime: 'application/pdf', contenido: bytes('colada mala') },
  })
  const [evi] = (await dentro((q) => q`
    select id from evidencia where hito_id = ${H1}::uuid
  `)) as unknown as Array<{ id: string }>

  await pedir({
    metodo: 'POST', ruta: `/evidencia/${evi!.id}/verificar`, cookie, campos: { af },
  })
  assert.match((await pedir({ ruta: `/renglones/${RG}`, cookie })).cuerpo!,
    /class="ba-v" style="width:40%"/)

  const sinMotivo = await pedir({
    metodo: 'POST', ruta: `/evidencia/${evi!.id}/rechazar`, cookie, campos: { af, motivo: '  ' },
  })
  assert.equal(sinMotivo.codigo, 409)

  const con = await pedir({
    metodo: 'POST', ruta: `/evidencia/${evi!.id}/rechazar`, cookie,
    campos: { af, motivo: 'la colada no coincide con el cabezal', volver: `/renglones/${RG}` },
  })
  assert.equal(con.codigo, 303)
  const despues = await pedir({ ruta: `/renglones/${RG}`, cookie })
  assert.match(despues.cuerpo!, /class="ba-v" style="width:0%"/)
  assert.match(despues.cuerpo!, /la colada no coincide con el cabezal/)
})

test('el destino de vuelta no puede sacarte del portal', async () => {
  await limpio()
  const cookie = await entrar('sub@prueba.test')
  const r = await pedir({
    metodo: 'POST', ruta: `/hitos/${H1}/evidencia`, cookie,
    campos: { af: testigoAnti(cookie), clase: 'certificado', volver: 'https://sitio-falso' },
    archivo: { archivo: 'a.pdf', tipoMime: 'application/pdf', contenido: bytes('x') },
  })
  assert.equal(r.cabeceras!['Location'], '/')
})

test('un documento que no te corresponde no se descarga, y da 404 no 403', async () => {
  await limpio()
  const cookie = await entrar('sub@prueba.test')
  const r = await pedir({
    ruta: '/evidencia/99999999-9999-9999-9999-99999999999b/archivo', cookie,
  })
  assert.equal(r.codigo, 404)
})

test('sin sesión, ni se mira qué pedía', async () => {
  const r = await pedir({
    metodo: 'POST', ruta: `/hitos/${H1}/evidencia`, campos: { clase: 'certificado' },
    archivo: { archivo: 'a.pdf', tipoMime: 'application/pdf', contenido: bytes('x') },
  })
  assert.equal(r.codigo, 303)
})

test('el mismo documento subido dos veces no duplica la fila', async () => {
  await limpio()
  const cookie = await entrar('sub@prueba.test')
  const af = testigoAnti(cookie)
  const contenido = bytes('%PDF el mismo papel')
  for (const nombre of ['mtr.pdf', 'certificado-final.pdf']) {
    await pedir({
      metodo: 'POST', ruta: `/hitos/${H1}/evidencia`, cookie,
      campos: { af, clase: 'certificado' },
      archivo: { archivo: nombre, tipoMime: 'application/pdf', contenido },
    })
  }
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from evidencia where hito_id = ${H1}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 1, 'el mismo papel con dos nombres es el mismo papel')
})

test('el cliente no llega a las medidas: 404, igual que a un contrato ajeno', async () => {
  // Son el margen de GPS mirado desde otro ángulo.
  const cli = await entrar('sub-cli@prueba.test')
  const r = await pedir({ ruta: '/medidas', cookie: cli })
  assert.equal(r.codigo, 404)
})

test('de dentro, las medidas se sirven y la cartera lleva a ellas', async () => {
  const cookie = await entrar('sub@prueba.test')
  const m = await pedir({ ruta: '/medidas', cookie })
  assert.equal(m.codigo, 200)
  assert.match(m.cuerpo!, /Solo para GPS/)

  const cartera = await pedir({ ruta: '/', cookie })
  assert.match(cartera.cuerpo!, /href="\/medidas"/)
})

test('al cliente la cartera no le ofrece las medidas', async () => {
  const cli = await entrar('sub-cli@prueba.test')
  const r = await pedir({ ruta: '/', cookie: cli })
  assert.equal(r.cuerpo!.includes('/medidas'), false)
})

test('el perfil se sirve, se guarda, y lo guardado se nota al volver', async () => {
  const cookie = await entrar('sub@prueba.test')
  const af = testigoAnti(cookie)

  const antes = await pedir({ ruta: '/perfil', cookie })
  assert.equal(antes.codigo, 200)
  assert.match(antes.cuerpo!, /type="checkbox"/)

  // Se mandan tres marcadas de las seis. Un formulario manda solo las marcadas.
  const r = await pedir({
    metodo: 'POST', ruta: '/perfil', cookie,
    campos: { af, idioma: 'es' },
    repetidos: { aviso: ['objecion_nueva', 'valuacion_presentada', 'hito_atrasado'] },
  })
  assert.equal(r.codigo, 200)
  assert.match(r.cuerpo!, /Guardado/)
  assert.equal((r.cuerpo!.match(/type="checkbox"[^>]* checked/g) ?? []).length, 3)

  // Y al volver a entrar sigue igual: no era solo el eco del formulario.
  const despues = await pedir({ ruta: '/perfil', cookie })
  assert.equal((despues.cuerpo!.match(/type="checkbox"[^>]* checked/g) ?? []).length, 3)

  // Se deja como estaba para no estorbar a las demás pruebas.
  await pedir({
    metodo: 'POST', ruta: '/perfil', cookie,
    campos: { af, idioma: 'es' },
    repetidos: { aviso: [
      'objecion_nueva', 'objecion_respondida', 'valuacion_presentada',
      'valuacion_aprobada', 'evidencia_sin_revisar', 'hito_atrasado',
    ] },
  })
})

test('guardar el perfil SIN el testigo antifalsificación no cambia nada', async () => {
  const cookie = await entrar('sub@prueba.test')
  const r = await pedir({
    metodo: 'POST', ruta: '/perfil', cookie,
    campos: { idioma: 'en' }, repetidos: { aviso: [] },
  })
  assert.equal(r.codigo, 403)
})

test('el alta de contrato: formulario, error con lo escrito, y alta buena', async () => {
  const cookie = await entrar('sub@prueba.test')
  const af = testigoAnti(cookie)

  const vacio = await pedir({ ruta: '/contratos/nuevo', cookie })
  assert.equal(vacio.codigo, 200)
  assert.match(vacio.cuerpo!, /Operadora Subida/)

  // Sin cliente y sin renglones: dos errores, y lo escrito vuelve escrito.
  const malo = await pedir({
    metodo: 'POST', ruta: '/contratos/nuevo', cookie,
    campos: { af, accion: 'crear', codigo: 'RUTA-ALTA-1', titulo_es: 'Cabezales',
              titulo_en: 'Wellheads', tipo: 'procura', moneda: 'USD', filas: '3' },
  })
  assert.equal(malo.codigo, 400)
  assert.match(malo.cuerpo!, /value="RUTA-ALTA-1"/)
  assert.match(malo.cuerpo!, /class="mal"/)

  // Pedir más filas NO es enviar: se vuelve a pintar con lo escrito y cinco huecos más.
  const mas = await pedir({
    metodo: 'POST', ruta: '/contratos/nuevo', cookie,
    campos: { af, accion: 'mas', codigo: 'RUTA-ALTA-1', filas: '3' },
  })
  assert.equal(mas.codigo, 200)
  assert.match(mas.cuerpo!, /value="RUTA-ALTA-1"/)
  assert.match(mas.cuerpo!, /name="filas" value="8"/)
  assert.equal(mas.cuerpo!.includes('class="mal"'), false, 'pedir filas no es un error')

  // Y ahora bien.
  const codigo = `RUTA-ALTA-${Date.now() % 1000000}`
  const bueno = await pedir({
    metodo: 'POST', ruta: '/contratos/nuevo', cookie,
    campos: { af, accion: 'crear', codigo, titulo_es: 'Cabezales', titulo_en: 'Wellheads',
              tipo: 'procura', moneda: 'USD', cliente: CLI, filas: '3',
              anticipo_pct: '0', amortiza_pct: '0', garantia_pct: '5' },
    repetidos: {
      r_desc_es: ['Cabezal', '', ''],
      r_desc_en: ['Wellhead', '', ''],
      r_cantidad: ['4', '', ''],
      r_unidad: ['unidad', '', ''],
      r_norma: ['API 6A', '', ''],
      r_espec: ['', '', ''],
      r_precio: ['120000', '', ''],
      r_costo: ['74500', '', ''],
    },
  })
  assert.equal(bueno.codigo, 303)
  assert.match(bueno.cabeceras!['Location']!, /^\/contratos\/[0-9a-f-]{36}$/)

  // La ficha ya se sirve, con sus hitos creados y las filas vacías descartadas.
  const ficha = await pedir({ ruta: bueno.cabeceras!['Location']!, cookie })
  assert.equal(ficha.codigo, 200)
  assert.match(ficha.cuerpo!, /Cabezal/)
  assert.equal((ficha.cuerpo!.match(/class="rg"/g) ?? []).length, 1,
    'las filas vacías del formulario no crean renglones fantasma')
})

test('el cliente no puede dar de alta un contrato', async () => {
  const cli = await entrar('sub-cli@prueba.test')
  assert.equal((await pedir({ ruta: '/contratos/nuevo', cookie: cli })).codigo, 404)
  assert.equal((await pedir({
    metodo: 'POST', ruta: '/contratos/nuevo', cookie: cli,
    campos: { af: testigoAnti(cli), accion: 'crear', codigo: 'X' },
  })).codigo, 404)
})

test('dar de alta SIN el testigo antifalsificación no pasa', async () => {
  const cookie = await entrar('sub@prueba.test')
  const r = await pedir({
    metodo: 'POST', ruta: '/contratos/nuevo', cookie,
    campos: { accion: 'crear', codigo: 'X' },
  })
  assert.equal(r.codigo, 403)
})

test('el importador, desde el navegador: hoja → mapeo → comprobar → importar', async () => {
  const cookie = await entrar('sub@prueba.test')
  const af = testigoAnti(cookie)

  // Un proveedor dado de alta, porque desde una hoja no se crean solos.
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`insert into organizacion (id, tipo, nombre, rif)
            values ('3c4d5e6f-0000-0000-0000-0000000000cc','proveedor','Suministros Sub',
                    'J-30777777-7') on conflict (id) do nothing`
    await q`insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
            values ('3c4d5e6f-1111-0000-0000-0000000000cc','2026-04-03', 40.00,'carga_manual')
            on conflict (id) do nothing`
  })

  const hoja = '﻿' + [
    'Fecha;RIF;Proveedor;Nro Factura;Nro Control;Base;IVA',
    `03/04/2026;J-30777777-7;Suministros Sub;SUB-${Date.now() % 100000};01-00077777;"500.000,00";"80.000,00"`,
  ].join('\r\n')

  const subida = await pedir({
    metodo: 'POST', ruta: '/importar', cookie,
    campos: { af, destino: 'facturas_recibidas' },
    archivo: { archivo: 'abril.csv', tipoMime: 'text/csv',
               contenido: new TextEncoder().encode(hoja) },
  })
  assert.equal(subida.codigo, 303)
  const rutaLote = subida.cabeceras!['Location']!

  // La pantalla de mapeo enseña la cabecera de la hoja Y un ejemplo del dato: sin
  // el ejemplo no hay forma de saber si «Base» es la base o el total con IVA.
  const mapeo = await pedir({ ruta: rutaLote, cookie })
  assert.equal(mapeo.codigo, 200)
  assert.match(mapeo.cuerpo!, /Nro Control/)
  assert.match(mapeo.cuerpo!, /500\.000,00/)
  // Y el formato propuesto sale elegido, no en blanco.
  assert.match(mapeo.cuerpo!, /value="ven" selected/)
  assert.match(mapeo.cuerpo!, /value="dmy" selected/)

  // Comprobar, DEVOLVIENDO el formulario tal como salió de la pantalla — no una
  // versión escrita a mano. Esta prueba tenía las tres listas a mano, perfectamente
  // alineadas, y por eso no vio que el navegador no manda los selects
  // deshabilitados: los formatos llegaban corridos y la fecha se leía con el formato
  // de otra columna.
  const { columnas, campos } = mapeoDe(mapeo.cuerpo!)
  assert.equal(campos['campo_1'], 'fecha')
  assert.equal(campos['formato_1'], 'dmy')

  const comprobado = await pedir({
    metodo: 'POST', ruta: rutaLote, cookie,
    campos: { af, accion: 'validar', ...campos },
    repetidos: { columna: columnas },
  })
  assert.equal(comprobado.codigo, 200)
  assert.match(comprobado.cuerpo!, /filas correctas/)
  assert.match(comprobado.cuerpo!, /accion" value="confirmar"/)

  // Importar de verdad.
  const importado = await pedir({
    metodo: 'POST', ruta: rutaLote, cookie,
    campos: { af, accion: 'confirmar', ...campos },
    repetidos: { columna: columnas },
  })
  assert.equal(importado.codigo, 303)

  const [n] = (await dentro((q) => q`
    select count(*)::int as n from documento_fiscal
     where organizacion_id = ${ORG}::uuid and sentido = 'recibido'
  `)) as unknown as Array<{ n: number }>
  assert.ok(n!.n >= 1, 'la factura tiene que estar en la contabilidad')
})

test('el cliente no llega al importador', async () => {
  const cli = await entrar('sub-cli@prueba.test')
  assert.equal((await pedir({ ruta: '/importar', cookie: cli })).codigo, 404)
  assert.equal((await pedir({
    metodo: 'POST', ruta: '/importar', cookie: cli, campos: { af: testigoAnti(cli) },
  })).codigo, 404)
})

test('traer la misma hoja dos veces se avisa, no se cuela', async () => {
  const cookie = await entrar('sub@prueba.test')
  const af = testigoAnti(cookie)
  const hoja = 'Fecha;RIF;Nro Factura;Base\n03/04/2026;J-30777777-7;REPE-001;"1.000,00"\n'
  const uno = await pedir({
    metodo: 'POST', ruta: '/importar', cookie, campos: { af },
    archivo: { archivo: 'r.csv', tipoMime: 'text/csv',
               contenido: new TextEncoder().encode(hoja) },
  })
  assert.equal(uno.codigo, 303)
  const dos = await pedir({
    metodo: 'POST', ruta: '/importar', cookie, campos: { af },
    archivo: { archivo: 'r-copia.csv', tipoMime: 'text/csv',
               contenido: new TextEncoder().encode(hoja) },
  })
  assert.equal(dos.codigo, 409)
  assert.match(dos.cuerpo!, /ya se importó/)
})

test('los meses contables se abren desde el navegador, y el cliente no llega', async () => {
  const cookie = await entrar('sub@prueba.test')
  const af = testigoAnti(cookie)

  const pantalla = await pedir({ ruta: '/periodos', cookie })
  assert.equal(pantalla.codigo, 200)
  assert.match(pantalla.cuerpo!, /Meses contables/)

  const r = await pedir({
    metodo: 'POST', ruta: '/periodos', cookie,
    campos: { af, accion: 'abrir', anio: '2027', mes: '7' },
  })
  assert.equal(r.codigo, 200)
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from periodo
     where organizacion_id = ${ORG}::uuid and anio = 2027 and mes = 7
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 1)

  const cli = await entrar('sub-cli@prueba.test')
  assert.equal((await pedir({ ruta: '/periodos', cookie: cli })).codigo, 404)
})

test('abrir un mes SIN el testigo antifalsificación no pasa', async () => {
  const cookie = await entrar('sub@prueba.test')
  const r = await pedir({
    metodo: 'POST', ruta: '/periodos', cookie,
    campos: { accion: 'abrir', anio: '2028', mes: '1' },
  })
  assert.equal(r.codigo, 403)
})
