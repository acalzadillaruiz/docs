/**
 * Con qué saldos empieza una empresa que ya existe.
 *
 * El importador traía tres cosas: facturas de proveedor, histórico de facturas emitidas y
 * extracto del banco. **No traía el balance de apertura.** Y no había ninguna otra puerta:
 * este producto no tiene —a propósito— una pantalla para teclear un asiento a mano, así que
 * el capital, el banco, lo que ya te deben y lo que ya debes no tenían por dónde entrar.
 *
 * Lo que eso significaba: **una empresa que ya existe no podía empezar a usar esto.** Cargaba
 * su histórico de facturas y el balance le salía como si hubiera nacido el día de la
 * instalación: sin capital, y con el banco en negativo en cuanto abriera una caja chica. Le
 * pasaba a la propia empresa de muestra, y se veía en la instantánea publicada — «Capital
 * social» no aparecía en ninguna parte del balance.
 *
 * Aquí se comprueba el camino entero por donde lo hace la pantalla —cargar, mapear, validar,
 * confirmar— y, sobre todo, **las tres cosas que se niegan**: un balance que no cuadra, una
 * cuenta que no está en el plan, y una segunda apertura. Las tres tienen que fallar ANTES de
 * escribir: un balance de apertura mal cargado no se nota el día que entra, se nota el mes
 * que viene, y para entonces hay cien asientos encima.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import {
  cargar, guardarMapeo, validar, confirmar, revertir, CAMPOS, proponerMapeo,
} from '../src/dominio/importar.ts'
import { estados } from '../src/dominio/estados.ts'
import { randomUUID } from 'node:crypto'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'e0f1a2b3-4444-0000-0000-00000000000a'
const YO = 'e0f1a2b3-4444-0000-0000-00000000000d'
const TASA = 'e0f1a2b3-4444-1111-0000-00000000000a'
const CORTE = '2028-12-31'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

/**
 * La hoja tal como la exporta un sistema contable: cuenta, debe, haber.
 *
 * Lleva una cuarta columna de notas con un valor distinto en cada llamada, y no es adorno:
 * el importador guarda la huella del archivo y avisa de que «esa misma hoja ya se trajo
 * antes». Dos pruebas con la misma hoja hacían que la segunda rebotara por eso en vez de por
 * lo que estaba comprobando — que es la clase de fallo que se lee como un fallo del código.
 * Y una columna de notas que el mapeo deja sin usar es exactamente lo que traen las hojas
 * de verdad.
 *
 * El valor es un identificador nuevo y no un contador: con un contador, la SEGUNDA pasada de
 * este archivo volvía a generar «hoja 1» y rebotaba contra la huella de la pasada anterior.
 * Correr una prueba dos veces es lo que enseña si depende de su propia historia, y esta
 * dependía.
 */
const hoja = (filas: ReadonlyArray<readonly [string, string, string]>) =>
  new TextEncoder().encode(
    ['Codigo;Debe;Haber;Nota',
      ...filas.map((f) => `${f.join(';')};${randomUUID()}`)].join('\n'))

// Un balance de apertura que cuadra: banco y clientes en el debe, proveedores y capital en
// el haber. 5.000.000 + 1.200.000 = 800.000 + 5.400.000.
const BUENO = [
  ['1.1.01.02', '5000000,00', ''],
  ['1.1.02.01', '1200000,00', ''],
  ['2.1.01.01', '', '800000,00'],
  ['3.1.01', '', '5400000,00'],
] as const

/** Sube la hoja, guarda el mapeo que propone la aplicación, y devuelve el lote. */
async function subir(bytes: Uint8Array, fecha: string | null = CORTE): Promise<string> {
  const r = await dentro((q) => cargar(q, G, YO, `apertura-${Math.random()}.csv`, bytes,
    'saldos_iniciales', fecha))
  const propuestas = proponerMapeo(r.cabeceras, r.muestras, 'saldos_iniciales')
  await dentro((q) => guardarMapeo(q, r.loteId, propuestas))
  return r.loteId
}

