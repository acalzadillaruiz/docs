/**
 * La reexpresión por inflación, en pantalla.
 *
 * Lo que se comprueba no es que multiplique bien — eso ya lo prueba
 * `db/pruebas/13-reexpresion.sql`. Se comprueba lo que decide esta capa: que lo
 * monetario se distinga de lo que no lo es, que el resultado monetario salga con su
 * signo y explicado, y que las tres cosas que impedirían asentar el mes se digan
 * ANTES de pulsar, no como una excepción de la base de datos después.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { cuadro, asentarMes, mesesReexpresados } from '../src/dominio/reexpresion.ts'
import { pintarReexpresion } from '../src/pantallas/reexpresion.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '0c2d3e4f-1000-0000-0000-00000000000a'
const C = '0c2d3e4f-1000-0000-0000-00000000000b'
const YO = '0c2d3e4f-1000-0000-0000-00000000000d'
const TASA = '0c2d3e4f-1100-0000-0000-00000000000a'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Reexpresión','J-902000000-0'),
        ('${C}','operadora','Operadora Reexpresión','J-902100000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'reexpresion@prueba.test','Interno','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-05-02', 40.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      -- El índice dobla de mayo a junio: así el ajuste se ve a simple vista.
      insert into indice_precios (vigente_desde, valor) values
        ('2026-05-01', 100.000000), ('2026-06-01', 200.000000)
        on conflict (vigente_desde) do update set valor = excluded.valor;
      select instalar_plan_cuentas('${G}');
      select marcar_monetarias('${G}');
      insert into periodo (organizacion_id, anio, mes) values
        ('${G}', 2026, 3), ('${G}', 2026, 5), ('${G}', 2026, 6) on conflict do nothing;

      -- Lo que dejo la corrida anterior. Solo los asientos de REEXPRESION: el aporte
      -- de capital de abajo tiene que seguir en pie, porque es el saldo que se
      -- reexpresa. Reversarlo todo dejaba el balance en cero y las cifras a cero con
      -- el, que es la forma mas silenciosa de que una prueba deje de probar nada.
      select reversar_asiento(asi.id,'${YO}','corrida anterior de las pruebas')
        from asiento asi
       where asi.organizacion_id = '${G}' and asi.origen_tipo = 'reexpresion'
         and asi.reversa_a is null
         and not exists (select 1 from asiento rev where rev.reversa_a = asi.id);
    `)
    // El aporte de capital de mayo: 1.000.000 al banco contra patrimonio. El banco es
    // monetario y el patrimonio no, que es justo lo que se quiere ver. Se comprueba
    // que siga VIVO — no solo que exista —, porque un asiento reversado sigue en la
    // tabla y deja el saldo en cero sin que se note.
    const [hay] = (await q`
      select count(*)::int as n from asiento asi
       where asi.organizacion_id = ${G}::uuid and asi.origen_tipo = 'aporte'
         and asi.reversa_a is null
         and not exists (select 1 from asiento rev where rev.reversa_a = asi.id)
    `) as unknown as Array<{ n: number }>
    if (Number(hay?.n ?? 0) === 0) {
      await q.unsafe(`
        do $$
        declare a uuid := gen_random_uuid();
        begin
          insert into asiento (id, organizacion_id, numero, ocurrido_en, anio, mes,
                               descripcion_es, descripcion_en, origen_tipo, origen_id,
                               creado_por)
            values (a,'${G}', siguiente_asiento('${G}'),'2026-05-02', 2026, 5,
                    'Aporte de capital','Capital contribution','aporte', a,'${YO}');
          insert into partida (asiento_id, linea, organizacion_id, cuenta, monto_ves,
                               monto_usd, tasa_id) values
            (a, 1,'${G}','1.1.01.02', 1000000.00, 25000.00,'${TASA}'),
            (a, 2,'${G}','3.1.01', -1000000.00, -25000.00,'${TASA}');
        end $$;
      `)
    }
  })
})
after(async () => { await cerrar() })

test('lo monetario NO se reexpresa: un bolívar en el banco sigue siendo un bolívar', async () => {
  const c = await dentro((q) => cuadro(q, G, 'es', '2026-06-30'))
  const banco = c.lineas.find((l) => l.codigo === '1.1.01.02')!
  assert.equal(banco.monetaria, true)
  assert.equal(banco.ajusteCrudo, 0)
  assert.equal(banco.historico, banco.reexpresado)
})

test('lo no monetario sí: con el índice doblado, el capital vale el doble', async () => {
  const c = await dentro((q) => cuadro(q, G, 'es', '2026-06-30'))
  const capital = c.lineas.find((l) => l.codigo === '3.1.01')!
  assert.equal(capital.monetaria, false)
  assert.match(capital.historico, /1\.000\.000,00/)
  assert.match(capital.reexpresado, /2\.000\.000,00/)
})

test('el resultado monetario es la pérdida por haber tenido bolívares', async () => {
  // Un millón en el banco mientras el índice dobla cuesta un millón. No es un ajuste
  // de cuadre: es lo que costó de verdad.
  //
  // Y el signo se lee al revés de lo que parece: POSITIVO es pérdida. Es la trampa de
  // esta cifra, y por eso está aquí escrita.
  const c = await dentro((q) => cuadro(q, G, 'es', '2026-06-30'))
  assert.equal(c.remeCrudo, 1000000)
  assert.match(c.reme, /1\.000\.000,00/)
})

test('sin índice a esa fecha lo dice, en vez de reventar la transacción', async () => {
  const c = await dentro((q) => cuadro(q, G, 'es', '2020-01-31'))
  assert.equal(c.sinIndice, true)
  assert.equal(c.lineas.length, 0)
})

test('un mes contable cerrado se explica antes de pulsar, no después', async () => {
  const r = await dentro(async (q) => {
    await q.unsafe(`set local role none;
      insert into periodo (organizacion_id, anio, mes, estado)
        values ('${G}', 2026, 4,'cerrado')
        on conflict (organizacion_id, anio, mes) do update set estado = 'cerrado'`)
    return asentarMes(q, G, 2026, 4, YO, 'es')
  })
  assert.equal(r.hecho, false)
  assert.match(r.hecho ? '' : r.motivo, /cerrado/)
})

test('sin índice al último día del mes, tampoco se asienta a ciegas', async () => {
  const r = await dentro((q) => asentarMes(q, G, 2026, 3, YO, 'es'))
  assert.equal(r.hecho, false)
  assert.match(r.hecho ? '' : r.motivo, /índice/)
})

test('asentar el mes deja su asiento, y el mes queda listado', async () => {
  const r = await dentro((q) => asentarMes(q, G, 2026, 6, YO, 'es'))
  assert.equal(r.hecho, true)
  const meses = await dentro((q) => mesesReexpresados(q, G))
  assert.ok(meses.some((m) => Number(m.anio) === 2026 && Number(m.mes) === 6))
})

test('el mismo mes no se reexpresa dos veces', async () => {
  const r = await dentro((q) => asentarMes(q, G, 2026, 6, YO, 'es'))
  assert.equal(r.hecho, false)
  assert.match(r.hecho ? '' : r.motivo, /ya está reexpresado/)
})

test('la pantalla pone el resultado monetario ARRIBA y en rojo, no al final', async () => {
  // Es la cifra que un CFO mira primero. Enterrarla al final de una tabla de cuarenta
  // cuentas es esconderla. Y en rojo aunque sea positiva: positivo es PÉRDIDA.
  const c = await dentro((q) => cuadro(q, G, 'es', '2026-06-30'))
  const h = pintarReexpresion(c, 'es', 'af', 2026, 6)
  assert.match(h, /class="reme-v mal"/)
  assert.ok(h.indexOf('reme-v') < h.indexOf('<table'))
})

test('una cuenta monetaria sale marcada y con el ajuste en blanco, no en cero', async () => {
  // Cero se lee como «se calculó y dio cero». Aquí es «no se reexpresa, a propósito».
  const c = await dentro((q) => cuadro(q, G, 'es', '2026-06-30'))
  const h = pintarReexpresion(c, 'es', 'af', 2026, 6)
  assert.match(h, /class="et">Monetaria</)
  assert.match(h, /<td class="n">—<\/td>/)
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const c = await dentro((q) => cuadro(q, G, 'en', '2026-06-30'))
  const h = pintarReexpresion(c, 'en', 'af', 2026, 6)
  assert.match(h, /Monetary result for the period/)
  assert.doesNotMatch(h, /Resultado monetario/)
  assert.doesNotMatch(h, /undefined/)
})

// ===========================================================================
// Y ANTES DE TODO ESTO: cargar el INPC del mes.
//
// La pantalla decía «No hay índice de precios (INPC) cargado a esa fecha. Sin índice
// no se puede reexpresar nada»... y no había forma de cargarlo. `indice_precios` la
// escribía **solo una prueba de la base de datos**, así que la reexpresión por
// inflación —que es todo este módulo, y en una economía hiperinflacionaria no es un
// adorno— no podía correr nunca en uso real.
//
// Lo encontró el barrido de tablas que la aplicación nunca escribe. Y las pruebas de
// arriba no lo veían porque cargan el índice a mano en su fixture: el fixture hacía lo
// que la aplicación no hacía, una vez más.

const { cargarIndice, indices } = await import('../src/dominio/reexpresion.ts')

/**
 * Deja solo los índices de 2027 que pida la prueba, sin tocar los de 2026.
 *
 * Los de 2026 los pone el fixture de arriba y los necesita el resto del archivo: el
 * primer intento de esta prueba los borraba todos y el resto se caía con «no hay
 * índice de precios vigente al 2026-05-02» — que es la misma clase de fallo que este
 * trozo viene a arreglar, cometido en la prueba.
 *
 * Y se reversan las reexpresiones de 2027, no se borran: un asiento no se borra.
 */
