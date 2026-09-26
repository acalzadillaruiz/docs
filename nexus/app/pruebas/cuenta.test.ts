/**
 * El estado de cuenta del cliente.
 *
 * «Cuánto me han facturado y cuánto debo» es la segunda pregunta de cualquiera que paga, y no
 * la contestaba ninguna pantalla desde su lado: el cliente veía cada valuación por separado y
 * tenía que sumarlas él, o llamar a GPS a preguntar por una cifra que el sistema ya sabe.
 *
 * Lo que de verdad se vigila aquí es la cerradura, porque este trozo tiene una pieza delicada:
 * la suma de lo pagado la hace una función con `security definer`, que **se salta las
 * políticas de fila**. Hace falta porque el cliente no puede ver la tabla de cobros —ahí vive
 * la referencia bancaria de GPS— y no necesita verla para saber cuánto ha pagado. Pero eso
 * significa que lo único que sujeta el aislamiento es la comprobación escrita dentro de la
 * función, y por eso la prueba que importa pide el estado de cuenta de OTRA operadora.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { estadoDeCuenta } from '../src/dominio/cuenta.ts'
import { pintarCuenta } from '../src/pantallas/cuenta.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'cc710000-0000-0000-0000-0000000000a1'
const C = 'cc710000-0000-0000-0000-0000000000a2'
const C2 = 'cc710000-0000-0000-0000-0000000000a3'
const YO = 'cc710000-0000-0000-0000-0000000000a4'
const ING = 'cc710000-0000-0000-0000-0000000000a5'
const ING2 = 'cc710000-0000-0000-0000-0000000000a6'
const TASA = 'cc710000-0000-0000-0000-0000000000a7'
const IVA = 'cc710000-0000-0000-0000-0000000000a8'
const CTR = 'cc710000-0000-0000-0000-0000000000b1'
const CTR2 = 'cc710000-0000-0000-0000-0000000000b2'
const RG = 'cc710000-0000-0000-0000-0000000000c1'
const V1 = 'cc710000-0000-0000-0000-0000000000d1'
const V2 = 'cc710000-0000-0000-0000-0000000000d2'
const V_OTRA = 'cc710000-0000-0000-0000-0000000000d3'
const DOC = 'cc710000-0000-0000-0000-0000000000e1'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)
const elCliente = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: ING }, 'nexus_cliente', f)
const elOtroCliente = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: ING2 }, 'nexus_cliente', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Cuenta','J-908000000-0'),
        ('${C}','operadora','Operadora Cuenta','J-908500000-5'),
        ('${C2}','operadora','Otra Operadora','J-908600000-6')
        on conflict (id) do update set nombre = excluded.nombre;
      insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash,
                           totp_secreto) values
        ('${YO}','${G}','cuenta@prueba.test','Interno','clave_2fa','(h)','(s)'),
        ('${ING}','${C}','cuenta-cli@prueba.test','De la operadora','clave_2fa','(h)','(s)'),
        ('${ING2}','${C2}','cuenta-cli2@prueba.test','De la otra','clave_2fa','(h)','(s)')
        on conflict (id) do nothing;
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2019-06-12', 40.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2018-01-19') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2018-01-19', 9.00)
        on conflict (vigente_desde) do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje,
                                 factor_ut, minimo_ut, vigente_desde)
        values ('CTA-SERV','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,
                '2018-01-19') on conflict (codigo) do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es,
                            titulo_en, estado, moneda, monto, tasa_id, creado_por) values
        ('${CTR}','${G}','${C}','CTA-001','servicio','Servicio de cuenta','Account service',
         'vigente','VES', 5000000.00,'${TASA}','${YO}'),
        ('${CTR2}','${G}','${C2}','CTA-002','servicio','De la otra','Of the other',
         'vigente','VES', 3000000.00,'${TASA}','${YO}')
        on conflict (id) do update set estado = 'vigente';
      insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                           unidad, cantidad, precio_unitario)
        values ('${RG}','${CTR}', 1,'Uno','One','und', 1, 5000000.00)
        on conflict (id) do nothing;

      delete from cobro where valuacion_id in ('${V1}','${V2}','${V_OTRA}');
      delete from valuacion where id in ('${V1}','${V2}','${V_OTRA}');
      delete from documento_fiscal where id = '${DOC}';

      insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde,
        periodo_hasta, obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
        concepto_islr, ret_iva_pct, estado, presentada_el, aprobada_el, aprobada_por,
        creada_por) values
        -- Facturada y cobrada a medias: es la que prueba que la suma de cobros llega.
        ('${V1}','${G}','${CTR}', 1,'2026-01-01','2026-01-31', 400000.00,'VES','${TASA}',
         0, 0,'${IVA}','CTA-SERV', 0,'facturada','2026-02-02','2026-02-05','${ING}','${YO}'),
        -- Presentada y sin firmar: lo único sobre lo que el cliente puede actuar.
        ('${V2}','${G}','${CTR}', 2,'2026-02-01','2026-02-28', 250000.00,'VES','${TASA}',
         0, 0,'${IVA}','CTA-SERV', 0,'presentada','2026-03-02', null, null,'${YO}'),
        -- Y una de la OTRA operadora, que no tiene que salirle a la primera.
        ('${V_OTRA}','${G}','${CTR2}', 1,'2026-01-01','2026-01-31', 111000.00,'VES',
         '${TASA}', 0, 0,'${IVA}','CTA-SERV', 0,'facturada','2026-02-02','2026-02-05',
         '${ING2}','${YO}');

      insert into documento_fiscal (id, organizacion_id, sentido, tipo, numero,
        numero_control, contraparte_id, fecha, contrato_id, base_ves, base_usd,
        alicuota_iva_id, iva_ves, iva_usd, tasa_id, registrado_por)
      values ('${DOC}','${G}','emitido','factura','00099001','01-00099001','${C}',
              '2026-02-06','${CTR}', 400000.00, 10000.00,'${IVA}', 64000.00, 1600.00,
              '${TASA}','${YO}');
      update valuacion set documento_id = '${DOC}' where id = '${V1}';

      insert into cobro (organizacion_id, valuacion_id, fecha, medio, moneda, monto, tasa_id,
                         referencia, registrado_por)
      values ('${G}','${V1}','2026-03-01','transferencia','VES', 100000.00,'${TASA}',
              'ref-que-el-cliente-no-ve','${YO}');
    `)
  })
})
after(async () => { await cerrar() })

test('el cliente ve lo facturado, lo pagado y lo que queda, de lo suyo', async () => {
  const c = await elCliente((q) => estadoDeCuenta(q, C, 'es'))
  assert.equal(c.lineas.length, 2, `le salieron ${c.lineas.length} líneas`)
  assert.equal(c.lineas.every((l) => l.contrato === 'CTA-001'), true)

  const uno = c.lineas.find((l) => l.numero === 1)!
  // Lo pagado sale de una tabla que el cliente NO puede leer: si la suma no llegara, aquí
  // habría un cero y le estaríamos diciendo que debe 100.000 más de lo que debe.
  assert.match(uno.cobrado, /100/, `lo pagado salió «${uno.cobrado}»`)
  assert.ok(uno.saldoCrudo < uno.netoCrudo, 'el saldo no descontó lo ya pagado')
  assert.equal(uno.factura, '00099001 · 01-00099001',
    'no enseña el número de control, que es el que necesita para su crédito fiscal')
})

test('y NO puede leer la tabla de cobros, que es de dónde sale esa suma', async () => {
  // La razón de que esto sea una función con `security definer` y no una consulta. Si algún
  // día se le concediera la tabla, este trozo dejaría de necesitar el privilegio — y hasta
  // entonces, la referencia bancaria de GPS no sale de GPS.
  await assert.rejects(
    elCliente((q) => q`select referencia from cobro`),
    /permission denied|no existe la relación|does not exist/i,
  )
})

test('lo que espera su firma se cuenta y se marca', async () => {
  const c = await elCliente((q) => estadoDeCuenta(q, C, 'es'))
  assert.equal(c.porFirmar, 1, 'no contó la que espera su firma')
  const h = pintarCuenta(c, 'es')
  assert.match(h, /class="lc firma"/, 'no la marca en la lista')
  assert.match(h, /espera tu firma/i, 'no lo dice arriba')
})

test('el estado de cuenta de OTRA operadora NO se le da, y eso es lo único que la sujeta', async () => {
  // La prueba que importa. La función se salta las políticas de fila, así que si la
  // comprobación de quién pregunta no estuviera, pedir el identificador de otra operadora
  // devolvería sus cifras — cuánto factura y cuánto debe otra empresa. Comprobado quitándola.
  const ajena = await elCliente((q) => estadoDeCuenta(q, C2, 'es'))
  assert.equal(ajena.lineas.length, 0,
    'una operadora obtuvo el estado de cuenta de otra pasando su identificador')

  // Y al revés, para que no pase por una casualidad del orden de los datos.
  const alRevés = await elOtroCliente((q) => estadoDeCuenta(q, C, 'es'))
  assert.equal(alRevés.lineas.length, 0)

  // Y que cada una SÍ ve la suya: una cerradura que no se abre nunca es una pared.
  assert.equal((await elCliente((q) => estadoDeCuenta(q, C, 'es'))).lineas.length, 2)
  assert.equal((await elOtroCliente((q) => estadoDeCuenta(q, C2, 'es'))).lineas.length, 1)
})

test('GPS puede ver el de su cliente, pero no el de un cliente de otra GPS', async () => {
  // GPS lo necesita para contestar al teléfono con la misma cifra que ve el cliente. Lo que
  // no puede es mirar el de un contrato que no ejecuta ella.
  const suyo = await dentro((q) => estadoDeCuenta(q, C, 'es'))
  assert.equal(suyo.lineas.length, 2)

  // La organización de otra GPS no existe en este archivo, así que se usa la de un cliente
  // que no es cliente de esta GPS: una organización cualquiera que no aparece como
  // `cliente_id` de ningún contrato suyo devuelve vacío igual.
  const nada = await dentro((q) => estadoDeCuenta(q, G, 'es'))
  assert.equal(nada.lineas.length, 0, 'devolvió algo para una organización que no es cliente')
})

test('un borrador de GPS no es una deuda del cliente y no aparece', async () => {
  // Enseñarle un borrador sería contarle una cifra que todavía puede cambiar, y además la
  // vería antes de que GPS decidiera presentarla.
  const antes = (await elCliente((q) => estadoDeCuenta(q, C, 'es'))).lineas.length
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`update valuacion set estado = 'borrador', presentada_el = null
             where id = ${V2}::uuid`
  })
  const conBorrador = await elCliente((q) => estadoDeCuenta(q, C, 'es'))
  assert.equal(conBorrador.lineas.length, antes - 1, 'le salió un borrador de GPS')
  assert.equal(conBorrador.porFirmar, 0)
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`update valuacion set estado = 'presentada', presentada_el = '2026-03-02'
             where id = ${V2}::uuid`
  })
})

test('con dos monedas NO se totaliza: un total falso es peor que ninguno', async () => {
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`update valuacion set moneda = 'USD' where id = ${V2}::uuid`
  })
  const c = await elCliente((q) => estadoDeCuenta(q, C, 'es'))
  assert.equal(c.moneda, '', 'sumó bolívares con dólares')
  assert.equal(c.totalSaldo, '')
  const h = pintarCuenta(c, 'es')
  assert.match(h, /más de una moneda/i, 'no explica por qué no hay total')
  // Y las líneas siguen dando su cifra cada una, que es lo que sí se puede decir.
  assert.equal(c.lineas.every((l) => l.saldo !== ''), true)
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`update valuacion set moneda = 'VES' where id = ${V2}::uuid`
  })
})

test('la pantalla sale entera en los dos idiomas, y sin nada del margen', async () => {
  const c = await elCliente((q) => estadoDeCuenta(q, C, 'es'))
  for (const idioma of ['es', 'en'] as const) {
    const h = pintarCuenta(c, idioma)
    assert.equal(h.includes('‹falta:'), false, `${idioma} tiene una clave sin traducir`)
    assert.match(h, /CTA-001/)
    // Nada de costos ni de margen: es una pantalla que ve alguien de fuera de GPS.
    //
    // Se mira el TEXTO, sin la hoja de estilos: la primera versión buscaba «margin» en el
    // documento entero y saltaba con cada `margin:` del CSS, o sea que la comprobación no
    // miraba lo que dice que mira. Una comprobación que salta por algo que no es el fallo se
    // acaba relajando hasta que deja de comprobar.
    const texto = h.replace(/<style>[\s\S]*?<\/style>/g, ' ')
    for (const prohibido of ['costo', 'margen', 'Costo', 'Margen', 'cost', 'margin']) {
      assert.equal(texto.toLowerCase().includes(prohibido.toLowerCase()), false,
        `${idioma} enseña «${prohibido}»`)
    }
  }
})
