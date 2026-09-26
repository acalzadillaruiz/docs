/**
 * Las cifras que se declaran.
 *
 * Los libros de ventas y de compras son lo único de esta aplicación que sale de la empresa
 * con destino al SENIAT. La pantalla lo dice encima de los totales: «estas son las cifras
 * que se declaran. No hay otra versión en ningún sitio.» Dos de esas cifras estaban mal, y
 * las dos habían sobrevivido a las pruebas que ya había — porque **las que había contaban
 * filas.** Contar filas comprueba que una nota de crédito aparece en el libro; no comprueba
 * en qué dirección.
 *
 *   1. La columna «Total» se calculaba `base + exento`, **sin el IVA**. En el libro de
 *      ventas esa columna es el valor total de la operación con el impuesto incluido
 *      (Reglamento de la LIVA, art. 76): es lo que tiene que cuadrar con lo que pagó el
 *      cliente.
 *   2. **Una nota de crédito sumaba.** Devuelve parte de una factura ya emitida, así que
 *      baja la venta del mes y baja el débito fiscal; se listaba en positivo, como una
 *      factura más. Se declaraba de más por el importe de cada nota, al doble: lo que no
 *      baja y lo que debería haber bajado.
 *
 * Así que aquí no se cuenta ni una fila. Se suman las columnas con una nota de crédito y una
 * de débito dentro, y se comparan contra una cuenta hecha aparte a mano.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { libro, libroCrudo, aFilas } from '../src/dominio/libros.ts'
import { t } from '../src/i18n/t.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'c8d9e0f1-1234-0000-0000-00000000000a'
const C = 'c8d9e0f1-1234-0000-0000-00000000000c'
const YO = 'c8d9e0f1-1234-0000-0000-00000000000d'
const TASA = 'c8d9e0f1-1234-1111-0000-00000000000a'
const IVA = 'c8d9e0f1-1234-1111-0000-00000000000b'
const F1 = 'c8d9e0f1-1234-2222-0000-000000000001'
const F2 = 'c8d9e0f1-1234-2222-0000-000000000002'
const NC = 'c8d9e0f1-1234-2222-0000-000000000003'
const ND = 'c8d9e0f1-1234-2222-0000-000000000004'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

// Un mes propio y lejano, porque la base no se vacía entre archivos de prueba y estas
// sumas cuentan TODO lo que haya en el mes. Un documento de otra prueba dentro del mismo
// mes haría fallar esto por algo que no es el fallo.
const MES = { anio: 2029, mes: 5 }
const DIA = '2029-05-14'

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Libro','J-905100000-0'),
        ('${C}','operadora','Operadora Libro','J-905110000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto) values
              (${YO}, ${G},'libro@prueba.test','Contador','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2029-05-02', 50.00,'carga_manual')
        on conflict (id) do update set ves_por_usd = excluded.ves_por_usd;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2019-05-02') on conflict do nothing;
      -- Dos facturas, una nota de crédito y una nota de débito, todas en el mismo mes y
      -- todas con su importe en POSITIVO, que es como las guarda la aplicación. El signo
      -- es cosa del libro: la nota se guarda por lo que devuelve, no por lo que resta.
      insert into documento_fiscal (id, organizacion_id, sentido, tipo, numero,
                                    numero_control, contraparte_id, fecha, afecta_a,
                                    base_ves, base_usd, alicuota_iva_id, iva_ves, iva_usd,
                                    tasa_id, motivo, registrado_por) values
        ('${F1}','${G}','emitido','factura','00009001','00-29-00009001','${C}','${DIA}',
         null, 1000000.00, 20000.00,'${IVA}', 160000.00, 3200.00,'${TASA}', null,'${YO}'),
        ('${F2}','${G}','emitido','factura','00009002','00-29-00009002','${C}','${DIA}',
         null,  500000.00, 10000.00,'${IVA}',  80000.00, 1600.00,'${TASA}', null,'${YO}'),
        ('${NC}','${G}','emitido','nota_credito','00009003','00-29-00009003','${C}','${DIA}',
         '${F1}', 200000.00, 4000.00,'${IVA}', 32000.00, 640.00,'${TASA}',
         'El cliente rechazó dos días de cuadrilla','${YO}'),
        ('${ND}','${G}','emitido','nota_debito','00009004','00-29-00009004','${C}','${DIA}',
         '${F2}', 100000.00, 2000.00,'${IVA}', 16000.00, 320.00,'${TASA}',
         'Se facturó de menos el flete','${YO}')
        on conflict (id) do nothing;
    `)
  })
})
after(async () => { await cerrar() })

const n = (s: string) => Number(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'))

test('el total de cada línea incluye el IVA: es el valor de la operación', async () => {
  const l = await dentro((q) => libro(q, G, 'ventas', MES.anio, MES.mes, 'es'))
  const f1 = l.lineas.find((x) => x.numero === '00009001')!
  // 1.000.000 de base y 160.000 de IVA. El total es lo que pagó el cliente.
  assert.equal(n(f1.total), 1160000,
    'el total de la factura no incluye el IVA: es la columna que se declara')
})

test('UNA NOTA DE CRÉDITO RESTA. Sumaba, y se declaraba de más', async () => {
  const l = await dentro((q) => libro(q, G, 'ventas', MES.anio, MES.mes, 'es'))
  const nc = l.lineas.find((x) => x.numero === '00009003')!
  assert.equal(n(nc.base), -200000, 'la nota de crédito no baja la base declarada')
  assert.equal(n(nc.iva), -32000, 'la nota de crédito no baja el débito fiscal')
  assert.equal(n(nc.total), -232000, 'la nota de crédito no baja el total')
})

test('y una nota de DÉBITO suma, igual que una factura: cobra más', async () => {
  const l = await dentro((q) => libro(q, G, 'ventas', MES.anio, MES.mes, 'es'))
  const nd = l.lineas.find((x) => x.numero === '00009004')!
  assert.equal(n(nd.base), 100000, 'la nota de débito no suma')
  assert.equal(n(nd.iva), 16000, 'la nota de débito no suma al débito fiscal')
})

test('los totales del mes son los de la declaración, hechos aparte a mano', async () => {
  const l = await dentro((q) => libro(q, G, 'ventas', MES.anio, MES.mes, 'es'))
  // Base: 1.000.000 + 500.000 - 200.000 + 100.000 = 1.400.000
  // Débito fiscal: 160.000 + 80.000 - 32.000 + 16.000 = 224.000
  // Total con IVA: 1.400.000 + 224.000 = 1.624.000
  assert.equal(n(l.totalBase), 1400000, 'la base declarada del mes no cuadra')
  assert.equal(n(l.totalIva), 224000, 'el débito fiscal del mes no cuadra')
  assert.equal(n(l.total), 1624000, 'el total del mes no cuadra')
})

test('la alícuota NO lleva signo: el 16% de una nota sigue siendo el 16%', async () => {
  const l = await dentro((q) => libro(q, G, 'ventas', MES.anio, MES.mes, 'es'))
  const nc = l.lineas.find((x) => x.numero === '00009003')!
  assert.equal(nc.alicuota, '16%', `la alícuota salió ${nc.alicuota}`)
})

test('la hoja que se baja lleva las MISMAS cifras que la pantalla', async () => {
  // El archivo y la pantalla se piden por caminos distintos —uno formatea y el otro no—,
  // y la mitad de lo que hay que poder comprobar de un exportador es que no se separen.
  const crudos = await dentro((q) => libroCrudo(q, G, 'ventas', MES.anio, MES.mes))
  const nc = crudos.find((c) => c['numero'] === '00009003')!
  assert.equal(Number(nc['base']), -200000, 'el archivo no resta la nota de crédito')
  assert.equal(Number(nc['total']), -232000, 'el total del archivo no lleva el IVA restado')
})

test('y la cabecera de la hoja sale del diccionario, no escrita aparte', async () => {
  // Estaba escrita aquí en los dos idiomas, y por eso se separó de la pantalla: arriba
  // pasó a decir «Total con IVA» y en el archivo seguía diciendo «Total».
  const l = await dentro((q) => libro(q, G, 'ventas', MES.anio, MES.mes, 'es'))
  const { cabeceras } = aFilas(l, 'es', [])
  assert.equal(cabeceras.at(-1), t('es', 'libro.total'),
    'la última columna del archivo no se llama como en la pantalla')
  const en = aFilas(l, 'en', [])
  assert.equal(en.cabeceras.at(-1), t('en', 'libro.total'),
    'y en inglés tampoco')
  assert.notEqual(t('es', 'libro.total'), t('en', 'libro.total'),
    'las dos comprobaciones de arriba pasarían con el diccionario vacío')
})
