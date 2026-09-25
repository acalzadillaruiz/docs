/**
 * «¿Cómo va el mes?».
 *
 * Todo lo que hay debajo de esta pantalla estaba construido y probado desde hace
 * meses —margen, rentabilidad por cliente y por servicio, ejecutado sin cobrar,
 * flujo de caja, estado de resultados— y **no lo usaba ninguna pantalla**. Estaba en
 * la base de datos, que para el CFO es como no tenerlo: seguía con su Excel.
 *
 * Lo que se comprueba aquí no es la aritmética —esa ya la prueban `08-estados.sql` y
 * `09-gerencia.sql`— sino lo que decide esta capa: el orden en que se contesta, que
 * un libro descuadrado se avise ANTES que las cifras, y que nada de esto se le
 * escape al cliente.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { mes } from '../src/dominio/gerencia.ts'
import { pintarGerencia } from '../src/pantallas/gerencia.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'c2d3e4f5-0000-0000-0000-00000000000a'
const C = 'c2d3e4f5-0000-0000-0000-00000000000b'
const YO = 'c2d3e4f5-0000-0000-0000-00000000000d'
const ING = 'c2d3e4f5-0000-0000-0000-00000000000e'
const TASA = 'c2d3e4f5-1111-0000-0000-00000000000a'
const IVA = 'c2d3e4f5-1111-0000-0000-00000000000b'
const CTR = 'c2d3e4f5-2222-0000-0000-00000000000a'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Gerencia','J-903000000-0'),
        ('${C}','operadora','Operadora Gerencia','J-903100000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'gerencia@prueba.test','CFO','clave_2fa','(h)','(s)'),
                   (${ING}, ${C},'gerencia-cli@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-10-01', 45.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2026-01-01') on conflict do nothing;
      select instalar_plan_cuentas('${G}');
      insert into periodo (organizacion_id, anio, mes) values ('${G}', 2026, 10)
        on conflict do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es,
                            titulo_en, estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR}','${G}','${C}','GER-001','servicio','Cuadrilla','Crew',
                'vigente','VES', 5000000.00,'${TASA}','${YO}')
        on conflict (id) do update set codigo = excluded.codigo;
    `)
  })
})
after(async () => { await cerrar() })

test('contesta las tres preguntas, y en ese orden', async () => {
  // El orden no es decorativo: si ganamos, dónde está el dinero, y qué nos deja.
  const m = await dentro((q) => mes(q, G, 2026, 10, 'es'))
  const h = pintarGerencia(m, 'es', 'af')
  const resultado = h.indexOf('Resultado del mes')
  const sinCobrar = h.indexOf('Ejecutado sin cobrar')
  const flujo = h.indexOf('Lo que se espera cobrar')
  assert.ok(resultado > 0 && sinCobrar > 0 && flujo > 0, 'falta alguna de las tres')
  assert.ok(resultado < sinCobrar, 'el resultado tiene que ir primero')
  assert.ok(sinCobrar < flujo, 'lo no cobrado va antes que la proyección')
})

test('el mes se calcula de su primer día a su último, no a hoy', async () => {
  const m = await dentro((q) => mes(q, G, 2026, 2, 'es'))
  assert.equal(m.desde, '2026-02-01')
  assert.equal(m.hasta, '2026-02-28', 'febrero de 2026 no es bisiesto')
  const bis = await dentro((q) => mes(q, G, 2028, 2, 'es'))
  assert.equal(bis.hasta, '2028-02-29', '2028 sí lo es')
})

test('el flujo de caja llega a ocho semanas: más allá es adivinar', async () => {
  const m = await dentro((q) => mes(q, G, 2026, 10, 'es'))
  assert.equal(m.semanas.length, 8)
  // Y van de siete en siete, sin huecos ni repetidos.
  for (let i = 1; i < m.semanas.length; i++) {
    const a = new Date(m.semanas[i - 1]!.semana).getTime()
    const b = new Date(m.semanas[i]!.semana).getTime()
    assert.equal((b - a) / 86_400_000, 7, `entre la semana ${i} y la ${i + 1} no hay 7 días`)
  }
})

test('con el libro descuadrado, se avisa ARRIBA y antes que las cifras', async () => {
  // Una pantalla de cifras sobre un libro descuadrado da confianza donde no la hay.
  const m = await dentro((q) => mes(q, G, 2026, 10, 'es'))
  const falso = { ...m, cuadra: false, descuadre: '1.000,00 Bs' }
  const h = pintarGerencia(falso, 'es', 'af')
  assert.match(h, /class="aviso"/)
  assert.ok(h.indexOf('class="aviso"') < h.indexOf('Resultado del mes'))
  // Y cuando cuadra, no se pone un aviso que no hace falta.
  const limpio = pintarGerencia({ ...m, cuadra: true }, 'es', 'af')
  assert.doesNotMatch(limpio, /class="aviso"/)
})

test('las tablas de rentabilidad son ACUMULADAS, y la pantalla lo dice', async () => {
  // Están bajo un selector de mes pero no son del mes: `margen_contrato` acumula
  // hasta la fecha, y su argumento `p_desde` ni siquiera se usa. Tiene sentido que
  // sea así —un contrato de ocho meses no se juzga por lo que dejó en agosto— pero
  // ponerlas ahí sin decirlo sería dejar que se leyeran como lo que no son.
  const m = await dentro((q) => mes(q, G, 2026, 10, 'es'))
  const h = pintarGerencia(m, 'es', 'af')
  if (m.porCliente.length > 0) {
    assert.match(h, /acumulado/)
    assert.match(h, /NO son del mes/)
  }
})

test('un mes de verdad vacío lo dice, y no enseña tablas vacías', async () => {
  // Una organización sin contratos: ahí sí no hay nada que enseñar.
  const vacio = await dentro((q) => mes(q, ING, 2020, 1, 'es'))
  const h = pintarGerencia(vacio, 'es', 'af')
  assert.match(h, /Todavía no hay nada de ese mes/)
})

test('la pantalla avisa por escrito de que el cliente no ve nada de esto', async () => {
  // El margen es lo que el CEO ha dicho mil veces que el cliente no puede ver. Que
  // esté escrito en la pantalla es lo que evita que alguien la pegue en un correo.
  const m = await dentro((q) => mes(q, G, 2026, 10, 'es'))
  const h = pintarGerencia(m, 'es', 'af')
  assert.match(h, /Nada de esta pantalla lo ve el cliente/)
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const m = await dentro((q) => mes(q, G, 2026, 10, 'en'))
  const h = pintarGerencia(m, 'en', 'af')
  assert.match(h, /How the month is going/)
  assert.match(h, /Delivered, not yet collected/)
  assert.doesNotMatch(h, /Resultado del mes/)
  assert.doesNotMatch(h, /undefined/)
})

test('la ganancia va en verde y la pérdida en rojo', async () => {
  const m = await dentro((q) => mes(q, G, 2026, 10, 'es'))
  const gana = pintarGerencia({ ...m, resultado: { ...m.resultado, resultadoCrudo: 500 } }, 'es', 'af')
  assert.match(gana, /class="cif-v bien"/)
  const pierde = pintarGerencia({ ...m, resultado: { ...m.resultado, resultadoCrudo: -500 } }, 'es', 'af')
  assert.match(pierde, /class="cif-v mal"/)
})

test('el resultado se puede ABRIR cuenta por cuenta', async () => {
  // Un total que no se puede abrir es un número que nadie se cree. Es la misma razón
  // por la que el ajuste de la reexpresión se enseña partida por partida.
  const m = await dentro((q) => mes(q, G, 2026, 10, 'es'))
  const h = pintarGerencia(m, 'es', 'af')
  if (m.pyg.length > 0) {
    assert.match(h, /De dónde sale ese resultado/)
    // Ingreso y gasto se distinguen sin tener que leer el signo.
    assert.ok(h.includes('class="ingresos"') || h.includes('class="gastos"'))
  }
})

test('la cartera sale contrato por contrato, con lo peor primero', async () => {
  // `margen_cartera` viene ordenada por margen ascendente. Eso es deliberado —lo que
  // más duele, primero— y esta capa no lo reordena.
  const m = await dentro((q) => mes(q, G, 2026, 10, 'es'))
  if (m.contratos.length > 1) {
    for (let i = 1; i < m.contratos.length; i++) {
      assert.ok(m.contratos[i - 1]!.margenPct <= m.contratos[i]!.margenPct + 0.001,
        'la cartera dejó de venir ordenada por lo que más duele')
    }
  }
  if (m.contratos.length > 0) {
    assert.match(pintarGerencia(m, 'es', 'af'), /Contrato por contrato/)
  }
})

test('con el mes vacío no se pintan las tablas nuevas', async () => {
  const vacio = await dentro((q) => mes(q, ING, 2020, 1, 'es'))
  const h = pintarGerencia(vacio, 'es', 'af')
  assert.doesNotMatch(h, /De dónde sale ese resultado/)
  assert.doesNotMatch(h, /Contrato por contrato/)
})

test('la cartera del cuadro enseña las peores y DICE cuántas quedan', async () => {
  // Con mil contratos esta pantalla pesaba 255 KB y tardaba 2,7 s. Medido, no
  // supuesto: herramientas/medir.ts. Y nadie lee mil filas de una tabla.
  //
  // Lo que NO se recorta son los totales: salen de `estado_resultados`, no de esta
  // lista, así que siguen calculados sobre todos los contratos. Esa es la diferencia
  // entre recortar una tabla y mentir.
  const muchos = 30
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    for (let i = 0; i < muchos; i++) {
      await q`
        insert into contrato (organizacion_id, cliente_id, codigo, tipo, titulo_es,
                              titulo_en, estado, moneda, monto, tasa_id, creado_por)
        values (${G}::uuid, ${C}::uuid, ${`GER-M-${String(i).padStart(3, '0')}`},
                'servicio','Relleno','Filler','vigente','VES', 100000, ${TASA}::uuid,
                ${YO}::uuid)
        on conflict (organizacion_id, codigo) do nothing`
    }
  })

  const c = await dentro((q) => mes(q, G, 2026, 10, 'es'))
  assert.equal(c.contratos.length, 25, 'se enseñan las peores, no todas')
  assert.ok(c.contratosOcultos > 0, `y se dice cuántas quedan, y quedaban ${c.contratosOcultos}`)

  const h = pintarGerencia(c, 'es', 'af')
  assert.match(h, new RegExp(String(c.contratosOcultos)))
  assert.equal(h.includes('‹falta:'), false)
})
