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
