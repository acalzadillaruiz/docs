/**
 * El circuito entero, de punta a punta, por HTTP y sin tocar la base de datos.
 *
 * Es la prueba que contesta la única pregunta que importa: ¿esto se puede usar?
 *
 * Camino completo, como lo recorrería una persona de GPS y otra de la operadora:
 * dar de alta el contrato → ponerlo en vigor → subir el certificado → verificarlo →
 * ver subir el avance → proponer la valuación desde lo verificado → presentarla →
 * que el cliente la objete → responder → que apruebe.
 *
 * Si esta prueba pasa, el sistema sirve. Si falla, da igual lo que digan las demás.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { configurarAlmacen } from '../src/servidor/almacen.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'
import { testigoAnti } from '../src/servidor/csrf.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '3a4b5c6d-0000-0000-0000-00000000000a'
const C = '3a4b5c6d-0000-0000-0000-00000000000b'
const YO = '3a4b5c6d-0000-0000-0000-00000000000d'
const ING = '3a4b5c6d-0000-0000-0000-00000000000e'
const TASA = '3a4b5c6d-1111-0000-0000-00000000000a'
const IVA = '3a4b5c6d-1111-0000-0000-00000000000b'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLAVE = 'una clave razonable'

let raiz = ''
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

before(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'nexus-circuito-'))
  configurarAlmacen(raiz)
  conectar(DESTINO)
  const hash = await cifrarClave(CLAVE)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Circuito','J-994444444-4'),
        ('${C}','operadora','Petrolera Circuito','J-995555555-5')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'circ@prueba.test','Ingeniero GPS','clave_2fa', ${hash}, ${SECRETO}),
                   (${ING}, ${C},'circ-cli@prueba.test','Ingeniera Operadora','clave_2fa', ${hash}, ${SECRETO})
            on conflict (id) do update set clave_hash = excluded.clave_hash`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-09-15', 36.50,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2026-01-01') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00)
        on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut,
                                 minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01')
        on conflict do nothing;
    `)
  })
})
after(async () => {
  await cerrar()
  await rm(raiz, { recursive: true, force: true })
})

test('de dar de alta un contrato a que el cliente lo apruebe, sin tocar la base de datos', async () => {
  const gps = await entrar('circ@prueba.test')
  const afG = testigoAnti(gps)
  const codigo = `CIRC-${Date.now() % 1000000}`

  // ---------------------------------------------------------------- 1. el alta
  const alta = await pedir({
    metodo: 'POST', ruta: '/contratos/nuevo', cookie: gps,
    campos: {
      af: afG, accion: 'crear', cliente: C, codigo, tipo: 'procura',
      titulo_es: 'Cabezales de pozo', titulo_en: 'Wellheads', moneda: 'USD',
      inicio: '2026-01-01', fin_previsto: '2026-12-31',
      anticipo_pct: '0', amortiza_pct: '0', garantia_pct: '5', filas: '3',
    },
    repetidos: {
      r_desc_es: ['Cabezal 11" 5M', '', ''],
      r_desc_en: ['11" 5M wellhead', '', ''],
      r_cantidad: ['2', '', ''], r_unidad: ['unidad', '', ''],
      r_norma: ['API 6A PSL-3', '', ''], r_espec: ['', '', ''],
      r_precio: ['100000', '', ''], r_costo: ['62000', '', ''],
    },
  })
  assert.equal(alta.codigo, 303, 'el contrato se crea')
  const rutaContrato = alta.cabeceras!['Location']!
  const contratoId = rutaContrato.split('/').pop()!

  // Nació en borrador, con sus cinco hitos, y el cliente todavía no lo ve.
  const cli = await entrar('circ-cli@prueba.test')
  assert.equal((await pedir({ ruta: rutaContrato, cookie: cli })).codigo, 404)

  // ---------------------------------------------------- 2. ponerlo en vigor
  const activo = await pedir({
    metodo: 'POST', ruta: `${rutaContrato}/activar`, cookie: gps, campos: { af: afG },
  })
  assert.equal(activo.codigo, 303)
  assert.equal((await pedir({ ruta: rutaContrato, cookie: cli })).codigo, 200,
    'ahora el cliente sí lo ve')

  // El avance arranca en cero y se puede abrir para ver por qué.
  const [renglon] = (await dentro((q) => q`
    select id from renglon where contrato_id = ${contratoId}::uuid
  `)) as unknown as Array<{ id: string }>
  const avance0 = await pedir({ ruta: `/renglones/${renglon!.id}`, cookie: gps })
  assert.match(avance0.cuerpo!, /class="ba-v" style="width:0%"/)

  // ------------------------------------------------- 3. subir el certificado
  const [hito] = (await dentro((q) => q`
    select id from hito where renglon_id = ${renglon!.id}::uuid and clave = 'fabricado'
  `)) as unknown as Array<{ id: string }>

  const subida = await pedir({
    metodo: 'POST', ruta: `/hitos/${hito!.id}/evidencia`, cookie: gps,
    campos: { af: afG, clase: 'certificado', ocurrido_en: '2026-06-15',
              volver: `/renglones/${renglon!.id}` },
    archivo: { archivo: 'MTR-colada-44821.pdf', tipoMime: 'application/pdf',
               contenido: new TextEncoder().encode('%PDF certificado de colada 44821') },
  })
  assert.equal(subida.codigo, 303)

  // Con el papel subido pero sin revisar, el avance SIGUE en cero.
  const avance1 = await pedir({ ruta: `/renglones/${renglon!.id}`, cookie: gps })
  assert.match(avance1.cuerpo!, /class="ba-v" style="width:0%"/)
  assert.match(avance1.cuerpo!, /Con documento, sin revisar/)

  // Y no hay nada que facturar todavía: lo evidenciado no es lo verificado.
  const sinFacturar = await pedir({ ruta: `${rutaContrato}/valuar`, cookie: gps })
  assert.match(sinFacturar.cuerpo!, /Sin evidencia no se factura/)

  // ----------------------------------------------------- 4. verificarlo
  const [evi] = (await dentro((q) => q`
    select id from evidencia where hito_id = ${hito!.id}::uuid
  `)) as unknown as Array<{ id: string }>
  assert.equal((await pedir({
    metodo: 'POST', ruta: `/evidencia/${evi!.id}/verificar`, cookie: gps,
    campos: { af: afG, volver: `/renglones/${renglon!.id}` },
  })).codigo, 303)

  // Ahora sí: el avance sube al peso del hito, y el cliente lo puede auditar.
  const avance2 = await pedir({ ruta: `/renglones/${renglon!.id}`, cookie: cli })
  assert.match(avance2.cuerpo!, /class="ba-v" style="width:30%/)
  assert.match(avance2.cuerpo!, /MTR-colada-44821\.pdf/)

  // -------------------------------------- 5. la valuación, desde lo verificado
  const propuesta = await pedir({ ruta: `${rutaContrato}/valuar`, cookie: gps })
  assert.equal(propuesta.codigo, 200)
  // 30% de 200.000 = 60.000. Nadie ha tecleado esa cifra.
  assert.match(propuesta.cuerpo!, /60\.000,00/)
  assert.match(propuesta.cuerpo!, /fabricado/)
  assert.equal(propuesta.cuerpo!.includes('name="obra"'), false)

  const emitida = await pedir({
    metodo: 'POST', ruta: `${rutaContrato}/valuar`, cookie: gps,
    campos: { af: afG, desde: '2026-06-01', hasta: '2026-06-30' },
  })
  assert.equal(emitida.codigo, 303)
  const rutaVal = emitida.cabeceras!['Location']!

  // En borrador el cliente todavía no la ve.
  assert.equal((await pedir({ ruta: rutaVal, cookie: cli })).codigo, 404)

  // ---------------------------------------------------- 6. presentarla
  assert.equal((await pedir({
    metodo: 'POST', ruta: `${rutaVal}/presentar`, cookie: gps, campos: { af: afG },
  })).codigo, 303)

  const hoja = await pedir({ ruta: rutaVal, cookie: cli })
  assert.equal(hoja.codigo, 200)
  assert.match(hoja.cuerpo!, /60\.000,00/)

  // Y al cliente se le ha encolado el aviso, sin que nadie se acuerde de nada.
  const [val] = (await dentro((q) => q`
    select id from valuacion where contrato_id = ${contratoId}::uuid
  `)) as unknown as Array<{ id: string }>
  const avisos = (await dentro(async (q) => {
    await q.unsafe('set local role none')
    return q`select tipo::text from aviso where sobre_id = ${val!.id}::uuid`
  })) as unknown as Array<{ tipo: string }>
  assert.ok(avisos.some((a) => a.tipo === 'valuacion_presentada'))

  // ------------------------------------------------ 7. el cliente objeta
  const afC = testigoAnti(cli)
  assert.equal((await pedir({
    metodo: 'POST', ruta: `${rutaVal}/objetar`, cookie: cli,
    campos: { af: afC, motivo: 'El certificado no corresponde a la colada del cabezal' },
  })).codigo, 303)

  // A GPS le entra en la bandeja, sin tener que acordarse de mirar.
  const bandeja = await pedir({ ruta: '/', cookie: gps })
  assert.match(bandeja.cuerpo!, /Objeción sin responder/)

  // -------------------------------------------- 8. GPS responde, el cliente aprueba
  const [obj] = (await dentro((q) => q`
    select id from objecion where valuacion_id = ${val!.id}::uuid
  `)) as unknown as Array<{ id: string }>
  assert.equal((await pedir({
    metodo: 'POST', ruta: `/objeciones/${obj!.id}/responder`, cookie: gps,
    campos: { af: afG, respuesta: 'Revisado: la colada 44821 es la del cabezal 2',
              volver: rutaVal },
  })).codigo, 303)

  assert.equal((await pedir({
    metodo: 'POST', ruta: `${rutaVal}/aprobar`, cookie: cli, campos: { af: afC },
  })).codigo, 303)

  // Y si el cliente vuelve a pulsar «Aprobar» —porque tenía la página abierta desde
  // antes, que es lo que pasa de verdad— se le DICE. Antes se le contestaba con una
  // página en blanco, y el cliente no tiene a quién preguntarle qué acaba de pasar.
  const otra = await pedir({
    metodo: 'POST', ruta: `${rutaVal}/aprobar`, cookie: cli, campos: { af: afC },
  })
  assert.equal(otra.codigo, 303)
  assert.match(otra.cabeceras!['Location']!, /fallo=estado_equivocado/)
  const conAviso = await pedir({
    ruta: rutaVal, cookie: cli, campos: { fallo: 'estado_equivocado' },
  })
  assert.equal(conAviso.codigo, 200)
  assert.match(conAviso.cuerpo!, /mientras tenías la página abierta/)
  assert.equal(conAviso.cuerpo!.includes('‹falta:'), false)

  const [final] = (await dentro((q) => q`
    select estado::text, aprobada_por, origen_obra, obra::text
      from valuacion where id = ${val!.id}::uuid
  `)) as unknown as Array<Record<string, string>>
  assert.equal(final!['estado'], 'aprobada')
  assert.equal(final!['aprobada_por'], ING, 'firmó el cliente, no GPS')
  assert.equal(final!['origen_obra'], 'hitos_evidenciados')
  assert.equal(final!['obra'], '60000.00')
})

test('y del cobro al cierre: la cuenta por cobrar baja sola, por el navegador', async () => {
  const gps = await entrar('circ@prueba.test')
  const afG = testigoAnti(gps)
  const cli = await entrar('circ-cli@prueba.test')
  const afC = testigoAnti(cli)

  // El libro necesita su plan de cuentas y su mes abierto. Sin eso no hay dónde
  // asentar, y un cobro sin asentar parece que cuenta y no cuenta.
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`select instalar_plan_cuentas(${G}::uuid)`
    await q`insert into periodo (organizacion_id, anio, mes)
            values (${G}::uuid, extract(year from current_date)::int,
                    extract(month from current_date)::int)
            on conflict do nothing`
  })

  // Un contrato nuevo, su hito verificado, su valuación aprobada.
  const codigo = `CIRC-COB-${Date.now() % 1000000}`
  const alta = await pedir({
    metodo: 'POST', ruta: '/contratos/nuevo', cookie: gps,
    campos: { af: afG, accion: 'crear', cliente: C, codigo, tipo: 'servicio',
              titulo_es: 'Cuadrilla', titulo_en: 'Crew', moneda: 'VES',
              anticipo_pct: '0', amortiza_pct: '0', garantia_pct: '0', filas: '3' },
    repetidos: {
      r_desc_es: ['Cuadrilla', '', ''], r_desc_en: ['Crew', '', ''],
      r_cantidad: ['1', '', ''], r_unidad: ['mes', '', ''],
      r_norma: ['', '', ''], r_espec: ['', '', ''],
      r_precio: ['100000', '', ''], r_costo: ['60000', '', ''],
    },
  })
  const rutaContrato = alta.cabeceras!['Location']!
  const contratoId = rutaContrato.split('/').pop()!
  await pedir({ metodo: 'POST', ruta: `${rutaContrato}/activar`, cookie: gps, campos: { af: afG } })

  // Se verifica el hito de movilización (10% de 100.000 = 10.000).
  const [hito] = (await dentro((q) => q`
    select h.id from hito h join renglon rg on rg.id = h.renglon_id
     where rg.contrato_id = ${contratoId}::uuid and h.clave = 'movilizacion'
  `)) as unknown as Array<{ id: string }>
  await pedir({
    metodo: 'POST', ruta: `/hitos/${hito!.id}/evidencia`, cookie: gps,
    campos: { af: afG, clase: 'acta', ocurrido_en: '2026-09-10' },
    archivo: { archivo: 'acta.pdf', tipoMime: 'application/pdf',
               contenido: new TextEncoder().encode('%PDF acta de movilizacion') },
  })
  const [evi] = (await dentro((q) => q`
    select id from evidencia where hito_id = ${hito!.id}::uuid
  `)) as unknown as Array<{ id: string }>
  await pedir({
    metodo: 'POST', ruta: `/evidencia/${evi!.id}/verificar`, cookie: gps, campos: { af: afG },
  })

  const hoy = new Date().toISOString().slice(0, 10)
  const emitida = await pedir({
    metodo: 'POST', ruta: `${rutaContrato}/valuar`, cookie: gps,
    campos: { af: afG, desde: '2026-09-01', hasta: hoy },
  })
  const rutaVal = emitida.cabeceras!['Location']!
  await pedir({ metodo: 'POST', ruta: `${rutaVal}/presentar`, cookie: gps, campos: { af: afG } })
  await pedir({ metodo: 'POST', ruta: `${rutaVal}/aprobar`, cookie: cli, campos: { af: afC } })

  // La pantalla de cobro enseña lo que queda, y el cliente no llega a ella.
  const cobro = await pedir({ ruta: `${rutaVal}/cobrar`, cookie: gps })
  assert.equal(cobro.codigo, 200)
  assert.match(cobro.cuerpo!, /class="saldo/)
  assert.equal((await pedir({ ruta: `${rutaVal}/cobrar`, cookie: cli })).codigo, 404)

  const valId = rutaVal.split('/').pop()!
  const [antes] = (await dentro((q) => q`
    select saldo_valuacion(${valId}::uuid)::text as s
  `)) as unknown as Array<{ s: string }>
  assert.ok(Number(antes!.s) > 0)

  const registrado = await pedir({
    metodo: 'POST', ruta: `${rutaVal}/cobrar`, cookie: gps,
    campos: { af: afG, monto: antes!.s, fecha: hoy, medio: 'transferencia',
              referencia: 'TRF-CIRC' },
  })
  assert.equal(registrado.codigo, 303)

  // La cuenta por cobrar queda en cero SOLA, y la valuación en cobrada.
  const [despues] = (await dentro((q) => q`
    select saldo_valuacion(${valId}::uuid)::text as s,
           (select estado::text from valuacion where id = ${valId}::uuid) as estado,
           (select asiento_id from cobro where valuacion_id = ${valId}::uuid limit 1) as asiento
  `)) as unknown as Array<{ s: string; estado: string; asiento: string | null }>
  assert.equal(Number(despues!.s), 0)
  assert.equal(despues!.estado, 'cobrada')
  assert.notEqual(despues!.asiento, null, 'el cobro quedó asentado, no solo registrado')
})

test('la factura se emite con su correlativo, y el cliente la ve en su valuación', async () => {
  const gps = await entrar('circ@prueba.test')
  const afG = testigoAnti(gps)
  const cli = await entrar('circ-cli@prueba.test')
  const afC = testigoAnti(cli)

  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`select instalar_plan_cuentas(${G}::uuid)`
    await q`insert into periodo (organizacion_id, anio, mes)
            values (${G}::uuid, extract(year from current_date)::int,
                    extract(month from current_date)::int)
            on conflict do nothing`
  })

  const codigo = `CIRC-FAC-${Date.now() % 1000000}`
  const alta = await pedir({
    metodo: 'POST', ruta: '/contratos/nuevo', cookie: gps,
    campos: { af: afG, accion: 'crear', cliente: C, codigo, tipo: 'servicio',
              titulo_es: 'Cuadrilla', titulo_en: 'Crew', moneda: 'VES',
              anticipo_pct: '0', amortiza_pct: '0', garantia_pct: '0', filas: '3' },
    repetidos: {
      r_desc_es: ['Cuadrilla', '', ''], r_desc_en: ['Crew', '', ''],
      r_cantidad: ['1', '', ''], r_unidad: ['mes', '', ''],
      r_norma: ['', '', ''], r_espec: ['', '', ''],
      r_precio: ['100000', '', ''], r_costo: ['60000', '', ''],
    },
  })
  const rutaContrato = alta.cabeceras!['Location']!
  const contratoId = rutaContrato.split('/').pop()!
  await pedir({ metodo: 'POST', ruta: `${rutaContrato}/activar`, cookie: gps, campos: { af: afG } })

  const [hito] = (await dentro((q) => q`
    select h.id from hito h join renglon rg on rg.id = h.renglon_id
     where rg.contrato_id = ${contratoId}::uuid and h.clave = 'movilizacion'
  `)) as unknown as Array<{ id: string }>
  await pedir({
    metodo: 'POST', ruta: `/hitos/${hito!.id}/evidencia`, cookie: gps,
    campos: { af: afG, clase: 'acta', ocurrido_en: '2026-09-10' },
    archivo: { archivo: 'acta.pdf', tipoMime: 'application/pdf',
               contenido: new TextEncoder().encode('%PDF acta para facturar') },
  })
  const [evi] = (await dentro((q) => q`
    select id from evidencia where hito_id = ${hito!.id}::uuid
  `)) as unknown as Array<{ id: string }>
  await pedir({
    metodo: 'POST', ruta: `/evidencia/${evi!.id}/verificar`, cookie: gps, campos: { af: afG },
  })

  const hoy = new Date().toISOString().slice(0, 10)
  const emitida = await pedir({
    metodo: 'POST', ruta: `${rutaContrato}/valuar`, cookie: gps,
    campos: { af: afG, desde: '2026-09-01', hasta: hoy },
  })
  const rutaVal = emitida.cabeceras!['Location']!
  await pedir({ metodo: 'POST', ruta: `${rutaVal}/presentar`, cookie: gps, campos: { af: afG } })

  // Antes de que el cliente apruebe, no se factura — y se DICE por qué, en la hoja,
  // en vez de contestar con una página en blanco.
  const pronto = await pedir({
    metodo: 'POST', ruta: `${rutaVal}/facturar`, cookie: gps, campos: { af: afG },
  })
  assert.equal(pronto.codigo, 303)
  assert.match(pronto.cabeceras!['Location']!, /fallo=facturar\.error\.sin_aprobar/)
  const dicho = await pedir({
    ruta: rutaVal, cookie: gps, campos: { fallo: 'facturar.error.sin_aprobar' },
  })
  assert.match(dicho.cuerpo!, /aprobada por el cliente/)

  await pedir({ metodo: 'POST', ruta: `${rutaVal}/aprobar`, cookie: cli, campos: { af: afC } })

  const facturada = await pedir({
    metodo: 'POST', ruta: `${rutaVal}/facturar`, cookie: gps, campos: { af: afG },
  })
  assert.equal(facturada.codigo, 303)

  // El número va a la vista: es lo que el cliente escribe en su transferencia.
  const hoja = await pedir({ ruta: rutaVal, cookie: cli })
  assert.match(hoja.cuerpo!, /class="factura"/)
  assert.match(hoja.cuerpo!, /\d{8}/)

  // Y no se factura dos veces: se corrige con una nota de crédito, y eso se lee.
  const otraVez = await pedir({
    metodo: 'POST', ruta: `${rutaVal}/facturar`, cookie: gps, campos: { af: afG },
  })
  assert.equal(otraVez.codigo, 303)
  assert.match(otraVez.cabeceras!['Location']!, /fallo=facturar\.error\.ya/)

  // El cliente no factura: una factura que emite quien la recibe no es una factura.
  assert.equal((await pedir({
    metodo: 'POST', ruta: `${rutaVal}/facturar`, cookie: cli, campos: { af: afC },
  })).codigo, 404)
})

test('corregir una factura con una nota: la factura no se toca y las dos quedan', async () => {
  const gps = await entrar('circ@prueba.test')
  const afG = testigoAnti(gps)
  const cli = await entrar('circ-cli@prueba.test')
  const afC = testigoAnti(cli)

  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`select instalar_plan_cuentas(${G}::uuid)`
    await q`insert into periodo (organizacion_id, anio, mes)
            values (${G}::uuid, extract(year from current_date)::int,
                    extract(month from current_date)::int)
            on conflict do nothing`
  })

  const codigo = `CIRC-NOT-${Date.now() % 1000000}`
  const alta = await pedir({
    metodo: 'POST', ruta: '/contratos/nuevo', cookie: gps,
    campos: { af: afG, accion: 'crear', cliente: C, codigo, tipo: 'servicio',
              titulo_es: 'Cuadrilla', titulo_en: 'Crew', moneda: 'VES',
              anticipo_pct: '0', amortiza_pct: '0', garantia_pct: '0', filas: '3' },
    repetidos: {
      r_desc_es: ['Cuadrilla', '', ''], r_desc_en: ['Crew', '', ''],
      r_cantidad: ['1', '', ''], r_unidad: ['mes', '', ''],
      r_norma: ['', '', ''], r_espec: ['', '', ''],
      r_precio: ['100000', '', ''], r_costo: ['60000', '', ''],
    },
  })
  const rutaContrato = alta.cabeceras!['Location']!
  const contratoId = rutaContrato.split('/').pop()!
  await pedir({ metodo: 'POST', ruta: `${rutaContrato}/activar`, cookie: gps, campos: { af: afG } })

  const [hito] = (await dentro((q) => q`
    select h.id from hito h join renglon rg on rg.id = h.renglon_id
     where rg.contrato_id = ${contratoId}::uuid and h.clave = 'movilizacion'
  `)) as unknown as Array<{ id: string }>
  await pedir({
    metodo: 'POST', ruta: `/hitos/${hito!.id}/evidencia`, cookie: gps,
    campos: { af: afG, clase: 'acta', ocurrido_en: '2026-09-10' },
    archivo: { archivo: 'acta.pdf', tipoMime: 'application/pdf',
               contenido: new TextEncoder().encode('%PDF acta para la nota') },
  })
  const [evi] = (await dentro((q) => q`
    select id from evidencia where hito_id = ${hito!.id}::uuid
  `)) as unknown as Array<{ id: string }>
  await pedir({
    metodo: 'POST', ruta: `/evidencia/${evi!.id}/verificar`, cookie: gps, campos: { af: afG },
  })

  const hoy = new Date().toISOString().slice(0, 10)
  const emitida = await pedir({
    metodo: 'POST', ruta: `${rutaContrato}/valuar`, cookie: gps,
    campos: { af: afG, desde: '2026-09-01', hasta: hoy },
  })
  const rutaVal = emitida.cabeceras!['Location']!
  await pedir({ metodo: 'POST', ruta: `${rutaVal}/presentar`, cookie: gps, campos: { af: afG } })
  await pedir({ metodo: 'POST', ruta: `${rutaVal}/aprobar`, cookie: cli, campos: { af: afC } })
  await pedir({ metodo: 'POST', ruta: `${rutaVal}/facturar`, cookie: gps, campos: { af: afG } })

  // Una nota de crédito de 2.000 sobre una factura de 10.000 (10% de 100.000).
  const nota = await pedir({
    metodo: 'POST', ruta: `${rutaVal}/nota`, cookie: gps,
    campos: { af: afG, tipo: 'nota_credito', base: '2000',
              motivo: 'El cliente rechazó medio día de cuadrilla' },
  })
  assert.equal(nota.codigo, 303)

  const hoja = await pedir({ ruta: rutaVal, cookie: gps })
  assert.match(hoja.cuerpo!, /El cliente rechazó medio día de cuadrilla/)
  assert.match(hoja.cuerpo!, /class="menos"/)
  assert.match(hoja.cuerpo!, /Queda facturado/)

  // Devolver más de lo que queda no pasa: una base negativa no significa nada.
  const pasada = await pedir({
    metodo: 'POST', ruta: `${rutaVal}/nota`, cookie: gps,
    campos: { af: afG, tipo: 'nota_credito', base: '999999', motivo: 'de más' },
  })
  assert.equal(pasada.codigo, 303)
  assert.match(pasada.cabeceras!['Location']!, /fallo=nota\.error\.pasa/)

  // Y sin motivo tampoco: una nota sin motivo no explica nada.
  const sinMotivo = await pedir({
    metodo: 'POST', ruta: `${rutaVal}/nota`, cookie: gps,
    campos: { af: afG, tipo: 'nota_credito', base: '100', motivo: '   ' },
  })
  assert.equal(sinMotivo.codigo, 303)
  assert.match(sinMotivo.cabeceras!['Location']!, /fallo=nota\.error\.motivo/)
  const leido = await pedir({ ruta: rutaVal, cookie: gps, campos: { fallo: 'nota.error.motivo' } })
  assert.match(leido.cuerpo!, /no explica nada/)

  // El cliente no corrige la factura que recibe.
  assert.equal((await pedir({
    metodo: 'POST', ruta: `${rutaVal}/nota`, cookie: cli,
    campos: { af: afC, tipo: 'nota_credito', base: '100', motivo: 'x' },
  })).codigo, 404)

  // La factura original sigue intacta: las dos quedan en el libro.
  const [f] = (await dentro((q) => q`
    select df.base_ves::text as base,
           (select count(*)::int from documento_fiscal n where n.afecta_a = df.id) as notas
      from documento_fiscal df join valuacion v on v.documento_id = df.id
     where v.contrato_id = ${contratoId}::uuid
  `)) as unknown as Array<{ base: string; notas: number }>
  assert.equal(Number(f!.base), 10000)
  assert.equal(f!.notas, 1)
})

test('no poder poner un contrato en vigor se DICE, no se contesta con una página en blanco', async () => {
  // El motivo estaba escrito en el diccionario desde el primer día —«hay renglones
  // sin hitos, y su avance se quedaría en cero para siempre»— y la ruta contestaba
  // 409 con el cuerpo vacío. Quien pulsaba el botón veía una página en blanco y no
  // tenía forma de saber qué había pasado.
  const gps = await entrar('circ@prueba.test')
  const afG = testigoAnti(gps)
  const codigo = `CIRC-SH-${Date.now() % 1000000}`

  const alta = await pedir({
    metodo: 'POST', ruta: '/contratos/nuevo', cookie: gps,
    campos: {
      af: afG, accion: 'crear', cliente: C, codigo, tipo: 'servicio',
      titulo_es: 'Sin hitos', titulo_en: 'No milestones', moneda: 'VES',
      inicio: '2026-01-01', fin_previsto: '2026-06-30',
      anticipo_pct: '0', amortiza_pct: '0', garantia_pct: '0', filas: '1',
    },
    repetidos: {
      r_desc_es: ['Servicio suelto'], r_desc_en: ['Loose service'],
      r_cantidad: ['1'], r_unidad: ['servicio'],
      r_norma: [''], r_espec: [''], r_precio: ['5000'], r_costo: ['3000'],
    },
  })
  assert.equal(alta.codigo, 303)
  const rutaContrato = alta.cabeceras!['Location']!
  const id = rutaContrato.split('/').pop()!

  // Se le quitan los hitos que el alta le puso, que es la situación real: un renglón
  // que no casa con ninguna plantilla se queda sin ellos.
  await dentro((q) => q`
    delete from hito where renglon_id in (
      select id from renglon where contrato_id = ${id}::uuid)`)

  const intento = await pedir({
    metodo: 'POST', ruta: `${rutaContrato}/activar`, cookie: gps, campos: { af: afG },
  })
  assert.equal(intento.codigo, 303, 'vuelve a la ficha, no a una página en blanco')
  const vuelta = intento.cabeceras!['Location']!
  assert.match(vuelta, /\?fallo=sin_hitos$/)

  const ficha = await pedir({ ruta: rutaContrato, cookie: gps, campos: { fallo: 'sin_hitos' } })
  assert.equal(ficha.codigo, 200)
  assert.match(ficha.cuerpo!, /sin hitos/)
  assert.equal(ficha.cuerpo!.includes('‹falta:'), false)

  // Y lo que llegue por la dirección no se pinta tal cual: se comprueba contra la
  // lista de motivos. Si no, cualquiera escribe el texto que quiera en la pantalla.
  const inventado = await pedir({
    ruta: rutaContrato, cookie: gps, campos: { fallo: '<b>lo que yo quiera</b>' },
  })
  assert.equal(inventado.codigo, 200)
  assert.equal(inventado.cuerpo!.includes('lo que yo quiera'), false)

  // Y sigue en borrador: el cliente no lo ve.
  const [c] = (await dentro((q) => q`
    select estado::text from contrato where id = ${id}::uuid
  `)) as unknown as Array<{ estado: string }>
  assert.equal(c!.estado, 'borrador')
})
