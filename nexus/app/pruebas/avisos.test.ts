/**
 * Los avisos: redactar y vaciar la cola.
 *
 * Sin esto, todo lo construido se usa la primera semana y se abandona la tercera: el
 * cliente objeta, nadie se entera, y vuelve al correo y al teléfono.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import {
  redactar, enlaceDe, vaciarCola, encolarLoParado,
  type AvisoEnCola, type Redactado, type Transporte,
} from '../src/dominio/avisos.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '8b9c0d1e-0000-0000-0000-00000000000a'
const C = '8b9c0d1e-0000-0000-0000-00000000000b'
const YO = '8b9c0d1e-0000-0000-0000-00000000000d'
const ING = '8b9c0d1e-0000-0000-0000-00000000000e'
const TASA = '8b9c0d1e-1111-0000-0000-00000000000a'
const IVA = '8b9c0d1e-1111-0000-0000-00000000000b'
const CTR = '8b9c0d1e-2222-0000-0000-00000000000a'
const VAL = '8b9c0d1e-4444-0000-0000-00000000000a'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

/** Un transporte que no manda nada: guarda lo que se le habría mandado. */
class Papelera implements Transporte {
  readonly mandados: Redactado[] = []
  falla: string | null = null
  async enviar(r: Redactado): Promise<void> {
    if (this.falla) throw new Error(this.falla)
    this.mandados.push(r)
  }
}

const AVISO: AvisoEnCola = {
  id: 'a1', tipo: 'valuacion_presentada', correo: 'ing@operadora.test',
  nombre: 'Ana <Pérez>', idioma: 'es', sobreId: VAL,
  datos: { contrato: 'GPS-2026-014', valuacion: 3, obra: '1000000.00', moneda: 'VES' },
  intentos: 0,
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Avisos App','J-942222222-2'),
        ('${C}','operadora','Operadora Avisos App','J-943333333-3')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, idioma, metodo,
                                 clave_hash, totp_secreto)
            values (${YO}, ${G},'avisos-app@prueba.test','Interno','es','clave_2fa','(h)','(s)'),
                   (${ING}, ${C},'ing-avisos@prueba.test','Ingeniera','en','clave_2fa','(h)','(s)')
            on conflict (id) do update set idioma = excluded.idioma`
    await q.unsafe(`
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-09-10', 36.50,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into alicuota_iva (id, clase, porcentaje, vigente_desde)
        values ('${IVA}','general', 16.00,'2026-01-01') on conflict do nothing;
      insert into unidad_tributaria (vigente_desde, valor_ves) values ('2026-01-01', 9.00)
        on conflict do nothing;
      insert into concepto_islr (codigo, nombre_es, nombre_en, sujeto, porcentaje, factor_ut,
                                 minimo_ut, vigente_desde)
        values ('SERV-PJ','Servicios','Services','pj_domiciliada', 5.00, 83.3334, 0,'2026-01-01')
        on conflict do nothing;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR}','${G}','${C}','AVI-APP-001','servicio','Servicio','Service',
                'vigente','VES', 5000000.00,'${TASA}','${YO}')
        on conflict (id) do update set codigo = excluded.codigo;
    `)
  })
})
after(async () => { await cerrar() })

/** Una valuación recién presentada, con su aviso ya en la cola. */
async function presentada(numero: number): Promise<string> {
  const id = `8b9c0d1e-4444-0000-0000-${String(numero).padStart(12, '0')}`
  await dentro(async (q) => {
    // El borrado va sin rol: un aviso es de quien lo recibe, así que ni siquiera
    // alguien de dentro ve —ni borra— los avisos del cliente. Sin esto, la prueba
    // pasa la primera vez contra una base limpia y falla la segunda.
    await q.unsafe('set local role none')
    await q`delete from aviso where sobre_id = ${id}::uuid`
    await q`
      insert into valuacion (id, organizacion_id, contrato_id, numero, periodo_desde,
        periodo_hasta, obra, moneda, tasa_id, amortiza_pct, garantia_pct, alicuota_iva_id,
        concepto_islr, ret_iva_pct, estado, creada_por)
      values (${id}::uuid, ${G}::uuid, ${CTR}::uuid, ${numero},'2026-09-01','2026-09-30',
        1000000.00,'VES', ${TASA}::uuid, 0, 0, ${IVA}::uuid,'SERV-PJ', 0,'borrador', ${YO}::uuid)
      on conflict (id) do update set estado = 'borrador'`
    await q`update valuacion set estado = 'presentada', presentada_el = current_date
             where id = ${id}::uuid`
  })
  return id
}

test('el aviso se redacta en el idioma de quien lo recibe', () => {
  const es = redactar(AVISO, 'https://nexus.gps')
  const en = redactar({ ...AVISO, idioma: 'en' }, 'https://nexus.gps')
  assert.match(es.asunto, /Valuación 3 de GPS-2026-014/)
  assert.match(en.asunto, /Progress payment 3 on GPS-2026-014/)
  assert.match(es.texto, /Hola Ana <Pérez>,/)
  assert.match(en.texto, /Hi Ana <Pérez>,/)
})

test('el aviso lleva al sitio exacto, nunca a la portada', () => {
  // Un aviso que deja a alguien en la portada a buscar de qué le hablaban es un
  // aviso que se cierra sin hacer nada.
  assert.equal(redactar(AVISO, 'https://nexus.gps').enlace, `https://nexus.gps/valuaciones/${VAL}`)
  assert.equal(
    enlaceDe({ ...AVISO, tipo: 'objecion_nueva', datos: { valuacion_id: 'v9' } }, 'https://n.gps'),
    'https://n.gps/valuaciones/v9',
  )
  assert.equal(
    enlaceDe({ ...AVISO, tipo: 'hito_atrasado', datos: { renglon_id: 'r7' } }, 'https://n.gps'),
    'https://n.gps/renglones/r7',
  )
  // La barra de más no se duplica.
  assert.equal(redactar(AVISO, 'https://nexus.gps/').enlace, `https://nexus.gps/valuaciones/${VAL}`)
})

