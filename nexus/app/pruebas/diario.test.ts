/**
 * El libro diario.
 *
 * Es la pantalla donde termina de abrirse cualquier cifra del sistema. Todas las
 * demás enseñan algo derivado; debajo de un asiento no hay nada más.
 *
 * Lo que se comprueba aquí: que el mes cuadre de verdad, que se vea lo que en otros
 * sitios no se ve —cuánto tardó el hecho en llegar y si el asiento fue reversado—, y
 * que el debe y el haber salgan en columnas distintas aunque por dentro sean un solo
 * campo con signo.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { randomUUID } from 'node:crypto'
import { diario, reversar, diarioCrudo, cabecerasDiario } from '../src/dominio/diario.ts'
import { pintarDiario } from '../src/pantallas/diario.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'e4f5a6b7-0000-0000-0000-00000000000a'
const YO = 'e4f5a6b7-0000-0000-0000-00000000000d'
const TASA = 'e4f5a6b7-1111-0000-0000-00000000000a'
const A1 = 'e4f5a6b7-2222-0000-0000-00000000000a'
const A2 = 'e4f5a6b7-2222-0000-0000-00000000000b'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif)
        values ('${G}','gps','GPS Diario','J-903400000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'diario@prueba.test','Contador','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-12-01', 55.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      select instalar_plan_cuentas('${G}');
      insert into periodo (organizacion_id, anio, mes) values ('${G}', 2026, 12)
        on conflict do nothing;
      -- La base no se vacía entre ejecuciones de un mismo archivo, y una de estas
      -- pruebas CIERRA noviembre para comprobar que un mes cerrado se dice antes. En
      -- la segunda corrida ese mes seguía cerrado y no dejaba ni crear el asiento
      -- suelto: el fixture lo devuelve a abierto, como haría una persona.
      update periodo set estado = 'abierto'
       where organizacion_id = '${G}' and anio = 2026 and mes = 11;
    `)
    const [hay] = (await q`
      select count(*)::int as n from asiento where organizacion_id = ${G}::uuid
    `) as unknown as Array<{ n: number }>
    if (Number(hay?.n ?? 0) === 0) {
      await q.unsafe(`
        insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                             descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
          values ('${A1}','${G}', siguiente_asiento('${G}'),'2026-12-03', 2026, 12,
                  'Aporte de capital','Capital contribution','aporte','${A1}','${YO}');
        insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves,
                             monto_usd, tasa_id) values
          ('${A1}', 1,'${G}','1.1.01.02', 3000000.00, 54545.45,'${TASA}'),
          ('${A1}', 2,'${G}','3.1.01', -3000000.00, -54545.45,'${TASA}');
        -- Un segundo asiento que despues se reversa, para ver las dos marcas.
        insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                             descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
          values ('${A2}','${G}', siguiente_asiento('${G}'),'2026-12-10', 2026, 12,
                  'Gasto mal imputado','Misposted expense','aporte','${A2}','${YO}');
        insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves,
                             monto_usd, tasa_id) values
          ('${A2}', 1,'${G}','5.2.01', 100000.00, 1818.18,'${TASA}'),
          ('${A2}', 2,'${G}','1.1.01.02', -100000.00, -1818.18,'${TASA}');
        select reversar_asiento('${A2}','${YO}','estaba en la cuenta equivocada');
      `)
    }
  })
})
after(async () => { await cerrar() })

test('el mes CUADRA: todas las líneas suman cero', async () => {
  // Es la comprobación que da sentido a las demás. Si no cuadra, hay un asiento a
  // medias y ninguna cifra del sistema se sostiene.
  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  assert.equal(d.cuadra, true, `descuadre de ${d.descuadre}`)
  assert.ok(d.apuntes.length >= 3, 'faltan asientos: el aporte, el gasto y su reverso')
})

test('el debe y el haber salen en columnas distintas', async () => {
  // Por dentro es un solo campo con signo —no se pueden tener las dos cosas—, pero
  // un contador lee dos columnas.
  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  const aporte = d.apuntes.find((a) => a.descripcion.includes('Aporte'))!
  const debe = aporte.lineas.filter((l) => l.debe !== '')
  const haber = aporte.lineas.filter((l) => l.haber !== '')
  assert.equal(debe.length, 1)
  assert.equal(haber.length, 1)
  // Y el haber se enseña en positivo: «-3.000.000» en una columna llamada «Haber»
  // es leer dos veces el mismo signo.
  assert.doesNotMatch(haber[0]!.haber, /-/)
})

test('un asiento reversado y su reverso salen los DOS, marcados', async () => {
  // Un asiento no se borra ni se edita: se contrapone. Los dos se quedan en el libro,
  // y quien mire dentro de dos años tiene que poder ver cuál es cuál.
  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  assert.ok(d.apuntes.some((a) => a.reversado), 'no se marca el asiento anulado')
  assert.ok(d.apuntes.some((a) => a.esReverso), 'no se marca el reverso')
  const h = pintarDiario(d, 'es', 'af')
  assert.match(h, /Es un reverso/)
  assert.match(h, /class="as anulado"/)
})

test('se ve cuándo ocurrió y cuándo se supo, que son dos fechas', async () => {
  // La diferencia entre las dos es la medida de «tiempo hasta la verdad».
  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  const a = d.apuntes[0]!
  assert.ok(a.ocurrido.length > 0 && a.registrado.length > 0)
  assert.ok(a.tardanza >= 0, 'la tardanza nunca es negativa')
  const h = pintarDiario(d, 'es', 'af')
  assert.match(h, /Ocurrió/)
  assert.match(h, /Se supo/)
})

test('cada asiento sale ENTERO, con sus líneas, sin tener que pinchar', async () => {
  // Un contador no busca un asiento: los recorre. Obligarle a abrir treinta
  // pantallas para leer un mes es lo que hace que acabe pidiendo una exportación.
  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  for (const a of d.apuntes) {
    assert.ok(a.lineas.length >= 2, `el asiento #${a.numero} salió sin sus líneas`)
  }
  const h = pintarDiario(d, 'es', 'af')
  assert.doesNotMatch(h, /href="\/asientos\//, 'no debería hacer falta pinchar')
})

test('un mes sin asientos lo dice', async () => {
  const d = await dentro((q) => diario(q, G, 2019, 5, 'es'))
  assert.equal(d.apuntes.length, 0)
  assert.match(pintarDiario(d, 'es', 'af'), /No hay ningún asiento en ese mes/)
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const d = await dentro((q) => diario(q, G, 2026, 12, 'en'))
  const h = pintarDiario(d, 'en', 'af')
  assert.match(h, /General journal/)
  assert.match(h, /Recorded/)
  assert.doesNotMatch(h, /Libro diario/)
  assert.doesNotMatch(h, /undefined/)
})

/**
 * Reversar desde el diario.
 *
 * Todo el sistema dice «un asiento no se modifica ni se borra: registra su reverso»
 * — y hasta ahora no había un solo sitio donde registrarlo. La instrucción era
 * correcta y el camino no existía, que es la peor combinación posible: quien la
 * seguía al pie de la letra se quedaba encallado.
 */

