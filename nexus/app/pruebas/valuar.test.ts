/**
 * De la evidencia al dinero.
 *
 * Sin evidencia no hay avance, y sin avance no se factura. Lo que se comprueba aquí
 * es que no haya forma de cobrar lo que no se puede demostrar, ni de cobrarlo dos
 * veces — y que la pantalla no ofrezca ninguna casilla donde teclear la cifra.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { proponer, emitir, presentar, ContratoNoValuable } from '../src/dominio/valuar.ts'
import { pintarValuar } from '../src/pantallas/valuar.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '2f3a4b5c-0000-0000-0000-00000000000a'
const C = '2f3a4b5c-0000-0000-0000-00000000000b'
const YO = '2f3a4b5c-0000-0000-0000-00000000000d'
const ING = '2f3a4b5c-0000-0000-0000-00000000000e'
const TASA = '2f3a4b5c-1111-0000-0000-00000000000a'
const IVA = '2f3a4b5c-1111-0000-0000-00000000000b'
const CTR = '2f3a4b5c-2222-0000-0000-00000000000a'
const BOR = '2f3a4b5c-2222-0000-0000-00000000000b'   // en borrador, no se valúa
const RG = '2f3a4b5c-3333-0000-0000-00000000000a'
const H = (n: number) => `2f3a4b5c-4444-0000-0000-${String(n).padStart(12, '0')}`

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

/** El renglón con 40 puntos verificados y 25 declarados sin papel. */
async function limpio(): Promise<void> {
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    // Los hitos primero: apuntan a la valuación que se los llevó, y esa clave
    // ajena es deliberada — una valuación no se borra, se anula.
    await q`delete from hito where renglon_id = ${RG}::uuid`
    await q`delete from aviso where sobre_id in (
      select id from valuacion where contrato_id = ${CTR}::uuid)`
    await q`delete from valuacion where contrato_id = ${CTR}::uuid`
    await q.unsafe(`
      insert into hito (id, renglon_id, orden, clave, nombre_es, nombre_en, peso, exige,
                        estado, ocurrido_en) values
        ('${H(1)}','${RG}', 1,'orden','Orden','PO', 10.00,'{}','verificado','2026-08-01'),
        ('${H(2)}','${RG}', 2,'fabricado','Fabricado','Made', 30.00,'{}','verificado','2026-08-20'),
        ('${H(3)}','${RG}', 3,'embarcado','Embarcado','Shipped', 25.00,'{}','declarado','2026-09-05'),
        ('${H(4)}','${RG}', 4,'recibido','Recibido','Received', 35.00,'{}','pendiente', null);
    `)
  })
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Valuar App','J-992222222-2'),
        ('${C}','operadora','Operadora Valuar','J-993333333-3')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'valuar@prueba.test','Interno','clave_2fa','(h)','(s)'),
                   (${ING}, ${C},'valuar-cli@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-09-14', 36.50,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2018-01-17') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00)
        on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut,
                                 minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01')
        on conflict do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por, amortiza_pct, garantia_pct)
        values ('${CTR}','${G}','${C}','VALAPP-001','procura','Cabezales','Wellheads',
                'vigente','USD', 200000.00,'${TASA}','${YO}', 20.00, 5.00),
               ('${BOR}','${G}','${C}','VALAPP-BOR','procura','Otro','Other',
                'borrador','USD', 100000.00,'${TASA}','${YO}', 0, 0)
        on conflict (id) do update set estado = excluded.estado;
      insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                           cantidad, unidad, precio_unitario, costo_unitario)
        values ('${RG}','${CTR}', 1,'Cabezal','Wellhead', 2,'unidad', 100000.0000, 62000.0000)
        on conflict (id) do update set precio_unitario = excluded.precio_unitario;
    `)
  })
})
after(async () => { await cerrar() })

const hoy = () => new Date().toISOString().slice(0, 10)

test('la propuesta sale de lo VERIFICADO, y lo declarado sin papel no aparece', async () => {
  await limpio()
  const p = await dentro((q) => proponer(q, CTR, hoy(), 'es'))
  assert.equal(p.obraCruda, 80000, '40 puntos de 200.000')
  assert.equal(p.lineas.length, 1)
  assert.deepEqual(p.lineas[0]!.hitos, ['orden', 'fabricado'])
  // Un número que sale en una propuesta acaba facturándose.
  assert.equal(p.lineas[0]!.hitos.includes('embarcado'), false)
})

test('emitir se lleva los hitos: no se cobra dos veces lo mismo', async () => {
  await limpio()
  const r = await dentro((q) => emitir(q, {
    contratoId: CTR, desde: '2026-08-01', hasta: hoy(),
    retieneIva: false, pagaEnDivisa: false,
  }, YO, G, 'es'))
  assert.equal(r.hecho, true)
  assert.equal(r.hecho && r.hitos, 2)

  const otra = await dentro((q) => proponer(q, CTR, hoy(), 'es'))
  assert.equal(otra.obraCruda, 0)
  assert.equal(otra.lineas.length, 0)
})

test('la obra guardada es la calculada, y se anota de dónde salió', async () => {
  await limpio()
  const r = await dentro((q) => emitir(q, {
    contratoId: CTR, desde: '2026-08-01', hasta: hoy(),
    retieneIva: true, pagaEnDivisa: true,
  }, YO, G, 'es'))
  const [v] = (await dentro((q) => q`
    select obra::text, origen_obra, ret_iva_pct::text, paga_en_divisa, estado::text,
           amortiza_pct::text, garantia_pct::text
      from valuacion where id = ${(r as { valuacionId: string }).valuacionId}::uuid
  `)) as unknown as Array<Record<string, string | boolean>>
  assert.equal(v!['obra'], '80000.00')
  // Nunca se pierde de dónde salió la cifra.
  assert.equal(v!['origen_obra'], 'hitos_evidenciados')
  assert.equal(v!['ret_iva_pct'], '75.00')
  assert.equal(v!['paga_en_divisa'], true)
  assert.equal(v!['estado'], 'borrador')
  // Los porcentajes se copian del contrato y se congelan: si el contrato cambia
  // mañana, lo ya emitido no se mueve.
  assert.equal(v!['amortiza_pct'], '20.00')
  assert.equal(v!['garantia_pct'], '5.00')
})

test('no se puede emitir si no hay nada verificado por facturar', async () => {
  await limpio()
  await dentro((q) => emitir(q, {
    contratoId: CTR, desde: '2026-08-01', hasta: hoy(), retieneIva: false, pagaEnDivisa: false,
  }, YO, G, 'es'))
  const otra = await dentro((q) => emitir(q, {
    contratoId: CTR, desde: '2026-09-01', hasta: hoy(), retieneIva: false, pagaEnDivisa: false,
  }, YO, G, 'es'))
  assert.equal(otra.hecho, false)
  assert.match((otra as { errores: readonly string[] }).errores.join(' '), /nada verificado/)
})

test('un periodo al revés no pasa', async () => {
  await limpio()
  const r = await dentro((q) => emitir(q, {
    contratoId: CTR, desde: '2026-09-30', hasta: '2026-09-01',
    retieneIva: false, pagaEnDivisa: false,
  }, YO, G, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { errores: readonly string[] }).errores.join(' '), /al revés/)
})

test('un contrato en borrador no se valúa', async () => {
  await assert.rejects(dentro((q) => proponer(q, BOR, hoy(), 'es')), ContratoNoValuable)
})

test('un contrato que no existe da el MISMO error que uno que no te toca', async () => {
  await assert.rejects(
    dentro((q) => proponer(q, '00000000-0000-0000-0000-0000000000aa', hoy(), 'es')),
    ContratoNoValuable,
  )
  await assert.rejects(
    comoPersona({ id: ING }, 'nexus_cliente', (q) => proponer(q, CTR, hoy(), 'es')),
    ContratoNoValuable,
  )
})

test('lo facturado que después se cayó se ve, y no se corrige solo', async () => {
  await limpio()
  await dentro((q) => emitir(q, {
    contratoId: CTR, desde: '2026-08-01', hasta: hoy(), retieneIva: false, pagaEnDivisa: false,
  }, YO, G, 'es'))

  // Se rechaza la evidencia de un hito YA facturado.
  await dentro((q) => q`
    update hito set estado = 'declarado' where id = ${H(2)}::uuid`)

  const p = await dentro((q) => proponer(q, CTR, hoy(), 'es'))
  assert.equal(p.caidos.length, 1)
  assert.equal(p.caidos[0]!.hito, 'fabricado')

  // Sigue apuntando a la valuación que lo cobró: lo facturado se arregla con una
  // nota de crédito, no borrando.
  const [h] = (await dentro((q) => q`
    select valuacion_id from hito where id = ${H(2)}::uuid
  `)) as unknown as Array<{ valuacion_id: string | null }>
  assert.notEqual(h!.valuacion_id, null)
})

test('la pantalla NO tiene ninguna casilla donde teclear la obra', async () => {
  await limpio()
  const p = await dentro((q) => proponer(q, CTR, hoy(), 'es'))
  const h = pintarValuar(p, 'es', 'af', '2026-08-01', '2026-08-31')
  // Ponerla «por si acaso» convertiría todo lo anterior en decoración: el día que
  // la cifra propuesta no gustara, alguien la reescribiría.
  assert.equal(h.includes('name="obra"'), false)
  assert.equal(h.includes('name="monto"'), false)
  // Pero sí se enseña, grande y aparte, con los hitos que la componen.
  assert.match(h, /class="obra"/)
  assert.match(h, /orden · fabricado/)
})

test('sin nada que facturar, la pantalla lo dice y no ofrece el botón', async () => {
  await limpio()
  await dentro((q) => emitir(q, {
    contratoId: CTR, desde: '2026-08-01', hasta: hoy(), retieneIva: false, pagaEnDivisa: false,
  }, YO, G, 'es'))
  const p = await dentro((q) => proponer(q, CTR, hoy(), 'es'))
  const h = pintarValuar(p, 'es', 'af', '2026-09-01', '2026-09-30')
  assert.match(h, /Sin evidencia no se factura/)
  assert.equal(h.includes('<form'), false, 'no se ofrece crear lo que no se puede')
})

test('la pantalla sale entera en los dos idiomas', async () => {
  await limpio()
  const p = await dentro((q) => proponer(q, CTR, hoy(), 'en'))
  const en = pintarValuar(p, 'en', 'af', '2026-08-01', '2026-08-31')
  assert.match(en, /What can be invoiced today/)
  assert.match(en, /No evidence, no invoice|comes from verified milestones/)
  assert.equal(en.includes('‹falta:'), false)
})

test('presentar saca la valuación de GPS y le avisa al cliente, en el mismo acto', async () => {
  await limpio()
  const r = await dentro((q) => emitir(q, {
    contratoId: CTR, desde: '2026-08-01', hasta: hoy(), retieneIva: false, pagaEnDivisa: false,
  }, YO, G, 'es'))
  const id = (r as { valuacionId: string }).valuacionId

  // En borrador el cliente no la ve.
  const antes = await comoPersona({ id: ING }, 'nexus_cliente', (q) => q`
    select id from valuacion where id = ${id}::uuid`)
  assert.equal(antes.length, 0)

  assert.deepEqual(await dentro((q) => presentar(q, id, false)), { hecho: true })

  const despues = await comoPersona({ id: ING }, 'nexus_cliente', (q) => q`
    select estado::text from valuacion where id = ${id}::uuid`) as unknown as
    Array<{ estado: string }>
  assert.equal(despues[0]!.estado, 'presentada')

  // El aviso lo encola la base de datos sola, en la misma transacción.
  const avisos = (await dentro(async (q) => {
    await q.unsafe('set local role none')
    return q`select tipo::text from aviso where sobre_id = ${id}::uuid`
  })) as unknown as Array<{ tipo: string }>
  assert.ok(avisos.some((a) => a.tipo === 'valuacion_presentada'))
})

test('presentar dos veces no pasa: mandaría dos correos', async () => {
  await limpio()
  const r = await dentro((q) => emitir(q, {
    contratoId: CTR, desde: '2026-08-01', hasta: hoy(), retieneIva: false, pagaEnDivisa: false,
  }, YO, G, 'es'))
  const id = (r as { valuacionId: string }).valuacionId
  await dentro((q) => presentar(q, id, false))
  assert.deepEqual(await dentro((q) => presentar(q, id, false)),
    { hecho: false, motivo: 'estado_equivocado' })
})

test('el cliente NO presenta: se estaría mandando trabajo a sí mismo para firmar', async () => {
  await limpio()
  const r = await dentro((q) => emitir(q, {
    contratoId: CTR, desde: '2026-08-01', hasta: hoy(), retieneIva: false, pagaEnDivisa: false,
  }, YO, G, 'es'))
  const id = (r as { valuacionId: string }).valuacionId
  assert.deepEqual(
    await comoPersona({ id: ING }, 'nexus_cliente', (q) => presentar(q, id, true)),
    { hecho: false, motivo: 'no_alcanzable' },
  )
})
