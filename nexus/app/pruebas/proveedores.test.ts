/**
 * Las retenciones a proveedores.
 *
 * GPS es agente de retención: no retener cuando toca lo paga GPS de su bolsillo,
 * con multa. Y lo que más se discute con un proveedor: sin número de control la
 * retención de IVA es del 100%, no del 75%.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import {
  facturasDeProveedor, conceptosIslr, retener, esAgenteDeRetencion,
} from '../src/dominio/proveedores.ts'
import { pintarProveedores } from '../src/pantallas/proveedores.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '8f9a0b1c-0000-0000-0000-00000000000a'
const PR = '8f9a0b1c-0000-0000-0000-00000000000c'
const YO = '8f9a0b1c-0000-0000-0000-00000000000d'
const TASA = '8f9a0b1c-1111-0000-0000-00000000000a'
const IVA = '8f9a0b1c-1111-0000-0000-00000000000b'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

/** Una factura de proveedor nueva. Con o sin número de control. */
async function factura(conControl: boolean, base = 1000000): Promise<string> {
  const id = randomUUID()
  const numero = String(Date.now() % 100000000).padStart(8, '0') + Math.floor(Math.random() * 99)
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`
      insert into documento_fiscal (id, organizacion_id, sentido, tipo, numero, numero_control,
                                    contraparte_id, fecha, base_ves, base_usd,
                                    alicuota_iva_id, iva_ves, iva_usd, tasa_id, registrado_por)
      values (${id}::uuid, ${G}::uuid,'recibido','factura', ${numero},
              ${conControl ? '01-00012345' : null}, ${PR}::uuid,'2026-04-10',
              ${base}, ${base / 40}, ${IVA}::uuid, ${base * 0.16}, ${(base * 0.16) / 40},
              ${TASA}::uuid, ${YO}::uuid)`
  })
  return id
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Retenciones','J-901400000-0'),
        ('${PR}','proveedor','Suministros Retención','J-30444444-4')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'ret@prueba.test','Interno','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-04-05', 40.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2026-01-01') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00)
        on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut,
                                 minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01')
        on conflict do nothing;
      select instalar_plan_cuentas('${G}');
      -- Solo un contribuyente especial retiene IVA. Sin esta fila, la base de datos
      -- se niega, y con razon.
      insert into regimen_iva (organizacion_id, vigente_desde, es_especial)
        values ('${G}','2026-01-01', true) on conflict do nothing;
      insert into periodo (organizacion_id, anio, mes) values ('${G}', 2026, 4)
        on conflict do nothing;
    `)
  })
})
after(async () => { await cerrar() })

test('la retención de IVA es del 75% cuando la factura trae número de control', async () => {
  const f = await factura(true)
  const r = await dentro((q) => retener(q, f, 'iva', '', YO, 'es'))
  assert.equal(r.hecho, true)

  const [ret] = (await dentro((q) => q`
    select porcentaje::text, monto_ves::text from retencion
     where documento_id = ${f}::uuid and clase = 'iva'
  `)) as unknown as Array<{ porcentaje: string; monto_ves: string }>
  assert.equal(ret!.porcentaje, '75.00')
  // 16% de 1.000.000 = 160.000; el 75% son 120.000.
  assert.equal(ret!.monto_ves, '120000.00')
})

test('SIN número de control la retención es del 100%: es la ley', async () => {
  // Es lo primero que se discute con un proveedor.
  const f = await factura(false)
  await dentro((q) => retener(q, f, 'iva', '', YO, 'es'))
  const [ret] = (await dentro((q) => q`
    select porcentaje::text, monto_ves::text from retencion
     where documento_id = ${f}::uuid and clase = 'iva'
  `)) as unknown as Array<{ porcentaje: string; monto_ves: string }>
  assert.equal(ret!.porcentaje, '100.00')
  assert.equal(ret!.monto_ves, '160000.00')
})

test('el comprobante lleva correlativo, y no se repite', async () => {
  const a = await factura(true)
  const b = await factura(true)
  const ra = await dentro((q) => retener(q, a, 'iva', '', YO, 'es'))
  const rb = await dentro((q) => retener(q, b, 'iva', '', YO, 'es'))
  assert.equal(ra.hecho && rb.hecho, true)
  const na = (ra as { comprobante: string }).comprobante
  const nb = (rb as { comprobante: string }).comprobante
  assert.match(na, /^\d{6}\d{8}$/, 'AAAAMM + secuencia')
  assert.notEqual(na, nb)
})

test('no se retiene dos veces lo mismo', async () => {
  const f = await factura(true)
  await dentro((q) => retener(q, f, 'iva', '', YO, 'es'))
  const otra = await dentro((q) => retener(q, f, 'iva', '', YO, 'es'))
  assert.equal(otra.hecho, false)
  assert.match((otra as { motivo: string }).motivo, /ya tiene esa retención/)
})

test('el ISLR exige decir por qué concepto se retiene', async () => {
  const f = await factura(true)
  const sin = await dentro((q) => retener(q, f, 'islr', '   ', YO, 'es'))
  assert.equal(sin.hecho, false)
  assert.match((sin as { motivo: string }).motivo, /concepto/)

  const con = await dentro((q) => retener(q, f, 'islr', 'SERV-PJ', YO, 'es'))
  assert.equal(con.hecho, true)
})

test('la retención de ISLR guarda la REGLA, no solo el resultado', async () => {
  // Guardar la regla es lo que permite reproducir el cálculo dentro de tres años.
  const f = await factura(true)
  await dentro((q) => retener(q, f, 'islr', 'SERV-PJ', YO, 'es'))
  const [ret] = (await dentro((q) => q`
    select porcentaje::text, sustraendo_ves::text, concepto_islr, base_ves::text
      from retencion where documento_id = ${f}::uuid and clase = 'islr'
  `)) as unknown as Array<Record<string, string>>
  assert.equal(ret!['porcentaje'], '5.00')
  assert.equal(ret!['concepto_islr'], 'SERV-PJ')
  assert.ok(Number(ret!['sustraendo_ves']) > 0, 'el sustraendo en UT queda guardado')
})

test('la lista pone delante lo que falta por retener', async () => {
  const f = await factura(true)
  const lista = await dentro((q) => facturasDeProveedor(q, G, 'es'))
  // Una lista donde lo hecho y lo pendiente se mezclan obliga a leerla entera.
  assert.ok(lista.some((x) => x.id === f))
  assert.equal(lista.every((x) => x.retenidoIva === null || x.retenidoIslr === null), true)
})

test('la pantalla marca la factura SIN número de control, antes de pulsar', async () => {
  await factura(false)
  const lista = await dentro((q) => facturasDeProveedor(q, G, 'es'))
  const conceptos = await dentro((q) => conceptosIslr(q, 'es'))
  const h = pintarProveedores(lista, conceptos, 'es', 'af')
  // Descubrirlo después de retener significa una nota y una llamada.
  assert.match(h, /class="fp sin-control"/)
  assert.match(h, /la retención de IVA es del 100%/)
})

test('el comprobante se enseña: es lo que el proveedor pide por teléfono', async () => {
  const f = await factura(true)
  await dentro((q) => retener(q, f, 'iva', '', YO, 'es'))
  const lista = await dentro((q) => facturasDeProveedor(q, G, 'es'))
  const mia = lista.find((x) => x.id === f)!
  assert.ok(mia.comprobanteIva)
  const h = pintarProveedores(lista, await dentro((q) => conceptosIslr(q, 'es')), 'es', 'af')
  assert.match(h, new RegExp(mia.comprobanteIva!))
})

test('los conceptos de ISLR salen con su porcentaje al lado', async () => {
  const c = await dentro((q) => conceptosIslr(q, 'es'))
  assert.ok(c.some((x) => x.codigo === 'SERV-PJ'))
  assert.match(c.find((x) => x.codigo === 'SERV-PJ')!.nombre, /5\.00 %|5,00 %/)
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const lista = await dentro((q) => facturasDeProveedor(q, G, 'en'))
  const en = pintarProveedores(lista, await dentro((q) => conceptosIslr(q, 'en')), 'en', 'af')
  assert.match(en, /Supplier invoices/)
  assert.equal(en.includes('‹falta:'), false)
})

test('si la empresa NO es agente de retención, no se ofrece el botón y se dice por qué', async () => {
  // Un botón que aparece y revienta hace pensar que el sistema está roto, cuando lo
  // que falta es un dato del régimen.
  const SIN = '8f9a0b1c-0000-0000-0000-00000000000f'
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`insert into organizacion (id, tipo, nombre, rif)
            values (${SIN},'gps','GPS No Agente','J-901500000-0') on conflict (id) do nothing`
    await q`delete from regimen_iva where organizacion_id = ${SIN}::uuid`
  })
  assert.equal(await dentro((q) => esAgenteDeRetencion(q, SIN)), false)
  assert.equal(await dentro((q) => esAgenteDeRetencion(q, G)), true)

  const h = pintarProveedores([{
    id: randomUUID(), numero: '001', control: '01-1', proveedor: 'P', rif: 'J-1',
    fecha: '2026-04-10', base: 'Bs 1', iva: 'Bs 0,16', tieneIva: true,
    retenidoIva: null, retenidoIslr: null, comprobanteIva: null, comprobanteIslr: null,
  }], [], 'es', 'af', [], false)
  assert.match(h, /no consta como agente de retención/)
  assert.equal(h.includes('value="iva"'), false, 'sin el botón que va a reventar')
})

test('retener cuando no se es agente se niega con su motivo, no con un error crudo', async () => {
  const SIN = '8f9a0b1c-0000-0000-0000-00000000000f'
  const id = randomUUID()
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values ('8f9a0b1c-0000-0000-0000-0000000000ff', ${SIN},'noag@prueba.test',
                    'Interno','clave_2fa','(h)','(s)') on conflict (id) do nothing`
    await q`
      insert into documento_fiscal (id, organizacion_id, sentido, tipo, numero, numero_control,
                                    contraparte_id, fecha, base_ves, base_usd,
                                    alicuota_iva_id, iva_ves, iva_usd, tasa_id, registrado_por)
      values (${id}::uuid, ${SIN}::uuid,'recibido','factura','NOAG-1','01-9', ${PR}::uuid,
              '2026-04-10', 1000, 25, ${IVA}::uuid, 160, 4, ${TASA}::uuid,
              '8f9a0b1c-0000-0000-0000-0000000000ff')`
  })
  const r = await comoPersona({ id: '8f9a0b1c-0000-0000-0000-0000000000ff' }, 'nexus_interno',
    (q) => retener(q, id, 'iva', '', '8f9a0b1c-0000-0000-0000-0000000000ff', 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { motivo: string }).motivo, /no consta como agente/)
})

