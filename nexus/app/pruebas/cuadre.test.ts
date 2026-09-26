/**
 * Dos formas de cuadrar que no son cuadrar.
 *
 * La regla 1 de la contabilidad de este producto, escrita en el primer archivo del
 * esquema: «un asiento no cuadra -> la base de datos lo rechaza. No existe asiento
 * descuadrado.» Es verdad, y no era suficiente.
 *
 * **La primera: la suma de cero líneas es cero.** El control del cuadre es un disparador
 * sobre las partidas, así que un asiento sin ninguna línea no lo dispara nunca — y si lo
 * disparara, diría que cuadra. La base de muestra tenía VEINTISÉIS asientos vacíos, con
 * nombres de contratos que no existen, en la pantalla del libro diario. Un asiento vacío
 * es peor que uno descuadrado: el descuadrado se ve; el vacío se cuela con su número
 * correlativo y, en un libro donde nada se edita y nada se borra, se queda.
 *
 * **La segunda: redondear cada línea por separado.** La columna en dólares de un asiento
 * en bolívares es una conversión línea a línea, y redondear seis veces y sumar no da lo
 * mismo que sumar y redondear. Sobra un céntimo, el asiento se rechaza, y la consecuencia
 * no es estética: `asentar_valuacion` no podía asentar la primera valuación de la muestra,
 * así que **el botón de facturar no funcionaba** para ella. Salía un error de base de datos
 * y esa valuación no se podía facturar nunca.
 *
 * Lo tapaba que la muestra escribía el asiento de la venta a mano, con dos líneas iguales
 * y de signo contrario, que cuadran siempre. El fixture hacía lo que la aplicación no
 * hacía — la cuarta vez en este proyecto.
 *
 * Lo que se comprueba aquí es lo uno y lo otro, y sobre todo **que el perdón sea
 * estrecho**: un control que perdona se convierte en un control que no controla. Así que
 * hay tantas pruebas de lo que NO se absorbe como de lo que sí.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { facturar } from '../src/dominio/valuar.ts'
import { randomUUID } from 'node:crypto'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'b7c8d9e0-0000-0000-0000-00000000000a'
const C = 'b7c8d9e0-0000-0000-0000-00000000000c'
const YO = 'b7c8d9e0-0000-0000-0000-00000000000d'
const TASA = 'b7c8d9e0-1111-0000-0000-00000000000a'
const IVA = 'b7c8d9e0-1111-0000-0000-00000000000b'
const CTR = 'b7c8d9e0-2222-0000-0000-00000000000a'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Cuadre','J-904300000-0'),
        ('${C}','operadora','Operadora Cuadre','J-904310000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto) values
              (${YO}, ${G},'cuadre@prueba.test','Contador','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      -- La tasa es 70, que es la de la muestra, porque es con la que salió el céntimo.
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2027-02-09', 70.00,'carga_manual')
        on conflict (id) do update set ves_por_usd = excluded.ves_por_usd;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2018-02-09') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00)
        on conflict do nothing;
      insert into alicuota_igtf (vigente_desde, porcentaje) values ('2026-01-01', 3.00)
        on conflict (vigente_desde) do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje,
                                 factor_ut, minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,
                '2026-01-01') on conflict do nothing;
      select instalar_plan_cuentas('${G}');
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es,
                            titulo_en, estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR}','${G}','${C}','CUA-001','servicio','Cuadrilla','Crew',
                'vigente','VES', 4000000.00,'${TASA}','${YO}')
        on conflict (id) do update set estado = excluded.estado;
      insert into periodo (organizacion_id, anio, mes, estado)
        values ('${G}', 2027, 3,'abierto')
        on conflict (organizacion_id, anio, mes) do update set estado = 'abierto';
    `)
  })
})
after(async () => { await cerrar() })

/**
 * Mete un asiento con las líneas que se le den, y devuelve lo que diga la base al
 * confirmarlo: `null` si pasa, el mensaje si lo rechaza.
 *
 * El control es diferido hasta el final de la transacción a propósito —el asiento tiene
 * que existir antes que sus líneas—, así que aquí se adelanta a inmediato, que es lo mismo
 * que hace `db/pruebas/01-reglas-duras.sql`. Sin eso, el fallo llegaría al confirmar, ya
 * fuera de la prueba, y la prueba pasaría por no mirar.
 */
