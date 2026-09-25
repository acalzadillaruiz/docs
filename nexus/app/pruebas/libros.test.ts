/**
 * Los libros de ventas y de compras.
 *
 * De todo lo que hay en esta aplicación, esto es lo único que sale de la empresa con
 * destino al SENIAT. Así que lo que se comprueba no es que se vea bien: es que los
 * totales sean exactamente los de la declaración, que el libro salga de las facturas
 * que ya existen —y no de una tabla aparte que alguien teclea—, y que la hoja que se
 * baja la pueda abrir un Excel en español sin romperse.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { libro, libroCrudo, aFilas } from '../src/dominio/libros.ts'
import { pintarLibro } from '../src/pantallas/libros.ts'
import { leerHoja, escribirHoja } from '../src/servidor/csv.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '8e9f0a1b-0000-0000-0000-00000000000a'
const C = '8e9f0a1b-0000-0000-0000-00000000000b'
const PR = '8e9f0a1b-0000-0000-0000-00000000000c'
const YO = '8e9f0a1b-0000-0000-0000-00000000000d'
const TASA = '8e9f0a1b-1111-0000-0000-00000000000a'
const IVA = '8e9f0a1b-1111-0000-0000-00000000000b'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Libros','J-902400000-0'),
        ('${C}','operadora','Operadora Libros','J-902500000-0'),
        ('${PR}','proveedor','Suministros Libros','J-30555555-5')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'libros@prueba.test','Interno','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-07-01', 40.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2026-01-01') on conflict do nothing;

      delete from documento_fiscal where organizacion_id = '${G}';

      -- Dos ventas de julio y una compra. La compra, sin número de control: es el
      -- caso que hay que ver en el libro, no el que hay que esconder.
      insert into documento_fiscal (organizacion_id, sentido, tipo, numero, numero_control,
                                    contraparte_id, fecha, alicuota_iva_id,
                                    base_ves, base_usd, iva_ves, iva_usd, tasa_id,
                                    registrado_por) values
        ('${G}','emitido','factura','V-001','01-001','${C}','2026-07-03','${IVA}',
         1000000.00, 25000.00, 160000.00, 4000.00,'${TASA}','${YO}'),
        ('${G}','emitido','factura','V-002','01-002','${C}','2026-07-20','${IVA}',
         500000.00, 12500.00, 80000.00, 2000.00,'${TASA}','${YO}'),
        ('${G}','recibido','factura','C-900', null,'${PR}','2026-07-10','${IVA}',
         200000.00, 5000.00, 32000.00, 800.00,'${TASA}','${YO}'),
        -- Y una de agosto, que NO puede aparecer en el libro de julio.
        ('${G}','emitido','factura','V-003','01-003','${C}','2026-08-01','${IVA}',
         999999.00, 24999.98, 159999.84, 4000.00,'${TASA}','${YO}');
    `)
  })
})
after(async () => { await cerrar() })

test('el libro de ventas sale de las facturas: nadie lo escribe', async () => {
  const l = await dentro((q) => libro(q, G, 'ventas', 2026, 7, 'es'))
  assert.equal(l.cuantas, 2)
  assert.deepEqual(l.lineas.map((a) => a.numero), ['V-001', 'V-002'])
  // Ordenado por fecha, que es como se declara.
  assert.equal(l.lineas[0]!.fecha, '2026-07-03')
})

test('los totales son EXACTAMENTE los que se declaran', async () => {
  const l = await dentro((q) => libro(q, G, 'ventas', 2026, 7, 'es'))
  assert.match(l.totalBase, /1\.500\.000,00/)
  assert.match(l.totalIva, /240\.000,00/)
})

test('una factura de otro mes no se cuela en el libro del mes', async () => {
  // Es el error que obliga a rehacer una declaración entera.
  const l = await dentro((q) => libro(q, G, 'ventas', 2026, 7, 'es'))
  assert.equal(l.lineas.some((a) => a.numero === 'V-003'), false)
  const agosto = await dentro((q) => libro(q, G, 'ventas', 2026, 8, 'es'))
  assert.equal(agosto.cuantas, 1)
})

test('el libro de compras es otro libro, no el mismo con otro nombre', async () => {
  const compras = await dentro((q) => libro(q, G, 'compras', 2026, 7, 'es'))
  assert.equal(compras.cuantas, 1)
  assert.equal(compras.lineas[0]!.numero, 'C-900')
  assert.equal(compras.lineas[0]!.rif, 'J-30555555-5')
})

test('una compra SIN número de control se señala, no se disimula', async () => {
  // Sin control no hay derecho a crédito fiscal y la retención de IVA pasa al 100%.
  // Que se vea en el libro es lo que hace que alguien la reclame a tiempo, en vez de
  // descubrirlo al declarar.
  const compras = await dentro((q) => libro(q, G, 'compras', 2026, 7, 'es'))
  assert.equal(compras.lineas[0]!.control, null)
  const h = pintarLibro(compras, 'es', 'af')
  assert.match(h, /class="sin"/)
  assert.match(h, /Sin número de control/)
})

test('la pantalla pone los totales ARRIBA, antes del detalle', async () => {
  // Es lo que se copia en la declaración; lo de abajo es lo que lo sostiene.
  const l = await dentro((q) => libro(q, G, 'ventas', 2026, 7, 'es'))
  const h = pintarLibro(l, 'es', 'af')
  assert.ok(h.indexOf('class="tot"') < h.indexOf('<table'))
})

test('un mes sin facturas lo dice, y no enseña una tabla vacía', async () => {
  const l = await dentro((q) => libro(q, G, 'ventas', 2026, 1, 'es'))
  assert.equal(l.cuantas, 0)
  const h = pintarLibro(l, 'es', 'af')
  assert.doesNotMatch(h, /<table/)
  assert.match(h, /No hay ninguna factura/)
})

test('la hoja que se baja lleva los importes SIN formatear', async () => {
  // La abre una hoja de cálculo, no una persona: «1.500.000,00» leído por un Excel
  // en inglés se convierte en otra cosa, y el total declarado deja de cuadrar.
  const l = await dentro((q) => libro(q, G, 'ventas', 2026, 7, 'es'))
  const crudos = await dentro((q) => libroCrudo(q, G, 'ventas', 2026, 7))
  const { cabeceras, filas } = aFilas(l, 'es', crudos)
  assert.equal(cabeceras[0], 'Fecha')
  assert.equal(filas.length, 2)
  assert.equal(filas[0]![7], '1000000.00')
  // Punto decimal y sin separador de miles: ni «1.000.000,00» ni «1,000,000.00».
  assert.doesNotMatch(filas[0]![7]!, /,/)
  assert.match(filas[0]![7]!, /^\d+\.\d{2}$/)
})

test('la hoja se vuelve a leer entera: ida y vuelta sin perder nada', async () => {
  const l = await dentro((q) => libro(q, G, 'compras', 2026, 7, 'es'))
  const crudos = await dentro((q) => libroCrudo(q, G, 'compras', 2026, 7))
  const { cabeceras, filas } = aFilas(l, 'es', crudos)
  const leida = leerHoja(escribirHoja([cabeceras, ...filas]))
  assert.deepEqual(leida.filas[0], cabeceras)
  assert.equal(leida.filas[1]![4], 'C-900')
})

test('la cabecera de la hoja dice de quién es el RIF, que no es lo mismo en cada libro', async () => {
  const v = await dentro((q) => libro(q, G, 'ventas', 2026, 7, 'es'))
  const c = await dentro((q) => libro(q, G, 'compras', 2026, 7, 'es'))
  assert.equal(aFilas(v, 'es').cabeceras[1], 'RIF del cliente')
  assert.equal(aFilas(c, 'es').cabeceras[1], 'RIF del proveedor')
  assert.equal(aFilas(v, 'en').cabeceras[1], 'Client tax ID')
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const l = await dentro((q) => libro(q, G, 'compras', 2026, 7, 'en'))
  const h = pintarLibro(l, 'en', 'af')
  assert.match(h, /Purchase ledger/)
  assert.match(h, /Input VAT/)
  assert.doesNotMatch(h, /Libro de compras/)
  assert.doesNotMatch(h, /undefined/)
})
