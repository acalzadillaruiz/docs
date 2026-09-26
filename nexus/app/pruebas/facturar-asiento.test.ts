/**
 * Facturar una valuación tiene que dejar el ingreso EN EL LIBRO.
 *
 * No lo dejaba. `asentar_valuacion()` existe en el esquema desde el principio, hace
 * el asiento de la venta —debe cuentas por cobrar y retenciones, haber ingresos e IVA
 * débito fiscal— y está probada en `db/pruebas/03-generadores.sql`. **La aplicación
 * no la llamaba nunca.** La llamaban solo las pruebas, que se lo montaban a mano en
 * su fixture antes de mirar.
 *
 * Lo que eso significaba en uso real: GPS aprueba la valuación, emite la factura, el
 * cliente la recibe, el libro de ventas la enseña —se construye desde
 * `documento_fiscal`— y **el diario no tiene nada**. Después el cobro sí se asienta,
 * porque `registrarCobro` sí llama a `asentar_cobro`, así que la cuenta por cobrar se
 * va a negativo y el estado de resultados sale sin ingresos.
 *
 * Y el motivo de que ninguna prueba lo viera es el mismo que ya ha salido cuatro
 * veces en este proyecto, con otra cara: **el fixture hacía lo que la aplicación no
 * hacía**. Los libros cuadraban porque la prueba asentaba la venta.
 *
 * Por eso este archivo no asienta nada a mano. Llama a `facturar()`, que es lo que
 * llama la ruta, y después mira el libro.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { emitir, facturar } from '../src/dominio/valuar.ts'
import { aprobar } from '../src/dominio/aprobacion.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'ff000000-0000-0000-0000-0000000000a1'
const C = 'ff000000-0000-0000-0000-0000000000a2'
const YO = 'ff000000-0000-0000-0000-0000000000a3'
const ING = 'ff000000-0000-0000-0000-0000000000a4'
const TASA = 'ff000000-0000-0000-0000-0000000000a5'
const IVA = 'ff000000-0000-0000-0000-0000000000a6'
const CTR = 'ff000000-0000-0000-0000-0000000000a7'
const RG = 'ff000000-0000-0000-0000-0000000000a8'
const H = (n: number) => `ff000000-4444-0000-0000-${String(n).padStart(12, '0')}`

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)
const comoCliente = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: ING }, 'nexus_cliente', f)

const DESDE = '2026-06-01'
const HASTA = '2026-06-30'

/** Deja el renglón con 40 puntos verificados y ninguna valuación viva. */
async function limpio(): Promise<void> {
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    // El mes abierto, por si una prueba anterior murió con él cerrado.
    await q`update periodo set estado = 'abierto'
             where organizacion_id = ${G}::uuid and anio = 2026 and mes = 6`
    // Los asientos NO se borran, ni siquiera en una prueba: el disparador lo impide
    // y tiene razón —un asiento es un hecho que ocurrió—. Así que cada prueba trabaja
    // con una valuación nueva y cuenta los asientos de ESA, no los de la empresa. El
    // libro se mira entero, que con varios asientos cuadrados sigue cuadrando.
    await q`delete from hito where renglon_id = ${RG}::uuid`
    await q`delete from aviso where sobre_id in (
              select id from valuacion where contrato_id = ${CTR}::uuid)`
    // La valuación apunta a su factura, así que la valuación se borra ANTES que el
    // documento. Es el mismo orden que ya mordió dos veces en otros fixtures.
    await q`delete from valuacion where contrato_id = ${CTR}::uuid`
    await q`delete from documento_fiscal where organizacion_id = ${G}::uuid`
    await q.unsafe(`
      insert into hito (id, renglon_id, orden, clave, nombre_es, nombre_en, peso, exige,
                        estado, ocurrido_en) values
        ('${H(1)}','${RG}', 1,'orden','Orden','PO', 10.00,'{}','verificado','2026-06-04'),
        ('${H(2)}','${RG}', 2,'fabricado','Fabricado','Made', 30.00,'{}','verificado','2026-06-20'),
        ('${H(3)}','${RG}', 3,'recibido','Recibido','Received', 60.00,'{}','pendiente', null);
    `)
  })
}