/** Un asiento nuevo y virgen, para poder reversarlo sin depender de otra prueba. */
async function asientoSuelto(mes: number, dia: string): Promise<string> {
  const id = randomUUID()
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`
      insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                           descripcion_es, descripcion_en, origen_tipo, origen_id, creado_por)
      values (${id}::uuid, ${G}::uuid, siguiente_asiento(${G}::uuid), ${dia}::date,
              2026, ${mes}, 'Suelto para reversar','Loose entry','aporte',
              ${id}::uuid, ${YO}::uuid)`
    await q`
      insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves,
                           monto_usd, tasa_id) values
        (${id}::uuid, 1, ${G}::uuid,'5.2.01', 50000.00, 909.09, ${TASA}::uuid),
        (${id}::uuid, 2, ${G}::uuid,'1.1.01.02', -50000.00, -909.09, ${TASA}::uuid)`
  })
  return id
}

test('reversar escribe el contrario y deja los dos en el libro', async () => {
  // Un asiento no se borra: el error también es un hecho que ocurrió.
  const a = await asientoSuelto(12, '2026-12-18')
  const r = await dentro((q) => reversar(q, G, a, 'estaba en la cuenta equivocada', YO, 'es'))
  assert.equal(r.hecho, true)

  const [p] = (await dentro((q) => q`
    select coalesce(sum(monto_ves), 0)::text as suma,
           count(*)::int as lineas
      from partida where asiento_id = ${(r as { id: string }).id}::uuid
  `)) as unknown as Array<{ suma: string; lineas: number }>
  assert.equal(p!.lineas, 2)
  assert.equal(Number(p!.suma), 0)

  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  const original = d.apuntes.find((x) => x.id === a)!
  assert.equal(original.reversado, true)
  const reverso = d.apuntes.find((x) => x.id === (r as { id: string }).id)!
  assert.equal(reverso.esReverso, true)
  assert.match(reverso.descripcion, /cuenta equivocada/)
})

