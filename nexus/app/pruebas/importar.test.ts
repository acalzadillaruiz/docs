/**
 * Traer una hoja de Excel.
 *
 * Es la pantalla que decide si esto se usa o se abandona: hoy la contabilidad de
 * GPS vive en hojas de cálculo, y si sacarla de ahí cuesta más que quedarse, se
 * queda. Lo que se comprueba aquí es que la hoja entre tal cual, que la aplicación
 * diga cómo la entendió antes de escribir nada, y que no entre nunca a medias.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import {
  cargar, proponerMapeo, guardarMapeo, validar, confirmar, lotes,
  formatoNumero, formatoFecha, HojaRepetida, revertir, type Campo,
} from '../src/dominio/importar.ts'
import { instalarPlan, tienePlan } from '../src/dominio/periodos.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '4b5c6d7e-0000-0000-0000-00000000000a'
const CLI = '4b5c6d7e-0000-0000-0000-00000000000b'
const PR = '4b5c6d7e-0000-0000-0000-00000000000c'
const YO = '4b5c6d7e-0000-0000-0000-00000000000d'
const TASA = '4b5c6d7e-1111-0000-0000-00000000000a'
const CTR = '4b5c6d7e-2222-0000-0000-00000000000a'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

const bytes = (t: string) => new TextEncoder().encode(t)

/** Una hoja como la que exporta Excel en español, con su BOM y sus comillas. */
const HOJA = '﻿' + [
  'Fecha;RIF;Proveedor;Nro Factura;Nro Control;Base;IVA;Contrato;Notas',
  '03/04/2026;J-30111111-1;Suministros Zulia;00012345;01-00098765;"1.200.000,00";"192.000,00";IMP-APP-001;"Cabezal 11"" 5M"',
  '15/04/2026;J-30111111-1;Suministros Zulia;00000987;01-00012345;"350.000,00";"56.000,00";;Flete',
].join('\r\n')

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Importar App','J-900300000-0'),
        ('${CLI}','operadora','Operadora Imp','J-900400000-0'),
        ('${PR}','proveedor','Suministros Zulia','J-30111111-1')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'imp-app@prueba.test','Interno','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-04-02', 40.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR}','${G}','${CLI}','IMP-APP-001','procura','Cabezales','Wellheads',
                'vigente','USD', 100000.00,'${TASA}','${YO}')
        on conflict (id) do update set codigo = excluded.codigo;
      -- Sin plan de cuentas no hay donde asentar, y una factura sin asentar no cuenta.
      select instalar_plan_cuentas('${G}');
      -- Y el periodo contable de abril abierto: un asiento en un mes que no existe
      -- es un asiento que nadie va a encontrar cuando lo busque.
      insert into periodo (organizacion_id, anio, mes) values ('${G}', 2026, 4)
        on conflict do nothing;
    `)
  })
})
after(async () => { await cerrar() })

/** Deja la organización sin lotes ni facturas, para cada prueba. */
async function limpio(): Promise<void> {
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    // Los movimientos del banco van PRIMERO: apuntan a su lote, y borrar el lote con
    // un movimiento colgando falla por clave foránea. Es la clase de cosa que rompe
    // el archivo entero en la segunda corrida y no en la primera.
    // El orden importa, y ya ha mordido dos veces: los movimientos del banco y las
    // facturas apuntan a su lote, así que el lote se borra EL ÚLTIMO. Borrarlo antes
    // falla por clave foránea y se lleva por delante el archivo entero.
    await q`delete from movimiento_banco where organizacion_id = ${G}::uuid`
    await q`delete from documento_fiscal where organizacion_id = ${G}::uuid`
    await q`delete from lote_importacion where organizacion_id = ${G}::uuid`
    // Y el mes vuelve a abrirse: una de estas pruebas lo CIERRA para comprobar que
    // deshacer una carga lo dice antes de intentarlo. Si esa prueba se corta por
    // medio, el mes se queda cerrado y a partir de ahí falla todo el archivo — y
    // falla la segunda vez, no la primera, que es lo que cuesta de encontrar.
    await q`update periodo set estado = 'abierto'
             where organizacion_id = ${G}::uuid and anio = 2026 and mes = 4`
  })
}

test('la hoja entra TAL CUAL, con su BOM y sus comillas', async () => {
  await limpio()
  const r = await dentro((q) => cargar(q, G, YO, 'abril.csv', bytes(HOJA), 'facturas_recibidas'))
  assert.equal(r.filas, 2, 'la cabecera no es un dato')
  assert.equal(r.cabeceras[0], 'Fecha', 'el BOM no se pega a la primera cabecera')

  const [fila] = (await dentro((q) => q`
    select celdas from fila_cruda where lote_id = ${r.loteId}::uuid and fila = 1
  `)) as unknown as Array<{ celdas: string[] }>
  // Convertir demasiado pronto es como se pierde información sin enterarse.
  assert.equal(fila!.celdas[5], '1.200.000,00')
  assert.equal(fila!.celdas[8], 'Cabezal 11" 5M')
})

test('la misma hoja dos veces se detecta y se dice', async () => {
  await limpio()
  await dentro((q) => cargar(q, G, YO, 'abril.csv', bytes(HOJA), 'facturas_recibidas'))
  // No se prohíbe —puede ser deliberado— pero no pasa en silencio, que es como
  // entran los importes por duplicado.
  await assert.rejects(
    dentro((q) => cargar(q, G, YO, 'abril-copia.csv', bytes(HOJA), 'facturas_recibidas')),
    HojaRepetida,
  )
})

test('la aplicación propone cómo entendió cada columna, mirando la cabecera', async () => {
  await limpio()
  const r = await dentro((q) => cargar(q, G, YO, 'abril.csv', bytes(HOJA), 'facturas_recibidas'))
  const p = proponerMapeo(r.cabeceras, r.muestras, 'facturas_recibidas')

  const de = (campo: Campo) => p.find((x) => x.campo === campo)
  assert.equal(de('fecha')!.columna, 1)
  assert.equal(de('proveedor')!.columna, 2, 'RIF es el proveedor, no su nombre')
  assert.equal(de('proveedor_nombre')!.columna, 3)
  assert.equal(de('numero')!.columna, 4)
  // «Nro Control» lleva dentro «Nro»: lo específico gana a lo genérico.
  assert.equal(de('control')!.columna, 5)
  assert.equal(de('base')!.columna, 6)
  assert.equal(de('iva')!.columna, 7)
  assert.equal(de('contrato')!.columna, 8)
  // La columna de notas no es ningún campo, y eso está bien.
  assert.equal(p[8]!.campo, null)
})

test('el formato se propone mirando el DATO, que es lo único que lo dice', async () => {
  await limpio()
  const r = await dentro((q) => cargar(q, G, YO, 'abril.csv', bytes(HOJA), 'facturas_recibidas'))
  const p = proponerMapeo(r.cabeceras, r.muestras, 'facturas_recibidas')
  assert.equal(p.find((x) => x.campo === 'base')!.formato, 'ven')
  assert.equal(p.find((x) => x.campo === 'fecha')!.formato, 'dmy')
})

test('si la coma va detrás del punto es venezolano, y al revés anglosajón', () => {
  assert.equal(formatoNumero('1.234,56'), 'ven')
  assert.equal(formatoNumero('1,234.56'), 'ang')
  // Con uno solo no se puede saber: se supone venezolano, que es donde está la
  // contabilidad de GPS. Y se enseña, para que alguien lo corrija.
  assert.equal(formatoNumero('1234,56'), 'ven')
})

test('si el primer número pasa de doce es el día: no hay un mes trece', () => {
  assert.equal(formatoFecha('15/04/2026'), 'dmy')
  assert.equal(formatoFecha('04/15/2026'), 'mdy')
  assert.equal(formatoFecha('2026-04-15'), 'iso')
  // Con 03/04 no se puede saber. Por eso se enseña siempre.
  assert.equal(formatoFecha('03/04/2026'), 'dmy')
})

test('validar NO escribe nada, y dice fila por fila qué está mal', async () => {
  await limpio()
  const mala = HOJA.replace('"1.200.000,00"', 'pendiente')
  const r = await dentro((q) => cargar(q, G, YO, 'mala.csv', bytes(mala), 'facturas_recibidas'))
  const p = proponerMapeo(r.cabeceras, r.muestras, 'facturas_recibidas')
  await dentro((q) => guardarMapeo(q, r.loteId, p))

  const v = await dentro((q) => validar(q, r.loteId))
  assert.equal(v.filas, 2)
  assert.equal(v.malas, 1)
  assert.equal(v.errores[0]!.fila, 1)
  assert.match(v.errores[0]!.motivo, /base/)

  const [n] = (await dentro((q) => q`
    select count(*)::int as n from documento_fiscal where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 0, 'validar no puede haber escrito nada')
})