test('un dato que la plantilla no pide NO acaba en el correo', () => {
  // Es la única defensa que queda una vez el correo sale: aquí ya no hay políticas
  // de fila que valgan.
  const r = redactar({ ...AVISO, datos: { ...AVISO.datos, costo: '740000.00', margen: '26%' } },
    'https://nexus.gps')
  assert.equal(r.texto.includes('740000'), false)
  assert.equal(r.asunto.includes('740000'), false)
  assert.equal(r.texto.includes('26%'), false)
})

test('un dato que falta no deja un hueco raro en el asunto', () => {
  const r = redactar({ ...AVISO, datos: {} }, 'https://nexus.gps')
  assert.equal(r.asunto.includes('{valuacion}'), false)
  assert.match(r.asunto, /—/)
})

test('el asunto no crece sin límite', () => {
  const r = redactar({ ...AVISO, datos: { contrato: 'X'.repeat(500), valuacion: 1 } },
    'https://nexus.gps')
  assert.ok(r.asunto.length <= 180)
})

test('el aviso NO lleva el contenido: es un empujón hacia la aplicación', () => {
  const r = redactar(AVISO, 'https://nexus.gps')
  // Mandar la valuación entera por correo es volver al correo, que es de lo que se
  // está saliendo — y la deja en buzones que GPS no controla.
  assert.ok(r.texto.length < 600)
  assert.match(r.texto, /Verlo en GPS Nexus/)
  assert.match(r.texto, /dejar de recibir/)
})

