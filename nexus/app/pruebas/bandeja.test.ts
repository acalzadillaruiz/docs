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
import { bandeja, bandejaCliente } from '../src/dominio/bandeja.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '5e6f7a8b-0000-0000-0000-00000000000a'
const C = '5e6f7a8b-0000-0000-0000-00000000000b'
const YO = '5e6f7a8b-0000-0000-0000-00000000000d'
const ING = '5e6f7a8b-0000-0000-0000-00000000000e'
const CTR = '5e6f7a8b-2222-0000-0000-00000000000a'
/** Una SEGUNDA operadora, con su contrato: sin ella, la prueba de aislamiento de la bandeja
 *  del cliente no tendría nada ajeno que dejar fuera y pasaría en vano. */
const C2 = '5e6f7a8b-0000-0000-0000-00000000000c'
const ING2 = '5e6f7a8b-0000-0000-0000-00000000000f'
const CTR2 = '5e6f7a8b-2222-0000-0000-00000000000b'
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
        ('${C}','operadora','Operadora','J-907777777-7'),
        ('${C2}','operadora','Otra Operadora','J-907888888-8') on conflict do nothing;
      insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto) values
        ('${YO}','${G}','ban@prueba.test','Interno','clave_2fa','(h)','(s)'),
        ('${ING}','${C}','ing-ban@prueba.test','Ingeniero','clave_2fa','(h)','(s)'),
        ('${ING2}','${C2}','ing-ban2@prueba.test','De la otra','clave_2fa','(h)','(s)')
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
                'vigente','VES', 9000000.00,'${TASA}','${YO}'),
               ('${CTR2}','${G}','${C2}','BAN-002','servicio','De la otra','Of the other',
                'vigente','VES', 4000000.00,'${TASA}','${YO}') on conflict do nothing;

      delete from objecion where valuacion_id in (
        select id from valuacion where contrato_id in ('${CTR}','${CTR2}'));
      delete from valuacion where contrato_id in ('${CTR}','${CTR2}');

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
         current_date - 1, null, null,'${YO}'),
        -- Objetada y ya contestada: la pelota vuelve al campo del cliente.
        ('5e6f7a8b-3333-0000-0000-000000000005','${G}','${CTR}', 5,'2026-06-01','2026-06-30',
         70000.00,'VES','${TASA}', 0, 0,'${IVA}','SERV-PJ', 0,'objetada',
         current_date - 60, null, null,'${YO}'),
        -- Objetada DOS veces: una contestada y otra no. Es el caso en el que el guardián
        -- importa, y sin ella se podía quitar sin que ninguna prueba se enterara.
        ('5e6f7a8b-3333-0000-0000-000000000007','${G}','${CTR}', 7,'2026-05-01','2026-05-31',
         64000.00,'VES','${TASA}', 0, 0,'${IVA}','SERV-PJ', 0,'objetada',
         current_date - 80, null, null,'${YO}'),
        -- Y una presentada de la OTRA operadora, que no tiene que salirle a la primera.
        ('5e6f7a8b-3333-0000-0000-000000000006','${G}','${CTR2}', 1,'2026-09-01','2026-09-15',
         88000.00,'VES','${TASA}', 0, 0,'${IVA}','SERV-PJ', 0,'presentada',
         current_date - 3, null, null,'${YO}');

      insert into objecion (valuacion_id, persona_id, motivo, objetada_en)
      values ('5e6f7a8b-3333-0000-0000-000000000001','${ING}',
              'El renglón 3 incluye 12 horas de grúa que no se ejecutaron el 14 de septiembre.',
              now() - interval '20 days');

      insert into objecion (valuacion_id, persona_id, motivo, objetada_en,
                            respuesta, respondida_en, respondida_por)
      values ('5e6f7a8b-3333-0000-0000-000000000005','${ING}',
              'Falta el informe del día 12.', now() - interval '9 days',
              'Adjuntado el informe; el retraso fue de la imprenta.',
              now() - interval '4 days','${YO}');

      insert into objecion (valuacion_id, persona_id, motivo, objetada_en,
                            respuesta, respondida_en, respondida_por)
      values ('5e6f7a8b-3333-0000-0000-000000000007','${ING}',
              'El renglon 1 esta bien.', now() - interval '15 days',
              'Gracias.', now() - interval '13 days','${YO}');
      insert into objecion (valuacion_id, persona_id, motivo, objetada_en)
      values ('5e6f7a8b-3333-0000-0000-000000000007','${ING}',
              'Pero el renglon 2 sigue sin el acta.', now() - interval '11 days');
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
    // De ESA valuación, no de la lista entera: contar el total hacía que cualquier fila
    // nueva del fixture rompiera esta prueba sin que nada estuviera mal. Pasó al añadir una
    // valuación con dos objeciones para medir otra cosa.
    assert.equal(
      b.some((x) => x.clase === 'objecion'
        && x.valuacionId === '5e6f7a8b-3333-0000-0000-000000000001'),
      false, 'la objeción respondida sigue esperando a GPS')
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