/** Emite, la aprueba el cliente, y devuelve la valuación lista para facturar. */
async function hastaAprobada(): Promise<string> {
  await limpio()
  const r = await dentro((q) => emitir(q, {
    contratoId: CTR, desde: DESDE, hasta: HASTA,
    retieneIva: false, pagaEnDivisa: false,
  }, YO, G, 'es'))
  assert.equal(r.hecho, true, (r as { motivo?: string }).motivo)
  const id = (r as { valuacionId: string }).valuacionId
  await dentro((q) => q`
    update valuacion set estado = 'presentada' where id = ${id}::uuid`)
  const a = await comoCliente((q) => aprobar(q, id, ING, true))
  assert.equal(a.hecho, true, (a as { motivo?: string }).motivo)
  return id
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Asiento Venta','J-906800000-0'),
        ('${C}','operadora','Operadora Asiento','J-906900000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto) values
              (${YO}, ${G},'asiento@prueba.test','Interno','clave_2fa','(h)','(s)'),
              (${ING}, ${C},'asiento-cli@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-06-11', 80.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2026-01-01') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00)
        on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje,
                                 factor_ut, minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,
                '2026-01-01') on conflict do nothing;
      select instalar_plan_cuentas('${G}');
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es,
                            titulo_en, estado, moneda, monto, tasa_id, creado_por,
                            amortiza_pct, garantia_pct)
        values ('${CTR}','${G}','${C}','ASI-001','procura','Cabezales','Wellheads',
                'vigente','VES', 200000.00,'${TASA}','${YO}', 0, 0)
        on conflict (id) do update set estado = excluded.estado;
      insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                           cantidad, unidad, precio_unitario, costo_unitario)
        values ('${RG}','${CTR}', 1,'Cabezal','Wellhead', 2,'unidad', 100000.0000, 62000.0000)
        on conflict (id) do update set precio_unitario = excluded.precio_unitario;
      insert into periodo (organizacion_id, anio, mes, estado)
        values ('${G}', 2026, 6,'abierto')
        on conflict (organizacion_id, anio, mes) do update set estado = 'abierto';
    `)
  })
})
after(async () => { await cerrar() })

/** Cuántos asientos tiene una valuación. Es lo que faltaba: siempre daba cero. */
async function asientosDe(valuacionId: string): Promise<number> {
  const [r] = (await dentro((q) => q`
    select count(*)::int as n from asiento
     where origen_tipo = 'valuacion' and origen_id = ${valuacionId}::uuid
  `)) as unknown as Array<{ n: number }>
  return Number(r!.n)
}

test('facturar DEJA EL ASIENTO. Antes no lo dejaba: esto es el agujero', async () => {
  const val = await hastaAprobada()
  assert.equal(await asientosDe(val), 0, 'ya había asiento antes de facturar')

  const f = await dentro((q) => facturar(q, val, YO, false, 'es'))
  assert.equal(f.hecho, true, (f as { motivo?: string }).motivo)
  assert.equal(await asientosDe(val), 1,
    'se emitió la factura y el ingreso no entró al libro')
})

test('y el asiento lleva el ingreso y el IVA débito, no solo el cobro', async () => {
  const val = await hastaAprobada()
  await dentro((q) => facturar(q, val, YO, false, 'es'))

  const partidas = (await dentro((q) => q`
    select c.concepto::text as concepto, p.monto_ves::text as monto
      from partida p
      join asiento a on a.id = p.asiento_id
      join mapa_cuenta c on c.organizacion_id = a.organizacion_id and c.cuenta = p.cuenta
     where a.origen_tipo = 'valuacion' and a.origen_id = ${val}::uuid
     order by p.linea
  `)) as unknown as Array<{ concepto: string; monto: string }>

  const por = new Map(partidas.map((p) => [p.concepto, Number(p.monto)]))
  // 40 puntos de 200.000 = 80.000 de obra, IVA al 16% = 12.800.
  assert.equal(por.get('ingreso_obra'), -80000, 'el ingreso no está en el libro')
  assert.equal(por.get('iva_debito'), -12800, 'el IVA débito fiscal no está en el libro')

  // Y el debe. NO se comprueba contra un número escrito a mano: el cliente retiene
  // ISLR, así que a la cuenta por cobrar le llega menos que la factura, y la
  // diferencia es exactamente la retención. Escribir aquí «92.800» habría sido copiar
  // una cuenta que el sistema hace mejor — y el día que cambie la tabla del SENIAT,
  // la prueba estaría defendiendo un número viejo.
  const debe = partidas.filter((p) => Number(p.monto) > 0)
    .reduce((n, p) => n + Number(p.monto), 0)
  assert.equal(debe, 92800, 'el debe no suma obra + IVA')
  assert.ok((por.get('cxc') ?? 0) > 0, 'la cuenta por cobrar no se cargó')
  assert.ok((por.get('ret_islr_sufrida') ?? 0) > 0,
    'el ISLR que retiene el cliente no quedó anotado como retención sufrida')
  assert.equal(por.get('cxc')! + por.get('ret_islr_sufrida')!, 92800,
    'lo que se cobra más lo retenido tiene que dar la factura')
})

test('y el libro queda CUADRADO sin que ninguna prueba lo asiente a mano', async () => {
  // Ésta es la afirmación que faltaba. Cuadrar no valía de nada mientras el fixture
  // asentara la venta él mismo: cuadraban los libros de la prueba, no los del
  // producto. Aquí no se asienta nada a mano.
  const val = await hastaAprobada()
  await dentro((q) => facturar(q, val, YO, false, 'es'))

  // Primero: que HAYA algo. Un libro vacío cuadra, y cuadrar sin nada dentro es la
  // misma trampa que «todo cuadra» sobre un mes sin extracto. Se comprobó apagando
  // el asiento: sin esta línea, esta prueba pasaba igual.
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from partida p
      join asiento a on a.id = p.asiento_id
     where a.origen_tipo = 'valuacion' and a.origen_id = ${val}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.ok(n!.n >= 3, 'el asiento de la venta no tiene partidas: no hay nada que cuadrar')

  const [d] = (await dentro((q) => q`
    select ves::text from descuadre(${G}::uuid, '2026-12-31'::date)
  `)) as unknown as Array<{ ves: string }>
  assert.equal(Number(d?.ves ?? 0), 0, 'el libro quedó descuadrado')
})

test('la factura y el diario cuentan LO MISMO', async () => {
  // Antes el libro de ventas —que se construye desde documento_fiscal— enseñaba una
  // factura que el diario no tenía. Dos verdades sobre el mismo hecho.
  const val = await hastaAprobada()
  await dentro((q) => facturar(q, val, YO, false, 'es'))
  const [f] = (await dentro((q) => q`
    select df.base_ves::text as base, df.iva_ves::text as iva
      from documento_fiscal df
      join valuacion v on v.documento_id = df.id
     where v.id = ${val}::uuid
  `)) as unknown as Array<{ base: string; iva: string }>
  const [l] = (await dentro((q) => q`
    select
      (select -sum(p.monto_ves) from partida p
         join asiento a on a.id = p.asiento_id
         join mapa_cuenta c on c.organizacion_id = a.organizacion_id and c.cuenta = p.cuenta
        where a.origen_id = ${val}::uuid and c.concepto = 'ingreso_obra')::text as obra,
      (select -sum(p.monto_ves) from partida p
         join asiento a on a.id = p.asiento_id
         join mapa_cuenta c on c.organizacion_id = a.organizacion_id and c.cuenta = p.cuenta
        where a.origen_id = ${val}::uuid and c.concepto = 'iva_debito')::text as iva
  `)) as unknown as Array<{ obra: string; iva: string }>
  assert.equal(Number(l!.obra), Number(f!.base), 'la factura y el diario no dicen lo mismo')
  assert.equal(Number(l!.iva), Number(f!.iva))
})

test('facturar dos veces no asienta dos veces', async () => {
  const val = await hastaAprobada()
  assert.equal((await dentro((q) => facturar(q, val, YO, false, 'es'))).hecho, true)
  const otra = await dentro((q) => facturar(q, val, YO, false, 'es'))
  assert.equal(otra.hecho, false)
  assert.equal(await asientosDe(val), 1, 'asentó la misma venta dos veces')
})

test('con el mes cerrado NO se emite la factura: el correlativo no se devuelve', async () => {
  // Es lo que un `try/catch` no habría salvado: la excepción del periodo cerrado
  // llegaría DESPUÉS de haber gastado el número de factura y el de control, que son
  // correlativos sin huecos. Se comprueba antes de emitir nada.
  const val = await hastaAprobada()
  const antes = (await dentro((q) => q`
    select count(*)::int as n from documento_fiscal where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`update periodo set estado = 'cerrado'
             where organizacion_id = ${G}::uuid and anio = 2026 and mes = 6`
  })

  const f = await dentro((q) => facturar(q, val, YO, false, 'es'))
  assert.equal(f.hecho, false)
  assert.equal((f as { motivo: string }).motivo, 'facturar.error.mes_cerrado')

  const despues = (await dentro((q) => q`
    select count(*)::int as n from documento_fiscal where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(despues[0]!.n, antes[0]!.n, 'gastó un número de factura para nada')
  assert.equal(await asientosDe(val), 0)

  // El mes lo reabre `limpio()` al empezar la siguiente, no esta prueba: si se corta
  // por medio, el arreglo del final no llegaría a ejecutarse.
})

test('el cliente no factura: una factura que emite quien la recibe no es una factura', async () => {
  const val = await hastaAprobada()
  const f = await dentro((q) => facturar(q, val, YO, true, 'es'))
  assert.equal(f.hecho, false)
  assert.equal(await asientosDe(val), 0)
})
