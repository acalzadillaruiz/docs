/**
 * Los valores fiscales: la tasa del BCV y los porcentajes de impuestos.
 *
 * Lo que este archivo vigila, antes que nada: **que la tasa del BCV se pueda cargar.**
 * Cambia todos los días, de ella cuelga cada contrato, cada valuación y cada cobro, y no
 * había ninguna pantalla donde ponerla. El sistema dejaba de servir al día siguiente de
 * arrancar.
 *
 * Y cómo se le pasó al barrido de tablas sin puerta, que existe justo para esto: el
 * barrido leía `herramientas/` entero como si fuera la aplicación, y ahí está el
 * sembrador de la empresa de muestra. Cuatro tablas —la tasa, la UT, el IVA y los
 * conceptos de ISLR— pasaban porque las escribía el SEMBRADOR. El fixture hacía lo que
 * la aplicación no hacía, esta vez dentro del propio barrido.
 *
 * Igual que con las plantillas, estas tablas NO llevan `organizacion_id`: son las mismas
 * para todas las operadoras y para todos los archivos de prueba, que corren a la vez. Lo
 * que se escriba aquí va dentro de una transacción que se deshace, y un `after` comprueba
 * que no quedó rastro.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona, type Consulta } from '../src/db/conexion.ts'
import {
  tasas, unidades, alicuotasIva, alicuotasIgtf, conceptos, loQueFalta,
  guardarTasa, guardarValor, guardarConcepto,
} from '../src/dominio/fiscales.ts'
import { pintarFiscales } from '../src/pantallas/fiscales.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'f7c10000-0000-0000-0000-0000000000a1'
const C = 'f7c10000-0000-0000-0000-0000000000a2'
const YO = 'f7c10000-0000-0000-0000-0000000000a3'
const ING = 'f7c10000-0000-0000-0000-0000000000a4'

/**
 * Las fechas de aquí son de 2021 a propósito, por dos razones. Una: no las usa ningún otro
 * archivo, y `tasa_bcv` tiene un índice único por día que haría chocar dos pruebas que
 * eligieran el mismo. Y dos: el pasado no lo limita ninguna guardia, mientras que una
 * fecha fija en el futuro dejaría de valer en cuanto pasara — una prueba con fecha de
 * caducidad es una prueba que un día falla sin que nadie haya roto nada.
 */
const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)
const comoCliente = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: ING }, 'nexus_cliente', f)

/** Un ensayo que no deja rastro: todo dentro de una transacción que se deshace. */
class Deshacer extends Error {}

async function ensayo(
  f: (q: Consulta) => Promise<void>,
  quien: typeof dentro = dentro,
): Promise<void> {
  try {
    await quien(async (q) => { await f(q); throw new Deshacer() })
  } catch (e) {
    if (!(e instanceof Deshacer)) throw e
  }
}

/** Lo que el esquema traía, para comprobar al final que sigue igual. */
let antes = ''

const retrato = (q: Consulta) => q`
  select (select count(*)::int from tasa_bcv) as tasas,
         (select count(*)::int from unidad_tributaria) as ut,
         (select count(*)::int from alicuota_iva) as iva,
         (select count(*)::int from alicuota_igtf) as igtf,
         (select count(*)::int from concepto_islr) as islr
` as unknown as Promise<Array<Record<string, number>>>

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Fiscal','J-907500000-0'),
        ('${C}','operadora','Operadora Fiscal','J-907600000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto) values
              (${YO}, ${G},'fiscal@prueba.test','Interno','clave_2fa','(h)','(s)'),
              (${ING}, ${C},'fiscal-cli@prueba.test','De la operadora','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
  })
  antes = JSON.stringify((await dentro(retrato))[0])
})

/**
 * El guardián de todo lo anterior. Si mañana alguien añade aquí una prueba que escriba
 * fuera de `ensayo`, esto falla en este archivo y no en el de otro — que es donde apareció
 * la primera vez que pasó, con las plantillas.
 */
after(async () => {
  const ahora = JSON.stringify((await dentro(retrato))[0])
  await cerrar()
  assert.equal(ahora, antes, 'una prueba escribió un valor fiscal y se quedó así')
})

// ---------------------------------------------------------------- la tasa del BCV