// ===========================================================================
// Y ANTES DE TODO ESTO: registrar el régimen de IVA.
//
// La pantalla decía, con estas palabras, «Esta empresa no consta como agente de
// retención de IVA en esta fecha, así que no corresponde retener. Si lo es, **hay que
// registrarlo en su régimen de IVA**». Y no había forma de registrarlo: `regimen_iva`
// la escribían solo las pruebas, cada una en su propio fixture.
//
// O sea que en uso real la retención de IVA a proveedores —que para un contribuyente
// especial es una obligación, no una opción— no se podía hacer nunca. Una pantalla que
// manda hacer algo tiene que poder hacerlo.
//
// Y las pruebas de arriba no lo veían porque siembran la fila a mano: el fixture hacía
// lo que la aplicación no hacía, otra vez.

const { regimenes, registrarRegimen } = await import('../src/dominio/proveedores.ts')

/** Una empresa propia para estas pruebas: tocar el régimen de G rompería las de arriba. */
const REG = '8f9a0b1c-7000-0000-0000-00000000000a'

async function sinRegimen(): Promise<void> {
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`insert into organizacion (id, tipo, nombre, rif)
            values (${REG},'gps','GPS Régimen','J-907200000-0')
            on conflict (id) do nothing`
    await q`delete from regimen_iva where organizacion_id = ${REG}::uuid`
  })
}

