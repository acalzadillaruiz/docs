/**
 * Los equipos y lo que dejan.
 *
 * Para GPS no es contabilidad de adorno: alquiler de equipos es uno de los cinco
 * tipos de contrato, y un equipo alquilado genera ingreso y se gasta al mismo
 * tiempo. Si solo se mira el ingreso, el negocio parece mejor de lo que es.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { equipos, depreciarMes, mesesDepreciados } from '../src/dominio/activos.ts'
import { pintarActivos } from '../src/pantallas/activos.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '0b1c2d3e-1000-0000-0000-00000000000a'
const C = '0b1c2d3e-1000-0000-0000-00000000000b'
const YO = '0b1c2d3e-1000-0000-0000-00000000000d'
const ING = '0b1c2d3e-1000-0000-0000-00000000000e'
const TASA = '0b1c2d3e-1100-0000-0000-00000000000a'
const IVA = '0b1c2d3e-1100-0000-0000-00000000000b'
const CTR = '0b1c2d3e-2200-0000-0000-00000000000a'
const EQ = '0b1c2d3e-3300-0000-0000-00000000000a'
const SUELTO = '0b1c2d3e-3300-0000-0000-00000000000b'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Equipos','J-901800000-0'),
        ('${C}','operadora','Operadora Equipos','J-901900000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'equipos@prueba.test','Interno','clave_2fa','(h)','(s)'),
                   (${ING}, ${C},'equipos-cli@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2025-12-31', 40.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2018-01-01') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00)
        on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut,
                                 minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01')
        on conflict do nothing;
      select instalar_plan_cuentas('${G}');
      insert into periodo (organizacion_id, anio, mes) values
        ('${G}', 2026, 1), ('${G}', 2026, 2) on conflict do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR}','${G}','${C}','EQ-001','alquiler','Bomba','Pump',
                'vigente','VES', 3000000.00,'${TASA}','${YO}')
        on conflict (id) do update set codigo = excluded.codigo;

      -- La base no se vacia entre ejecuciones de un mismo archivo, y depreciar_mes se
      -- niega a repetir un mes que ya tiene asiento. Un asiento no se borra — es un
      -- hecho que ocurrio — asi que lo de la corrida anterior se reversa, que es lo
      -- mismo que haria una persona.
      select reversar_asiento(a.id, '${YO}','corrida anterior de las pruebas')
        from asiento a
       where a.organizacion_id = '${G}' and a.origen_tipo = 'depreciacion'
         and a.reversa_a is null
         and not exists (select 1 from asiento r where r.reversa_a = a.id);
      delete from depreciacion where activo_id in ('${EQ}','${SUELTO}');
      delete from activo where organizacion_id = '${G}';
      -- La valuacion que crea una de las pruebas mas abajo. Si se queda de una corrida
      -- anterior, las pruebas que miran el equipo SIN facturar ven ingreso y fallan: la
      -- base no se vacia entre ejecuciones de un mismo archivo.
      delete from valuacion where contrato_id = '${CTR}';
      -- Una bomba alquilada: 1.200.000 en cinco años, 20.000 al mes.
      insert into activo (id, organizacion_id, codigo, descripcion_es, descripcion_en,
                          cuenta, cuenta_depre, cuenta_gasto, en_servicio_el,
                          costo_ves, costo_usd, tasa_id, metodo, vida_meses, contrato_id)
        values ('${EQ}','${G}','BOM-01','Bomba de lodo','Mud pump',
                '1.2.01.04','1.2.02','5.2.05','2026-01-01', 1200000.00, 30000.00,'${TASA}',
                'linea_recta', 60,'${CTR}');
      -- Y un equipo sin alquilar, para ver que no inventa rendimiento.
      insert into activo (id, organizacion_id, codigo, descripcion_es, descripcion_en,
                          cuenta, cuenta_depre, cuenta_gasto, en_servicio_el,
                          costo_ves, costo_usd, tasa_id, metodo, vida_meses)
        values ('${SUELTO}','${G}','CAM-01','Camión','Truck',
                '1.2.01.05','1.2.02','5.2.05','2026-01-01', 600000.00, 15000.00,'${TASA}',
                'linea_recta', 60);
    `)
  })
})
after(async () => { await cerrar() })

test('depreciar un mes genera UN asiento, no uno por equipo', async () => {
  // Uno por equipo llenaría el libro de asientos de cuatro líneas y haría ilegible
  // el mayor de la cuenta de depreciación.
  const r = await dentro((q) => depreciarMes(q, G, 2026, 1, YO, 'es'))
  assert.equal(r.hecho, true)

  const [n] = (await dentro((q) => q`
    select count(*)::int as n from partida where asiento_id = ${(r as { asiento: string }).asiento}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.ok(n!.n >= 4, 'una línea por equipo, más sus contrapartidas, en un solo asiento')
})

test('el mismo mes no se deprecia dos veces', async () => {
  const otra = await dentro((q) => depreciarMes(q, G, 2026, 1, YO, 'es'))
  assert.equal(otra.hecho, false)
  assert.match((otra as { motivo: string }).motivo, /ya está depreciado/)
})

test('no se deprecia en un mes sin periodo contable abierto', async () => {
  const r = await dentro((q) => depreciarMes(q, G, 2026, 6, YO, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { motivo: string }).motivo, /periodo contable/)
})

test('el valor en libros baja con cada mes depreciado', async () => {
  const lista = await dentro((q) => equipos(q, G, 'es', '2026-01-31'))
  const bomba = lista.find((e) => e.codigo === 'BOM-01')!
  // 1.200.000 en 60 meses = 20.000 al mes. Tras enero quedan 1.180.000.
  assert.match(bomba.enLibros, /1\.180\.000,00/)
})

test('un equipo alquilado enseña LO QUE DEJA, no solo lo que vale', async () => {
  // Es la única cifra que contesta «¿alquilar esto sale a cuenta?».
  const lista = await dentro((q) => equipos(q, G, 'es', '2026-01-31'))
  const bomba = lista.find((e) => e.codigo === 'BOM-01')!
  assert.notEqual(bomba.deja, null)
  assert.notEqual(bomba.desgaste, null)
  assert.equal(bomba.contrato, 'EQ-001')
  // Sin nada facturado todavía, deja lo que se gastó, en negativo.
  assert.ok((bomba.dejaCrudo ?? 0) < 0)
})

test('un equipo sin alquilar no inventa rendimiento', async () => {
  const lista = await dentro((q) => equipos(q, G, 'es'))
  const camion = lista.find((e) => e.codigo === 'CAM-01')!
  assert.equal(camion.contrato, null)
  assert.equal(camion.deja, null)
  assert.equal(camion.ingreso, null)
})

test('lo que deja en negativo se ve en rojo: habría salido más barato parado', async () => {
  const lista = await dentro((q) => equipos(q, G, 'es', '2026-01-31'))
  const h = pintarActivos(lista, 'es', 'af', 2026, 2)
  assert.match(h, /class="eq-d mal"/)
})

test('con lo facturado por encima del desgaste, se ve en verde', async () => {
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`
      insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde,
        periodo_hasta, obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
        concepto_islr, ret_iva_pct, estado, aprobada_el, aprobada_por, creada_por)
      values ('0b1c2d3e-4400-0000-0000-00000000000a'::uuid, ${G}::uuid, ${CTR}::uuid, 1,
        '2026-01-01','2026-01-31', 500000.00,'VES', ${TASA}::uuid, 0, 0, ${IVA}::uuid,
        'SERV-PJ', 0,'aprobada','2026-01-31', ${ING}::uuid, ${YO}::uuid)
      on conflict (id) do update set estado = 'aprobada'`
  })
  const lista = await dentro((q) => equipos(q, G, 'es', '2026-01-31'))
  const bomba = lista.find((e) => e.codigo === 'BOM-01')!
  assert.ok((bomba.dejaCrudo ?? 0) > 0)
  const h = pintarActivos(lista, 'es', 'af', 2026, 2)
  assert.match(h, /class="eq-d bien"/)
})

test('los meses ya depreciados quedan listados', async () => {
  const m = await dentro((q) => mesesDepreciados(q, G))
  assert.ok(m.some((x) => Number(x.anio) === 2026 && Number(x.mes) === 1))
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const lista = await dentro((q) => equipos(q, G, 'en'))
  const en = pintarActivos(lista, 'en', 'af', 2026, 2)
  assert.match(en, /Equipment/)
  assert.match(en, /Mud pump/)
  assert.equal(en.includes('‹falta:'), false)
})

test('el cliente no llega a los equipos', async () => {
  await assert.rejects(
    comoPersona({ id: ING }, 'nexus_cliente', (q) => equipos(q, G, 'es')),
    /permission denied|no existe/,
  )
})

// ===========================================================================
// Y ANTES DE TODO ESTO: dar de alta un equipo.
//
// No existía. La pantalla enseñaba los equipos, calculaba su valor en libros, el
// rendimiento de los alquilados y corría la depreciación del mes... sobre una tabla en
// la que **nada, en ninguna parte, insertaba una fila**. Un módulo entero mirando por
// una ventana a una tabla vacía para siempre, y alquiler de equipos es uno de los
// cinco tipos de contrato de GPS.
//
// Lo encontró un barrido nuevo: tablas del esquema que la aplicación nunca escribe.
// Una tabla que nadie escribe es una función que no existe. Las pruebas de arriba no
// lo veían porque insertan sus equipos a mano — el fixture hacía lo que la aplicación
// no hacía, otra vez.

const { registrarActivo, cuentasPara, contratosDeAlquiler } =
  await import('../src/dominio/activos.ts')

/** Un equipo válido, al que cada prueba le cambia lo que quiere romper. */
const bueno = () => ({
  codigo: `ALTA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  descripcionEs: 'Compresor de alta', descripcionEn: 'High pressure compressor',
  cuenta: '1.2.01.04', cuentaDepre: '1.2.02', cuentaGasto: '5.2.05',
  enServicio: '2026-01-15', moneda: 'VES' as const,
  costo: 120000, residual: 20000,
  metodo: 'linea_recta' as const, vidaMeses: 60, unidadesVida: null,
  contratoId: null,
})

test('dar de alta un equipo: antes no había forma, y el módulo entero era una ventana', async () => {
  const e = bueno()
  const r = await dentro((q) => registrarActivo(q, G, e, 'es'))
  assert.equal(r.hecho, true, (r as { errores?: string[] }).errores?.join(' · '))

  // Y aparece en la pantalla, que es la mitad que importa.
  const lista = await dentro((q) => equipos(q, G, 'es'))
  assert.ok(lista.some((x) => x.codigo === e.codigo), 'no salió en la lista de equipos')
})

test('y entra en la depreciación del mes, que es para lo que sirve', async () => {
  const e = { ...bueno(), enServicio: '2026-01-15' }
  const r = await dentro((q) => registrarActivo(q, G, e, 'es'))
  assert.equal(r.hecho, true)
  const id = (r as { id: string }).id
  // Línea recta: (120.000 − 20.000) / 60 = 1.666,67 al mes.
  const [c] = (await dentro((q) => q`
    select cuota_depreciacion(${id}::uuid, 2026, 3)::text as cuota
  `)) as unknown as Array<{ cuota: string }>
  assert.equal(Number(c!.cuota), 1666.67)
})

test('el formulario da TODOS los errores de una vez, no el primero', async () => {
  // Trece casillas. Uno de cada vez son cuatro vueltas al formulario.
  const r = await dentro((q) => registrarActivo(q, G, {
    ...bueno(), codigo: '  ', descripcionEn: '', costo: Number.NaN, enServicio: 'ayer',
  }, 'es'))
  assert.equal(r.hecho, false)
  const errs = (r as { errores: readonly string[] }).errores
  assert.ok(errs.length >= 4, `solo dio ${errs.length} errores: ${errs.join(' · ')}`)
})

test('un costo ilegible NO entra como cero', async () => {
  // `Number('mucho')` no falla: devuelve NaN. Y `NaN <= 0` es falso, así que una
  // comprobación escrita al revés lo dejaría pasar y registraría un equipo de coste
  // cero, que no se deprecia nunca y nadie entiende por qué.
  const r = await dentro((q) => registrarActivo(q, G, { ...bueno(), costo: Number.NaN }, 'es'))
  assert.equal(r.hecho, false)
  assert.ok((r as { errores: readonly string[] }).errores.some((x) => /costo/i.test(x)))
})

test('el valor residual no puede llegar al costo', async () => {
  for (const residual of [120000, 130000]) {
    const r = await dentro((q) => registrarActivo(q, G, { ...bueno(), residual }, 'es'))
    assert.equal(r.hecho, false, `residual ${residual} no puede valer`)
  }
})

test('por horas de operación hacen falta las horas, y por meses los meses', async () => {
  const sinHoras = await dentro((q) => registrarActivo(q, G, {
    ...bueno(), metodo: 'unidades_produccion', unidadesVida: null,
  }, 'es'))
  assert.equal(sinHoras.hecho, false)

  const sinMeses = await dentro((q) => registrarActivo(q, G, {
    ...bueno(), metodo: 'linea_recta', vidaMeses: null,
  }, 'es'))
  assert.equal(sinMeses.hecho, false)

  // Y por horas, con sus horas, sí entra.
  const bien = await dentro((q) => registrarActivo(q, G, {
    ...bueno(), metodo: 'unidades_produccion', vidaMeses: null, unidadesVida: 20000,
  }, 'es'))
  assert.equal(bien.hecho, true, (bien as { errores?: string[] }).errores?.join(' · '))
})

test('el mismo código no se da de alta dos veces', async () => {
  const e = bueno()
  assert.equal((await dentro((q) => registrarActivo(q, G, e, 'es'))).hecho, true)
  const otra = await dentro((q) => registrarActivo(q, G, e, 'es'))
  assert.equal(otra.hecho, false)
})

test('hace falta la descripción en los DOS idiomas', async () => {
  // Bilingüe desde el primer día: un equipo con nombre en un solo idioma sale como un
  // hueco en la pantalla del otro.
  const r = await dentro((q) => registrarActivo(q, G, { ...bueno(), descripcionEn: '' }, 'es'))
  assert.equal(r.hecho, false)
  const en = await dentro((q) => registrarActivo(q, G, { ...bueno(), descripcionEs: '' }, 'es'))
  assert.equal(en.hecho, false)
})

test('una cuenta de agrupación no vale: dejaría saldo donde no debe haberlo', async () => {
  // '1.2' es un nivel de agrupación, no imputable. La base de datos lo aceptaría
  // —solo mira que exista— y el mayor quedaría con saldo en un nivel intermedio.
  const r = await dentro((q) => registrarActivo(q, G, { ...bueno(), cuenta: '1.2' }, 'es'))
  assert.equal(r.hecho, false)
  const inventada = await dentro((q) =>
    registrarActivo(q, G, { ...bueno(), cuentaGasto: '9.9.99' }, 'es'))
  assert.equal(inventada.hecho, false)
})

test('sin tasa del BCV de ese día no se registra: el costo en la otra moneda sería inventado', async () => {
  const r = await dentro((q) =>
    registrarActivo(q, G, { ...bueno(), enServicio: '2019-03-07' }, 'es'))
  assert.equal(r.hecho, false)
  assert.ok((r as { errores: readonly string[] }).errores.some((x) => /BCV|tasa/i.test(x)))
})

test('el contrato de otra empresa no se le puede imputar', async () => {
  const otra = '0b1c2d3e-9900-0000-0000-00000000000a'
  const ctrAjeno = '0b1c2d3e-9900-0000-0000-00000000000b'
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif)
        values ('${otra}','gps','GPS Equipos Otra','J-907100000-0')
        on conflict (id) do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es,
                            titulo_en, estado, moneda, monto, tasa_id, creado_por)
        values ('${ctrAjeno}','${otra}','${C}','EQ-AJENO','alquiler','De otra','Other',
                'vigente','VES', 1000.00,'${TASA}','${YO}')
        on conflict (id) do nothing;
    `)
  })
  const r = await dentro((q) =>
    registrarActivo(q, G, { ...bueno(), contratoId: ctrAjeno }, 'es'))
  assert.equal(r.hecho, false)
  assert.ok((r as { errores: readonly string[] }).errores.some((x) => /contrato/i.test(x)))
})

