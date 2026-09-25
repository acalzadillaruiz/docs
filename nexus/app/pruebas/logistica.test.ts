/**
 * Dónde está el material.
 *
 * Es la pregunta que hace un cliente de procura y que no contesta ningún portal de
 * seguimiento. La máquina ya estaba —la cadena de hitos de procura con el papel que
 * exige cada paso— y lo que faltaba era la vista.
 *
 * Lo que se comprueba aquí es la única decisión que la hace distinta de un tablero
 * cualquiera: **la posición la marca el último paso VERIFICADO**. Si alguien anota
 * que algo se embarcó y no hay conocimiento de embarque, aquí sigue en fábrica.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { enRuta, porPaso } from '../src/dominio/logistica.ts'
import { pintarLogistica } from '../src/pantallas/logistica.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '4f5a6b7c-1000-0000-0000-00000000000a'
const OP = '4f5a6b7c-1000-0000-0000-00000000000b'
const YO = '4f5a6b7c-1000-0000-0000-00000000000d'
const ING = '4f5a6b7c-1000-0000-0000-00000000000e'
const TASA = '4f5a6b7c-1100-0000-0000-00000000000a'
const CTR = '4f5a6b7c-2200-0000-0000-00000000000a'
const SERV = '4f5a6b7c-2200-0000-0000-00000000000b'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

/**
 * El estado de un paso de la cadena, por su clave de plantilla.
 *
 * Pone antes el papel que ese paso exige, porque **la base de datos no deja marcar
 * un hito como evidenciado o verificado sin él** — y eso está bien, es la regla que
 * sostiene todo. Un atajo en la prueba habría chocado contra ella, que es justo lo
 * que pasó al escribirla.
 */
async function marcar(
  renglon: string, clave: string, estado: string, cuando: string | null = null,
): Promise<void> {
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    if (estado === 'evidenciado' || estado === 'verificado') {
      // Una evidencia por cada clase que el hito exija, con su huella distinta. Y
      // verificada cuando el paso va a quedar verificado: la regla pide las dos cosas.
      await q`
        insert into evidencia (hito_id, clase, huella, nombre, bytes, tipo_mime,
                               subida_por, verificada_en, verificada_por)
        select h.id, c, md5(h.id::text || c) || md5(c || h.id::text),
               c || '.pdf', 10, 'application/pdf', ${YO}::uuid, null, null
          from hito h, unnest(h.exige) c
         where h.renglon_id = ${renglon}::uuid and h.clave = ${clave}
           and not exists (select 1 from evidencia e
                            where e.hito_id = h.id and e.clase = c)`
      if (estado === 'verificado') {
        await q`update evidencia e set verificada_en = now(), verificada_por = ${YO}::uuid
                 from hito h
                where h.id = e.hito_id and h.renglon_id = ${renglon}::uuid
                  and h.clave = ${clave} and e.verificada_en is null`
      }
    }
    await q`update hito set estado = ${estado}::estado_hito,
                            ocurrido_en = ${cuando}::date
             where renglon_id = ${renglon}::uuid and clave = ${clave}`
  })
}

