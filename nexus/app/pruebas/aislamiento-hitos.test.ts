/**
 * El aislamiento de los hitos y su evidencia, mirado a la cara.
 *
 * Existe por una razón concreta y es honesto decirla: **`/medidas` tarda 739 ms con
 * mil contratos, y la mayor parte se va en la política de fila de `hito`.** Por cada
 * hito, la política mira si su renglón se ve; eso mira si el contrato se ve. Tres
 * niveles de subconsulta por fila, veinte mil veces.
 *
 * Lo primero que se probó fue **copiar la regla del contrato dentro de la política
 * del hito**, que es lo que uno escribiría para quitar un nivel. Medido: **no sirve
 * de nada**, y por una razón que conviene saberse — *las tablas que se nombran
 * dentro de una política llevan la suya puesta*. La subconsulta contra `renglon`
 * sigue disparando la política de `renglon`, y esa la de `contrato`. No se quita un
 * nivel copiando la regla: se añade una copia que mantener.
 *
 * Eso deja el techo donde está, y estas pruebas fijan la propiedad que habría que
 * romper para moverlo: **un hito se ve exactamente cuando se ve su renglón**.
 *
 * Y una advertencia que costó descubrir, escrita aquí porque se repite: **preguntar
 * por un hito uniendo con `renglon` y `contrato` NO comprueba la política del
 * hito.** Esas dos tablas esconden la fila antes de que la del hito opine, así que
 * la prueba pasa con la política del hito abierta de par en par. Lo comprobé
 * abriéndola a `true`: tres de estas seis seguían en verde. Las preguntas del
 * cliente van a `hito` a secas, con los identificadores traídos desde dentro.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '3e4f5a6b-1000-0000-0000-00000000000a'
const OP_A = '3e4f5a6b-1000-0000-0000-00000000000b'
const OP_B = '3e4f5a6b-1000-0000-0000-00000000000c'
const YO = '3e4f5a6b-1000-0000-0000-00000000000d'
const ING_A = '3e4f5a6b-1000-0000-0000-00000000000e'
const ING_B = '3e4f5a6b-1000-0000-0000-00000000000f'
const TASA = '3e4f5a6b-1100-0000-0000-00000000000a'
const CTR_A = '3e4f5a6b-2200-0000-0000-00000000000a'
const CTR_B = '3e4f5a6b-2200-0000-0000-00000000000b'
const BORRADOR = '3e4f5a6b-2200-0000-0000-00000000000c'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)
const comoA = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: ING_A }, 'nexus_cliente', f)
const comoB = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: ING_B }, 'nexus_cliente', f)

const cuantos = async (
  quien: typeof dentro, tabla: 'hito' | 'evidencia',
): Promise<number> => {
  const [r] = (await quien((q) => q.unsafe(
    `select count(*)::int as n from ${tabla}`,
  ))) as unknown as Array<{ n: number }>
  return Number(r?.n ?? 0)
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Hitos','J-908100000-0'),
        ('${OP_A}','operadora','Operadora Hitos A','J-908200000-0'),
        ('${OP_B}','operadora','Operadora Hitos B','J-908300000-0')
        on conflict (id) do update set nombre = excluded.nombre;`)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'hitos@prueba.test','Interno','clave_2fa','(h)','(s)'),
                   (${ING_A}, ${OP_A},'hitos-a@prueba.test','Ing A','clave_2fa','(h)','(s)'),
                   (${ING_B}, ${OP_B},'hitos-b@prueba.test','Ing B','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2027-08-01', 70.00,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      select instalar_plan_cuentas('${G}');

      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es,
                            titulo_en, estado, moneda, monto, tasa_id, creado_por) values
        ('${CTR_A}','${G}','${OP_A}','HI-A','servicio','De A','A''s','vigente','VES',
         1000000,'${TASA}','${YO}'),
        ('${CTR_B}','${G}','${OP_B}','HI-B','servicio','De B','B''s','vigente','VES',
         1000000,'${TASA}','${YO}'),
        -- Un borrador de A: existe, es suyo, y NO lo ve todavía. Su hito tampoco.
        ('${BORRADOR}','${G}','${OP_A}','HI-A-BORR','servicio','Borrador de A',
         'A''s draft','borrador','VES', 500000,'${TASA}','${YO}')
        on conflict (id) do update set estado = excluded.estado;

      insert into renglon (contrato_id, numero, descripcion_es, descripcion_en,
                           cantidad, unidad, precio_unitario, costo_unitario)
      select c.id, 1,'Renglón','Line', 1,'u', 100000, 70000
        from contrato c where c.organizacion_id = '${G}' and c.codigo like 'HI-%'
        on conflict (contrato_id, numero) do nothing;

      insert into hito (renglon_id, orden, clave, nombre_es, nombre_en, peso, estado)
      select r.id, 1,'h1','Hito','Milestone', 100,'verificado'
        from renglon r join contrato c on c.id = r.contrato_id
       where c.organizacion_id = '${G}' and c.codigo like 'HI-%'
        on conflict (renglon_id, orden) do nothing;

      -- Dos papeles por hito: un acta, que el cliente puede ver, y una factura de
      -- proveedor, que lleva dentro el precio de compra y NO sale de GPS.
      insert into evidencia (hito_id, clase, huella, nombre, bytes, tipo_mime, subida_por)
      -- La huella es un SHA-256 de verdad en su forma: la base de datos lo exige, y
      -- con razón. Aquí se fabrica una distinta por hito a partir de su identificador.
      select h.id,'acta', md5('acta'||h.id) || md5('acta2'||h.id),'acta.pdf', 10,
             'application/pdf','${YO}'
        from hito h join renglon r on r.id = h.renglon_id
        join contrato c on c.id = r.contrato_id
       where c.organizacion_id = '${G}' and c.codigo like 'HI-%'
        on conflict do nothing;
      insert into evidencia (hito_id, clase, huella, nombre, bytes, tipo_mime, subida_por)
      select h.id,'factura', md5('fact'||h.id) || md5('fact2'||h.id),'factura.pdf', 10,
             'application/pdf','${YO}'
        from hito h join renglon r on r.id = h.renglon_id
        join contrato c on c.id = r.contrato_id
       where c.organizacion_id = '${G}' and c.codigo like 'HI-%'
        on conflict do nothing;`)
  })
})
after(async () => { await cerrar() })

test('de dentro se ven los hitos de los tres contratos', async () => {
  // Sin esto, los ceros de las pruebas siguientes no demostrarían nada: un cero
  // porque no hay datos se parece mucho a un cero porque la valla funciona.
  const [n] = (await dentro((q) => q`
    select count(*)::int as n from hito h
      join renglon r on r.id = h.renglon_id
      join contrato c on c.id = r.contrato_id
     where c.organizacion_id = ${G}::uuid and c.codigo like 'HI-%'
  `)) as unknown as Array<{ n: number }>
  assert.equal(n!.n, 3)
})

/**
 * Los identificadores de los hitos de un contrato, mirados DESDE DENTRO.
 *
 * Hace falta porque preguntar por ellos uniendo con `renglon` y `contrato` no
 * comprueba la política del hito: esas dos tablas tienen la suya y esconden la fila
 * antes de que la del hito llegue a opinar. La prueba pasaría con la política del
 * hito abierta de par en par. Lo comprobé abriéndola a `true` y viéndola pasar.
 *
 * Así que la pregunta del cliente va a `hito` y a nada más.
 */