// ---------------------------------------------------------------- la del cliente

/**
 * La otra mitad del círculo.
 *
 * La bandeja de GPS nació porque «el cliente escribe y no pasa nada» es lo que deja un portal
 * sin usarse. El espejo seguía abierto: GPS presentaba una valuación y el cliente no sabía que
 * le esperaba nada salvo que leyera el correo — y si el correo se perdió, no había otra forma
 * de enterarse. Entraba, veía su lista de contratos igual que ayer, y se iba.
 */
const comoElCliente = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: ING }, 'nexus_cliente', f)

test('al cliente le espera lo presentado sin firmar, con los días que lleva', async () => {
  const suya = await comoElCliente((q) => bandejaCliente(q, C, 'es'))
  const firma = suya.filter((p) => p.clase === 'esperando_firma')
  assert.equal(firma.length, 1, 'no le sale la valuación que espera su firma')
  assert.equal(firma[0]!.dias, 1)
  assert.match(firma[0]!.titulo, /firma/i)
  // Y la tercera línea es el título del contrato, no su propio nombre: en su bandeja todas
  // las filas son suyas, así que repetir «Operadora» tres veces no distingue nada.
  assert.equal(firma[0]!.contexto, 'Servicio')
})

test('y le espera su objeción contestada, que es lo que la desbloquea', async () => {
  const suya = await comoElCliente((q) => bandejaCliente(q, C, 'es'))
  const contestada = suya.filter((p) => p.clase === 'objecion_contestada')
  assert.equal(contestada.length, 1)
  assert.equal(contestada[0]!.dias, 4)
  assert.match(contestada[0]!.detalle, /imprenta/,
    'no enseña la respuesta de GPS, que es justo lo que tiene que leer')
})

test('la bandeja del cliente enseña TAMBIÉN lo que GPS le debe a él', async () => {
  // Un portal que solo enseña las deudas de un lado se lee como una máquina de cobrar.
  const suya = await comoElCliente((q) => bandejaCliente(q, C, 'es'))
  const gps = suya.filter((p) => p.clase === 'esperando_gps')
  // La de las 12 horas de grúa, por su identificador: contar cuántas hay en total ataba esta
  // prueba a cuántas filas tenga el fixture, y eso no es lo que quiere comprobar.
  const grua = gps.find((p) => p.valuacionId === '5e6f7a8b-3333-0000-0000-000000000001')
  assert.ok(grua, 'no le dice que GPS le debe una respuesta')
  assert.equal(grua.dias, 20)
  assert.match(grua.detalle, /grúa/, 'no recuerda qué objetó')
})

