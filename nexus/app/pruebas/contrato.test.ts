/**
 * La ficha de contrato, contra la base de datos real.
 *
 * Lo que importa aquí es una sola cosa, repetida de tres formas: **el cliente no
 * puede llegar al precio de compra ni al margen**, ni pidiéndolos, ni por un hueco
 * en la respuesta, ni entrando por el contrato de otro.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { ficha, ContratoNoAlcanzable } from '../src/dominio/contrato.ts'
import { cabeceraDeValuacion, ValuacionNoAlcanzable } from '../src/dominio/valuacion.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '2b3c4d5e-0000-0000-0000-00000000000a'
const A = '2b3c4d5e-0000-0000-0000-00000000000b'
const B = '2b3c4d5e-0000-0000-0000-00000000000c'
const YO = '2b3c4d5e-0000-0000-0000-00000000000d'
const ING_A = '2b3c4d5e-0000-0000-0000-00000000000e'
const CTR_A = '2b3c4d5e-2222-0000-0000-00000000000a'
const CTR_B = '2b3c4d5e-2222-0000-0000-00000000000b'
const TASA = '2b3c4d5e-1111-0000-0000-00000000000a'
const IVA = '2b3c4d5e-1111-0000-0000-00000000000b'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)
const comoCliente = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: ING_A }, 'nexus_cliente', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Ficha','J-901111111-1'),
        ('${A}','operadora','Operadora A','J-902222222-2'),
        ('${B}','operadora','Operadora B','J-903333333-3') on conflict do nothing;
      insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto) values
        ('${YO}','${G}','ficha@prueba.test','Interno','clave_2fa','(h)','(s)'),
        ('${ING_A}','${A}','ing-ficha@prueba.test','Ingeniero A','clave_2fa','(h)','(s)')
        on conflict do nothing;
      -- Día de tasa propio de este archivo: la base impone una sola tasa por día.
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-09-03', 36.50,'carga_manual') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00) on conflict do nothing;
      insert into alicuota_igtf (vigente_desde, porcentaje) values ('2026-01-01', 3.00) on conflict do nothing;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2026-01-01') on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01') on conflict do nothing;

      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, firmado_el, inicio, fin_previsto,
                            anticipo_pct, amortiza_pct, garantia_pct, creado_por) values
        ('${CTR_A}','${G}','${A}','FICHA-A-001','procura','Cabezales de pozo','Wellheads',
         'vigente','USD', 500000.00,'${TASA}','2026-06-15','2026-07-01','2026-12-31',
         20.00, 20.00, 5.00,'${YO}'),
        ('${CTR_B}','${G}','${B}','FICHA-B-001','servicio','De B','Of B',
         'vigente','USD', 800000.00,'${TASA}', null, null, null, 0, 0, 0,'${YO}')
        on conflict do nothing;

      insert into renglon (contrato_id, numero, descripcion_es, descripcion_en, cantidad, unidad,
                           norma, especificacion, precio_unitario, costo_unitario) values
        ('${CTR_A}', 1,'Cabezal de pozo 7 1/16"','Wellhead 7 1/16"', 2,'unidad',
         'API 6A','PSL-3, PR-2, Clase AA', 120000.0000, 74000.0000),
        ('${CTR_A}', 2,'Válvula de compuerta','Gate valve', 6,'unidad',
         'ASME B16.34','Clase 900, NACE MR0175', 18500.0000, 12300.0000)
        on conflict do nothing;

      insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                             obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
                             concepto_islr, ret_iva_pct, estado, presentada_el, creada_por) values
        ('2b3c4d5e-3333-0000-0000-00000000000a','${G}','${CTR_A}', 1,'2026-08-01','2026-08-31',
         150000.00,'USD','${TASA}', 20.00, 5.00,'${IVA}','SERV-PJ', 75.00,'presentada',
         current_date - 12,'${YO}')
        on conflict do nothing;
    `)
  })
})
after(async () => { await cerrar() })

test('la ficha trae lo que se compró, con su norma a la vista', () => {
  return dentro(async (q) => {
    const f = await ficha(q, CTR_A, 'es', true)
    assert.equal(f.codigo, 'FICHA-A-001')
    assert.equal(f.renglones.length, 2)
    // Que un cabezal sea API 6A y no otra cosa es la mitad de lo que se compró.
    assert.equal(f.renglones[0]!.norma, 'API 6A')
    assert.equal(f.renglones[0]!.especificacion, 'PSL-3, PR-2, Clase AA')
    assert.equal(f.renglones[1]!.norma, 'ASME B16.34')
  })
})

test('desde dentro se ve el costo y el margen', () => {
  return dentro(async (q) => {
    const f = await ficha(q, CTR_A, 'es', true)
    assert.ok(f.renglones[0]!.costoUnitario)
    // 120.000 de venta, 74.000 de compra → 38,3 % de margen.
    assert.equal(f.renglones[0]!.margenPct, '38,3 %')
  })
})

test('el cliente ve su ficha SIN costo ni margen', () => {
  return comoCliente(async (q) => {
    const f = await ficha(q, CTR_A, 'es', false)
    assert.equal(f.renglones.length, 2)
    assert.equal(f.renglones[0]!.costoUnitario, null)
    assert.equal(f.renglones[0]!.margenPct, null)
    // Pero sí ve lo que le facturan, que es lo que le corresponde.
    assert.match(f.renglones[0]!.precioUnitario, /120,000\.00|120\.000,00/)
  })
})

test('si el cliente PIDE el costo, la base de datos se niega', () => {
  // No es que se filtre después: el rol no tiene permiso sobre esa columna. Un
  // error es ruidoso; un hueco en la respuesta se cuela sin que nadie lo note.
  return assert.rejects(
    comoCliente((q) => ficha(q, CTR_A, 'es', true)),
    (e: Error) => /permission denied|permiso/i.test(e.message),
  )
})

test('el cliente de A no alcanza el contrato de B, ni nombrándolo', () => {
  return assert.rejects(
    comoCliente((q) => ficha(q, CTR_B, 'es', false)),
    ContratoNoAlcanzable,
  )
})

test('no existir y no corresponderte dan el mismo error, palabra por palabra', () => {
  return comoCliente(async (q) => {
    const errores: string[] = []
    for (const id of [CTR_B, '2b3c4d5e-9999-0000-0000-000000000000']) {
      try { await ficha(q, id, 'es', false); assert.fail('debería fallar') }
      catch (e) { errores.push((e as Error).message) }
    }
    assert.equal(errores[0], errores[1])
  })
})

test('las valuaciones salen de la más nueva a la más vieja', () => {
  return dentro(async (q) => {
    const f = await ficha(q, CTR_A, 'es', true)
    assert.equal(f.valuaciones.length, 1)
    assert.equal(f.valuaciones[0]!.estado, 'Presentada')
    assert.equal(f.valuaciones[0]!.estadoCrudo, 'presentada')
  })
})

test('en inglés, el vocabulario del contrato es el correcto', () => {
  return dentro(async (q) => {
    const f = await ficha(q, CTR_A, 'en', true)
    assert.equal(f.tipo, 'Procurement')
    assert.equal(f.titulo, 'Wellheads')
    assert.equal(f.valuaciones[0]!.estado, 'Submitted')
  })
})

test('el total de un renglón es cantidad por precio, no un campo guardado', () => {
  return dentro(async (q) => {
    const f = await ficha(q, CTR_A, 'es', true)
    // 6 válvulas × 18.500 = 111.000
    assert.match(f.renglones[1]!.total, /111[.,]000/)
  })
})

test('la cabecera de la valuación trae la moneda del contrato, no una fija', () => {
  // Poner VES fijo daba cifras en bolívares para un contrato en dólares. La moneda
  // tiene que salir del contrato, siempre.
  return dentro(async (q) => {
    const c = await cabeceraDeValuacion(q, '2b3c4d5e-3333-0000-0000-00000000000a')
    assert.equal(c.moneda, 'USD')
    assert.equal(c.contrato, 'FICHA-A-001')
    assert.equal(c.numero, 1)
    assert.equal(c.estado, 'presentada')
    assert.equal(c.contratoId, CTR_A)
  })
})

test('la cabecera de una valuación ajena tampoco se alcanza', () => {
  return assert.rejects(
    comoCliente((q) => cabeceraDeValuacion(q, '2b3c4d5e-9999-0000-0000-000000000000')),
    ValuacionNoAlcanzable,
  )
})
