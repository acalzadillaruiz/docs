/**
 * Prueba de integración contra la base de datos real.
 *
 * No comprueba que la aplicación filtre bien. Comprueba que **aunque la aplicación
 * pida explícitamente los datos de otro cliente, no los recibe**. La diferencia
 * importa: lo primero depende de que nadie se equivoque nunca; lo segundo no.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { hojaDeValuacion, ValuacionNoAlcanzable } from '../src/dominio/valuacion.ts'

const DESTINO = process.env.NEXUS_DB
  ?? { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }

const GPS   = '0a1b2c3d-0000-0000-0000-00000000000a'
const OP_A  = '0a1b2c3d-0000-0000-0000-00000000000b'
const OP_B  = '0a1b2c3d-0000-0000-0000-00000000000c'
const YO    = '0a1b2c3d-0000-0000-0000-00000000000d'
const ING_A = '0a1b2c3d-0000-0000-0000-00000000000e'
const ING_B = '0a1b2c3d-0000-0000-0000-00000000000f'
const VAL_A = '0a1b2c3d-1111-0000-0000-00000000000a'
const VAL_B = '0a1b2c3d-1111-0000-0000-00000000000b'

before(async () => {
  conectar(DESTINO)
  // La semilla se monta como interno, que es quien puede escribir.
  await comoPersona({ id: YO }, 'nexus_interno', async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${GPS}','gps','GPS Energy','J-900000000-0'),
        ('${OP_A}','operadora','Operadora A','J-911111111-1'),
        ('${OP_B}','operadora','Operadora B','J-922222222-2')
        on conflict do nothing;
      insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto) values
        ('${YO}','${GPS}','yo@prueba.test','Interno','clave_2fa','(h)','(s)'),
        ('${ING_A}','${OP_A}','a@prueba.test','Ingeniero de A','clave_2fa','(h)','(s)'),
        ('${ING_B}','${OP_B}','b@prueba.test','Ingeniero de B','clave_2fa','(h)','(s)')
        on conflict do nothing;
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('0a1b2c3d-2222-0000-0000-00000000000a','2026-09-01', 36.50,'carga_manual')
        on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00)
        on conflict do nothing;
      insert into alicuota_igtf (vigente_desde, porcentaje) values ('2026-01-01', 3.00)
        on conflict do nothing;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('0a1b2c3d-2222-0000-0000-00000000000b','general', 16.00,'2018-01-02')
        on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01')
        on conflict do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, amortiza_pct, garantia_pct, creado_por) values
        ('0a1b2c3d-3333-0000-0000-00000000000a','${GPS}','${OP_A}','APP-A-001','servicio','De A','Of A',
         'vigente','VES', 20000000.00,'0a1b2c3d-2222-0000-0000-00000000000a', 20.00, 5.00,'${YO}'),
        ('0a1b2c3d-3333-0000-0000-00000000000b','${GPS}','${OP_B}','APP-B-001','servicio','De B','Of B',
         'vigente','VES', 20000000.00,'0a1b2c3d-2222-0000-0000-00000000000a', 20.00, 5.00,'${YO}')
        on conflict do nothing;
      insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                             obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
                             concepto_islr, ret_iva_pct, estado, aprobada_el, aprobada_por, creada_por) values
        ('${VAL_A}','${GPS}','0a1b2c3d-3333-0000-0000-00000000000a', 1,'2026-09-01','2026-09-30',
         1000000.00,'VES','0a1b2c3d-2222-0000-0000-00000000000a', 20.00, 5.00,
         '0a1b2c3d-2222-0000-0000-00000000000b','SERV-PJ', 75.00,'aprobada','2026-09-30','${YO}','${YO}'),
        ('${VAL_B}','${GPS}','0a1b2c3d-3333-0000-0000-00000000000b', 1,'2026-09-01','2026-09-30',
         2500000.00,'VES','0a1b2c3d-2222-0000-0000-00000000000a', 20.00, 5.00,
         '0a1b2c3d-2222-0000-0000-00000000000b','SERV-PJ', 75.00,'aprobada','2026-09-30','${YO}','${YO}')
        on conflict do nothing;
    `)
  })
})

after(async () => { await cerrar() })

test('de dentro se ve la hoja completa, con el neto calculado en la base de datos', async () => {
  const hoja = await comoPersona({ id: YO }, 'nexus_interno', (q) =>
    hojaDeValuacion(q, VAL_A, 'es', 'VES'),
  )
  assert.equal(hoja.length, 9)
  const neto = hoja.at(-1)!
  assert.equal(neto.concepto, 'Neto a cobrar')
  assert.equal(neto.total, true)
  assert.match(neto.monto, /740\.037,50/)
})

test('la misma hoja en inglés usa el vocabulario correcto y el formato anglosajón', async () => {
  const hoja = await comoPersona({ id: YO }, 'nexus_interno', (q) =>
    hojaDeValuacion(q, VAL_A, 'en', 'VES'),
  )
  assert.equal(hoja[0]!.concepto, 'Work executed in period')
  assert.equal(hoja.find((l) => l.orden === 5)!.concepto, 'Retention')
  assert.match(hoja.at(-1)!.monto, /740,037\.50/)
})

test('lo que resta viene marcado, para que la pantalla no tenga que interpretar signos', async () => {
  const hoja = await comoPersona({ id: YO }, 'nexus_interno', (q) =>
    hojaDeValuacion(q, VAL_A, 'es', 'VES'),
  )
  assert.equal(hoja.find((l) => l.orden === 4)!.resta, true)   // amortización
  assert.equal(hoja.find((l) => l.orden === 1)!.resta, false)  // obra ejecutada
})

test('el cliente de A ve su propia valuación', async () => {
  const hoja = await comoPersona({ id: ING_A }, 'nexus_cliente', (q) =>
    hojaDeValuacion(q, VAL_A, 'es', 'VES', true),
  )
  assert.match(hoja.at(-1)!.monto, /740\.037,50/)
})

test('el cliente de A pide la valuación de B por su identificador y NO la recibe', async () => {
  await assert.rejects(
    comoPersona({ id: ING_A }, 'nexus_cliente', (q) =>
      hojaDeValuacion(q, VAL_B, 'es', 'VES', true),
    ),
    ValuacionNoAlcanzable,
  )
})

test('el error no distingue entre "no existe" y "no es tuya"', async () => {
  // Decir "existe pero no es tuya" ya es contar algo sobre el contrato de otro.
  const inexistente = '0a1b2c3d-9999-0000-0000-000000000000'
  const errores: string[] = []
  for (const id of [VAL_B, inexistente]) {
    try {
      await comoPersona({ id: ING_A }, 'nexus_cliente', (q) =>
        hojaDeValuacion(q, id, 'es', 'VES', true),
      )
      assert.fail('debería haber fallado')
    } catch (e) {
      errores.push((e as Error).message)
    }
  }
  assert.equal(errores[0], errores[1])
})

test('la identidad no se queda pegada a la conexión entre peticiones', async () => {
  // Si una conexión devuelta al pozo conservara app.persona_id, la siguiente
  // petición heredaría los permisos de la anterior. Es el fallo clásico.
  await comoPersona({ id: ING_B }, 'nexus_cliente', (q) =>
    hojaDeValuacion(q, VAL_B, 'es', 'VES', true),
  )
  await assert.rejects(
    comoPersona({ id: ING_A }, 'nexus_cliente', (q) =>
      hojaDeValuacion(q, VAL_B, 'es', 'VES', true),
    ),
    ValuacionNoAlcanzable,
  )
})
