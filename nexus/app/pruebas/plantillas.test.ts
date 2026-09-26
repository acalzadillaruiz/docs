/**
 * Las plantillas de hitos, y que sumen 100.
 *
 * `plantilla_hito` dice en qué pasos se divide un renglón de cada tipo de contrato y
 * cuánto pesa cada uno. De ahí salen los hitos de TODOS los renglones, y de los hitos
 * verificados sale el avance: es la pieza de la que cuelga la tesis del producto.
 *
 * Y la escribía solo el archivo de esquema que la sembró el primer día. `/medidas` decía
 * «ese tipo de contrato todavía no tiene plantilla de hitos, así que no hay de dónde
 * sacarlos» y no había forma de hacer una. Última tabla de las que la aplicación nunca
 * escribía y era una pantalla mandando algo imposible.
 *
 * Pero lo que de verdad se vigila aquí es otra cosa, que llevaba desde el primer día:
 * **el comentario «la suma por tipo debe dar 100» era un comentario, no una
 * comprobación.** Si una plantilla suma 90, un renglón con TODOS sus hitos verificados se
 * queda para siempre en el 90 %. No sale un error en ninguna parte. Sale un contrato que
 * no acaba de avanzar, y la explicación está en una tabla que nadie mira.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona, type Consulta } from '../src/db/conexion.ts'
import {
  plantillas, guardarPaso, quitarPaso, plantillaUsable,
} from '../src/dominio/plantillas.ts'
import { pintarPlantillas } from '../src/pantallas/plantillas.ts'
import { crearContrato } from '../src/dominio/alta.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'aa110000-0000-0000-0000-0000000000a1'
const C = 'aa110000-0000-0000-0000-0000000000a2'
const YO = 'aa110000-0000-0000-0000-0000000000a3'
const ING = 'aa110000-0000-0000-0000-0000000000a4'
const TASA = 'aa110000-0000-0000-0000-0000000000a5'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)
const comoCliente = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: ING }, 'nexus_cliente', f)

/**
 * El tipo con el que se juega. `alquiler` tiene tres pasos en la plantilla que trae el
 * esquema.
 */
const TIPO = 'alquiler'
let original: Array<Record<string, unknown>> = []

/**
 * Un ensayo que NO DEJA RASTRO, y por qué tiene que ser así.
 *
 * `plantilla_hito` no lleva `organizacion_id`: es la misma tabla para todas las
 * operadoras y —lo que aquí importa— para todos los archivos de prueba, que corren a la
 * vez en procesos distintos. La primera versión de estas pruebas rompía la plantilla,
 * comprobaba, y la devolvía a su sitio. Pasaba sola y tumbaba otros doce casos de otros
 * dos archivos: entre romperla y arreglarla hay una ventana, y en esa ventana otro
 * archivo daba de alta un contrato de alquiler y se encontraba la plantilla a medias.
 *
 * Restaurar después no sirve. Lo que sirve es que lo roto no se publique nunca: todo
 * ocurre dentro de UNA transacción que al final se deshace, así que ninguna otra
 * conexión llega a ver la plantilla rota en ningún momento.
 */
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