test('el mes sigue cuadrando después de reversar', async () => {
  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  assert.equal(d.cuadra, true, `descuadre de ${d.descuadre}`)
})

test('un reverso SIN motivo no pasa: dentro de dos años no se distingue de un error', async () => {
  const a = await asientoSuelto(12, '2026-12-19')
  for (const motivo of ['', '   ', 'ok']) {
    const r = await dentro((q) => reversar(q, G, a, motivo, YO, 'es'))
    assert.equal(r.hecho, false, `«${motivo}» no puede valer como motivo`)
  }
})

test('el mismo asiento no se reversa dos veces', async () => {
  const a = await asientoSuelto(12, '2026-12-20')
  assert.equal((await dentro((q) => reversar(q, G, a, 'la primera vez', YO, 'es'))).hecho, true)
  const otra = await dentro((q) => reversar(q, G, a, 'la segunda', YO, 'es'))
  assert.equal(otra.hecho, false)
  assert.match((otra as { motivo: string }).motivo, /ya fue reversado/)
})

test('en un mes cerrado se dice ANTES, no con un error de la base de datos', async () => {
  // El reverso se escribe en el mes del original, no en el de hoy. Si ese mes está
  // cerrado no entra, y eso hay que decirlo con palabras y no con una excepción.
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`insert into periodo (organizacion_id, anio, mes, estado)
            values (${G}::uuid, 2026, 11, 'abierto') on conflict do nothing`
  })
  const a = await asientoSuelto(11, '2026-11-14')
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`update periodo set estado = 'cerrado'
             where organizacion_id = ${G}::uuid and anio = 2026 and mes = 11`
  })

  const r = await dentro((q) => reversar(q, G, a, 'se coló en un mes cerrado', YO, 'es'))
  assert.equal(r.hecho, false)
  assert.match((r as { motivo: string }).motivo, /cerrado/)
})

test('un asiento que no existe se contesta sin tocar la base de datos', async () => {
  for (const id of ['no-soy-un-id', '00000000-0000-0000-0000-000000000000']) {
    const r = await dentro((q) => reversar(q, G, id, 'da igual el motivo', YO, 'es'))
    assert.equal(r.hecho, false)
  }
})

test('la pantalla ofrece reversar solo donde se puede', async () => {
  const d = await dentro((q) => diario(q, G, 2026, 12, 'es'))
  const h = pintarDiario(d, 'es', 'af')
  const formularios = (h.match(/class="rev"/g) ?? []).length
  const reversables = d.apuntes.filter((a) => !a.reversado && !a.esReverso).length
  assert.ok(reversables > 0, 'sin asientos reversables esta prueba no comprobaría nada')
  assert.equal(formularios, reversables)
  assert.equal(h.includes('‹falta:'), false)
})