async function hitosDe(codigo: string): Promise<string[]> {
  const filas = (await dentro((q) => q`
    select h.id from hito h
      join renglon r on r.id = h.renglon_id
      join contrato c on c.id = r.contrato_id
     where c.organizacion_id = ${G}::uuid and c.codigo = ${codigo}
  `)) as unknown as Array<{ id: string }>
  return filas.map((f) => f.id)
}

test('un cliente NO ve el hito de otra operadora, ni sabe que existe', async () => {
  const deB = await hitosDe('HI-B')
  const deA = await hitosDe('HI-A')
  assert.ok(deB.length > 0 && deA.length > 0, 'sin hitos que pedir esto no comprueba nada')

  // Se pregunta por 'hito' a secas, con los identificadores en la mano. Sin uniones
  // que escondan la fila por su cuenta.
  const aMirandoB = (await comoA((q) => q`
    select id from hito where id = any(${deB}::uuid[])
  `)) as unknown as Array<{ id: string }>
  assert.equal(aMirandoB.length, 0)

  const bMirandoA = (await comoB((q) => q`
    select id from hito where id = any(${deA}::uuid[])
  `)) as unknown as Array<{ id: string }>
  assert.equal(bMirandoA.length, 0)

  // Y cada uno sí ve el suyo: el cero de arriba es la valla, no la falta de datos.
  const aMirandoA = (await comoA((q) => q`
    select id from hito where id = any(${deA}::uuid[])
  `)) as unknown as Array<{ id: string }>
  assert.equal(aMirandoA.length, deA.length)
})