test('se puede cargar la tasa del BCV: antes no había ninguna forma', async () => {
  await ensayo(async (q) => {
    const r = await guardarTasa(q, {
      vigenteEl: '2021-03-15', vesPorUsd: 123.456789, rectifica: false,
    }, YO, 'es')
    assert.equal(r.hecho, true, (r as { errores?: string[] }).errores?.join(' · '))

    const [puesta] = (await q`
      select ves_por_usd::text as v, fuente, registrada_por
        from tasa_bcv where vigente_el = '2021-03-15'
    `) as unknown as Array<{ v: string; fuente: string; registrada_por: string }>
    assert.equal(Number(puesta!.v), 123.456789, 'guardó otra cifra')
    assert.equal(puesta!.fuente, 'carga_manual')
    assert.equal(puesta!.registrada_por, YO, 'no dejó dicho quién la cargó')
  })
})

test('una tasa que no es un número mayor que cero NO entra, ni como cero', async () => {
  // Cero no es «sin tasa»: es una tasa que convierte cada importe del sistema en cero.
  // Y NaN es peor, porque toda comparación con NaN es falsa y `<= 0` lo deja pasar.
  await ensayo(async (q) => {
    for (const v of [Number.NaN, 0, -3, Number.POSITIVE_INFINITY * 0]) {
      const r = await guardarTasa(q, {
        vigenteEl: '2021-03-16', vesPorUsd: v, rectifica: false,
      }, YO, 'es')
      assert.equal(r.hecho, false, `entró una tasa de ${v}`)
    }
    const [n] = (await q`
      select count(*)::int as n from tasa_bcv where vigente_el = '2021-03-16'
    `) as unknown as Array<{ n: number }>
    assert.equal(n!.n, 0, 'guardó alguna de las tasas malas')
  })
})

test('una fecha que no existe NO entra, y una de dentro de un año tampoco', async () => {
  await ensayo(async (q) => {
    for (const d of ['2021-02-31', '2021-13-01', 'mañana', '', '2028/03/15']) {
      const r = await guardarTasa(q, { vigenteEl: d, vesPorUsd: 40, rectifica: false },
        YO, 'es')
      assert.equal(r.hecho, false, `entró la fecha «${d}»`)
    }
    // Y la del año que viene: es un dedo gordo en el año, no una previsión.
    const lejos = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10)
    const r = await guardarTasa(q, { vigenteEl: lejos, vesPorUsd: 40, rectifica: false },
      YO, 'es')
    assert.equal(r.hecho, false, 'entró una tasa de dentro de un año')
    assert.match((r as { errores: readonly string[] }).errores.join(' '), /mes|month/i)

    // Pero la de mañana SÍ: el BCV publica la del día siguiente y es lo normal.
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const b = await guardarTasa(q, { vigenteEl: manana, vesPorUsd: 40, rectifica: false },
      YO, 'es')
    assert.equal(b.hecho, true, 'no dejó cargar la tasa de mañana')
  })
})

test('dos tasas el mismo día no pasan solas: hay que pedir la rectificación', async () => {
  // Es el caso que importa. El esquema tiene un índice único sobre el día de las tasas no
  // sustituidas, así que una segunda tasa callada estallaría con un error de base de
  // datos; y si no estallara, el día tendría dos tasas y cuál rige lo decidiría el orden
  // de lectura. Lo normal, cuando alguien teclea un día que ya tiene tasa, es que se haya
  // equivocado de día, así que eso es lo que se le dice.
  await ensayo(async (q) => {
    const a = await guardarTasa(q, {
      vigenteEl: '2021-04-01', vesPorUsd: 50, rectifica: false,
    }, YO, 'es')
    assert.equal(a.hecho, true)

    const b = await guardarTasa(q, {
      vigenteEl: '2021-04-01', vesPorUsd: 51, rectifica: false,
    }, YO, 'es')
    assert.equal(b.hecho, false, 'guardó una segunda tasa del mismo día sin pedirla')
    assert.match((b as { errores: readonly string[] }).errores.join(' '), /rectific/i)

    const [sigue] = (await q`
      select ves_por_usd::text as v from tasa_bcv
       where vigente_el = '2021-04-01' and sustituida_por is null
    `) as unknown as Array<{ v: string }>
    assert.equal(Number(sigue!.v), 50, 'cambió la tasa sin que nadie lo pidiera')
  })
})