async function meter(lineas: ReadonlyArray<readonly [string, number, number]>):
  Promise<{ error: string | null; lineas: Array<{ linea: number; ves: string; usd: string }> }> {
  const asiento = randomUUID()
  try {
    return await dentro(async (q) => {
      await q`insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                                   descripcion_es, descripcion_en, origen_tipo, origen_id,
                                   creado_por)
              values (${asiento}::uuid, ${G}::uuid, siguiente_asiento(${G}::uuid),
                      '2027-03-15', 2027, 3,'Prueba de cuadre','Balance test','prueba',
                      ${randomUUID()}::uuid, ${YO}::uuid)`
      let n = 0
      for (const [cuenta, ves, usd] of lineas) {
        n += 1
        await q`insert into partida (asiento_id, linea, organizacion_id, cuenta,
                                     monto_ves, monto_usd, tasa_id)
                values (${asiento}::uuid, ${n}, ${G}::uuid, ${cuenta},
                        ${ves.toFixed(2)}, ${usd.toFixed(2)}, ${TASA}::uuid)`
      }
      await q.unsafe('set constraints all immediate')
      const filas = (await q`
        select linea, monto_ves::text as ves, monto_usd::text as usd
          from partida where asiento_id = ${asiento}::uuid order by linea
      `) as unknown as Array<{ linea: number; ves: string; usd: string }>
      return { error: null, lineas: filas }
    })
  } catch (e) {
    return { error: (e as Error).message, lineas: [] }
  }
}

// El `+ 0` no es un adorno: sumar decimales en coma flotante deja un resto minúsculo y
// negativo, `toFixed` lo escribe «-0.00», y eso vuelve como -0, que no es igual a 0 para
// una comparación estricta. La prueba fallaba con el asiento perfectamente cuadrado.
const suma = (l: Array<{ ves: string; usd: string }>, cual: 'ves' | 'usd') =>
  Number(l.reduce((t, x) => t + Number(x[cual]), 0).toFixed(2)) + 0

test('un asiento SIN NINGUNA LÍNEA no se confirma, y lo dice por su nombre', async () => {
  const r = await meter([])
  assert.notEqual(r.error, null, 'entró un asiento vacío: la muestra tenía veintiséis')
  assert.match(r.error!, /no tiene ninguna línea/,
    `fue rechazado, pero no por estar vacío: ${r.error}`)
})

test('uno cuadrado entra, que es la otra mitad de la comprobación', async () => {
  const r = await meter([['1.1.01', 3500, 50], ['4.1.01', -3500, -50]])
  assert.equal(r.error, null, `rechazó un asiento que cuadra: ${r.error}`)
})

test('el céntimo de la conversión se absorbe, y el asiento queda cuadrado', async () => {
  // Bolívares exactos; en dólares sobra un céntimo, que es lo que deja convertir y
  // redondear cada línea por separado.
  const r = await meter([
    ['1.1.02.01', 1000, 14.29], ['1.1.04.02', 500, 7.14], ['4.1.02', -1500, -21.42],
  ])
  assert.equal(r.error, null, `no se pudo asentar por un céntimo de dólar: ${r.error}`)
  assert.equal(suma(r.lineas, 'ves'), 0, 'los bolívares dejaron de cuadrar')
  assert.equal(suma(r.lineas, 'usd'), 0, 'el céntimo de dólar sigue ahí')
})

test('y cae en la línea MÁS GRANDE, que es donde un céntimo significa menos', async () => {
  const r = await meter([
    ['1.1.02.01', 1000, 14.29], ['1.1.04.02', 500, 7.14], ['4.1.02', -1500, -21.42],
  ])
  const tercera = r.lineas.find((l) => Number(l.linea) === 3)
  assert.equal(tercera!.usd, '-21.43', 'el céntimo no cayó en la línea más grande')
  assert.equal(r.lineas.find((l) => Number(l.linea) === 1)!.usd, '14.29',
    'se movió una línea que no tocaba')
})