const ensayoCliente = (f: (q: Consulta) => Promise<void>) => ensayo(f, comoCliente)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Plantillas','J-907300000-0'),
        ('${C}','operadora','Operadora Plantillas','J-907400000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto) values
              (${YO}, ${G},'plantillas@prueba.test','Interno','clave_2fa','(h)','(s)'),
              (${ING}, ${C},'plantillas-cli@prueba.test','De la operadora','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-02-14', 45.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
    `)
    original = (await q`
      select orden, clave, nombre_es, nombre_en, peso::text as peso, exige
        from plantilla_hito where tipo = ${TIPO}::tipo_contrato order by orden
    `) as unknown as Array<Record<string, unknown>>
  })
  assert.ok(original.length > 0, 'el esquema trae una plantilla de alquiler')
})
/**
 * Y el guardián de todo lo anterior: al terminar, la plantilla de alquiler tiene que
 * estar EXACTAMENTE como la trajo el esquema. Si mañana alguien añade una prueba que
 * escribe fuera de `ensayo`, esto falla aquí y no en el archivo de otro.
 */
after(async () => {
  const ahora = await dentro((q) => q`
    select orden, clave, nombre_es, nombre_en, peso::text as peso, exige
      from plantilla_hito where tipo = ${TIPO}::tipo_contrato order by orden
  `) as unknown as Array<Record<string, unknown>>
  await cerrar()
  assert.deepEqual(ahora, original, 'una prueba escribió en la plantilla y se quedó así')
})

test('las cinco plantillas que trae el esquema suman 100', async () => {
  // Si alguna no sumara, todos los contratos de ese tipo estarían topados desde el
  // primer día. Vale la pena afirmarlo antes de tocar nada.
  const lista = await dentro((q) => plantillas(q, 'es'))
  assert.equal(lista.length, 5)
  for (const p of lista) {
    assert.equal(p.sumaCruda, 100, `${p.tipo} suma ${p.sumaCruda}`)
    assert.equal(p.sirve, true)
  }
})

test('se puede añadir un paso: antes no había forma de crear una plantilla', async () => {
  await ensayo(async (q) => {
    const r = await guardarPaso(q, {
      tipo: TIPO, orden: 9, clave: 'devuelto', nombreEs: 'Equipo devuelto',
      nombreEn: 'Equipment returned', peso: 10, exige: ['acta'],
    }, 'es')
    assert.equal(r.hecho, true, (r as { errores?: string[] }).errores?.join(' · '))

    const [p] = (await plantillas(q, 'es')).filter((x) => x.tipo === TIPO)
    assert.ok(p!.pasos.some((s) => s.clave === 'devuelto'))
    // Y ahora suma 110, así que la pantalla lo dice y la plantilla NO se puede usar.
    assert.equal(p!.sumaCruda, 110)
    assert.equal(p!.sirve, false)
  })
})

test('una plantilla que no suma 100 se puede GUARDAR pero no USAR', async () => {
  // Las dos mitades importan. Si no se pudiera guardar a medias, montar una plantilla
  // nueva sería imposible: el primer paso ya la deja en 25. Y si se pudiera usar,
  // volvemos al contrato topado al 90 % que nadie entiende.
  await ensayo(async (q) => {
    const quitado = await quitarPaso(q, TIPO, original[0]!['orden'] as number,
      original[0]!['clave'] as string, 'es')
    assert.equal(quitado.hecho, true)

    const u = await plantillaUsable(q, TIPO, 'es')
    assert.equal(u.sirve, false)
    assert.match((u as { motivo: string }).motivo, /100/)
  })
})

test('y con la plantilla incompleta NO se da de alta un contrato', async () => {
  await ensayo(async (q) => {
    await quitarPaso(q, TIPO, original[0]!['orden'] as number,
      original[0]!['clave'] as string, 'es')

    const r = await crearContrato(q, {
      clienteId: C, codigo: `PL-${Date.now() % 100000}`, tipo: TIPO,
      tituloEs: 'Alquiler de prueba', tituloEn: 'Test rental',
      moneda: 'USD', firmadoEl: '2026-02-01', inicio: '2026-03-01',
      finPrevisto: '2026-06-01', anticipoPct: 0, amortizaPct: 0, garantiaPct: 0,
      renglones: [{
        descripcionEs: 'Bomba', descripcionEn: 'Pump', unidad: 'unidad',
        cantidad: 1, precioUnitario: 100000, costoUnitario: 60000, norma: null,
        especificacion: null,
      }],
    }, YO, G, 'es')
    assert.equal(r.hecho, false, 'dio de alta un contrato con la plantilla topada')
    assert.ok((r as { errores: readonly string[] }).errores.some((e) => /100/.test(e)))
  })
})

test('y la base de datos lo impide aunque se salte la comprobación del dominio', async () => {
  // La comprobación del dominio existe para dar un mensaje legible; la que no se puede
  // saltar es la de la base. Aquí se llama a la función directamente, como lo haría
  // cualquier otro camino que alguien añada mañana.
  //
  // Todo va en UNA transacción, y aquí eso sale gratis: lo que se espera es que la
  // función reviente, y una transacción que revienta se deshace ella sola. Ni la
  // plantilla rota ni el contrato de mentira llegan a existir para nadie.
  await assert.rejects(dentro(async (q) => {
    await quitarPaso(q, TIPO, original[0]!['orden'] as number,
      original[0]!['clave'] as string, 'es')
    await q.unsafe('set local role none')
    const [ctr] = (await q`
      insert into contrato (organizacion_id, cliente_id, codigo, tipo, titulo_es,
                            titulo_en, estado, moneda, monto, tasa_id, creado_por)
      values (${G}, ${C}, ${`PLSQL-${Date.now() % 100000}`}, ${TIPO}::tipo_contrato,
              'X','X','vigente','VES', 1000, ${TASA}, ${YO})
      returning id`) as unknown as Array<{ id: string }>
    const [rg] = (await q`
      insert into renglon (contrato_id, numero, descripcion_es, descripcion_en, unidad,
                           cantidad, precio_unitario)
      values (${ctr!.id}::uuid, 1,'X','X','ud', 1, 1000) returning id
    `) as unknown as Array<{ id: string }>
    await q`select crear_hitos_desde_plantilla(${rg!.id}::uuid)`
  }), /suma .* tiene que sumar 100|sumar 100/)
})

test('un peso ilegible NO entra como cero, ni una clave con espacios', async () => {
  await ensayo(async (q) => {
    for (const malo of [
      { peso: Number.NaN }, { peso: 0 }, { peso: -5 }, { peso: 101 },
    ]) {
      const r = await guardarPaso(q, {
        tipo: TIPO, orden: 9, clave: 'x_prueba', nombreEs: 'A', nombreEn: 'B',
        exige: [], ...malo,
      } as Parameters<typeof guardarPaso>[1], 'es')
      assert.equal(r.hecho, false, `peso ${malo.peso} no puede valer`)
    }
    for (const clave of ['Orden de compra', '1orden', '', 'órden', 'x'.repeat(31)]) {
      const r = await guardarPaso(q, {
        tipo: TIPO, orden: 9, clave, nombreEs: 'A', nombreEn: 'B', peso: 10, exige: [],
      }, 'es')
      assert.equal(r.hecho, false, `«${clave}» no puede valer como clave`)
    }

    // Y la mayúscula NO se rechaza: se baja. Lo que importa no es lo que se escribe en
    // el formulario, es lo que llega a la base — la clave viaja a los hitos, a los
    // avisos y a lo que se exporta, y ahí un «ORDEN» junto a un «orden» son dos cosas
    // distintas que se leen igual. Comprobar que se rechaza sería comprobar la pantalla;
    // esto comprueba la tabla.
    const subida = await guardarPaso(q, {
      tipo: TIPO, orden: 9, clave: 'X_Prueba', nombreEs: 'A', nombreEn: 'B',
      peso: 10, exige: [],
    }, 'es')
    assert.equal(subida.hecho, true)
    const [puesta] = (await q`
      select clave from plantilla_hito where tipo = ${TIPO}::tipo_contrato and orden = 9
    `) as unknown as Array<{ clave: string }>
    assert.equal(puesta!.clave, 'x_prueba', 'la mayúscula llegó a la base')
  })
})

test('hace falta el nombre en los dos idiomas, y la clase de evidencia tiene que existir', async () => {
  await ensayo(async (q) => {
    const sinEn = await guardarPaso(q, {
      tipo: TIPO, orden: 9, clave: 'x_prueba', nombreEs: 'Algo', nombreEn: '',
      peso: 10, exige: [],
    }, 'es')
    assert.equal(sinEn.hecho, false)

    const claseMala = await guardarPaso(q, {
      tipo: TIPO, orden: 9, clave: 'x_prueba', nombreEs: 'A', nombreEn: 'B',
      peso: 10, exige: ['inventada'],
    }, 'es')
    assert.equal(claseMala.hecho, false)
  })
})

test('la clave es única por tipo: no se repite en otro orden', async () => {
  await ensayo(async (q) => {
    const clave = original[0]!['clave'] as string
    const r = await guardarPaso(q, {
      tipo: TIPO, orden: 9, clave, nombreEs: 'Repetida', nombreEn: 'Repeated',
      peso: 5, exige: [],
    }, 'es')
    assert.equal(r.hecho, false, 'dejó repetir la clave en otro orden')
    assert.ok((r as { errores: readonly string[] }).errores
      .some((e) => /única|unique/i.test(e)))
  })
})

test('el mismo orden se corrige, no se duplica', async () => {
  await ensayo(async (q) => {
    const orden = original[0]!['orden'] as number
    const r = await guardarPaso(q, {
      tipo: TIPO, orden, clave: 'corregido', nombreEs: 'Corregido', nombreEn: 'Fixed',
      peso: Number(original[0]!['peso']), exige: [],
    }, 'es')
    assert.equal(r.hecho, true, (r as { errores?: string[] }).errores?.join(' · '))
    const [p] = (await plantillas(q, 'es')).filter((x) => x.tipo === TIPO)
    assert.equal(p!.pasos.length, original.length, 'duplicó el paso en vez de corregirlo')
    assert.ok(p!.pasos.some((s) => s.clave === 'corregido'))
    assert.equal(p!.sumaCruda, 100, 'corregir con el mismo peso no cambia la suma')
  })
})

test('quitar un paso EXIGE escribir su clave, no basta el botón', async () => {
  // El agujero que encontró el barrido de formularios en blanco. Había un botón «Quitar»
  // por paso, con el tipo y el orden ya puestos en campos escondidos; mandar los
  // formularios sin tocar nada dejaba la tabla vacía, y con la tabla vacía no se puede
  // dar de alta ni un contrato de ningún tipo, porque los hitos salen de aquí.
  //
  // No es una molestia de interfaz: quitar un paso deja la suma por debajo de 100, y eso
  // bloquea el alta de ese tipo hasta que alguien la vuelva a cuadrar.
  await ensayo(async (q) => {
    const orden = original[0]!['orden'] as number
    const clave = original[0]!['clave'] as string

    for (const intento of ['', '   ', 'cualquier cosa', clave + 'x']) {
      const r = await quitarPaso(q, TIPO, orden, intento, 'es')
      assert.equal(r.hecho, false, `quitó el paso con «${intento}»`)
    }
    const [siguen] = (await q`
      select count(*)::int as n from plantilla_hito where tipo = ${TIPO}::tipo_contrato
    `) as unknown as Array<{ n: number }>
    assert.equal(siguen!.n, original.length, 'quitó algún paso sin la clave escrita')

    // Y con la clave escrita sí se quita: la puerta cerrada tiene que abrirse.
    const bien = await quitarPaso(q, TIPO, orden, ` ${clave.toUpperCase()} `, 'es')
    assert.equal(bien.hecho, true, (bien as { errores?: string[] }).errores?.join(' · '))
  })
})

test('la lista dice cuántos renglones ya tienen hitos hechos con cada plantilla', async () => {
  // Cambiar una plantilla NO rehace los hitos que ya existen, y saberlo antes evita
  // tocarla esperando que se arreglen contratos en marcha.
  const lista = await dentro((q) => plantillas(q, 'es'))
  assert.ok(lista.every((p) => Number.isInteger(p.renglones)))
})

test('el cliente puede LEER las plantillas pero no tocarlas', async () => {
  // Leerlas hace falta para entender los hitos de su propio contrato. Escribirlas es de
  // GPS: la tabla no lleva organizacion_id, así que quien la edita la edita para todas
  // las operadoras a la vez.
  const lista = await comoCliente((q) => plantillas(q, 'es'))
  assert.ok(lista.some((p) => p.pasos.length > 0), 'el cliente no puede leer los pasos')

  await assert.rejects(
    ensayoCliente(async (q) => {
      await guardarPaso(q, {
        tipo: TIPO, orden: 9, clave: 'colado', nombreEs: 'A', nombreEn: 'B',
        peso: 5, exige: [],
      }, 'es')
    }),
    /permission denied|row-level|política|policy/i,
  )
  const [p] = (await dentro((q) => plantillas(q, 'es'))).filter((x) => x.tipo === TIPO)
  assert.equal(p!.pasos.some((s) => s.clave === 'colado'), false)
})

test('la pantalla pone la SUMA delante, y en rojo cuando no da 100', async () => {
  // El número solo no dice nada; lo que hay que ver desde la puerta es si la plantilla
  // sirve. Una que suma 90 no da un error: da contratos que no avanzan.
  const lista = await dentro((q) => plantillas(q, 'es'))
  for (const idioma of ['es', 'en'] as const) {
    const h = pintarPlantillas(lista, idioma, 'af')
    assert.match(h, /class="pl-s bien"/, `${idioma}: la suma buena no sale en verde`)
    assert.match(h, /name="accion" value="paso"/, `${idioma}: no hay formulario`)
    assert.equal(h.includes('‹falta:'), false, `${idioma} tiene una clave sin traducir`)
  }
  const roto = lista.map((p) => p.tipo === TIPO
    ? { ...p, suma: '90,00', sumaCruda: 90, sirve: false } : p)
  const h = pintarPlantillas(roto, 'es', 'af')
  assert.match(h, /class="pl-s mal"/)
  assert.match(h, /No suma 100/)
})