test('rectificar deja la vieja marcada y NO borra nada: el pasado no se reescribe', async () => {
  await ensayo(async (q) => {
    await guardarTasa(q, { vigenteEl: '2021-04-02', vesPorUsd: 60, rectifica: false },
      YO, 'es')
    const [vieja] = (await q`
      select id from tasa_bcv where vigente_el = '2021-04-02'
    `) as unknown as Array<{ id: string }>

    const r = await guardarTasa(q, {
      vigenteEl: '2021-04-02', vesPorUsd: 62, rectifica: true,
    }, YO, 'es')
    assert.equal(r.hecho, true, (r as { errores?: string[] }).errores?.join(' · '))

    const filas = (await q`
      select id, ves_por_usd::text as v, sustituida_por
        from tasa_bcv where vigente_el = '2021-04-02' order by ves_por_usd
    `) as unknown as Array<{ id: string; v: string; sustituida_por: string | null }>

    // Las DOS siguen ahí: la vieja no se borra, porque lo ya asentado la apunta.
    assert.equal(filas.length, 2, 'una rectificación borró la tasa vieja')
    const v = filas.find((f) => f.id === vieja!.id)!
    const nueva = filas.find((f) => f.id !== vieja!.id)!
    assert.equal(v.sustituida_por, nueva.id, 'no marcó la vieja como sustituida')
    assert.equal(nueva.sustituida_por, null)
    assert.equal(Number(nueva.v), 62)

    // Y solo una queda vigente, que es lo que el índice único del esquema exige.
    const [vigentes] = (await q`
      select count(*)::int as n from tasa_bcv
       where vigente_el = '2021-04-02' and sustituida_por is null
    `) as unknown as Array<{ n: number }>
    assert.equal(vigentes!.n, 1)
  })
})

test('la lista dice cuánto subió o bajó la tasa respecto de la anterior', async () => {
  // Un dedo gordo en la tasa —80 en vez de 8— multiplica por diez cada importe del
  // sistema. El porcentaje al lado es lo que lo hace evidente de un vistazo, y es lo único
  // que se puede hacer sin inventarse una banda de plausibilidad que nadie ha decidido.
  await ensayo(async (q) => {
    await guardarTasa(q, { vigenteEl: '2021-05-01', vesPorUsd: 100, rectifica: false },
      YO, 'es')
    await guardarTasa(q, { vigenteEl: '2021-05-02', vesPorUsd: 110, rectifica: false },
      YO, 'es')
    const lista = await tasas(q, 'es', 50)
    const dos = lista.find((r) => r.vigenteEl === '2021-05-02')
    assert.equal(dos!.variacion, '10,00', `la variación salió «${dos!.variacion}»`)
  })
})

// ---------------------------------------------------------------- UT, IVA, IGTF

test('la UT, el IVA y el IGTF se pueden poner, y se corrigen sobre la misma fecha', async () => {
  await ensayo(async (q) => {
    for (const [cual, valor, extra] of [
      ['ut', 40, 'Gaceta 42.999'], ['iva', 16, 'general'], ['igtf', 3, ''],
    ] as const) {
      const a = await guardarValor(q, { cual, desde: '2021-06-01', valor, extra }, 'es')
      assert.equal(a.hecho, true, `${cual}: ${(a as { errores?: string[] }).errores?.join(' · ')}`)
      // Otra vez la misma fecha: corrige, no duplica. Dos filas del mismo día dejarían
      // cuál rige a merced de qué fila lea primero la consulta.
      const b = await guardarValor(q, { cual, desde: '2021-06-01', valor: valor + 1, extra }, 'es')
      assert.equal(b.hecho, true)
    }

    const [n] = (await q`
      select (select count(*)::int from unidad_tributaria where vigente_desde = '2021-06-01') as ut,
             (select count(*)::int from alicuota_iva
               where vigente_desde = '2021-06-01' and clase = 'general') as iva,
             (select count(*)::int from alicuota_igtf where vigente_desde = '2021-06-01') as igtf
    `) as unknown as Array<Record<string, number>>
    assert.deepEqual({ ...n }, { ut: 1, iva: 1, igtf: 1 }, 'duplicó alguna en vez de corregirla')

    const [pct] = (await q`
      select porcentaje::text as p from alicuota_iva
       where vigente_desde = '2021-06-01' and clase = 'general'
    `) as unknown as Array<{ p: string }>
    assert.equal(Number(pct!.p), 17, 'no se quedó con la corrección')
  })
})

test('y la base de datos ya no deja dos alícuotas de IVA el mismo día', async () => {
  // El sembrador decía `on conflict do nothing` y no hacía nada, porque no había ninguna
  // restricción única que arbitrar: diecisiete filas de («general», 16 %, 2026-01-01) en
  // la base de pruebas. Ahora el índice existe, y con él ese `on conflict` sirve.
  await ensayo(async (q) => {
    await q.unsafe('set local role none')
    await assert.rejects(q`
      insert into alicuota_iva (clase, porcentaje, vigente_desde) values
        ('reducida', 8, '2021-07-01'), ('reducida', 9, '2021-07-01')
    `, /alicuota_iva_clase_desde_uq|duplicate key/i)
  })
})