/** Cuántos asientos de apertura tiene la empresa ahora mismo, sin contar los reversados. */
async function aperturas(): Promise<number> {
  const [r] = (await dentro((q) => q`
    select count(*)::int as n from asiento a
     where a.organizacion_id = ${G}::uuid and a.descripcion_es = 'Balance de apertura'
       and a.reversa_a is null
       and not exists (select 1 from asiento rev where rev.reversa_a = a.id)
  `)) as unknown as Array<{ n: number }>
  return Number(r!.n)
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Apertura','J-905200000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto) values
              (${YO}, ${G},'apertura@prueba.test','Contador','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2028-12-02', 90.00,'carga_manual')
        on conflict (id) do update set ves_por_usd = excluded.ves_por_usd;
      select instalar_plan_cuentas('${G}');
      -- El mes de la fecha de corte, abierto. Un asiento tiene clave ajena contra el mes
      -- contable, así que sin esta fila el de apertura no entra — y el importador lo dice
      -- antes de escribir nada, que es lo que comprueba una de las pruebas de abajo.
      insert into periodo (organizacion_id, anio, mes, estado)
        values ('${G}', 2028, 12,'abierto')
        on conflict (organizacion_id, anio, mes) do update set estado = 'abierto';
    `)
    // La base no se vacía entre pasadas, y «una sola apertura por empresa» haría fallar la
    // segunda corrida de este archivo por su propia historia. Se limpia al EMPEZAR, no al
    // terminar: si una prueba muere a mitad, la de después tiene que poder correr igual.
    // Los asientos no se borran ni en una prueba —lo impide el disparador, y tiene razón—,
    // así que lo que se hace es reversarlos, que es lo que haría una persona.
    const viejos = (await q`
      select id from lote_importacion
       where organizacion_id = ${G}::uuid and destino = 'saldos_iniciales'
         and estado = 'confirmado'
    `) as unknown as Array<{ id: string }>
    for (const v of viejos) {
      await revertir(q, v.id, 'limpieza de la prueba anterior', YO, 'es')
    }
    // Y los lotes que quedaron a medio camino. No estorban a nada —cada hoja lleva su
    // identificador— pero sin esto la tabla crece una docena de filas por pasada, y un
    // fixture que deja basura acaba escondiendo un fallo dentro de su propia basura.
    await q`delete from lote_importacion
             where organizacion_id = ${G}::uuid and destino = 'saldos_iniciales'
               and estado in ('cargado','mapeado','validado')`
  })
})
after(async () => { await cerrar() })

test('el camino entero: la hoja entra, se valida y el asiento de apertura queda', async () => {
  const antes = await aperturas()
  const lote = await subir(hoja(BUENO))
  const r = await dentro((q) => validar(q, lote))
  assert.equal(r.malas, 0, `filas con error: ${JSON.stringify(r.errores)}`)
  assert.equal(r.filas, 4)
  const c = await dentro((q) => confirmar(q, lote, YO, 'es'))
  assert.equal(c.hecho, true, (c as { motivo?: string }).motivo)
  assert.equal(await aperturas(), antes + 1)
})

test('y el balance ya enseña el CAPITAL, que antes no aparecía en ninguna parte', async () => {
  const e = await dentro((q) => estados(q, G, 'es', CORTE))
  assert.equal(e.cuadra, true, `descuadre de ${e.descuadre}`)
  const patrim = e.secciones.find((s) => s.cual === 'patrimonio')!
  const capital = patrim.lineas.find((l) => l.codigo === '3.1.01')
  assert.ok(capital, 'el capital social no aparece en el patrimonio')
  assert.match(capital!.monto, /5\.400\.000,00/, `salió ${capital!.monto}`)
  const activo = e.secciones.find((s) => s.cual === 'activo')!
  assert.equal(activo.totalCrudo, 6200000, 'el activo de apertura no es el de la hoja')
})

test('una fila que solo trae HABER no se da por mala por tener el debe vacío', async () => {
  // Cada línea de un balance de comprobación trae una de las dos casillas y la otra vacía.
  // Exigir las dos daría por mala cada fila de la hoja, que es la forma más rápida de que
  // alguien decida que el importador no funciona.
  const lote = await subir(hoja([['3.1.01', '', '100,00'], ['1.1.01.02', '100,00', '']]))
  const r = await dentro((q) => validar(q, lote))
  assert.equal(r.malas, 0, `filas con error: ${JSON.stringify(r.errores)}`)
})

test('UN BALANCE QUE NO CUADRA no entra, y se dice por cuánto', async () => {
  const antes = await aperturas()
  const lote = await subir(hoja([
    ['1.1.01.02', '5000000,00', ''],
    ['3.1.01', '', '4999000,00'],
  ]))
  await assert.rejects(() => dentro((q) => validar(q, lote)),
    /no cuadra.*1000/s, 'se aceptó un balance de apertura descuadrado')
  assert.equal(await aperturas(), antes, 'escribió algo pese a no cuadrar')
})

test('una CUENTA QUE NO ESTÁ EN EL PLAN no entra, y se dicen TODAS', async () => {
  // Todas y no la primera: quien corrige una hoja quiere la lista entera, no una vuelta
  // por cada línea mala.
  const lote = await subir(hoja([
    ['9.9.99', '100,00', ''],
    ['8.8.88', '100,00', ''],
    ['3.1.01', '', '200,00'],
  ]))
  await assert.rejects(() => dentro((q) => validar(q, lote)), (e: Error) => {
    assert.match(e.message, /no están en el plan/)
    assert.match(e.message, /9\.9\.99/)
    assert.match(e.message, /8\.8\.88/, 'solo dijo la primera cuenta que falta')
    return true
  })
})

test('SIN FECHA DE CORTE no entra: de ella sale la fecha del asiento', async () => {
  const lote = await subir(hoja(BUENO), null)
  await assert.rejects(() => dentro((q) => validar(q, lote)), /fecha de corte/)
})

test('y SIN EL MES CONTABLE abierto tampoco, diciendo cuál hay que abrir', async () => {
  // Un asiento tiene clave ajena contra el mes contable. Sin comprobarlo aquí, el fallo
  // llegaba como «violates foreign key constraint asiento_organizacion_id_anio_mes_fkey»,
  // que no dice nada de meses y manda a quien lo lea a leer el esquema.
  const lote = await subir(hoja(BUENO), '2019-07-31')
  await assert.rejects(() => dentro((q) => validar(q, lote)), (e: Error) => {
    assert.match(e.message, /mes contable/)
    assert.match(e.message, /2019/)
    assert.doesNotMatch(e.message, /foreign key/)
    return true
  })
})

test('UNA SEGUNDA APERTURA no entra: duplicaría todo lo que hay debajo', async () => {
  // La primera prueba de este archivo ya cargó una. Ésta tiene que rebotar, y rebotar al
  // confirmar y no al validar: hasta ese momento no se ha escrito nada y no hay nada que
  // duplicar.
  const lote = await subir(hoja([
    ['1.1.01.02', '7,00', ''], ['3.1.01', '', '7,00'],
  ]))
  const r = await dentro((q) => validar(q, lote))
  assert.equal(r.malas, 0)
  await assert.rejects(() => dentro((q) => confirmar(q, lote, YO, 'es')),
    /ya tiene un balance de apertura/)
})

test('deshacer la carga REVERSA su asiento, no solo marca el lote', async () => {
  // Es el fallo que ya apareció una vez en este mismo importador: el lote pasaba a
  // «revertido» y la contabilidad seguía cargada. El asiento de apertura se marca con el
  // lote como origen, que es justo lo que revertir_lote ya sabía buscar.
  const lote = (await dentro((q) => q`
    select id from lote_importacion
     where organizacion_id = ${G}::uuid and destino = 'saldos_iniciales'
       and estado = 'confirmado' limit 1
  `)) as unknown as Array<{ id: string }>
  assert.ok(lote[0], 'no hay ninguna apertura confirmada que deshacer')
  const antes = await aperturas()
  const r = await dentro((q) => revertir(q, lote[0]!.id, 'la hoja estaba mal', YO, 'es'))
  assert.equal(r.hecho, true, (r as { motivo?: string }).motivo)
  assert.equal(r.asientos, 1, 'no reversó el asiento de apertura')
  assert.equal(await aperturas(), antes - 1)
  // Y el libro sigue cuadrando después de deshacer: el reverso es otro asiento, no un
  // borrado.
  const e = await dentro((q) => estados(q, G, 'es', CORTE))
  assert.equal(e.cuadra, true, `tras deshacer, descuadre de ${e.descuadre}`)
})

test('el campo de la cuenta es obligatorio y los importes no, como pide la hoja', async () => {
  // Una comprobación de la declaración, no del comportamiento: si algún día alguien pone
  // `debe` como obligatorio, la prueba de arriba se pone roja y esta dice por qué.
  const campos = CAMPOS['saldos_iniciales']
  assert.equal(campos.find((c) => c.campo === 'cuenta')!.obligatorio, true)
  assert.equal(campos.find((c) => c.campo === 'debe')!.obligatorio, false)
  assert.equal(campos.find((c) => c.campo === 'haber')!.obligatorio, false)
})
