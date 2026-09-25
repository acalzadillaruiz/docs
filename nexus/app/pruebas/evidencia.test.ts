/**
 * La evidencia, por arriba.
 *
 * Lo que se comprueba aquí es que el camino humano no abre ningún atajo que la base
 * de datos ya había cerrado: que la huella se calcula sobre los bytes y no se cree
 * lo que digan, que el mismo archivo no entra dos veces, que rechazar hace caer el
 * avance, y que el cliente ve los documentos que sostienen su avance — todos menos
 * la factura del proveedor.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import {
  avanceDelRenglon, subir, verificar, rechazar, porRevisar,
  huellaDe, HitoNoAlcanzable, DocumentoVacio,
} from '../src/dominio/evidencia.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '7a8b9c0d-0000-0000-0000-00000000000a'
const C = '7a8b9c0d-0000-0000-0000-00000000000b'
const OTRA = '7a8b9c0d-0000-0000-0000-00000000000c'
const YO = '7a8b9c0d-0000-0000-0000-00000000000d'
const ING = '7a8b9c0d-0000-0000-0000-00000000000e'
const AJENO = '7a8b9c0d-0000-0000-0000-00000000000f'
const TASA = '7a8b9c0d-1111-0000-0000-00000000000a'
const CTR = '7a8b9c0d-2222-0000-0000-00000000000a'
const RG = '7a8b9c0d-3333-0000-0000-00000000000a'

const H = (n: number) => `7a8b9c0d-4444-0000-0000-${String(n).padStart(12, '0')}`

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)
const cliente = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: ING }, 'nexus_cliente', f)

const bytes = (texto: string) => new TextEncoder().encode(texto)

/** Los cinco hitos del renglón, en su estado de partida, para cada prueba. */
async function hitosLimpios(): Promise<void> {
  await dentro(async (q) => {
    await q`delete from evidencia where hito_id in (
      select id from hito where renglon_id = ${RG}::uuid)`
    await q`update hito set estado = 'pendiente', ocurrido_en = null,
                            registrado_en = null, registrado_por = null
             where renglon_id = ${RG}::uuid`
  })
}

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Evidencia','J-916666666-6'),
        ('${C}','operadora','Operadora Uno','J-917777777-7'),
        ('${OTRA}','operadora','Operadora Dos','J-918888888-8')
        on conflict (id) do update set nombre = excluded.nombre, tipo = excluded.tipo;
      insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto) values
        ('${YO}','${G}','evi@prueba.test','Interno','clave_2fa','(h)','(s)'),
        ('${ING}','${C}','ing-evi@prueba.test','Ingeniero','clave_2fa','(h)','(s)'),
        ('${AJENO}','${OTRA}','otro-evi@prueba.test','Ajeno','clave_2fa','(h)','(s)')
        on conflict do nothing;
      insert into tasa_bcv (id, vigente_el, ves_por_usd, fuente)
        values ('${TASA}','2026-09-06', 36.50,'carga_manual')
        on conflict (id) do update set vigente_el = excluded.vigente_el;
      insert into contrato (id, organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
        values ('${CTR}','${G}','${C}','EVI-APP-001','procura','Cabezales','Wellheads',
                'vigente','USD', 500000.00,'${TASA}','${YO}')
        on conflict (id) do update set codigo = excluded.codigo, cliente_id = excluded.cliente_id,
                                       estado = excluded.estado;
      insert into renglon (id, contrato_id, numero, descripcion_es, descripcion_en,
                           cantidad, unidad, norma, precio_unitario, costo_unitario)
        values ('${RG}','${CTR}', 1,'Cabezal de pozo','Wellhead', 2,'unidad','API 6A',
                100000.0000, 62000.0000)
        on conflict (id) do update set contrato_id = excluded.contrato_id,
                                       precio_unitario = excluded.precio_unitario;
      insert into hito (id, renglon_id, orden, clave, nombre_es, nombre_en, peso, exige) values
        ('${H(1)}','${RG}', 1,'orden','Orden colocada','PO placed', 10.00,'{}'),
        ('${H(2)}','${RG}', 2,'fabricado','Fabricado','Manufactured', 30.00,'{certificado}'),
        ('${H(3)}','${RG}', 3,'embarcado','Embarcado','Shipped', 25.00,'{conocimiento}'),
        ('${H(4)}','${RG}', 4,'nacionalizado','Nacionalizado','Cleared', 15.00,'{aduana}'),
        ('${H(5)}','${RG}', 5,'recibido','Recibido','Received', 20.00,'{acta,foto}')
        on conflict (id) do update set renglon_id = excluded.renglon_id,
                                       peso = excluded.peso, exige = excluded.exige;
    `)
  })
})
after(async () => { await cerrar() })

test('la huella se calcula sobre los bytes, no se cree lo que digan', async () => {
  await hitosLimpios()
  // El vector de SHA-256 más conocido que hay. Si esto cambiara, todo lo demás
  // estaría calculando otra cosa.
  assert.equal(
    huellaDe(bytes('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )

  const r = await dentro((q) => subir(q, {
    hitoId: H(2), clase: 'certificado', nombre: 'mtr.pdf',
    tipoMime: 'application/pdf', contenido: bytes('colada 44821'),
  }, YO))
  assert.equal(r.documento.huella, huellaDe(bytes('colada 44821')))
  assert.equal(r.documento.huella.length, 64)
})

test('subir el documento sube el hito a evidenciado, pero no a verificado', async () => {
  await hitosLimpios()
  const r = await dentro((q) => subir(q, {
    hitoId: H(2), clase: 'certificado', nombre: 'mtr.pdf',
    tipoMime: 'application/pdf', contenido: bytes('colada 44821'),
  }, YO))
  assert.equal(r.estadoHito, 'evidenciado')

  // Y el avance sigue en cero: tener el papel no es que alguien lo haya mirado.
  const a = await dentro((q) => avanceDelRenglon(q, RG, 'es'))
  assert.equal(a.verificado, 0)
  assert.equal(a.declarado, 30)
  assert.equal(a.brecha, 30, 'los 30 puntos declarados no están demostrados')
})

test('verificado el documento, el avance sube — y sale de ahí, no de una casilla', async () => {
  await hitosLimpios()
  const s = await dentro((q) => subir(q, {
    hitoId: H(2), clase: 'certificado', nombre: 'mtr.pdf',
    tipoMime: 'application/pdf', contenido: bytes('colada 44821'),
  }, YO))
  const v = await dentro((q) => verificar(q, s.documento.id, YO))
  assert.deepEqual(v, { hecho: true, estadoHito: 'verificado' })

  const a = await dentro((q) => avanceDelRenglon(q, RG, 'es'))
  assert.equal(a.verificado, 30)
  assert.equal(a.brecha, 0)

  const hito = a.hitos.find((h) => h.clave === 'fabricado')!
  assert.equal(hito.documentos.length, 1, 'el avance enseña el papel del que sale')
  assert.equal(hito.documentos[0]!.estado, 'verificada')
  assert.deepEqual(hito.falta, [])
})

test('el mismo archivo no entra dos veces, y decirlo no es un error', async () => {
  await hitosLimpios()
  const uno = { hitoId: H(2), clase: 'certificado' as const, nombre: 'mtr.pdf',
                tipoMime: 'application/pdf', contenido: bytes('colada 44821') }
  const a = await dentro((q) => subir(q, uno, YO))
  // Mismo contenido, otro nombre. Es el mismo papel.
  const b = await dentro((q) => subir(q, { ...uno, nombre: 'certificado-final.pdf' }, YO))

  assert.equal(b.yaEstaba, true)
  assert.equal(b.documento.id, a.documento.id, 'se devuelve el que ya estaba')

  const av = await dentro((q) => avanceDelRenglon(q, RG, 'es'))
  const hito = av.hitos.find((h) => h.clave === 'fabricado')!
  assert.equal(hito.documentos.length, 1, 'no se duplicó')
})

test('rechazar hace CAER el avance: si el papel no vale, el avance tampoco', async () => {
  await hitosLimpios()
  const s = await dentro((q) => subir(q, {
    hitoId: H(2), clase: 'certificado', nombre: 'mtr.pdf',
    tipoMime: 'application/pdf', contenido: bytes('colada 44821'),
    ocurridoEn: '2026-09-10',
  }, YO))
  await dentro((q) => verificar(q, s.documento.id, YO))
  assert.equal((await dentro((q) => avanceDelRenglon(q, RG, 'es'))).verificado, 30)

  const r = await dentro((q) => rechazar(q, s.documento.id, YO, 'la colada no coincide'))
  assert.equal(r.hecho, true)
  assert.equal(r.hecho && r.estadoHito, 'declarado')

  const a = await dentro((q) => avanceDelRenglon(q, RG, 'es'))
  assert.equal(a.verificado, 0)
  assert.equal(a.declarado, 30, 'sigue declarado: alguien dijo que estaba hecho')
})

test('rechazar sin decir por qué no pasa', async () => {
  await hitosLimpios()
  const s = await dentro((q) => subir(q, {
    hitoId: H(3), clase: 'conocimiento', nombre: 'bl.pdf',
    tipoMime: 'application/pdf', contenido: bytes('BL-9912'),
  }, YO))
  // Quien subió el papel equivocado tiene que saber cuál traer.
  const r = await dentro((q) => rechazar(q, s.documento.id, YO, '   '))
  assert.deepEqual(r, { hecho: false, motivo: 'sin_motivo' })
})

test('un documento ya revisado no se vuelve a revisar', async () => {
  await hitosLimpios()
  const s = await dentro((q) => subir(q, {
    hitoId: H(3), clase: 'conocimiento', nombre: 'bl.pdf',
    tipoMime: 'application/pdf', contenido: bytes('BL-9912'),
  }, YO))
  await dentro((q) => verificar(q, s.documento.id, YO))
  const otra = await dentro((q) => verificar(q, s.documento.id, YO))
  assert.deepEqual(otra, { hecho: false, motivo: 'ya_revisada' })
})

test('un identificador inventado no dice si existe o no', async () => {
  const r = await dentro((q) => verificar(q, '00000000-0000-0000-0000-0000000000ff', YO))
  assert.deepEqual(r, { hecho: false, motivo: 'no_alcanzable' })
})

test('un hito que no existe y uno que no te toca dan el MISMO error', async () => {
  await hitosLimpios()
  const inventado = dentro((q) => subir(q, {
    hitoId: '00000000-0000-0000-0000-0000000000fe', clase: 'acta', nombre: 'a.pdf',
    tipoMime: 'application/pdf', contenido: bytes('x'),
  }, YO))
  await assert.rejects(inventado, HitoNoAlcanzable)

  // El de otra operadora existe de verdad, y para este cliente tampoco.
  const ajeno = comoPersona({ id: AJENO }, 'nexus_cliente',
    (q) => avanceDelRenglon(q, RG, 'es'))
  await assert.rejects(ajeno, HitoNoAlcanzable)
})

test('un documento vacío no prueba nada', async () => {
  await hitosLimpios()
  await assert.rejects(dentro((q) => subir(q, {
    hitoId: H(2), clase: 'certificado', nombre: 'vacio.pdf',
    tipoMime: 'application/pdf', contenido: new Uint8Array(0),
  }, YO)), DocumentoVacio)
})

test('con una de las dos evidencias exigidas, el hito dice cuál le falta', async () => {
  await hitosLimpios()
  await dentro((q) => subir(q, {
    hitoId: H(5), clase: 'acta', nombre: 'acta.pdf',
    tipoMime: 'application/pdf', contenido: bytes('acta de recepción'),
  }, YO))

  const a = await dentro((q) => avanceDelRenglon(q, RG, 'es'))
  const hito = a.hitos.find((h) => h.clave === 'recibido')!
  assert.deepEqual(hito.falta, ['foto'], 'la pantalla no tiene que averiguarlo')
  assert.notEqual(hito.estado, 'verificado')
})

test('el cliente ve los papeles que sostienen su avance', async () => {
  await hitosLimpios()
  const s = await dentro((q) => subir(q, {
    hitoId: H(2), clase: 'certificado', nombre: 'mtr.pdf',
    tipoMime: 'application/pdf', contenido: bytes('colada 44821'),
  }, YO))
  await dentro((q) => verificar(q, s.documento.id, YO))

  // Un avance que el cliente no puede auditar vuelve a ser un número que alguien
  // escribió. Este lo puede abrir hasta el documento.
  const a = await cliente((q) => avanceDelRenglon(q, RG, 'es'))
  assert.equal(a.verificado, 30)
  const hito = a.hitos.find((h) => h.clave === 'fabricado')!
  assert.equal(hito.documentos.length, 1)
  assert.equal(hito.documentos[0]!.nombre, 'mtr.pdf')
})

test('el cliente NO ve la factura del proveedor: ahí va el precio de compra', async () => {
  await hitosLimpios()
  await dentro((q) => subir(q, {
    hitoId: H(1), clase: 'factura', nombre: 'factura-proveedor.pdf',
    tipoMime: 'application/pdf', contenido: bytes('62.000 por unidad'),
  }, YO))

  const mio = await dentro((q) => avanceDelRenglon(q, RG, 'es'))
  assert.equal(mio.hitos.find((h) => h.clave === 'orden')!.documentos.length, 1)

  const suyo = await cliente((q) => avanceDelRenglon(q, RG, 'es'))
  assert.equal(
    suyo.hitos.find((h) => h.clave === 'orden')!.documentos.length, 0,
    'el cliente no tiene por qué ver el margen',
  )
})

test('el cliente no puede subir ni verificar nada', async () => {
  await hitosLimpios()
  // Escribir evidencia es de dentro. Si el cliente pudiera, el avance volvería a
  // ser lo que alguien diga — solo que ahora lo diría el otro lado.
  await assert.rejects(cliente((q) => subir(q, {
    hitoId: H(2), clase: 'certificado', nombre: 'mio.pdf',
    tipoMime: 'application/pdf', contenido: bytes('lo digo yo'),
  }, ING)))
})

test('la cola de revisión pone delante lo que lleva más tiempo parado', async () => {
  await hitosLimpios()
  const a = await dentro((q) => subir(q, {
    hitoId: H(3), clase: 'conocimiento', nombre: 'bl.pdf',
    tipoMime: 'application/pdf', contenido: bytes('BL-9912'),
  }, YO))
  await dentro((q) => subir(q, {
    hitoId: H(4), clase: 'aduana', nombre: 'dua.pdf',
    tipoMime: 'application/pdf', contenido: bytes('DUA-7710'),
  }, YO))

  // El conocimiento lleva quince días esperando. Mientras está aquí, el avance que
  // sostiene no cuenta y el contrato parece más atrasado de lo que está.
  await dentro((q) => q`
    update evidencia set subida_en = now() - interval '15 days'
     where id = ${a.documento.id}::uuid`)

  const cola = await dentro((q) => porRevisar(q, 'es'))
  const mios = cola.filter((c) => c.contrato === 'EVI-APP-001')
  assert.equal(mios.length, 2)
  assert.equal(mios[0]!.nombre, 'bl.pdf', 'lo más viejo va delante')
  assert.ok(mios[0]!.dias >= 15)
  assert.equal(mios[0]!.hito, 'Embarcado')
})

test('revisado deja de estar en la cola', async () => {
  await hitosLimpios()
  const s = await dentro((q) => subir(q, {
    hitoId: H(3), clase: 'conocimiento', nombre: 'bl.pdf',
    tipoMime: 'application/pdf', contenido: bytes('BL-9912'),
  }, YO))
  await dentro((q) => verificar(q, s.documento.id, YO))
  const cola = await dentro((q) => porRevisar(q, 'es'))
  assert.equal(cola.filter((c) => c.contrato === 'EVI-APP-001').length, 0)
})

test('el nombre del hito sale en el idioma de quien mira', async () => {
  await hitosLimpios()
  const es = await dentro((q) => avanceDelRenglon(q, RG, 'es'))
  const en = await dentro((q) => avanceDelRenglon(q, RG, 'en'))
  assert.equal(es.hitos.find((h) => h.clave === 'embarcado')!.nombre, 'Embarcado')
  assert.equal(en.hitos.find((h) => h.clave === 'embarcado')!.nombre, 'Shipped')
})