async function renglonDe(codigo: string): Promise<string> {
  const [r] = (await dentro((q) => q`
    select rg.id from renglon rg join contrato c on c.id = rg.contrato_id
     where c.organizacion_id = ${G}::uuid and c.codigo = ${codigo} and rg.numero = 1
  `)) as unknown as Array<{ id: string }>
  return r!.id
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Ruta','J-909100000-0'),
        ('${OP}','operadora','Operadora Ruta','J-909200000-0')
        on conflict (id) do update set nombre = excluded.nombre;`)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'ruta@prueba.test','Interno','clave_2fa','(h)','(s)'),
                   (${ING}, ${OP},'ruta-cli@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2027-09-01', 80.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;

      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es,
                            titulo_en, estado, moneda, monto, tasa_id, inicio, creado_por) values
        ('${CTR}','${G}','${OP}','RU-PROC','procura','Cabezales','Wellheads',
         'vigente','USD', 500000,'${TASA}','2027-09-01','${YO}'),
        -- Un contrato de servicio: NO es material en ruta y no tiene que salir.
        ('${SERV}','${G}','${OP}','RU-SERV','servicio','Mantenimiento','Maintenance',
         'vigente','USD', 100000,'${TASA}','2027-09-01','${YO}')
        on conflict (id) do update set estado = excluded.estado;

      insert into renglon (contrato_id, numero, descripcion_es, descripcion_en,
                           cantidad, unidad, precio_unitario, costo_unitario) values
        ('${CTR}', 1,'Cabezal 11" 5M','11" 5M wellhead', 2,'unidad', 100000, 62000),
        ('${SERV}', 1,'Mantenimiento','Maintenance', 1,'servicio', 100000, 60000)
        on conflict (contrato_id, numero) do nothing;

      -- Los hitos salen de la plantilla del tipo, que es como nacen de verdad.
      insert into hito (renglon_id, orden, clave, nombre_es, nombre_en, peso, exige)
      select rg.id, p.orden, p.clave, p.nombre_es, p.nombre_en, p.peso, p.exige
        from renglon rg join contrato c on c.id = rg.contrato_id
        join plantilla_hito p on p.tipo = c.tipo
       where c.organizacion_id = '${G}' and c.codigo in ('RU-PROC','RU-SERV')
        on conflict (renglon_id, orden) do nothing;

      -- La base no se vacía entre ejecuciones de un mismo archivo, y estas pruebas
      -- mueven los hitos por la cadena. Sin esto, la segunda corrida empieza con el
      -- material a medio camino y la primera prueba falla sin que nadie entienda
      -- por qué.
      delete from evidencia e using hito h, renglon rg, contrato c
       where e.hito_id = h.id and h.renglon_id = rg.id and rg.contrato_id = c.id
         and c.organizacion_id = '${G}' and c.codigo in ('RU-PROC','RU-SERV');
      update hito h set estado = 'pendiente', ocurrido_en = null
        from renglon rg join contrato c on c.id = rg.contrato_id
       where h.renglon_id = rg.id and c.organizacion_id = '${G}'
         and c.codigo in ('RU-PROC','RU-SERV');`)
  })
})
after(async () => { await cerrar() })

const soloProcura = async () =>
  (await dentro((q) => enRuta(q, G, 'es'))).filter((r) => r.contrato === 'RU-PROC')

test('un renglón sin ningún paso cumplido sale «sin empezar», esperando el primero', async () => {
  const [r] = await soloProcura()
  assert.ok(r, 'el renglón de procura tiene que estar en ruta')
  assert.equal(r!.paso, null)
  assert.match(r!.siguiente, /Orden de compra/)
})

test('un contrato de servicio NO es material en ruta', async () => {
  // El tablero es de procura y transporte. Meter dentro lo que no viaja lo convierte
  // en un listado de todo, que es lo que no sirve.
  const todos = await dentro((q) => enRuta(q, G, 'es'))
  assert.equal(todos.some((r) => r.contrato === 'RU-SERV'), false)
  assert.ok(todos.some((r) => r.contrato === 'RU-PROC'), 'y el de procura sí está')
})

test('LA POSICIÓN LA MARCA LO VERIFICADO, no lo que alguien escribió', async () => {
  // Es la decisión entera. Se marca «embarcado» como declarado —alguien lo dijo— sin
  // que los pasos anteriores estén verificados: el material NO se mueve en el tablero.
  const rg = await renglonDe('RU-PROC')
  await marcar(rg, 'orden', 'verificado', '2027-09-05')
  await marcar(rg, 'embarcado', 'declarado', '2027-09-20')

  const [r] = await soloProcura()
  assert.match(r!.paso!, /Orden de compra/, 'sigue donde tenía papel')
  assert.match(r!.siguiente, /Fabricado/, 'y lo que falta es el paso siguiente de verdad')
})

