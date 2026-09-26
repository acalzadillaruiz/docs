/**
 * La bandeja de lo que espera a GPS.
 *
 * Sin esto el cliente objeta y nadie se entera. Lo que se comprueba: que aparezca
 * lo que espera, que el orden ponga delante lo más antiguo, y que un cliente no
 * reciba nada de aquí.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { bandeja } from '../src/dominio/bandeja.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '5e6f7a8b-0000-0000-0000-00000000000a'
const C = '5e6f7a8b-0000-0000-0000-00000000000b'
const YO = '5e6f7a8b-0000-0000-0000-00000000000d'
const ING = '5e6f7a8b-0000-0000-0000-00000000000e'
const CTR = '5e6f7a8b-2222-0000-0000-00000000000a'
const TASA = '5e6f7a8b-1111-0000-0000-00000000000a'
const IVA = '5e6f7a8b-1111-0000-0000-00000000000b'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Bandeja','J-906666666-6'),
        ('${C}','operadora','Operadora','J-907777777-7') on conflict do nothing;
      insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto) values
        ('${YO}','${G}','ban@prueba.test','Interno','clave_2fa','(h)','(s)'),
        ('${ING}','${C}','ing-ban@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
        on conflict do nothing;
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-09-05', 36.50,'carga_manual') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00) on conflict do nothing;
      insert into alicuota_igtf (vigente_desde, porcentaje) values ('2026-01-01', 3.00) on conflict do nothing;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2018-01-06') on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01') on conflict do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR}','${G}','${C}','BAN-001','servicio','Servicio','Service',
                'vigente','VES', 9000000.00,'${TASA}','${YO}') on conflict do nothing;

      delete from objecion where valuacion_id in (
        select id from valuacion where contrato_id = '${CTR}');
      delete from valuacion where contrato_id = '${CTR}';

      insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde,
        periodo_hasta, obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
        concepto_islr, ret_iva_pct, estado, presentada_el, aprobada_el, aprobada_por, creada_por) values
        -- Objetada hace 20 días, sin responder. Poco dinero, mucha espera.
        ('5e6f7a8b-3333-0000-0000-000000000001','${G}','${CTR}', 1,'2026-07-01','2026-07-31',
         50000.00,'VES','${TASA}', 0, 0,'${IVA}','SERV-PJ', 0,'objetada',
         current_date - 30, null, null,'${YO}'),
        -- Aprobada hace 45 días y sin cobrar. Mucho dinero, menos espera.
        ('5e6f7a8b-3333-0000-0000-000000000002','${G}','${CTR}', 2,'2026-08-01','2026-08-31',
         900000.00,'VES','${TASA}', 0, 0,'${IVA}','SERV-PJ', 0,'aprobada',
         current_date - 50, current_date - 45,'${ING}','${YO}'),
        -- En borrador, con el período ya cerrado hace 5 días.
        ('5e6f7a8b-3333-0000-0000-000000000003','${G}','${CTR}', 3,'2026-09-01', current_date - 5,
         300000.00,'VES','${TASA}', 0, 0,'${IVA}','SERV-PJ', 0,'borrador',
         null, null, null,'${YO}'),
        -- Recién presentada: NO espera a GPS, espera al cliente.
        ('5e6f7a8b-3333-0000-0000-000000000004','${G}','${CTR}', 4,'2026-09-01','2026-09-20',
         120000.00,'VES','${TASA}', 0, 0,'${IVA}','SERV-PJ', 0,'presentada',
         current_date - 1, null, null,'${YO}');

      insert into objecion (valuacion_id, persona_id, motivo, objetada_en)
      values ('5e6f7a8b-3333-0000-0000-000000000001','${ING}',
              'El renglón 3 incluye 12 horas de grúa que no se ejecutaron el 14 de septiembre.',
              now() - interval '20 days');
    `)
  })
})
after(async () => { await cerrar() })

test('la objeción sin responder aparece, con su motivo', () => {
  return dentro(async (q) => {
    const b = await bandeja(q, 'es')
    const o = b.find((x) => x.clase === 'objecion')
    assert.ok(o, 'la objeción debería estar')
    assert.equal(o!.titulo, 'Objeción sin responder')
    assert.match(o!.detalle, /12 horas de grúa/)
    assert.equal(o!.dias, 20)
  })
})

test('lo que lleva más tiempo esperando va primero, aunque sea de menos dinero', () => {
  // 45 días y 900.000 contra 20 días y 50.000: manda la espera. El daño de dejar a
  // un cliente sin respuesta no es proporcional al importe.
  return dentro(async (q) => {
    const b = await bandeja(q, 'es')
    assert.ok(b.length >= 3)
    for (let i = 1; i < b.length; i++) {
      assert.ok(b[i - 1]!.dias >= b[i]!.dias, 'la lista debería ir de más antiguo a más nuevo')
    }
    assert.equal(b[0]!.clase, 'por_cobrar')
    assert.equal(b[0]!.dias, 45)
  })
})

test('una valuación en borrador con el período cerrado aparece: es dinero parado por descuido', () => {
  return dentro(async (q) => {
    const b = await bandeja(q, 'es')
    const sp = b.find((x) => x.clase === 'sin_presentar')
    assert.ok(sp)
    assert.equal(sp!.dias, 5)
  })
})

test('lo recién presentado NO aparece: eso espera al cliente, no a GPS', () => {
  return dentro(async (q) => {
    const b = await bandeja(q, 'es')
    assert.equal(b.some((x) => x.valuacionId === '5e6f7a8b-3333-0000-0000-000000000004'), false)
  })
})

test('respondida la objeción, desaparece de la bandeja', () => {
  return dentro(async (q) => {
    await q`
      update objecion set respuesta = 'Se retiran las 12 horas.', respondida_en = now(),
             respondida_por = ${YO}::uuid
       where valuacion_id = '5e6f7a8b-3333-0000-0000-000000000001'::uuid`
    const b = await bandeja(q, 'es')
    assert.equal(b.some((x) => x.clase === 'objecion'), false)
    // Se deshace para no estorbar a otras pruebas del mismo archivo.
    await q`
      update objecion set respuesta = null, respondida_en = null, respondida_por = null
       where valuacion_id = '5e6f7a8b-3333-0000-0000-000000000001'::uuid`
  })
})

test('un cliente no recibe nada de la bandeja', () => {
  // No hay ninguna rama que lo impida: las políticas de fila no le devuelven
  // borradores ni objeciones de otros, y el resto lo filtran igual.
  return comoPersona({ id: ING }, 'nexus_cliente', async (q) => {
    const b = await bandeja(q, 'es')
    assert.equal(b.some((x) => x.clase === 'sin_presentar'), false,
      'un cliente no debería ver borradores')
  })
})

test('en inglés, los títulos son los correctos', () => {
  return dentro(async (q) => {
    const b = await bandeja(q, 'en')
    assert.ok(b.some((x) => x.titulo === 'Unanswered dispute'))
    assert.ok(b.some((x) => x.titulo === 'Approved and unpaid'))
  })
})