async function soloIndices(pares: readonly [string, number][]): Promise<void> {
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`select reversar_asiento(asi.id, ${YO}::uuid, 'limpieza de la prueba')
              from asiento asi
             where asi.organizacion_id = ${G}::uuid and asi.origen_tipo = 'reexpresion'
               and asi.anio = 2027 and asi.reversa_a is null
               and not exists (select 1 from asiento rev where rev.reversa_a = asi.id)`
    await q`delete from indice_precios where vigente_desde >= '2027-01-01'`
    for (const [desde, valor] of pares) {
      await q`insert into indice_precios (vigente_desde, valor) values (${desde}::date, ${valor})
              on conflict (vigente_desde) do update set valor = excluded.valor`
    }
  })
}

test('cargar el INPC del mes: antes no había forma y el módulo entero no podía correr', async () => {
  await soloIndices([])
  const r = await dentro((q) => cargarIndice(q, G, 2027, 7, 1450.5, 'es'))
  assert.equal(r.hecho, true, (r as { motivo?: string }).motivo)

  // Se guarda con fecha del día uno, que es lo que busca `indice_del_dia()`.
  const [i] = (await dentro((q) => q`
    select indice_del_dia('2027-07-31'::date)::text as v
  `)) as unknown as Array<{ v: string | null }>
  assert.equal(Number(i!.v), 1450.5)
})