test('registrar el régimen: antes no había forma y no se podía retener a nadie', async () => {
  await sinRegimen()
  assert.equal(await dentro((q) => esAgenteDeRetencion(q, REG, '2026-06-15')), false)

  const r = await dentro((q) => registrarRegimen(q, REG, {
    desde: '2026-06-01', esEspecial: true, normal: 75, falla: 100,
  }, 'es'))
  assert.equal(r.hecho, true, (r as { errores?: string[] }).errores?.join(' · '))

  // Y con eso la empresa ya puede retener, que es lo único que importa de esta fila.
  assert.equal(await dentro((q) => esAgenteDeRetencion(q, REG, '2026-06-15')), true)
  // Antes de la fecha, no: es un histórico, no un interruptor.
  assert.equal(await dentro((q) => esAgenteDeRetencion(q, REG, '2026-05-31')), false)
})

test('la retención por factura defectuosa NO puede ser menor que la normal', async () => {
  // Es la comprobación que nadie piensa en escribir. Al revés significaría que a un
  // proveedor le sale mejor entregar la factura mal, y eso no lo dice ninguna ley: lo
  // diría un dedo gordo al teclear los dos porcentajes.
  await sinRegimen()
  const r = await dentro((q) => registrarRegimen(q, REG, {
    desde: '2026-06-01', esEspecial: true, normal: 100, falla: 75,
  }, 'es'))
  assert.equal(r.hecho, false)
  assert.ok((r as { errores: readonly string[] }).errores.some((e) => /defectuosa|menor/i.test(e)))
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from regimen_iva where organizacion_id = ${REG}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 0)
})