test('vaciar la cola manda lo pendiente y lo marca enviado', async () => {
  const v = await presentada(901)
  const papelera = new Papelera()
  const r = await dentro((q) => vaciarCola(q, papelera, 'https://nexus.gps'))

  assert.ok(r.enviados >= 1)
  assert.equal(r.fallidos, 0)
  assert.ok(papelera.mandados.some((m) => m.para === 'ing-avisos@prueba.test'))

  // Sin rol: el aviso es del cliente. Preguntándolo como GPS la cuenta saldría cero
  // siempre —las políticas de fila no devuelven nada— y esta comprobación pasaría
  // sin comprobar nada.
  const [n] = (await dentro(async (q) => {
    await q.unsafe('set local role none')
    return q`select count(*)::int as total,
                    count(*) filter (where estado = 'pendiente')::int as quedan
               from aviso where sobre_id = ${v}::uuid`
  })) as unknown as Array<{ total: number; quedan: number }>
  assert.ok(n!.total >= 1, 'tenía que haber un aviso encolado')
  assert.equal(n!.quedan, 0, 'no puede quedar nada pendiente')
})

test('el correo sale en el idioma de cada destinatario, no en el del sistema', async () => {
  await presentada(902)
  const papelera = new Papelera()
  await dentro((q) => vaciarCola(q, papelera, 'https://nexus.gps'))
  const suyo = papelera.mandados.find((m) => m.para === 'ing-avisos@prueba.test')!
  // La ingeniera tiene el idioma en inglés.
  assert.match(suyo.asunto, /Progress payment/)
})

test('vaciar dos veces no manda el mismo correo dos veces', async () => {
  const v = await presentada(903)
  const uno = new Papelera()
  await dentro((q) => vaciarCola(q, uno, 'https://nexus.gps'))
  const dos = new Papelera()
  await dentro((q) => vaciarCola(q, dos, 'https://nexus.gps'))

  // Se cuenta lo de ESTA valuación, no el total. La cola es una sola para todo el
  // sistema y los archivos de prueba corren a la vez, así que entre las dos pasadas
  // puede entrar un aviso de otro archivo — y contar el total haría que esta
  // comprobación fallara por algo que no tiene nada que ver con lo que comprueba.
  const mio = (p: Papelera) => p.mandados.filter((m) => m.enlace.endsWith(v)).length
  assert.equal(mio(uno), 1, 'la primera pasada tenía que mandarlo')
  assert.equal(mio(dos), 0, 'la segunda no puede volver a mandarlo')
})

test('si el servidor de correo falla, el aviso espera en la cola', async () => {
  const v = await presentada(904)
  const rota = new Papelera()
  rota.falla = 'conexión rechazada'
  const r = await dentro((q) => vaciarCola(q, rota, "https://nexus.gps"))
  assert.ok(r.fallidos >= 1)
  assert.equal(r.enviados, 0)

  // La valuación ya está presentada. El aviso sale cuando se pueda, no se pierde.
  // Se mira sin rol: el aviso es del cliente, y ni siquiera alguien de dentro lo ve.
  const [f] = (await dentro(async (q) => {
    await q.unsafe('set local role none')
    return q`
      select estado::text, intentos, ultimo_error, intentar_en > now() as espera
        from aviso where sobre_id = ${v}::uuid limit 1`
  })) as unknown as Array<{ estado: string; intentos: number; ultimo_error: string; espera: boolean }>
  assert.equal(f!.estado, 'pendiente')
  assert.equal(f!.intentos, 1)
  assert.equal(f!.espera, true, 'no reintenta inmediatamente')
  assert.match(f!.ultimo_error, /conexión rechazada/)
})

test('un fallo al mandar uno no deja sin avisar a los demás', async () => {
  await presentada(905)
  const caprichosa = new class implements Transporte {
    readonly mandados: Redactado[] = []
    private n = 0
    async enviar(r: Redactado): Promise<void> {
      if (this.n++ === 0) throw new Error('esta dirección no existe')
      this.mandados.push(r)
    }
  }()
  await presentada(906)
  const r = await dentro((q) => vaciarCola(q, caprichosa, 'https://nexus.gps'))
  assert.equal(r.fallidos, 1)
  assert.ok(r.enviados >= 1, 'el resto tiene que salir igual')
})

test('encolar lo parado no depende de que pase nada', async () => {
  // Un documento sin revisar no es un suceso: es la ausencia de uno, y nadie encola
  // nada cuando algo NO pasa.
  const n = await dentro((q) => encolarLoParado(q, 3))
  assert.ok(typeof n === 'number' && n >= 0)
})