test('un valor ilegible NO entra como cero: con índice cero el factor es una división por cero', async () => {
  await soloIndices([])
  const r = await dentro((q) => cargarIndice(q, G, 2027, 7, Number.NaN, 'es'))
  assert.equal(r.hecho, false)
  // Solo los de 2027: los de 2026 son del fixture de arriba y los necesita el resto
  // del archivo.
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from indice_precios where vigente_desde >= '2027-01-01'
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 0)
})

test('un mes fuera de 1..12 no pasa, ni un año que no es un año', async () => {
  await soloIndices([])
  for (const [anio, mes] of [[2027, 0], [2027, 13], [1999, 5], [2101, 5]] as const) {
    const r = await dentro((q) => cargarIndice(q, G, anio, mes, 100, 'es'))
    assert.equal(r.hecho, false, `${anio}-${mes} no puede valer`)
  }
})

test('se puede corregir mientras no lo haya usado ninguna reexpresión', async () => {
  // El BCV revisa cifras. Corregir un índice que todavía no se usó es normal.
  await soloIndices([])
  assert.equal((await dentro((q) => cargarIndice(q, G, 2027, 7, 1000, 'es'))).hecho, true)
  const otra = await dentro((q) => cargarIndice(q, G, 2027, 7, 1100, 'es'))
  assert.equal(otra.hecho, true)
  const [i] = (await dentro((q) => q`
    select valor::text as v from indice_precios where vigente_desde = '2027-07-01'
  `)) as unknown as Array<{ v: string }>
  assert.equal(Number(i!.v), 1100)
})