test('con una fila mala NO entra ninguna', async () => {
  await limpio()
  const mala = HOJA.replace('"1.200.000,00"', 'pendiente')
  const r = await dentro((q) => cargar(q, G, YO, 'mala.csv', bytes(mala), 'facturas_recibidas'))
  await dentro((q) => guardarMapeo(q, r.loteId,
    proponerMapeo(r.cabeceras, r.muestras, 'facturas_recibidas')))
  await dentro((q) => validar(q, r.loteId))

  const c = await dentro((q) => confirmar(q, r.loteId, YO))
  assert.equal(c.hecho, false)
  // Una carga a medias es peor que no haber cargado: nadie sabe por dónde se quedó.
  assert.match((c as { motivo: string }).motivo, /filas con error/)
})

test('el camino completo: hoja de Excel a facturas de proveedor en la contabilidad', async () => {
  await limpio()
  const r = await dentro((q) => cargar(q, G, YO, 'abril.csv', bytes(HOJA), 'facturas_recibidas'))
  const p = proponerMapeo(r.cabeceras, r.muestras, 'facturas_recibidas')
  await dentro((q) => guardarMapeo(q, r.loteId, p))

  const v = await dentro((q) => validar(q, r.loteId))
  assert.equal(v.malas, 0)
  assert.equal(v.proveedoresFaltan.length, 0)

  const c = await dentro((q) => confirmar(q, r.loteId, YO))
  assert.equal(c.hecho, true)

  const filas = (await dentro((q) => q`
    select numero, numero_control, base_ves::text, base_usd::text, fecha, contrato_id
      from documento_fiscal where organizacion_id = ${G}::uuid order by numero
  `)) as unknown as Array<Record<string, string | Date | null>>
  assert.equal(filas.length, 2)
  assert.equal(filas[1]!['numero'], '00012345')
  assert.equal(filas[1]!['numero_control'], '01-00098765')
  assert.equal(filas[1]!['base_ves'], '1200000.00')
  // 1.200.000 a 40,00 = 30.000, con la tasa del día de la factura.
  assert.equal(filas[1]!['base_usd'], '30000.00')
  assert.equal(filas[1]!['contrato_id'], CTR)
  // La segunda no traía contrato, y no se le inventa ninguno.
  assert.equal(filas[0]!['contrato_id'], null)
})

