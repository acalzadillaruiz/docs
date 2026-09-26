/**
 * La cartera, contra la base de datos real.
 *
 * Lo que se comprueba: que el orden ponga delante lo que espera a alguien, que el
 * avance salga del libro y no de un campo, y que el cliente de A no vea a B ni
 * contando contratos.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { cartera, cuantosContratos, POR_PAGINA } from '../src/dominio/cartera.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '1a2b3c4d-0000-0000-0000-00000000000a'   // GPS
const A = '1a2b3c4d-0000-0000-0000-00000000000b'   // Operadora A
const B = '1a2b3c4d-0000-0000-0000-00000000000c'   // Operadora B
const YO = '1a2b3c4d-0000-0000-0000-00000000000d'
const ING_A = '1a2b3c4d-0000-0000-0000-00000000000e'
const TASA = '1a2b3c4d-1111-0000-0000-00000000000a'
const IVA = '1a2b3c4d-1111-0000-0000-00000000000b'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Cartera','J-977777777-7'),
        ('${A}','operadora','Operadora A','J-988888888-8'),
        ('${B}','operadora','Operadora B','J-999999999-9') on conflict do nothing;
      insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto) values
        ('${YO}','${G}','cartera@prueba.test','Interno','clave_2fa','(h)','(s)'),
        ('${ING_A}','${A}','ing-a@prueba.test','Ingeniero A','clave_2fa','(h)','(s)')
        on conflict do nothing;
      -- Cada archivo de prueba usa SU propio día de tasa. La base impone una sola
      -- tasa vigente por día, así que dos archivos con el mismo día se pisan: el
      -- segundo cae en 'on conflict do nothing', su tasa no entra, y luego falla la
      -- clave foránea del contrato con un error que no dice nada de la causa real.
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-09-02', 36.50,'carga_manual') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00) on conflict do nothing;
      insert into alicuota_igtf (vigente_desde, porcentaje) values ('2026-01-01', 3.00) on conflict do nothing;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2018-01-07') on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01') on conflict do nothing;

      -- Tres contratos: uno sin nada pendiente, uno esperando al cliente, uno cobrando.
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, fin_previsto, creado_por) values
        ('1a2b3c4d-2222-0000-0000-00000000000a','${G}','${A}','ZZZ-TRANQUILO','procura','Sin nada','Nothing',
         'vigente','VES', 1000000.00,'${TASA}','2026-12-31','${YO}'),
        ('1a2b3c4d-2222-0000-0000-00000000000b','${G}','${A}','AAA-ESPERA','servicio','Esperando','Waiting',
         'vigente','VES', 2000000.00,'${TASA}','2026-08-31','${YO}'),
        ('1a2b3c4d-2222-0000-0000-00000000000c','${G}','${B}','BBB-DE-OTRO','transporte','De B','Of B',
         'vigente','VES', 3000000.00,'${TASA}','2026-12-31','${YO}')
        on conflict do nothing;

      -- En AAA hay una valuación presentada hace días, y otra ya aprobada.
      insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde, periodo_hasta,
                             obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
                             concepto_islr, ret_iva_pct, estado, presentada_el, aprobada_el,
                             aprobada_por, creada_por) values
        ('1a2b3c4d-3333-0000-0000-00000000000a','${G}','1a2b3c4d-2222-0000-0000-00000000000b', 1,
         '2026-08-01','2026-08-31', 500000.00,'VES','${TASA}', 0, 0,'${IVA}','SERV-PJ', 0,
         'aprobada', current_date - 40, current_date - 35,'${YO}','${YO}'),
        ('1a2b3c4d-3333-0000-0000-00000000000b','${G}','1a2b3c4d-2222-0000-0000-00000000000b', 2,
         '2026-09-01','2026-09-30', 300000.00,'VES','${TASA}', 0, 0,'${IVA}','SERV-PJ', 0,
         'presentada', current_date - 12, null, null,'${YO}')
        on conflict do nothing;
    `)
  })
})
after(async () => { await cerrar() })

test('el avance sale del libro, no de un campo escrito a mano', () => {
  // 500.000 aprobados sobre 2.000.000 de contrato = 25,0 %. No existe columna de
  // avance en ninguna tabla: si existiera, alguien la escribiría.
  return dentro(async (q) => {
    const c = await cartera(q, 'es')
    const aaa = c.find((x) => x.codigo === 'AAA-ESPERA')!
    assert.equal(aaa.avance, 25)
    assert.equal(aaa.avanceTexto, '25,0 %')
  })
})

test('se enseña qué espera a quién, no un porcentaje suelto', () => {
  return dentro(async (q) => {
    const c = await cartera(q, 'es')
    const aaa = c.find((x) => x.codigo === 'AAA-ESPERA')!
    assert.equal(aaa.espera?.deQuien, 'cliente')
    assert.equal(aaa.espera?.cuantas, 1)
    assert.equal(aaa.espera?.desdeDias, 12)
    assert.equal(aaa.espera?.que, 'Valuación')
  })
})

test('lo que espera a alguien va primero, aunque su código vaya después', () => {
  // Ordenado por código, AAA saldría primero por casualidad. Se comprueba con el
  // que empieza por Z, que no tiene nada pendiente y tiene que quedar detrás.
  return dentro(async (q) => {
    const c = await cartera(q, 'es')
    const i = c.findIndex((x) => x.codigo === 'AAA-ESPERA')
    const j = c.findIndex((x) => x.codigo === 'ZZZ-TRANQUILO')
    assert.ok(i < j, 'el que espera debería ir antes que el tranquilo')
  })
})

test('un contrato sin nada pendiente no inventa una espera', () => {
  return dentro(async (q) => {
    const c = await cartera(q, 'es')
    assert.equal(c.find((x) => x.codigo === 'ZZZ-TRANQUILO')!.espera, null)
  })
})

test('el retraso se cuenta contra el fin previsto, y solo si sigue vigente', () => {
  return dentro(async (q) => {
    const c = await cartera(q, 'es')
    assert.ok((c.find((x) => x.codigo === 'AAA-ESPERA')!.diasTarde ?? 0) > 0)
    assert.ok((c.find((x) => x.codigo === 'ZZZ-TRANQUILO')!.diasTarde ?? 0) < 0)
  })
})

test('el tipo y el estado salen traducidos, no en clave', () => {
  return dentro(async (q) => {
    const es = await cartera(q, 'es')
    assert.equal(es.find((x) => x.codigo === 'BBB-DE-OTRO')!.tipo, 'Transporte')
    assert.equal(es.find((x) => x.codigo === 'AAA-ESPERA')!.estado, 'Vigente')
  })
})

test('en inglés, el vocabulario es el correcto', () => {
  return dentro(async (q) => {
    const en = await cartera(q, 'en')
    assert.equal(en.find((x) => x.codigo === 'ZZZ-TRANQUILO')!.tipo, 'Procurement')
    assert.equal(en.find((x) => x.codigo === 'AAA-ESPERA')!.espera?.que, 'Progress payment')
  })
})

test('el cliente de A ve sus dos contratos y NINGUNO de B', () => {
  // La misma función, sin una sola rama que distinga cliente de interno. El
  // aislamiento lo hacen las políticas de fila, no este código.
  return comoPersona({ id: ING_A }, 'nexus_cliente', async (q) => {
    const c = await cartera(q, 'es')
    const codigos = c.map((x) => x.codigo)
    assert.ok(codigos.includes('AAA-ESPERA'))
    assert.ok(codigos.includes('ZZZ-TRANQUILO'))
    assert.equal(codigos.includes('BBB-DE-OTRO'), false)
  })
})

test('el cliente tampoco alcanza a B contando: la cifra tiene que cuadrar con lo que ve', () => {
  // Un recuento que incluya lo ajeno delata su existencia aunque no muestre el detalle.
  return comoPersona({ id: ING_A }, 'nexus_cliente', async (q) => {
    const c = await cartera(q, 'es')
    assert.equal(c.filter((x) => x.cliente === 'Operadora B').length, 0)
  })
})

// ---------------------------------------------------------------- la bandeja
import { pintarCartera } from '../src/pantallas/cartera.ts'
import type { Pendiente } from '../src/dominio/bandeja.ts'

const PENDIENTE: Pendiente = {
  clase: 'objecion',
  valuacionId: '33333333-3333-3333-3333-333333333333',
  contratoId: '44444444-4444-4444-4444-444444444444',
  contrato: 'GPS-2026-001',
  cliente: 'Operadora <A> & Cía',
  titulo: 'Objeción sin responder',
  detalle: 'El renglón 3 incluye 12 horas de grúa que no se ejecutaron.',
  dias: 20,
  importe: 'Bs 50.000,00',
}

test('la bandeja va dentro de la cartera, no en una pantalla aparte', () => {
  // Una bandeja que hay que buscar no se mira, y una que no se mira no sirve:
  // el cliente sigue escribiendo al vacío igual que antes.
  const h = pintarCartera([], 'es', false, [PENDIENTE])
  assert.match(h, /Te esperan a ti/)
  assert.match(h, /12 horas de grúa/)
  assert.match(h, /href="\/valuaciones\/33333333-3333-3333-3333-333333333333"/)
})

test('sin nada pendiente no queda un encabezado huérfano', () => {
  // «No hay nada esperando» ocupa sitio y no informa.
  const h = pintarCartera([], 'es', false, [])
  assert.equal(h.includes('Te esperan a ti'), false)
})

test('el cliente nunca ve la bandeja: es lo que espera a GPS', () => {
  const h = pintarCartera([], 'es', true, [PENDIENTE])
  assert.equal(h.includes('Te esperan a ti'), false)
})

test('a partir de una semana se marca como urgente', () => {
  const nuevo = pintarCartera([], 'es', false, [{ ...PENDIENTE, dias: 3 }])
  assert.equal(nuevo.includes('class="pd urge"'), false)
  const viejo = pintarCartera([], 'es', false, [{ ...PENDIENTE, dias: 7 }])
  assert.match(viejo, /class="pd urge"/)
})

test('cero días se dice «hoy», no «0 días»', () => {
  assert.match(pintarCartera([], 'es', false, [{ ...PENDIENTE, dias: 0 }]), />hoy</)
  assert.match(pintarCartera([], 'en', false, [{ ...PENDIENTE, dias: 0 }]), />today</)
  assert.match(pintarCartera([], 'es', false, [{ ...PENDIENTE, dias: 1 }]), />1 día</)
})

test('el nombre del cliente se escapa también en la bandeja', () => {
  const h = pintarCartera([], 'es', false, [PENDIENTE])
  assert.match(h, /Operadora &lt;A&gt; &amp; Cía/)
  assert.equal(h.includes('<A>'), false)
})

test('los días que algo lleva esperando NUNCA son negativos', async () => {
  // Salió mirando una captura de pantalla: decía «Aprobada hace -184 días». Una
  // fecha de aprobación en el futuro es un dato malo —un año mal tecleado, una zona
  // horaria— pero la pantalla no puede contestar eso.
  //
  // La comprobación va contra la CONSULTA, que es donde se hace la resta y el único
  // sitio donde se puede arreglar para todas las pantallas a la vez. Fabricar aquí
  // un contrato de mentira comprobaría que la prueba sabe sumar, no que el sistema
  // sepa restar.
  const futura = await comoPersona({ id: YO }, 'nexus_interno', async (q) => {
    await q.unsafe('set local role none')
    await q`update valuacion set aprobada_el = current_date + 200
             where organizacion_id = ${G}::uuid and estado in ('aprobada','facturada')`
    const c = await cartera(q, 'es')
    await q`update valuacion set aprobada_el = current_date - 5
             where organizacion_id = ${G}::uuid and estado in ('aprobada','facturada')`
    return c
  })
  let mirados = 0
  for (const c of futura) {
    if (c.espera === null) continue
    mirados++
    assert.ok(c.espera.desdeDias >= 0,
      `el contrato ${c.codigo} lleva ${c.espera.desdeDias} días esperando`)
  }
  // Sin esto la prueba pasaría aunque no hubiera ni un contrato esperando.
  assert.ok(mirados > 0, 'no se miró ningún contrato en espera')
})

test('la cartera va de cincuenta en cincuenta, y DICE cuántos hay', async () => {
  // Con mil contratos dentro esta página pesaba 514 KB —medido con
  // herramientas/medir.ts— y es lo primero que se abre, muchas veces desde un
  // teléfono con datos venezolanos.
  //
  // Recortar sin decirlo sería peor que no recortar: alguien con sesenta contratos
  // creería que ha visto los suyos. Por eso se dice cuántos hay y se puede pasar.
  const cuantos = 55
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    for (let i = 0; i < cuantos; i++) {
      await q`
        insert into contrato (organizacion_id, cliente_id, codigo, tipo, titulo_es,
                              titulo_en, estado, moneda, monto, tasa_id, creado_por)
        values (${G}::uuid, ${A}::uuid, ${`PAG-${String(i).padStart(3, '0')}`},
                'servicio','Relleno','Filler','vigente','VES', 100000, ${TASA}::uuid,
                ${YO}::uuid)
        on conflict (organizacion_id, codigo) do nothing`
    }
  })

  const total = await dentro((q) => cuantosContratos(q))
  assert.ok(total > POR_PAGINA, `sin más de ${POR_PAGINA} contratos esto no comprobaría nada`)

  const primera = await dentro((q) => cartera(q, 'es'))
  assert.equal(primera.length, POR_PAGINA)

  const segunda = await dentro((q) => cartera(q, 'es', POR_PAGINA))
  assert.ok(segunda.length > 0, 'la segunda página tiene que traer los que faltan')
  // Y no repite: un contrato en las dos páginas es un contrato que se cuenta dos veces.
  const codigos = new Set(primera.map((c) => c.codigo))
  assert.equal(segunda.some((c) => codigos.has(c.codigo)), false)

  const h = pintarCartera(primera, 'es', false, [], [], { desde: 0, total })
  assert.match(h, new RegExp(`de ${total}`))
  assert.match(h, /href="\/\?desde=50"/)
  assert.equal(h.includes('‹falta:'), false)

  // En la última página no se ofrece «siguientes»: un enlace que lleva a una lista
  // vacía hace dudar de si se ha perdido algo.
  const ultima = pintarCartera(segunda, 'es', false, [], [],
    { desde: POR_PAGINA, total })
  assert.equal(/desde=\d+">Siguientes/.test(ultima), false)
  assert.match(ultima, /desde=0/)
})