test('pero NO se cambia por debajo de una reexpresión ya asentada', async () => {
  // Cambiar el índice de un mes ya reexpresado deja un libro que nadie puede volver a
  // explicar: los números del asiento no saldrían de los datos que quedan.
  await soloIndices([['2027-06-01', 1000], ['2027-07-01', 1100]])
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`insert into periodo (organizacion_id, anio, mes, estado)
            values (${G}, 2027, 7,'abierto')
            on conflict (organizacion_id, anio, mes) do update set estado = 'abierto'`
  })
  const a = await dentro((q) => asentarMes(q, G, 2027, 7, YO, 'es'))
  assert.equal(a.hecho, true, (a as { motivo?: string }).motivo)

  const r = await dentro((q) => cargarIndice(q, G, 2027, 7, 9999, 'es'))
  assert.equal(r.hecho, false, 'dejó cambiar el índice por debajo de un asiento')
  assert.match((r as { motivo: string }).motivo, /reversar/)

  // Y uno ANTERIOR que no existía tampoco, aunque no haya nada que sobrescribir.
  //
  // Es el caso que casi se me cuela: la primera versión solo impedía CAMBIAR un índice
  // ya usado. Pero la reexpresión va partida por partida, cada una con el índice de su
  // fecha, así que meter un índice de mayo después de reexpresar julio hace que el
  // asiento de julio deje de salir de los datos que hay. El asiento no cambia —no se
  // puede—, pero deja de poder explicarse, que es peor.
  const antes = await dentro((q) => cargarIndice(q, G, 2027, 5, 900, 'es'))
  assert.equal(antes.hecho, false,
    'dejó meter un índice anterior a un mes ya reexpresado')

  // Lo de DESPUÉS del último mes reexpresado sí, que es como se sigue trabajando.
  const post = await dentro((q) => cargarIndice(q, G, 2027, 8, 1200, 'es'))
  assert.equal(post.hecho, true, (post as { motivo?: string }).motivo)
})

test('la lista enseña la VARIACIÓN, que es donde se ve un cero de más', async () => {
  // El número solo no dice nada; un «+1.240 %» salta a la vista. Es la comprobación
  // que pilla un dedo gordo antes de que se reexprese un mes entero con él.
  await soloIndices([['2027-05-01', 1000], ['2027-06-01', 1100], ['2027-07-01', 14000]])
  const lista = await dentro((q) => indices(q, 'es'))
  // Vienen del más nuevo al más viejo, y en la tabla hay también los de 2026 que pone
  // el fixture de arriba: se busca el que interesa en vez de contar filas.
  assert.equal(lista[0]!.anio, 2027)
  assert.equal(lista[0]!.mes, 7)
  assert.ok(lista[0]!.variacion !== null && /1\.172|1172/.test(lista[0]!.variacion),
    `la variación del dedo gordo no se ve: ${lista[0]!.variacion}`)

  // Y el más viejo de todos no tiene con qué comparar: se dice, en vez de inventar
  // un cero que se leería como «no subió».
  const todos = await dentro((q) => indices(q, 'es', 200))
  assert.equal(todos[todos.length - 1]!.variacion, null)
})

test('la pantalla trae el formulario y la lista, en los dos idiomas', async () => {
  await soloIndices([['2027-06-01', 1000], ['2027-07-01', 1100]])
  const c = await dentro((q) => cuadro(q, G, 'es', '2027-07-31'))
  const lista = await dentro((q) => indices(q, 'es'))
  for (const idioma of ['es', 'en'] as const) {
    const h = pintarReexpresion(c, idioma, 'af', 2027, 7, [], lista)
    assert.match(h, /name="accion" value="indice"/, `${idioma}: no hay formulario de índice`)
    assert.match(h, /name="i_valor"/)
    assert.match(h, /class="ix"/, `${idioma}: no sale la lista de índices`)
    assert.equal(h.includes('‹falta:'), false, `${idioma} tiene una clave sin traducir`)
  }
  // Sin índices, lo dice en vez de pintar una tabla vacía.
  const vacia = pintarReexpresion(c, 'es', 'af', 2027, 7, [], [])
  assert.doesNotMatch(vacia, /class="ix"/)
  assert.match(vacia, /Todavía no hay ningún índice/)
})