test('un proveedor que no está dado de alta se dice ANTES de tocar nada', async () => {
  await limpio()
  const otra = HOJA.replace(/J-30111111-1/g, 'J-30999999-9')
  const r = await dentro((q) => cargar(q, G, YO, 'otra.csv', bytes(otra), 'facturas_recibidas'))
  await dentro((q) => guardarMapeo(q, r.loteId,
    proponerMapeo(r.cabeceras, r.muestras, 'facturas_recibidas')))

  const v = await dentro((q) => validar(q, r.loteId))
  assert.equal(v.proveedoresFaltan.length, 1)
  assert.equal(v.proveedoresFaltan[0]!.rif, 'J-30999999-9')
  assert.equal(v.proveedoresFaltan[0]!.nombre, 'Suministros Zulia')
  assert.equal(v.proveedoresFaltan[0]!.filas, 2)

  // Y confirmar se niega, sin crear media hoja.
  const c = await dentro((q) => confirmar(q, r.loteId, YO))
  assert.equal(c.hecho, false)
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from documento_fiscal where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 0)
})

test('una columna que no es ningún campo simplemente no se usa', async () => {
  await limpio()
  const r = await dentro((q) => cargar(q, G, YO, 'abril.csv', bytes(HOJA), 'facturas_recibidas'))
  const p = proponerMapeo(r.cabeceras, r.muestras, 'facturas_recibidas')
  await dentro((q) => guardarMapeo(q, r.loteId, p))

  const [n] = (await dentro((q) => q`
    select count(*)::int as n from mapeo_columna where lote_id = ${r.loteId}::uuid
  `)) as unknown as Array<{ n: number }>
  // Ocho campos mapeados de nueve columnas: la de notas se queda fuera.
  assert.equal(n!.n, 8)
})

test('las hojas traídas quedan listadas, con su estado', async () => {
  await limpio()
  await dentro((q) => cargar(q, G, YO, 'abril.csv', bytes(HOJA), 'facturas_recibidas'))
  const lista = await dentro((q) => lotes(q, G))
  assert.equal(lista.length, 1)
  assert.equal(lista[0]!.archivo, 'abril.csv')
  assert.equal(lista[0]!.estado, 'cargado')
  assert.equal(lista[0]!.filas, 2)
})

test('lo importado LLEGA AL LIBRO: la factura queda asentada, no solo registrada', async () => {
  await limpio()
  const r = await dentro((q) => cargar(q, G, YO, 'abril.csv', bytes(HOJA), 'facturas_recibidas'))
  await dentro((q) => guardarMapeo(q, r.loteId,
    proponerMapeo(r.cabeceras, r.muestras, 'facturas_recibidas')))
  await dentro((q) => validar(q, r.loteId))
  assert.equal((await dentro((q) => confirmar(q, r.loteId, YO))).hecho, true)

  // Una factura registrada y sin asentar es el peor sitio donde dejarla: parece
  // que cuenta y no cuenta.
  const filas = (await dentro((q) => q`
    select numero, asiento_id from documento_fiscal
     where organizacion_id = ${G}::uuid order by numero
  `)) as unknown as Array<{ numero: string; asiento_id: string | null }>
  assert.equal(filas.length, 2)
  assert.equal(filas.every((f) => f.asiento_id !== null), true, 'las dos asentadas')

  // Y el asiento cuadra, que es lo único que hace que valga de algo.
  const [cuadre] = (await dentro((q) => q`
    select sum(p.monto_ves)::text as descuadre
      from partida p join asiento a on a.id = p.asiento_id
     where a.organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ descuadre: string }>
  assert.equal(Number(cuadre!.descuadre), 0)
})

test('sin plan de cuentas NO se importa, y se dice por qué', async () => {
  await limpio()
  // Una organización recién creada no tiene dónde asentar.
  const SIN = '4b5c6d7e-0000-0000-0000-00000000000f'
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`insert into organizacion (id, tipo, nombre, rif)
            values (${SIN},'gps','GPS Sin Plan','J-900500000-0') on conflict (id) do nothing`
    await q`delete from mapa_cuenta where organizacion_id = ${SIN}::uuid`
    await q`delete from lote_importacion where organizacion_id = ${SIN}::uuid`
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values ('4b5c6d7e-0000-0000-0000-0000000000ff', ${SIN},'sinplan@prueba.test',
                    'Interno','clave_2fa','(h)','(s)') on conflict (id) do nothing`
  })
  const comoOtro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
    comoPersona<T>({ id: '4b5c6d7e-0000-0000-0000-0000000000ff' }, 'nexus_interno', f)

  const r = await comoOtro((q) => cargar(q, SIN, '4b5c6d7e-0000-0000-0000-0000000000ff',
    'sinplan.csv', bytes(HOJA), 'facturas_recibidas'))
  await comoOtro((q) => guardarMapeo(q, r.loteId,
    proponerMapeo(r.cabeceras, r.muestras, 'facturas_recibidas')))
  await comoOtro((q) => validar(q, r.loteId))

  const c = await comoOtro((q) => confirmar(q, r.loteId,
    '4b5c6d7e-0000-0000-0000-0000000000ff'))
  assert.equal(c.hecho, false)
  assert.match((c as { motivo: string }).motivo, /plan de cuentas/)
})

