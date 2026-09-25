/**
 * Las tres cifras que no da ningún portal.
 *
 * Lo que se comprueba aquí: que salgan bien calculadas, que no mezclen monedas, que
 * la pantalla no se pueda leer como un cuadro de mando de los de siempre, y que un
 * cliente no llegue nunca — es el margen de GPS mirado desde otro ángulo.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { medidas, dias, type Medidas } from '../src/dominio/medidas.ts'
import { pintarMedidas } from '../src/pantallas/medidas.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '9c0d1e2f-0000-0000-0000-00000000000a'
const C = '9c0d1e2f-0000-0000-0000-00000000000b'
const YO = '9c0d1e2f-0000-0000-0000-00000000000d'
const ING = '9c0d1e2f-0000-0000-0000-00000000000e'
const TASA = '9c0d1e2f-1111-0000-0000-00000000000a'
const CT1 = '9c0d1e2f-2222-0000-0000-00000000000a'   // en dólares
const CT2 = '9c0d1e2f-2222-0000-0000-00000000000b'   // en bolívares
const RG1 = '9c0d1e2f-3333-0000-0000-00000000000a'
const RG2 = '9c0d1e2f-3333-0000-0000-00000000000b'
const RG3 = '9c0d1e2f-3333-0000-0000-00000000000c'   // sin hitos, a propósito

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Medidas','J-960000000-0'),
        ('${C}','operadora','Operadora Medidas','J-961111111-1')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'med@prueba.test','Interno','clave_2fa','(h)','(s)'),
                   (${ING}, ${C},'med-cli@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-09-12', 36.50,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por, inicio, fin_previsto)
        values ('${CT1}','${G}','${C}','MED-USD','procura','Cabezales','Wellheads',
                'vigente','USD', 200000.00,'${TASA}','${YO}','2026-01-01','2026-12-31'),
               ('${CT2}','${G}','${C}','MED-VES','servicio','Cuadrilla','Crew',
                'vigente','VES', 500000.00,'${TASA}','${YO}','2026-01-01','2026-12-31')
        on conflict (id) do update set codigo = excluded.codigo;
      insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                           cantidad, unidad, precio_unitario, costo_unitario)
        values ('${RG1}','${CT1}', 1,'Cabezal','Wellhead', 2,'unidad', 100000.0000, 62000.0000),
               ('${RG2}','${CT2}', 1,'Cuadrilla','Crew', 1,'mes', 500000.0000, 300000.0000),
               ('${RG3}','${CT1}', 2,'Válvula','Valve', 10,'unidad', 5000.0000, 3000.0000)
        on conflict (id) do update set precio_unitario = excluded.precio_unitario;
      delete from hito where renglon_id in ('${RG1}','${RG2}','${RG3}');
      -- RG1: 40 verificado, 30 declarado sin respaldo. De 200.000 → 60.000 sin demostrar.
      insert into hito (id, renglon_id, orden, clave, nombre_es, nombre_en, peso, exige,
                        estado, ocurrido_en, registrado_en) values
        ('9c0d1e2f-4444-0000-0000-000000000001','${RG1}', 1,'orden','Orden','PO', 40.00,'{}',
         'verificado','2026-08-01', now() - interval '80 days'),
        ('9c0d1e2f-4444-0000-0000-000000000002','${RG1}', 2,'fabricado','Fabricado','Made',
         30.00,'{}','declarado', current_date - 10, now()),
        ('9c0d1e2f-4444-0000-0000-000000000003','${RG1}', 3,'resto','Resto','Rest', 30.00,'{}',
         'pendiente', null, null);
      -- RG2: 50 declarado, nada verificado. De 500.000 → 250.000 sin demostrar.
      insert into hito (id, renglon_id, orden, clave, nombre_es, nombre_en, peso, exige,
                        estado, ocurrido_en, registrado_en) values
        ('9c0d1e2f-4444-0000-0000-000000000011','${RG2}', 1,'mov','Movilización','Mob',
         50.00,'{}','declarado', current_date - 6, now()),
        ('9c0d1e2f-4444-0000-0000-000000000012','${RG2}', 2,'eje','Ejecución','Exec',
         50.00,'{}','pendiente', null, null);
    `)
  })
})
after(async () => { await cerrar() })

const mias = () => dentro((q) => medidas(q, G, 'es'))

test('la brecha se calcula en dinero, no en porcentaje suelto', async () => {
  const m = await mias()
  const usd = m.brecha.find((f) => f.contrato === 'MED-USD')!
  // Declarado 70% de 200.000 = 140.000. Verificado 40% = 80.000. Brecha 60.000.
  assert.match(usd.declarado, /140\.000,00/)
  assert.match(usd.evidenciado, /80\.000,00/)
  assert.match(usd.brecha, /60\.000,00/)
})

test('NO se suman dólares con bolívares', async () => {
  // Un número grande y falso en una pantalla de dirección es peor que no tener la
  // pantalla.
  const m = await mias()
  assert.equal(m.brechaTotal.length >= 2, true, 'tiene que haber un total por moneda')
  assert.ok(m.brechaTotal.some((v) => v.includes('60.000')))
  assert.ok(m.brechaTotal.some((v) => v.includes('250.000')))
})

test('el tiempo hasta la verdad sale de cuándo se supo, no de cuándo pasó', async () => {
  const m = await mias()
  const usd = m.verdad.find((f) => f.contrato === 'MED-USD')
  assert.ok(usd, 'el contrato con hechos fechados tiene que aparecer')
  assert.ok(usd!.peor >= 10, `el peor caso era de al menos 10 días, fue ${usd!.peor}`)
  assert.ok(usd!.hechos >= 2)
})

test('el renglón al que se le olvidaron los hitos aparece señalado', async () => {
  const m = await mias()
  const olvidado = m.sinHitos.find((f) => f.renglonId === RG3)
  assert.ok(olvidado, 'un renglón sin hitos tiene que verse')
  assert.match(olvidado!.valor, /50\.000,00/)
  assert.equal(olvidado!.contratoId, CT1, 'y lleva a su contrato')
})

test('cada bloque abre con la pregunta que contesta, en castellano normal', async () => {
  const h = pintarMedidas(await mias(), 'es')
  // Un cuadro de mando que hay que aprender a leer se mira el día que se instala y
  // nunca más.
  assert.match(h, /se derrumbaría si lo pidiera por escrito mañana/)
  assert.match(h, /Con cuántos días de retraso estamos viendo la obra/)
  assert.match(h, /sin haber comprado todavía nada debajo/)
})

test('la pantalla dice que no sale al cliente, con todas las letras', async () => {
  const h = pintarMedidas(await mias(), 'es')
  assert.match(h, /Solo para GPS/)
})

test('cuando no hay nada que señalar lo dice, no pinta una tabla vacía', () => {
  // Una tabla vacía parece un error del programa.
  const nada: Medidas = { brecha: [], verdad: [], cobertura: [], sinHitos: [], brechaTotal: [] }
  const h = pintarMedidas(nada, 'es')
  assert.match(h, /Nada que señalar aquí. Es una buena noticia./)
  assert.equal(h.includes('class="fila"'), false)
  // Y sin brecha no se pinta un total vacío.
  assert.equal(h.includes('Total sin demostrar'), false)
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const m = await mias()
  const en = pintarMedidas(m, 'en')
  assert.match(en, /Evidence gap/)
  assert.match(en, /Time to truth/)
  assert.match(en, /GPS only/)
  assert.equal(en.includes('‹falta:'), false, 'ninguna clave sin traducir')
})

test('los días se dicen como se dicen', () => {
  assert.equal(dias('es', 1), '1 día')
  assert.equal(dias('es', 7.5), '7,5 días')
  assert.equal(dias('en', 1), '1 day')
  assert.equal(dias('en', 12), '12 days')
})

test('un cliente que pide las medidas choca contra un permiso, no contra un filtro', async () => {
  // Es más fuerte que devolverle una lista vacía: la cobertura lee las partidas del
  // libro, y el rol del cliente no tiene permiso sobre esa tabla. Un error es
  // ruidoso; una lista vacía se cuela sin que nadie lo note.
  await assert.rejects(
    comoPersona({ id: ING }, 'nexus_cliente', (q) => medidas(q, C, 'es')),
    /permission denied/,
  )
})

test('un cliente nombrando expresamente la organización de GPS tampoco pasa', async () => {
  await assert.rejects(
    comoPersona({ id: ING }, 'nexus_cliente', (q) => medidas(q, G, 'es')),
    /permission denied/,
  )
})

test('lo que un cliente sí alcanza es su propia obra, nunca la contabilidad', async () => {
  // La brecha sola no toca el libro, así que el cliente puede llamarla — y lo que
  // obtiene son SUS contratos, con cifras que ya ve en el portal: la brecha se puede
  // deducir mirando los hitos uno por uno. No es un secreto y no se finge que lo sea.
  //
  // Lo que no alcanza es la contabilidad, y eso es lo que se protege de verdad: la
  // cobertura lee las partidas del libro y ahí el permiso se niega (arriba).
  const filas = (await comoPersona({ id: ING }, 'nexus_cliente', (q) => q`
    select contrato, cliente, declarado, brecha from brecha_evidencia(${G}::uuid)
  `)) as unknown as Array<Record<string, string>>

  for (const f of filas) {
    assert.equal(f['cliente'], 'Operadora Medidas', 'solo sus propios contratos')
    assert.equal('costo' in f, false)
    assert.equal('margen' in f, false)
  }
})