test('el mismo asiento dos veces deja el céntimo en la MISMA línea', async () => {
  // Sin el desempate por número de línea, dos líneas del mismo importe harían que el
  // céntimo cayera en una o en otra según le viniera al planificador, y dos bases iguales
  // guardarían asientos distintos.
  // Las dos primeras líneas son EMPATE exacto en tamaño, y el céntimo que sobra lo ponen
  // las dos pequeñas. Con un empate de verdad, si no hubiera desempate, el céntimo podría
  // caer en cualquiera de las dos.
  const caso = [
    ['1.1.01', 1000, 14.29], ['1.1.02.01', -1000, -14.29],
    ['4.1.01', 2, 0.03], ['2.1.03.01', -2, -0.02],
  ] as const
  const uno = await meter(caso)
  const dos = await meter(caso)
  assert.equal(uno.error, null, `la primera pasada falló: ${uno.error}`)
  assert.equal(dos.error, null, `la segunda pasada falló: ${dos.error}`)
  assert.deepEqual(uno.lineas.map((l) => l.usd), dos.lineas.map((l) => l.usd),
    'el céntimo cambió de sitio entre dos pasadas iguales')
})

test('si descuadran LAS DOS columnas se rechaza, aunque sea un céntimo', async () => {
  // Esta es la que importa. Redondear la conversión descuadra SOLO la columna convertida,
  // porque la otra se escribió y suma cero de verdad. Las dos a la vez es un error de
  // cuentas, y taparlo dejaría el libro cuadrado y la cifra mal.
  const r = await meter([['1.1.01', 1000.01, 14.29], ['4.1.01', -1000, -14.28]])
  assert.notEqual(r.error, null, 'se tapó un descuadre de verdad')
  assert.match(r.error!, /no cuadra/, `se rechazó, pero por otra cosa: ${r.error}`)
})

test('y si sobra más de un céntimo por línea, tampoco: eso no es redondeo', async () => {
  const r = await meter([['1.1.01', 1000, 14.29], ['4.1.01', -1000, -14.20]])
  assert.notEqual(r.error, null, 'se tapó una diferencia de nueve céntimos')
  assert.match(r.error!, /no cuadra/, `se rechazó, pero por otra cosa: ${r.error}`)
})

test('FACTURAR la valuación que no se podía facturar: entra y el libro cuadra', async () => {
  // Las cifras son las de GPS-2027-001 de la muestra, tal cual, porque son las que no se
  // podían asentar: obra 1.173.000, IVA al 16%, garantía 5%, retención de IVA 75%, ISLR de
  // servicios, y la tasa a 70. Se pide por `facturar()`, que es lo que llama el botón: lo
  // que no funcionaba no era una función del esquema, era el botón.
  const val = randomUUID()
  await dentro((q) => q`
    insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde,
                           periodo_hasta, obra, moneda, tasa_id, amortiza_pct, garantia_pct,
                           alicuota_iva_id, concepto_islr, ret_iva_pct, estado, aprobada_el,
                           aprobada_por, creada_por)
    values (${val}::uuid, ${G}::uuid, ${CTR}::uuid,
            (select coalesce(max(numero), 0) + 1 from valuacion where contrato_id = ${CTR}::uuid),
            '2027-03-01','2027-03-31', 1173000.00,'VES', ${TASA}::uuid, 0, 5,
            ${IVA}::uuid,'SERV-PJ', 75,'aprobada','2027-03-31', ${YO}::uuid, ${YO}::uuid)`)

  const f = await dentro((q) => facturar(q, val, YO, false, 'es'))
  assert.equal(f.hecho, true,
    `no se pudo facturar: ${(f as { motivo?: string }).motivo ?? ''}`)

  const filas = (await dentro((q) => q`
    select p.linea, p.monto_ves::text as ves, p.monto_usd::text as usd
      from partida p join asiento a on a.id = p.asiento_id
     where a.origen_tipo = 'valuacion' and a.origen_id = ${val}::uuid
     order by p.linea
  `)) as unknown as Array<{ linea: number; ves: string; usd: string }>
  assert.equal(filas.length, 6, 'el asiento de la venta no tiene sus seis líneas')
  assert.equal(suma(filas, 'ves'), 0, 'el asiento de la venta no cuadra en bolívares')
  assert.equal(suma(filas, 'usd'), 0, 'el asiento de la venta no cuadra en dólares')
  // Y la cifra que se declara no se movió: el céntimo va a la columna CONVERTIDA.
  assert.equal(filas.find((l) => Number(l.linea) === 1)!.ves, '1102657.50',
    'el neto a cobrar en bolívares cambió por un céntimo de dólar')
})