test('un mes con el periodo contable cerrado se dice ANTES, no a mitad', async () => {
  await limpio()
  // Mayo no está abierto en esta organización.
  const mayo = HOJA.replace(/03\/04\/2026/g, '03/05/2026').replace(/15\/04\/2026/g, '15/05/2026')
  const r = await dentro((q) => cargar(q, G, YO, 'mayo.csv', bytes(mayo), 'facturas_recibidas'))
  await dentro((q) => guardarMapeo(q, r.loteId,
    proponerMapeo(r.cabeceras, r.muestras, 'facturas_recibidas')))

  const v = await dentro((q) => validar(q, r.loteId))
  assert.equal(v.mesesSinPeriodo.length, 1)
  assert.equal(v.mesesSinPeriodo[0]!.mes, 5)
  assert.equal(v.mesesSinPeriodo[0]!.filas, 2)

  const c = await dentro((q) => confirmar(q, r.loteId, YO))
  assert.equal(c.hecho, false)
  // Un asiento en un mes que no existe es un asiento que nadie va a encontrar.
  assert.match((c as { motivo: string }).motivo, /05\/2026/)

  const [n] = (await dentro((q) => q`
    select count(*)::int as n from documento_fiscal where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 0, 'no quedó media hoja dentro')
})

// ===========================================================================
// El histórico de ventas.
//
// El día que esto se enciende, la empresa no empieza de cero: lleva años
// facturando y ese histórico está en una hoja. Sin él, el libro de ventas nace
// vacío y comparar este mes con el mismo mes del año pasado es imposible —que es
// justo la comparación que se quiere hacer.

/** Una hoja de ventas de antes del sistema, con el cliente por RIF. */
const VENTAS = '﻿' + [
  'Fecha;RIF Cliente;Cliente;Nro Factura;Nro Control;Base;IVA;Contrato',
  '10/04/2026;J-900400000-0;Operadora Imp;V-0000101;01-00000101;"2.000.000,00";"320.000,00";IMP-APP-001',
  '20/04/2026;J-900400000-0;Operadora Imp;V-0000102;01-00000102;"1.000.000,00";"160.000,00";',
].join('\r\n')

async function cargarVentas(nombre = 'ventas.csv', hoja = VENTAS) {
  const r = await dentro((q) => cargar(q, G, YO, nombre, bytes(hoja), 'facturas_emitidas'))
  const props = proponerMapeo(r.cabeceras, r.muestras, 'facturas_emitidas')
  await dentro((q) => guardarMapeo(q, r.loteId, props))
  await dentro((q) => validar(q, r.loteId))
  return r.loteId
}

test('una hoja de ventas se reconoce sola: el RIF es el cliente, no el proveedor', async () => {
  await limpio()
  const r = await dentro((q) => cargar(q, G, YO, 'ventas.csv', bytes(VENTAS), 'facturas_emitidas'))
  const props = proponerMapeo(r.cabeceras, r.muestras, 'facturas_emitidas')
  const de = (c: Campo) => props.find((p) => p.campo === c)
  assert.equal(de('cliente')?.columna, 2)        // «RIF Cliente», no «Cliente»
  assert.equal(de('cliente_nombre')?.columna, 3)
  assert.equal(de('numero')?.columna, 4)
  assert.equal(de('base')?.columna, 6)
  // Y no propone campos del otro destino: 'proveedor' no existe en una hoja de ventas.
  assert.equal(props.some((p) => p.campo === ('proveedor' as Campo)), false)
})

test('el histórico entra con su NÚMERO, que no se inventa', async () => {
  // Al revés que al emitir una factura nueva. Estas ya existen, ya las tiene el
  // cliente y ya se declararon: darles un correlativo nuevo sería crear una segunda
  // versión de un documento que está en la calle.
  await limpio()
  const lote = await cargarVentas()
  const r = await dentro((q) => confirmar(q, lote, YO, 'es'))
  assert.equal(r.hecho, true)

  const docs = (await dentro((q) => q`
    select numero, numero_control, base_ves::text, iva_ves::text, base_usd::text
      from documento_fiscal
     where organizacion_id = ${G}::uuid and sentido = 'emitido' order by numero
  `)) as unknown as Array<Record<string, string>>
  assert.equal(docs.length, 2)
  assert.equal(docs[0]!['numero'], 'V-0000101')
  assert.equal(docs[0]!['numero_control'], '01-00000101')
  assert.equal(Number(docs[0]!['base_ves']), 2000000)
  // El importe en dólares NO está en la hoja: sale de la tasa del día de la factura.
  assert.equal(Number(docs[0]!['base_usd']), 50000)
})

test('el histórico llega al LIBRO: cobrar contra ingreso y IVA débito', async () => {
  // Una factura registrada y sin asentar es el peor sitio donde dejarla: parece que
  // cuenta y no cuenta.
  await limpio()
  const lote = await cargarVentas()
  await dentro((q) => confirmar(q, lote, YO, 'es'))

  // Del asiento de ESTA carga, no de los que dejaron las pruebas anteriores: un
  // asiento no se borra, así que `limpio()` no puede llevárselos por delante.
  const partidas = (await dentro((q) => q`
    select p.cuenta, p.monto_ves::text from partida p
     where p.asiento_id = (
       select a.id from asiento a
        where a.organizacion_id = ${G}::uuid and a.origen_tipo = 'factura_emitida'
          and a.descripcion_es like '%V-0000101%'
        order by a.registrado_en desc limit 1)
     order by p.linea
  `)) as unknown as Array<{ cuenta: string; monto_ves: string }>
  assert.equal(partidas.length, 3)
  assert.equal(Number(partidas[0]!.monto_ves), 2320000)     // por cobrar, todo
  assert.equal(Number(partidas[1]!.monto_ves), -2000000)    // ingreso
  assert.equal(Number(partidas[2]!.monto_ves), -320000)     // IVA débito
  // El ingreso va a la cuenta del TIPO del contrato, no a un cajón de «ingresos»:
  // saber cuál de los cinco tipos deja dinero es media decisión.
  assert.equal(partidas[1]!.cuenta, '4.1.01')
})

test('el asiento del histórico cuadra, como todos', async () => {
  await limpio()
  const lote = await cargarVentas()
  await dentro((q) => confirmar(q, lote, YO, 'es'))
  const [d] = (await dentro((q) => q`
    select ves::text from descuadre(${G}::uuid,'2026-12-31'::date)
  `)) as unknown as Array<{ ves: string }>
  assert.equal(Number(d?.ves ?? 0), 0)
})

test('una factura del histórico NO se asienta dos veces al reimportar la hoja', async () => {
  // Reimportar una hoja corregida es lo normal, no un error. Lo que no puede pasar es
  // que el ingreso entre dos veces.
  await limpio()
  const cuantos = async () => {
    const [n] = (await dentro((q) => q`
      select count(*)::int as n from asiento
       where organizacion_id = ${G}::uuid and origen_tipo = 'factura_emitida'
    `)) as unknown as Array<{ n: number }>
    return Number(n!.n)
  }
  // Se cuenta el ANTES y el DESPUÉS, no el total: los asientos de las pruebas
  // anteriores siguen ahí, porque un asiento no se borra.
  const antes = await cuantos()
  const primera = await cargarVentas('ventas.csv')
  await dentro((q) => confirmar(q, primera, YO, 'es'))
  const tras_una = await cuantos()
  // La hoja corregida no es la misma hoja: si lo fuera, la aplicación avisaría de que
  // ya se trajo, que es otra prueba. Aquí se corrige el IVA de la SEGUNDA factura, y
  // lo que se mira es que la primera no se vuelva a asentar por ello.
  const corregida = VENTAS.replace('"160.000,00"', '"161.000,00"')
  const segunda = await cargarVentas('ventas-corregida.csv', corregida)
  await dentro((q) => confirmar(q, segunda, YO, 'es'))
  const tras_dos = await cuantos()

  assert.equal(tras_una - antes, 2, 'dos facturas, dos asientos')
  assert.equal(tras_dos - tras_una, 0, 'la segunda vez no vuelve a asentar nada')
})

test('un cliente sin dar de alta para la carga y dice quién es', async () => {
  // Crear empresas desde una hoja es como se acaba con el mismo cliente tres veces
  // escrito de tres maneras.
  await limpio()
  const hoja = VENTAS.replace(/J-900400000-0/g, 'J-90099999-9')
  const r = await dentro((q) => cargar(q, G, YO, 'ventas-raras.csv', bytes(hoja), 'facturas_emitidas'))
  const props = proponerMapeo(r.cabeceras, r.muestras, 'facturas_emitidas')
  await dentro((q) => guardarMapeo(q, r.loteId, props))
  await dentro((q) => validar(q, r.loteId))

  const res = await dentro((q) => confirmar(q, r.loteId, YO, 'es'))
  assert.equal(res.hecho, false)
  assert.match(res.hecho ? '' : res.motivo, /J-90099999-9/)

  const [creadas] = (await dentro((q) => q`
    select count(*)::int as n from documento_fiscal
     where organizacion_id = ${G}::uuid and sentido = 'emitido'
  `)) as unknown as Array<{ n: number }>
  assert.equal(Number(creadas!.n), 0, 'ni media hoja dentro')
})

test('la pantalla ofrece los dos destinos, no solo el de compras', async () => {
  const { pintarSubirHoja } = await import('../src/pantallas/importar.ts')
  const h = pintarSubirHoja('es', 'af', [])
  assert.match(h, /value="facturas_recibidas"/)
  assert.match(h, /value="facturas_emitidas"/)
})

/**
 * El extracto del banco, el tercer destino.
 *
 * La conciliación bancaria existía desde hacía días y **no tenía puerta**: comparaba
 * los movimientos del banco contra los cobros y los pagos, y no había una sola forma
 * de meter un movimiento. Una pantalla que no tiene nada que conciliar.
 */

const EXTRACTO = [
  'Fecha;Referencia;Concepto;Monto',
  '05/04/2026;OP-90001;Abono Petrolera del Lago;"1.500.000,00"',
  '07/04/2026;OP-90002;Pago Suministros;"-320.000,00"',
  '09/04/2026;OP-90003;Comisión mantenimiento;"-1.200,00"',
].join('\n')

async function traerExtracto(hoja = EXTRACTO): Promise<string> {
  const bytes = new TextEncoder().encode(hoja)
  const r = await dentro((q) => cargar(q, G, YO, `extracto-${Date.now()}.csv`, bytes,
    'movimientos_banco'))
  const id = r.loteId
  const cabeceras = hoja.split('\n')[0]!.split(';')
  const propuesta = proponerMapeo(cabeceras,
    hoja.split('\n')[1]!.split(';'), 'movimientos_banco')
  await dentro((q) => guardarMapeo(q, id, propuesta.map((p) => ({
    columna: p.columna, campo: p.campo, tipo: p.tipo, formato: p.formato,
  }))))
  await dentro((q) => validar(q, id))
  return id
}

test('el extracto del banco entra, y el importe trae su signo', async () => {
  // Positivo entra y negativo sale, que es como lo da el banco. Inventar el signo a
  // partir del concepto es como se acaba con un cobro contado como un pago.
  await limpio()
  const lote = await traerExtracto()
  const r = await dentro((q) => confirmar(q, lote, YO, 'es'))
  assert.equal(r.hecho, true, (r as { motivo?: string }).motivo)

  const movs = (await dentro((q) => q`
    select monto::text, referencia, descripcion, moneda::text, cuenta
      from movimiento_banco where organizacion_id = ${G}::uuid
     order by fecha
  `)) as unknown as Array<Record<string, string>>
  assert.equal(movs.length, 3)
  assert.equal(Number(movs[0]!['monto']), 1500000)
  assert.equal(Number(movs[1]!['monto']), -320000)
  assert.equal(movs[0]!['referencia'], 'OP-90001')
  assert.match(movs[0]!['descripcion']!, /Petrolera/)
  // Sin columna de cuenta ni de moneda: la del banco de la empresa, en bolívares.
  assert.equal(movs[0]!['moneda'], 'VES')
  assert.equal(movs[0]!['cuenta'], '1.1.01.02')
})

test('IMPORTAR EL EXTRACTO NO ESCRIBE NI UN ASIENTO', async () => {
  // Es lo más importante de todo esto. Una línea del banco no es un apunte: es un
  // hecho que hay que casar con un cobro o un pago que YA está en el libro. Si al
  // importar se asentara, todo quedaría contado dos veces y el descuadre aparecería
  // en el cierre, a tres semanas de su causa.
  const [antes] = (await dentro((q) => q`
    select count(*)::int as n from asiento where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>

  const lote = await traerExtracto(EXTRACTO.replace(/OP-9000/g, 'OP-9100'))
  assert.equal((await dentro((q) => confirmar(q, lote, YO, 'es'))).hecho, true)

  const [despues] = (await dentro((q) => q`
    select count(*)::int as n from asiento where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(despues!.n, antes!.n, 'el extracto escribió en el libro')
})

test('dos extractos que se solapan no duplican los días repetidos', async () => {
  // Es el caso de verdad: del 1 al 31 y del 15 al 15 traen quince días dos veces. La
  // huella del archivo no lo cubre, porque las dos hojas son distintas.
  const solapado = [
    'Fecha;Referencia;Concepto;Monto',
    '09/04/2026;OP-90003;Comisión mantenimiento;"-1.200,00"',
    '11/04/2026;OP-90004;Abono cliente;"800.000,00"',
  ].join('\n')

  const [antes] = (await dentro((q) => q`
    select count(*)::int as n from movimiento_banco where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>

  const lote = await traerExtracto(solapado)
  assert.equal((await dentro((q) => confirmar(q, lote, YO, 'es'))).hecho, true)

  const [despues] = (await dentro((q) => q`
    select count(*)::int as n from movimiento_banco where organizacion_id = ${G}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(despues!.n, antes!.n + 1, 'el repetido volvió a entrar')

  const [rep] = (await dentro((q) => q`
    select count(*)::int as n from movimiento_banco
     where organizacion_id = ${G}::uuid and referencia = 'OP-90003'
  `)) as unknown as Array<{ n: number }>
  assert.equal(rep!.n, 1)
})

test('revertir un lote del banco NO borra lo que alguien ya concilió', async () => {
  // Borrar un movimiento ya casado dejaría un cobro apuntando al vacío, y eso no se
  // arregla solo.
  const hoja = [
    'Fecha;Referencia;Concepto;Monto',
    '20/04/2026;OP-95001;Uno;"100,00"',
    '21/04/2026;OP-95002;Dos;"200,00"',
  ].join('\n')
  const lote = await traerExtracto(hoja)
  assert.equal((await dentro((q) => confirmar(q, lote, YO, 'es'))).hecho, true)

  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`update movimiento_banco set conciliado_en = now(), conciliado_por = ${YO}::uuid,
                                        nota = 'casado a mano para la prueba'
             where referencia = 'OP-95001'`
  })

  await dentro((q) => q`select revertir_lote(${lote}::uuid, ${YO}::uuid, 'prueba')`)

  const quedan = (await dentro((q) => q`
    select referencia from movimiento_banco where lote_id = ${lote}::uuid
  `)) as unknown as Array<{ referencia: string }>
  assert.equal(quedan.length, 1)
  assert.equal(quedan[0]!.referencia, 'OP-95001')

  const [l] = (await dentro((q) => q`
    select nota from lote_importacion where id = ${lote}::uuid
  `)) as unknown as Array<{ nota: string }>
  assert.match(l!.nota, /conciliado/)
})

test('la pantalla ofrece los TRES destinos, y avisa de que el extracto no se asienta', async () => {
  const { pintarSubirHoja } = await import('../src/pantallas/importar.ts')
  const h = pintarSubirHoja('es', 'af', [])
  assert.match(h, /value="movimientos_banco"/)
  assert.match(h, /Extracto del banco/)
  assert.match(h, /no es un apunte contable/)
  assert.equal(h.includes('‹falta:'), false)
})

/**
 * Deshacer una carga, y el plan de cuentas del día 1.
 *
 * Dos máquinas que estaban enteras y sin puerta. El propio importador mandaba
 * revertir un lote —«para rehacerlo, reviértelo antes»— y no había una sola pantalla
 * desde donde hacerlo; y decía «esta empresa todavía no tiene plan de cuentas» sin
 * ofrecer en ningún sitio la forma de instalarlo.
 */

/** Una hoja de compras traída hasta el final: cargada, mapeada, validada y confirmada. */
async function traerHasta(_estado: 'confirmado'): Promise<string> {
  const r = await dentro((q) => cargar(q, G, YO, 'abril.csv', bytes(HOJA), 'facturas_recibidas'))
  await dentro((q) => guardarMapeo(q, r.loteId, proponerMapeo(r.cabeceras, r.muestras,
    'facturas_recibidas')))
  await dentro((q) => validar(q, r.loteId))
  const c = await dentro((q) => confirmar(q, r.loteId, YO))
  assert.equal(c.hecho, true, (c as { motivo?: string }).motivo)
  return r.loteId
}

test('deshacer una carga REVERSA sus asientos, no los borra', async () => {
  // Un asiento no se borra: es un hecho que ocurrió. Los dos se quedan en el libro.
  await limpio()
  const lote = await traerHasta('confirmado')

  // Los asientos de una carga NO llevan el lote como origen: los crea el generador
  // de la factura, que los marca con la factura, y eso es lo correcto para el libro.
  // Se buscan por los documentos que el lote selló. Ese detalle es justo el que hacía
  // que `revertir_lote` no reversara nada.
  const cuantos = async () => {
    const [r] = (await dentro((q) => q`
      select count(*)::int as n from asiento a
       where a.organizacion_id = ${G}::uuid
         and a.origen_id in (select id from documento_fiscal where lote_id = ${lote}::uuid)
    `)) as unknown as Array<{ n: number }>
    return Number(r!.n)
  }
  const antes = await cuantos()
  assert.ok(antes > 0, 'la carga tiene que haber dejado asientos')

  const r = await dentro((q) => revertir(q, lote, 'la hoja era del mes que no era', YO, 'es'))
  assert.equal(r.hecho, true, (r as { motivo?: string }).motivo)
  assert.equal((r as { asientos: number }).asientos, antes)
  assert.equal(await cuantos(), antes * 2, 'los originales y sus reversos')

  const [l] = (await dentro((q) => q`
    select estado::text, nota from lote_importacion where id = ${lote}::uuid
  `)) as unknown as Array<{ estado: string; nota: string }>
  assert.equal(l!.estado, 'revertido')
  assert.match(l!.nota, /mes que no era/)
})

test('deshacer SIN motivo no pasa, y deshacer dos veces tampoco', async () => {
  await limpio()
  const lote = await traerHasta('confirmado')
  for (const motivo of ['', '  ', 'ya']) {
    const r = await dentro((q) => revertir(q, lote, motivo, YO, 'es'))
    assert.equal(r.hecho, false, `«${motivo}» no puede valer como motivo`)
  }
  assert.equal((await dentro((q) => revertir(q, lote, 'buen motivo', YO, 'es'))).hecho, true)
  const otra = await dentro((q) => revertir(q, lote, 'otro motivo', YO, 'es'))
  assert.equal(otra.hecho, false)
  assert.match((otra as { motivo: string }).motivo, /ya estaba deshecha/)
})

test('con el mes cerrado se dice ANTES, no con un error de la base de datos', async () => {
  // El reverso va al mes del asiento original. Si está cerrado, no entra.
  await limpio()
  const lote = await traerHasta('confirmado')
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`update periodo set estado = 'cerrado'
             where organizacion_id = ${G}::uuid and anio = 2026 and mes = 4`
  })

  const r = await dentro((q) => revertir(q, lote, 'con el mes cerrado', YO, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { motivo: string }).motivo, /2026-04/)
  // El mes lo vuelve a abrir `limpio()`, no esta prueba: si se corta por medio, el
  // arreglo de aquí abajo no llegaría a ejecutarse nunca.
})

test('el día 1 se puede instalar el plan de cuentas desde la pantalla', async () => {
  // El importador decía «esta empresa todavía no tiene plan de cuentas instalado» y
  // no había forma de instalarlo. Otra instrucción sin camino.
  const NUEVA = '4b5c6d7e-9999-0000-0000-00000000000a'
  const YO_N = '4b5c6d7e-9999-0000-0000-00000000000d'
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif)
        values ('${NUEVA}','gps','GPS Recién Nacida','J-909900000-0')
        on conflict (id) do nothing;
      delete from mapa_cuenta where organizacion_id = '${NUEVA}';
      delete from cuenta where organizacion_id = '${NUEVA}';`)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto)
            values (${YO_N}, ${NUEVA},'nueva@prueba.test','Nueva','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
  })

  const comoNueva = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
    comoPersona<T>({ id: YO_N }, 'nexus_interno', f)

  assert.equal(await comoNueva((q) => tienePlan(q, NUEVA)), 0)
  const r = await comoNueva((q) => instalarPlan(q, NUEVA, 'es'))
  assert.equal(r.hecho, true)
  assert.ok(await comoNueva((q) => tienePlan(q, NUEVA)) > 50, 'el plan entero')

  // Y no se instala dos veces: dos numeraciones mezcladas no se separan después.
  const otra = await comoNueva((q) => instalarPlan(q, NUEVA, 'es'))
  assert.equal(otra.hecho, false)
  assert.match((otra as { motivo: string }).motivo, /ya tiene cuentas/)
})

test('la pantalla de meses avisa del plan que falta, y solo cuando falta', async () => {
  const { pintarPeriodos } = await import('../src/pantallas/periodos.ts')
  const { meses } = await import('../src/dominio/periodos.ts')
  // Con los meses de verdad, no con un objeto inventado: un objeto a medias hace que
  // la pantalla reviente por un campo que falta, y eso no prueba nada de lo que se
  // quería probar.
  const m = await dentro((q) => meses(q, G, 'es'))

  const sin = pintarPeriodos(m, 'es', 'af', [], 0)
  assert.match(sin, /todavía no tiene plan de cuentas/)
  assert.match(sin, /value="plan"/)
  assert.equal(sin.includes('‹falta:'), false)

  const con = pintarPeriodos(m, 'es', 'af', [], 84)
  assert.equal(/todavía no tiene plan de cuentas/.test(con), false)
})

// ===========================================================================
// Y las dos acciones contestaban SIN DECIR NADA.
//
// Deshacer una carga volvía a la misma pantalla con la misma caja vacía: la única
// señal de que había pasado algo era que el lote cambiaba de estado en una lista de
// más abajo. Instalar el plan de cuentas, igual: la pantalla volvía sin el aviso de
// antes, y había que deducir de su ausencia que había funcionado.
//
// Deducir de una ausencia es exactamente lo que este sistema no deja hacer en
// ninguna otra parte. Y una acción que contesta sin decir nada se vuelve a pulsar.
//
// Los dos textos —«Carga deshecha: {n} asiento(s) reversado(s)» y «Plan de cuentas
// instalado»— llevaban escritos en los dos idiomas sin que nada los pintara. Los
// destapó el barrido de claves del diccionario sin pantalla.

test('deshacer una carga DICE cuántos asientos reversó', async () => {
  const { pintarSubirHoja } = await import('../src/pantallas/importar.ts')
  const { t } = await import('../src/i18n/t.ts')
  await limpio()
  const lote = await traerHasta('confirmado')
  const r = await dentro((q) => revertir(q, lote, 'la hoja estaba mal', YO, 'es'))
  assert.equal(r.hecho, true)
  const cuantos = (r as { asientos: number }).asientos
  assert.ok(cuantos > 0)

  const h = pintarSubirHoja('es', 'af', await dentro((q) => lotes(q, G)), '',
    t('es', 'importar.revertida').replace('{n}', String(cuantos)))
  assert.match(h, /Carga deshecha/, 'deshacer contesta sin decir nada')
  assert.match(h, new RegExp(`${cuantos} asiento`))
  // Y sin mensaje la caja no sale: un recuadro vacío es peor que ninguno.
  const sin = pintarSubirHoja('es', 'af', await dentro((q) => lotes(q, G)), '')
  assert.doesNotMatch(sin, /<div class="bien-caja">/)
})

test('instalar el plan de cuentas lo DICE, no lo deja deducir de una ausencia', async () => {
  const { pintarPeriodos } = await import('../src/pantallas/periodos.ts')
  const { meses } = await import('../src/dominio/periodos.ts')
  const { t } = await import('../src/i18n/t.ts')
  const m = await dentro((q) => meses(q, G, 'es'))

  const con = pintarPeriodos(m, 'es', 'af', [], 84, t('es', 'periodo.plan_puesto'))
  assert.match(con, /Plan de cuentas instalado/)
  const sin = pintarPeriodos(m, 'es', 'af', [], 84)
  assert.doesNotMatch(sin, /<div class="bien-caja">/)
})

test('y en inglés las dos dicen lo mismo', async () => {
  const { pintarPeriodos } = await import('../src/pantallas/periodos.ts')
  const { pintarSubirHoja } = await import('../src/pantallas/importar.ts')
  const { meses } = await import('../src/dominio/periodos.ts')
  const { t } = await import('../src/i18n/t.ts')
  const m = await dentro((q) => meses(q, G, 'en'))
  assert.match(pintarPeriodos(m, 'en', 'af', [], 84, t('en', 'periodo.plan_puesto')),
    /Chart of accounts installed/)
  assert.match(
    pintarSubirHoja('en', 'af', await dentro((q) => lotes(q, G)), '',
      t('en', 'importar.revertida').replace('{n}', '3')),
    /Import undone/)
})