test('un porcentaje ilegible NO entra como cero, que sería no retener fingiendo que sí', async () => {
  await sinRegimen()
  for (const campo of ['normal', 'falla'] as const) {
    const r = await dentro((q) => registrarRegimen(q, REG, {
      desde: '2026-06-01', esEspecial: true,
      normal: campo === 'normal' ? Number.NaN : 75,
      falla: campo === 'falla' ? Number.NaN : 100,
    }, 'es'))
    assert.equal(r.hecho, false, `${campo} ilegible tendría que rechazarse`)
  }
  for (const pct of [-1, 101]) {
    const r = await dentro((q) => registrarRegimen(q, REG, {
      desde: '2026-06-01', esEspecial: true, normal: pct, falla: 100,
    }, 'es'))
    assert.equal(r.hecho, false, `${pct} % no es un porcentaje`)
  }
})

test('una fecha ilegible tampoco', async () => {
  await sinRegimen()
  for (const desde of ['', 'ayer', '2026-13-40']) {
    const r = await dentro((q) => registrarRegimen(q, REG, {
      desde, esEspecial: true, normal: 75, falla: 100,
    }, 'es'))
    assert.equal(r.hecho, false, `«${desde}» no es una fecha`)
  }
})

test('es un histórico: dos tramos con su fecha, y el de la fecha manda', async () => {
  await sinRegimen()
  await dentro((q) => registrarRegimen(q, REG, {
    desde: '2026-01-01', esEspecial: false, normal: 0, falla: 0,
  }, 'es'))
  await dentro((q) => registrarRegimen(q, REG, {
    desde: '2026-07-01', esEspecial: true, normal: 75, falla: 100,
  }, 'es'))

  // Lo que se retuvo antes se rigió por lo de antes.
  assert.equal(await dentro((q) => esAgenteDeRetencion(q, REG, '2026-06-30')), false)
  assert.equal(await dentro((q) => esAgenteDeRetencion(q, REG, '2026-07-01')), true)

  const lista = await dentro((q) => regimenes(q, REG, 'es'))
  assert.equal(lista.length, 2)
  // Del más nuevo al más viejo: lo que rige hoy va arriba.
  assert.equal(lista[0]!.desde, '2026-07-01')
  assert.equal(lista[0]!.esEspecial, true)
  assert.equal(lista[1]!.esEspecial, false)
})

test('la misma fecha se corrige, no se duplica', async () => {
  await sinRegimen()
  await dentro((q) => registrarRegimen(q, REG, {
    desde: '2026-07-01', esEspecial: true, normal: 75, falla: 100,
  }, 'es'))
  const otra = await dentro((q) => registrarRegimen(q, REG, {
    desde: '2026-07-01', esEspecial: true, normal: 80, falla: 100,
  }, 'es'))
  assert.equal(otra.hecho, true)
  const lista = await dentro((q) => regimenes(q, REG, 'es'))
  assert.equal(lista.length, 1)
  assert.match(lista[0]!.normal, /80/)
})

test('la lista dice cuántas retenciones se emitieron bajo cada tramo', async () => {
  // Es lo que hace visible la consecuencia de cambiar uno: un tramo con retenciones
  // debajo no se toca a la ligera, y el número está delante antes de tocarlo.
  const lista = await dentro((q) => regimenes(q, G, 'es'))
  assert.ok(lista.length > 0, 'la empresa de las pruebas de arriba sí tiene régimen')
  assert.ok(lista.every((r) => Number.isInteger(r.retenciones)))
  assert.ok(lista.some((r) => r.retenciones >= 0))
})

test('la pantalla trae el formulario y el histórico, en los dos idiomas', async () => {
  const lista = await dentro((q) => regimenes(q, G, 'es'))
  for (const idioma of ['es', 'en'] as const) {
    const h = pintarProveedores([], [], idioma, 'af', [], true, lista, '2026-07-15')
    assert.match(h, /name="accion" value="regimen"/, `${idioma}: no hay formulario`)
    assert.match(h, /name="r_falla"/)
    assert.equal(h.includes('‹falta:'), false, `${idioma} tiene una clave sin traducir`)
  }
  // Sin régimen, lo dice y dice qué significa: que no se puede retener a nadie.
  const vacia = pintarProveedores([], [], 'es', 'af', [], false, [], '2026-07-15')
  assert.match(vacia, /no se puede retener IVA a nadie/)
})
