/**
 * Aprobar y objetar. Es el momento en que la aplicación deja de informar y empieza
 * a hacer que pasen cosas: todo lo anterior se deshacía recargando, esto no.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { aprobar, objetar } from '../src/dominio/aprobacion.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '4d5e6f7a-0000-0000-0000-00000000000a'
const C = '4d5e6f7a-0000-0000-0000-00000000000b'
const YO = '4d5e6f7a-0000-0000-0000-00000000000d'
const ING = '4d5e6f7a-0000-0000-0000-00000000000e'
const CTR = '4d5e6f7a-2222-0000-0000-00000000000a'
const TASA = '4d5e6f7a-1111-0000-0000-00000000000a'
const IVA = '4d5e6f7a-1111-0000-0000-00000000000b'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

/**
 * Una valuación recién presentada, para cada prueba.
 *
 * Devuelve la fila al estado inicial si ya existía. Un `on conflict do nothing` la
 * dejaría como la hubiera dejado la ejecución anterior, y la prueba pasaría la
 * primera vez y fallaría la segunda — que es la peor clase de prueba que hay.
 */
async function valuacionNueva(numero: number): Promise<string> {
  const id = `4d5e6f7a-3333-0000-0000-${String(numero).padStart(12, '0')}`
  await dentro(async (q) => {
    await q`delete from objecion where valuacion_id = ${id}::uuid`
    await q`
      insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde,
        periodo_hasta, obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
        concepto_islr, ret_iva_pct, estado, presentada_el, creada_por)
      values (${id}::uuid, ${G}::uuid, ${CTR}::uuid, ${numero},'2026-09-01','2026-09-30',
        100000.00,'VES', ${TASA}::uuid, 0, 0, ${IVA}::uuid,'SERV-PJ', 0,'presentada',
        current_date, ${YO}::uuid)
      on conflict (id) do update
        set estado = 'presentada', aprobada_el = null, aprobada_por = null`
  })
  return id
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Aprobación','J-904444444-4'),
        ('${C}','operadora','Operadora','J-905555555-5') on conflict do nothing;
      insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto) values
        ('${YO}','${G}','apr@prueba.test','Interno','clave_2fa','(h)','(s)'),
        ('${ING}','${C}','ing-apr@prueba.test','Ingeniero','clave_2fa','(h)','(s)')
        on conflict do nothing;
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-09-04', 36.50,'carga_manual') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00) on conflict do nothing;
      insert into alicuota_igtf (vigente_desde, porcentaje) values ('2026-01-01', 3.00) on conflict do nothing;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2018-01-03') on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut, minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01') on conflict do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR}','${G}','${C}','APR-APP-001','servicio','Servicio','Service',
                'vigente','VES', 5000000.00,'${TASA}','${YO}') on conflict do nothing;
    `)
  })
})
after(async () => { await cerrar() })

test('el cliente aprueba, y queda quién y cuándo', async () => {
  const v = await valuacionNueva(101)
  const r = await comoPersona({ id: ING }, 'nexus_cliente', (q) => aprobar(q, v, ING, true))
  assert.deepEqual(r, { hecho: true })

  const [fila] = await dentro((q) => q`
    select estado::text, aprobada_por, aprobada_el from valuacion where id = ${v}::uuid
  `) as unknown as Array<{ estado: string; aprobada_por: string; aprobada_el: Date }>
  assert.equal(fila!.estado, 'aprobada')
  // Sin esto, dentro de un año nadie puede defender que esa valuación se aprobó.
  assert.equal(fila!.aprobada_por, ING)
  assert.ok(fila!.aprobada_el)
})

test('GPS NO puede aprobar su propia valuación', async () => {
  // El acta valdría lo que vale un papel que se firma uno mismo.
  const v = await valuacionNueva(102)
  const r = await dentro((q) => aprobar(q, v, YO, false))
  assert.deepEqual(r, { hecho: false, motivo: 'no_eres_el_cliente' })

  const [fila] = await dentro((q) => q`
    select estado::text from valuacion where id = ${v}::uuid
  `) as unknown as Array<{ estado: string }>
  assert.equal(fila!.estado, 'presentada', 'no debería haber cambiado nada')
})

test('una valuación ya aprobada no se aprueba dos veces', async () => {
  const v = await valuacionNueva(103)
  await comoPersona({ id: ING }, 'nexus_cliente', (q) => aprobar(q, v, ING, true))
  const otra = await comoPersona({ id: ING }, 'nexus_cliente', (q) => aprobar(q, v, ING, true))
  assert.deepEqual(otra, { hecho: false, motivo: 'estado_equivocado' })
})

test('dos aprobaciones a la vez: solo una gana', async () => {
  // La condición del estado va dentro del update, no en un if de arriba. Entre la
  // consulta y la escritura cabe otra petición, y sin esto las dos aprobarían.
  const v = await valuacionNueva(104)
  const [a, b] = await Promise.all([
    comoPersona({ id: ING }, 'nexus_cliente', (q) => aprobar(q, v, ING, true)),
    comoPersona({ id: ING }, 'nexus_cliente', (q) => aprobar(q, v, ING, true)),
  ])
  assert.equal([a.hecho, b.hecho].filter(Boolean).length, 1,
    'exactamente una de las dos debería haber aprobado')
})

test('una valuación que no te corresponde no se aprueba, y no se dice por qué', async () => {
  const r = await comoPersona({ id: ING }, 'nexus_cliente',
    (q) => aprobar(q, '4d5e6f7a-9999-0000-0000-000000000000', ING, true))
  assert.deepEqual(r, { hecho: false, motivo: 'no_alcanzable' })
})

test('el cliente objeta con motivo, y la valuación queda objetada', async () => {
  const v = await valuacionNueva(105)
  const r = await comoPersona({ id: ING }, 'nexus_cliente',
    (q) => objetar(q, v, ING, true, 'El renglón 3 incluye 12 horas de grúa que no se ejecutaron.'))
  assert.deepEqual(r, { hecho: true })

  const [fila] = await dentro((q) => q`
    select estado::text from valuacion where id = ${v}::uuid
  `) as unknown as Array<{ estado: string }>
  assert.equal(fila!.estado, 'objetada')

  const [o] = await dentro((q) => q`
    select motivo, respondida_en from objecion where valuacion_id = ${v}::uuid
  `) as unknown as Array<{ motivo: string; respondida_en: Date | null }>
  assert.match(o!.motivo, /12 horas de grúa/)
  assert.equal(o!.respondida_en, null)
})

test('una objeción sin motivo no se acepta', async () => {
  const v = await valuacionNueva(106)
  for (const vacio of ['', '   ', '\n\t']) {
    const r = await comoPersona({ id: ING }, 'nexus_cliente', (q) => objetar(q, v, ING, true, vacio))
    assert.equal(r.hecho, false, `debería rechazar: ${JSON.stringify(vacio)}`)
  }
})

test('lo objetado se puede aprobar después, cuando GPS responde', async () => {
  const v = await valuacionNueva(107)
  await comoPersona({ id: ING }, 'nexus_cliente', (q) => objetar(q, v, ING, true, 'falta el acta'))
  const r = await comoPersona({ id: ING }, 'nexus_cliente', (q) => aprobar(q, v, ING, true))
  assert.deepEqual(r, { hecho: true })
})

test('GPS no puede objetar: la objeción es del cliente', async () => {
  const v = await valuacionNueva(108)
  const r = await dentro((q) => objetar(q, v, YO, false, 'me objeto a mí mismo'))
  assert.deepEqual(r, { hecho: false, motivo: 'no_eres_el_cliente' })
})