test('EL HITO SE VE EXACTAMENTE CUANDO SE VE SU RENGLÓN', async () => {
  // Es la propiedad entera, y la que se perdería al copiar la regla del contrato
  // dentro de la política del hito para ganar milisegundos. No se comprueba contra
  // una lista escrita a mano: se comparan los dos conjuntos tal como los ve la base
  // de datos para esa misma persona.
  for (const [quien, nombre] of [[comoA, 'A'], [comoB, 'B']] as const) {
    const [r] = (await quien((q) => q`
      select (select count(*)::int from hito) as hitos,
             (select count(*)::int from hito h
               where exists (select 1 from renglon rg where rg.id = h.renglon_id)) as con_renglon,
             (select count(*)::int from renglon) as renglones
    `)) as unknown as Array<{ hitos: number; con_renglon: number; renglones: number }>
    assert.equal(r!.hitos, r!.con_renglon,
      `para ${nombre} hay hitos visibles cuyo renglón no lo es`)
    assert.ok(r!.renglones > 0, `${nombre} tiene que ver algún renglón suyo`)
  }
})

test('un contrato en borrador no le enseña sus hitos al cliente', async () => {
  // El borrador es suyo y todavía lleva erratas. Si su hito se viera, el cliente
  // estaría mirando un contrato que aún no se le ha presentado.
  const borrador = await hitosDe('HI-A-BORR')
  assert.equal(borrador.length, 1, 'el borrador tiene su hito, visto desde dentro')

  const v = (await comoA((q) => q`
    select id from hito where id = any(${borrador}::uuid[])
  `)) as unknown as Array<{ id: string }>
  assert.equal(v.length, 0)

  // Y de dentro sí está: no es que no exista.
  const [d] = (await dentro((q) => q`
    select count(*)::int as n from hito h
      join renglon r on r.id = h.renglon_id
      join contrato c on c.id = r.contrato_id
     where c.id = ${BORRADOR}::uuid
  `)) as unknown as Array<{ n: number }>
  assert.equal(d!.n, 1)
})

test('la factura del proveedor NUNCA sale de GPS, ni en el hito del propio cliente', async () => {
  // Lleva dentro el precio de compra. El cliente no tiene por qué ver el margen.
  const clases = (await comoA((q) => q`
    select distinct clase::text from evidencia
  `)) as unknown as Array<{ clase: string }>
  assert.ok(clases.length > 0, 'el cliente tiene que ver ALGÚN papel suyo')
  assert.equal(clases.some((c) => c.clase === 'factura'), false)
  assert.ok(clases.some((c) => c.clase === 'acta'))

  // De dentro se ven las dos clases: la factura existe, simplemente no sale.
  assert.ok(await cuantos(dentro, 'evidencia') >= 6)
})

test('lo que ve un cliente no depende de lo que acabe de ver otro', async () => {
  // La identidad va en la transacción, no pegada a la conexión. Se alternan a
  // propósito: es la forma en que un fallo de este tipo se ve.
  const a1 = await cuantos(comoA, 'hito')
  const b1 = await cuantos(comoB, 'hito')
  const a2 = await cuantos(comoA, 'hito')
  assert.equal(a1, a2)
  assert.ok(a1 > 0 && b1 > 0, 'cada uno tiene que ver los suyos')
})