test('lo dicho sin papel se señala, en vez de callarlo o creérselo', async () => {
  const rg = await renglonDe('RU-PROC')
  await marcar(rg, 'fabricado', 'declarado', '2027-09-15')

  const [r] = await soloProcura()
  assert.equal(r!.dichoSinPapel, true)
  assert.match(r!.siguiente, /Fabricado/)
  // Y la pantalla lo enseña, que es donde sirve de algo.
  const h = pintarLogistica([r!], [], 'es')
  assert.match(h, /Dicho sin papel/)
})

test('el papel subido y sin mirar se distingue del papel que falta', async () => {
  // No es lo mismo: confundirlos hace que se persiga al proveedor cuando el atasco
  // está en casa.
  const rg = await renglonDe('RU-PROC')
  await marcar(rg, 'fabricado', 'evidenciado', '2027-09-15')

  const [r] = await soloProcura()
  assert.equal(r!.papelEsperando, true)
  assert.equal(r!.dichoSinPapel, false)
  assert.match(pintarLogistica([r!], [], 'es'), /Papel esperando/)
})

test('los días parados se cuentan desde el último paso con papel', async () => {
  const rg = await renglonDe('RU-PROC')
  await marcar(rg, 'orden', 'verificado', new Date(Date.now() - 40 * 86_400_000)
    .toISOString().slice(0, 10))
  const [r] = await soloProcura()
  assert.ok(r!.dias >= 39 && r!.dias <= 41, `llevaba ${r!.dias} días`)
})

test('el renglón que ya llegó desaparece del tablero', async () => {
  // Un tablero de material en ruta con el material que ya llegó dentro no es un
  // tablero: es un listado.
  const rg = await renglonDe('RU-PROC')
  for (const c of ['orden', 'fabricado', 'embarcado', 'nacionalizado', 'recibido']) {
    await marcar(rg, c, 'verificado', '2027-09-25')
  }
  assert.equal((await soloProcura()).length, 0)
})

test('el resumen por paso cuenta lo parado y dice cuánto lleva el peor', async () => {
  // Se recoloca el renglón para que haya algo parado que resumir: sin eso, el
  // resumen saldría vacío y esta prueba no comprobaría nada.
  const rg = await renglonDe('RU-PROC')
  await marcar(rg, 'recibido', 'pendiente', null)
  await marcar(rg, 'nacionalizado', 'pendiente', null)

  const resumen = await dentro((q) => porPaso(q, G, 'es'))
  assert.ok(resumen.length > 0, 'con algo parado el resumen no puede salir vacío')
  const total = resumen.reduce((n, p) => n + p.cuantos, 0)
  assert.equal(total, (await dentro((q) => enRuta(q, G, 'es'))).length)
  assert.ok(resumen.every((p) => p.peorDias >= 0))
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const lista = await dentro((q) => enRuta(q, G, 'en'))
  const resumen = await dentro((q) => porPaso(q, G, 'en'))
  assert.ok(lista.length > 0, 'sin material en ruta esta prueba no comprobaría nada')
  const en = pintarLogistica(lista, resumen, 'en')
  assert.equal(en.includes('‹falta:'), false)
  assert.match(en, /Where the material is/)
  assert.match(en, /11" 5M wellhead|wellhead/)

  const es = pintarLogistica(await dentro((q) => enRuta(q, G, 'es')),
    await dentro((q) => porPaso(q, G, 'es')), 'es')
  assert.equal(es.includes('‹falta:'), false)
  assert.match(es, /Dónde está el material/)
})

test('el cliente no llega al tablero: es de GPS, y está en la ruta', async () => {
  const fuente = await import('node:fs/promises')
    .then((fs) => fs.readFile(new URL('../src/servidor/rutas.ts', import.meta.url), 'utf8'))
  const i = fuente.indexOf(`p.ruta === '/logistica'`)
  assert.notEqual(i, -1)
  assert.match(fuente.slice(i, i + 400), /esCliente\) return noEncontrado/)
})