test('las listas del formulario traen lo que se puede elegir, y nada más', async () => {
  const activo = await dentro((q) => cuentasPara(q, G, 'activo', 'es'))
  const gasto = await dentro((q) => cuentasPara(q, G, 'gasto', 'es'))
  assert.ok(activo.some((c) => c.codigo === '1.2.01.04'), 'falta la cuenta de equipos de alquiler')
  assert.ok(gasto.some((c) => c.codigo === '5.2.05'), 'falta la cuenta de gasto de depreciación')
  // Ninguna de agrupación: si sale en la lista, alguien la elige.
  assert.equal(activo.some((c) => c.codigo === '1.2'), false)

  const ctrs = await dentro((q) => contratosDeAlquiler(q, G))
  assert.ok(ctrs.every((c) => c.codigo !== 'EQ-AJENO'), 'ofrece el contrato de otra empresa')
})

test('la pantalla trae el formulario, y en los dos idiomas', async () => {
  const lista = await dentro((q) => equipos(q, G, 'es'))
  const alta = {
    cuentasActivo: await dentro((q) => cuentasPara(q, G, 'activo', 'es')),
    cuentasGasto: await dentro((q) => cuentasPara(q, G, 'gasto', 'es')),
    contratos: await dentro((q) => contratosDeAlquiler(q, G)),
    hoy: '2026-03-01',
  }
  for (const idioma of ['es', 'en'] as const) {
    const h = pintarActivos(lista, idioma, 'af', 2026, 3, [], alta)
    assert.match(h, /name="accion" value="alta"/, `${idioma}: no hay formulario de alta`)
    assert.match(h, /name="cuenta_depre"/)
    assert.equal(h.includes('‹falta:'), false, `${idioma} tiene una clave sin traducir`)
  }
  // Y sin los datos del alta, la pantalla sigue saliendo: es lo que llaman las
  // pruebas viejas, y romperlas para añadir esto habría sido peor.
  const sin = pintarActivos(lista, 'es', 'af', 2026, 3)
  assert.doesNotMatch(sin, /name="accion" value="alta"/)
})