test('una objeción contestada NO sale como «esperando a GPS», ni al revés', async () => {
  // Las dos filas salen de la misma tabla y la única diferencia es si hay respuesta. Si la
  // condición se escribiera al revés, las dos listas tendrían lo mismo y las tres pruebas de
  // arriba pasarían igual: lo que no puede pasar es que una valuación esté en las dos.
  const suya = await comoElCliente((q) => bandejaCliente(q, C, 'es'))
  const contestadas = new Set(suya.filter((p) => p.clase === 'objecion_contestada')
    .map((p) => p.valuacionId))
  for (const p of suya.filter((x) => x.clase === 'esperando_gps')) {
    assert.equal(contestadas.has(p.valuacionId), false,
      'la misma valuación sale esperando a GPS y contestada a la vez')
  }
})

test('con una objeción contestada Y otra abierta, el que espera sigue siendo GPS', async () => {
  // El caso que hace falta para que el guardián se mida. Sin él, la valuación saldría como
  // «GPS contestó tu objeción» mientras GPS todavía le debe una respuesta — o sea, diciéndole
  // al cliente que la pelota es suya cuando no lo es. Comprobado quitándolo: con una sola
  // objeción por valuación, quitarlo no rompía ninguna prueba.
  const suya = await comoElCliente((q) => bandejaCliente(q, C, 'es'))
  const dosVeces = suya.filter((p) => p.valuacionId === '5e6f7a8b-3333-0000-0000-000000000007')
  assert.equal(dosVeces.length, 1, `salió ${dosVeces.length} veces, no una`)
  assert.equal(dosVeces[0]!.clase, 'esperando_gps',
    'dice que la pelota es del cliente y GPS todavía le debe una respuesta')
})

test('lo de OTRA operadora no le sale, y el filtro por cliente está ESCRITO', async () => {
  // Se pregunta desde DENTRO de GPS, que bajo las políticas de fila lo ve todo, pasando el
  // identificador de cada operadora. Así lo único que puede dejar fuera lo ajeno es la
  // condición escrita en la consulta. Preguntándolo como el cliente, la prueba pasaría con
  // esa condición quitada —la salvaría el filtro de la base— y no estaría midiendo nada.
  const deLaPrimera = await dentro((q) => bandejaCliente(q, C, 'es'))
  const deLaOtra = await dentro((q) => bandejaCliente(q, C2, 'es'))

  assert.ok(deLaPrimera.length >= 3, 'la primera operadora tiene que tener sus tres filas')
  assert.equal(deLaPrimera.some((p) => p.contrato === 'BAN-002'), false,
    'a una operadora le sale una valuación de otra')

  assert.equal(deLaOtra.length, 1, 'la otra operadora tiene exactamente una')
  assert.equal(deLaOtra[0]!.contrato, 'BAN-002')
  assert.equal(deLaOtra.some((p) => p.contrato === 'BAN-001'), false)
})

test('lo que lleva más esperando va primero, igual que en la de GPS', async () => {
  const suya = await comoElCliente((q) => bandejaCliente(q, C, 'es'))
  const dias = suya.map((p) => p.dias)
  assert.deepEqual([...dias].sort((a, b) => b - a), dias,
    'no está ordenada por lo que lleva más tiempo esperando')
})

test('y la bandeja de GPS sigue sin salirle a un cliente, pase lo que pase', async () => {
  // La cerradura de la pantalla, que este trozo NO podía debilitar: se llama a propósito con
  // los pendientes de GPS y esCliente a la vez, y además con los del cliente, para que quede
  // claro que lo que sale es lo segundo y nunca lo primero.
  const { pintarCartera } = await import('../src/pantallas/cartera.ts')
  const deGps = await dentro((q) => bandeja(q, 'es'))
  const delCliente = await comoElCliente((q) => bandejaCliente(q, C, 'es'))
  assert.ok(deGps.length > 0 && delCliente.length > 0, 'las dos listas tienen que traer algo')

  const h = pintarCartera([], 'es', true, deGps, [], undefined, delCliente)
  assert.equal(h.includes('Objeción sin responder'), false,
    'a un cliente le salió la bandeja de GPS')
  assert.ok(h.includes('Esperando tu firma'), 'no le salió la suya')
})