test('un porcentaje ilegible o de más de cien NO entra, ni una clase inventada', async () => {
  await ensayo(async (q) => {
    for (const v of [Number.NaN, -1, 101]) {
      const r = await guardarValor(q,
        { cual: 'iva', desde: '2021-08-01', valor: v, extra: 'general' }, 'es')
      assert.equal(r.hecho, false, `entró un IVA de ${v}`)
    }
    // Cero SÍ, que es lo que hace que no valga preguntar por `> 0`: el IVA exento es cero.
    const cero = await guardarValor(q,
      { cual: 'iva', desde: '2021-08-02', valor: 0, extra: 'exento' }, 'es')
    assert.equal(cero.hecho, true, 'no dejó poner el IVA exento, que es cero')

    const clase = await guardarValor(q,
      { cual: 'iva', desde: '2021-08-03', valor: 16, extra: 'inventada' }, 'es')
    assert.equal(clase.hecho, false, 'aceptó una clase de IVA que no existe')

    // Y la UT sí exige mayor que cero: una unidad tributaria de cero haría que el
    // sustraendo del ISLR fuera siempre cero y nadie vería un error.
    const ut = await guardarValor(q,
      { cual: 'ut', desde: '2021-08-04', valor: 0, extra: '' }, 'es')
    assert.equal(ut.hecho, false, 'aceptó una unidad tributaria de cero')
  })
})

// ---------------------------------------------------------------- ISLR

test('un concepto de ISLR se puede crear y corregir', async () => {
  await ensayo(async (q) => {
    const base = {
      codigo: 'x-prueba', nombreEs: 'De prueba', nombreEn: 'Test',
      sujeto: 'pj_domiciliada', porcentaje: 3, factorUt: 10, minimoUt: 0,
      desde: '2021-09-01',
    }
    const a = await guardarConcepto(q, base, 'es')
    assert.equal(a.hecho, true, (a as { errores?: string[] }).errores?.join(' · '))

    const [c] = (await q`
      select codigo, porcentaje::text as p from concepto_islr where codigo = 'X-PRUEBA'
    `) as unknown as Array<{ codigo: string; p: string }>
    assert.equal(c!.codigo, 'X-PRUEBA', 'no subió el código a mayúsculas')

    const b = await guardarConcepto(q, { ...base, porcentaje: 5 }, 'es')
    assert.equal(b.hecho, true)
    const [dos] = (await q`
      select count(*)::int as n from concepto_islr where codigo = 'X-PRUEBA'
    `) as unknown as Array<{ n: number }>
    assert.equal(dos!.n, 1, 'duplicó el concepto en vez de corregirlo')
  })
})

test('un concepto sin nombre en los dos idiomas, o con sujeto inventado, NO entra', async () => {
  await ensayo(async (q) => {
    const base = {
      codigo: 'x-prueba2', nombreEs: 'Algo', nombreEn: 'Something',
      sujeto: 'pj_domiciliada', porcentaje: 3, factorUt: 0, minimoUt: 0,
      desde: '2021-09-02',
    }
    for (const cambio of [
      { nombreEn: '' }, { nombreEs: '  ' }, { sujeto: 'extraterrestre' },
      { porcentaje: Number.NaN }, { factorUt: -1 }, { minimoUt: -1 },
      { codigo: 'con espacios' }, { codigo: '' }, { desde: '2021-02-31' },
    ]) {
      const r = await guardarConcepto(q, { ...base, ...cambio }, 'es')
      assert.equal(r.hecho, false, `entró con ${JSON.stringify(cambio)}`)
    }
    const [n] = (await q`
      select count(*)::int as n from concepto_islr where codigo like 'X-PRUEBA2%'
    `) as unknown as Array<{ n: number }>
    assert.equal(n!.n, 0)
  })
})

// ---------------------------------------------------------------- el aviso, y el cliente