/**
 * El exportador para el contador.
 *
 * Estaba entre las decisiones YA TOMADAS desde el primer día —«el exportador para el
 * contador»— y no existía. Lo que había era la pantalla del diario, que está escrita
 * para leerse: importes con puntos y comas, fechas en el idioma de quien mira. Eso
 * abierto por una hoja de cálculo en inglés se convierte en otra cosa.
 */

test('el exportador saca el debe y el haber en columnas distintas', async () => {
  // Por dentro es un solo campo con signo. Un sistema contable que recibe «-1000»
  // en la columna del debe no lo entiende: entiende un haber de 1000.
  const filas = await dentro((q) => diarioCrudo(q, G, 2026, 12))
  assert.ok(filas.length >= 4, `el mes tiene que tener apuntes, y tenía ${filas.length}`)

  const conDebe = filas.filter((f) => f[6] !== '')
  const conHaber = filas.filter((f) => f[7] !== '')
  assert.ok(conDebe.length > 0 && conHaber.length > 0)
  // Ninguna línea lleva las dos cosas, y ninguna lleva un negativo.
  for (const f of filas) {
    assert.equal(f[6] !== '' && f[7] !== '', false, 'una línea con debe Y haber')
    assert.equal(/-/.test(f[6]!) || /-/.test(f[7]!), false, `importe negativo: ${f[6]}/${f[7]}`)
  }
})

test('los importes salen SIN formatear y las fechas en ISO', async () => {
  // «1.234,56» leído por una hoja en inglés se convierte en 1,23456. Quien lo lee es
  // una máquina.
  const filas = await dentro((q) => diarioCrudo(q, G, 2026, 12))
  for (const f of filas) {
    for (const importe of [f[6]!, f[7]!, f[8]!, f[9]!]) {
      if (importe === '') continue
      assert.match(importe, /^\d+\.\d{2}$/, `importe formateado: ${importe}`)
    }
    assert.match(f[1]!, /^\d{4}-\d{2}-\d{2}$/, `fecha no ISO: ${f[1]}`)
  }
})

test('el mes exportado CUADRA, igual que en pantalla', async () => {
  // Si la exportación no cuadra, el contador la carga y su sistema la rechaza — o
  // peor, la acepta y el descuadre aparece tres meses después.
  const filas = await dentro((q) => diarioCrudo(q, G, 2026, 12))
  const suma = (i: number) => filas.reduce((n, f) => n + Number(f[i] || 0), 0)
  assert.ok(Math.abs(suma(6) - suma(7)) < 0.005, 'el debe y el haber en bolívares')
  assert.ok(Math.abs(suma(8) - suma(9)) < 0.005, 'y en dólares')
})

test('cada línea lleva su contrato: es lo que ningún sistema contable trae', async () => {
  // Sin esta columna, devolver un resultado por contrato es adivinar.
  const filas = await dentro((q) => diarioCrudo(q, G, 2026, 12))
  assert.equal(filas[0]!.length, 14, 'la forma de la fila cambió sin avisar')
  // Y las cabeceras describen exactamente esas catorce columnas, en los dos idiomas.
  for (const idioma of ['es', 'en'] as const) {
    const c = cabecerasDiario(idioma)
    assert.equal(c.length, 14)
    assert.equal(c.some((x) => x.includes('‹falta:')), false)
  }
})

test('un reverso va marcado: el contador tiene que poder distinguirlo', async () => {
  const filas = await dentro((q) => diarioCrudo(q, G, 2026, 12))
  assert.ok(filas.some((f) => f[13] === 'reverso'),
    'sin un reverso en el mes esta prueba no comprobaría nada')
})
