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
  formatoNumero, formatoFecha, HojaRepetida, type Campo,
} from '../src/dominio/importar.ts'

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
    `)
  })
})
after(async () => { await cerrar() })

/** Deja la organización sin lotes ni facturas, para cada prueba. */
async function limpio(): Promise<void> {
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`delete from lote_importacion where organizacion_id = ${G}::uuid`
    await q`delete from documento_fiscal where organizacion_id = ${G}::uuid`
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