test('la pantalla dice lo que FALTA para poder trabajar, y también cuando no falta', async () => {
  // Sin tasa de hoy, `valuar.ts` contesta «no hay tasa del BCV publicada todavía para hoy»
  // y no dice dónde se arregla. Esto lo dice antes de que nadie lo intente.
  //
  // Dos versiones anteriores de esta prueba estaban mal, y las dos por lo mismo — dar por
  // hecho el estado del mundo en vez de construirlo:
  //
  //   1. La primera afirmaba que en la base de muestra no faltaba nada. Faltaban dos, y
  //      eso era el fallo de verdad y no el de la prueba: el escenario de la muestra es de
  //      marzo de 2027 y la única tasa sembrada era de entonces —o sea, del FUTURO—
  //      mientras que todo lo que se emite busca la de hoy o anterior. En la base de
  //      muestra no se podía emitir ni una valuación, y COMO-CORRERLO.md decía que sí.
  //      Comprobado llamando a `emitir` antes y después de arreglarlo.
  //   2. La segunda borraba la tasa de hoy para provocar el aviso, y de la tasa de hoy
  //      solo cabe UNA: el comprobador de colisiones avisó de que `alta.test.ts` también
  //      pone la de hoy y los dos archivos corren a la vez.
  //
  // Así que ahora la prueba se monta su propio día, y lo pone en 1990: los diecisiete
  // archivos que siembran una alícuota de IVA la ponen en 2018, y un día posterior a
  // aquéllos encontraría el IVA de otro y vería cuatro cosas que faltan en vez de cinco.
  // Un día anterior a todo lo que existe no depende de nadie. Y de paso comprueba los
  // CINCO avisos en vez de dos.
  const DIA = '1990-06-15'
  await ensayo(async (q) => {
    const falta = await loQueFalta(q, 'es', DIA)
    assert.equal(falta.length, 5,
      `a un día sin nada le faltan cinco cosas, dijo ${falta.length}: ${falta.join(' | ')}`)
    for (const cual of [/tasa/i, /unidad tributaria/i, /IVA/, /IGTF/, /ISLR/]) {
      assert.ok(falta.some((f) => cual.test(f)), `no avisó de ${cual}`)
    }

    // Y puestos los cinco, lo dice también: un hueco donde debería ir un aviso no se
    // distingue de un aviso que no salió.
    assert.equal((await guardarTasa(q, {
      vigenteEl: '1990-06-01', vesPorUsd: 30, rectifica: false,
    }, YO, 'es')).hecho, true)
    for (const [cual, valor, extra] of [
      ['ut', 5, ''], ['iva', 16, 'general'], ['igtf', 3, ''],
    ] as const) {
      const r = await guardarValor(q, { cual, desde: '1990-06-01', valor, extra }, 'es')
      assert.equal(r.hecho, true, `${cual}: ${(r as { errores?: string[] }).errores?.join(' · ')}`)
    }
    assert.equal((await guardarConcepto(q, {
      codigo: 'x-falta', nombreEs: 'De prueba', nombreEn: 'Test',
      sujeto: 'pj_domiciliada', porcentaje: 3, factorUt: 0, minimoUt: 0,
      desde: '1990-06-01',
    }, 'es')).hecho, true)

    assert.deepEqual(await loQueFalta(q, 'es', DIA), [],
      'sigue avisando de que falta algo con las cinco cosas puestas')
  })
})

test('el cliente NO entra aquí: la tasa rige para todas las operadoras a la vez', async () => {
  await assert.rejects(
    ensayo(async (q) => {
      await guardarTasa(q, { vigenteEl: '2021-10-01', vesPorUsd: 70, rectifica: false },
        YO, 'es')
    }, comoCliente),
    /permission denied|row-level|política|policy/i,
  )
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from tasa_bcv where vigente_el = '2021-10-01'
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 0, 'el cliente cargó una tasa')
})

test('la pantalla sale entera en los dos idiomas', async () => {
  const d = await dentro(async (q) => ({
    falta: await loQueFalta(q, 'es'),
    tasas: await tasas(q, 'es'),
    ut: await unidades(q, 'es'),
    iva: await alicuotasIva(q, 'es'),
    igtf: await alicuotasIgtf(q, 'es'),
    conceptos: await conceptos(q, 'es'),
  }))
  for (const idioma of ['es', 'en'] as const) {
    const h = pintarFiscales(d, idioma, 'af')
    assert.equal(h.includes('‹falta:'), false, `${idioma} tiene una clave sin traducir`)
    // La fuente de la tasa se pinta traducida y no como 'carga_manual', que no es ni
    // castellano ni inglés.
    assert.equal(/>carga_manual</.test(h), false, `${idioma} pinta la fuente en crudo`)
    for (const accion of ['tasa', 'ut', 'iva', 'igtf', 'islr']) {
      assert.match(h, new RegExp(`name="accion" value="${accion}"`),
        `${idioma}: falta el formulario de ${accion}`)
    }
  }
})
