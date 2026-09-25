/**
 * El perfil.
 *
 * Es poco y decide si los avisos sobreviven. Un aviso del que no puedes salir acaba
 * marcado como correo no deseado, y con él todos los demás — incluido el que avisa
 * de que una valuación lleva un mes sin firmar.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { perfil, guardarPerfil, TIPOS_AVISO } from '../src/dominio/perfil.ts'
import { pintarPerfil } from '../src/pantallas/perfil.ts'
import {
  partir, campos as camposDe, repetidos as repetidosDe,
} from '../src/servidor/multipart.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '0d1e2f3a-0000-0000-0000-00000000000a'
const C = '0d1e2f3a-0000-0000-0000-00000000000b'
const YO = '0d1e2f3a-0000-0000-0000-00000000000d'
const ING = '0d1e2f3a-0000-0000-0000-00000000000e'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)
const cliente = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: ING }, 'nexus_cliente', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Perfil','J-970000000-0'),
        ('${C}','operadora','Operadora Perfil','J-971111111-1')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, idioma, metodo,
                                 clave_hash, totp_secreto)
            values (${YO}, ${G},'perf@prueba.test','Interno','es','clave_2fa','(h)','(s)'),
                   (${ING}, ${C},'perf-cli@prueba.test','Ingeniera','es','clave_2fa','(h)','(s)')
            on conflict (id) do update set idioma = 'es'`
    await q.unsafe(`delete from preferencia_aviso where persona_id in ('${YO}','${ING}')`)
  })
})
after(async () => { await cerrar() })

test('por omisión se recibe todo: no hay nada que activar', async () => {
  // Un aviso que hay que activar es un aviso que nadie activa.
  const p = await dentro((q) => perfil(q, YO, 'es', false))
  assert.equal(p.preferencias.length, TIPOS_AVISO.length)
  assert.equal(p.preferencias.every((x) => x.quiere), true)
})

test('al cliente no se le ofrecen los avisos que son de dentro', async () => {
  const p = await cliente((q) => perfil(q, ING, 'es', true))
  const suyos = p.preferencias.map((x) => x.tipo)
  assert.deepEqual(suyos, ['objecion_respondida', 'valuacion_presentada'])
  // Ofrecerle apagar «documento sin revisar» sería ofrecerle apagar algo que nunca
  // le llega, y eso hace la pantalla incomprensible.
  assert.equal(suyos.includes('evidencia_sin_revisar'), false)
})

test('el nombre del aviso es lo que va a ver en su bandeja, sin huecos', async () => {
  const p = await dentro((q) => perfil(q, YO, 'es', false))
  for (const pr of p.preferencias) {
    assert.equal(pr.nombre.includes('{'), false, `quedó una plantilla sin rellenar: ${pr.nombre}`)
    assert.ok(pr.nombre.length > 8)
  }
})

test('desmarcar uno lo apaga, y solo ese', async () => {
  await dentro((q) => guardarPerfil(q, YO, 'es',
    TIPOS_AVISO.filter((t) => t !== 'hito_atrasado'), false))

  const p = await dentro((q) => perfil(q, YO, 'es', false))
  assert.equal(p.preferencias.find((x) => x.tipo === 'hito_atrasado')!.quiere, false)
  assert.equal(p.preferencias.filter((x) => !x.quiere).length, 1)
})

test('volver a marcarlo lo enciende: no es un camino de ida', async () => {
  await dentro((q) => guardarPerfil(q, YO, 'es', [...TIPOS_AVISO], false))
  const p = await dentro((q) => perfil(q, YO, 'es', false))
  assert.equal(p.preferencias.every((x) => x.quiere), true)
})

test('desmarcarlo todo se guarda: guardar solo lo que vino haría imposible apagar nada', async () => {
  // Un formulario con casillas manda SOLO las marcadas. Si no se escribe también lo
  // que no vino, quitarse un aviso de encima sería imposible.
  await dentro((q) => guardarPerfil(q, YO, 'es', [], false))
  const p = await dentro((q) => perfil(q, YO, 'es', false))
  assert.equal(p.preferencias.some((x) => x.quiere), false)
  await dentro((q) => guardarPerfil(q, YO, 'es', [...TIPOS_AVISO], false))
})

test('lo apagado se respeta de verdad: ese aviso ya no se encola', async () => {
  await dentro((q) => guardarPerfil(q, YO, 'es',
    TIPOS_AVISO.filter((t) => t !== 'valuacion_aprobada'), false))

  const [n] = (await dentro((q) => q`
    select encolar_aviso('valuacion_aprobada', ${G}::uuid,
                         '0d1e2f3a-9999-0000-0000-00000000000a'::uuid) as n
  `)) as unknown as Array<{ n: number }>
  assert.equal(Number(n!.n), 0, 'no se le puede encolar lo que dijo que no quiere')

  await dentro((q) => guardarPerfil(q, YO, 'es', [...TIPOS_AVISO], false))
})

test('el cliente no puede apagar ni encender los avisos de otro', async () => {
  // Las preferencias son de cada persona y de nadie más: ni de su empresa, ni de GPS.
  const filas = await cliente((q) => q`
    select * from preferencia_aviso where persona_id = ${YO}::uuid
  `)
  assert.equal(filas.length, 0)
})

test('cambiar el idioma cambia en qué idioma le llegan los correos', async () => {
  await dentro((q) => guardarPerfil(q, YO, 'en', [...TIPOS_AVISO], false))
  const [p] = (await dentro((q) => q`
    select idioma from persona where id = ${YO}::uuid
  `)) as unknown as Array<{ idioma: string }>
  assert.equal(p!.idioma, 'en')
  await dentro((q) => guardarPerfil(q, YO, 'es', [...TIPOS_AVISO], false))
})

test('las casillas salen marcadas, y el correo no se edita', async () => {
  const p = await dentro((q) => perfil(q, YO, 'es', false))
  const h = pintarPerfil(p, 'es', 'af-de-prueba')
  assert.equal((h.match(/type="checkbox"[^>]* checked/g) ?? []).length, TIPOS_AVISO.length)
  // Cambiar el correo de acceso es cambiar la identidad con la que se entra, y eso
  // no se hace en la misma pantalla donde se marcan casillas.
  assert.equal(h.includes('name="correo"'), false)
  assert.match(h, /perf@prueba\.test/)
  assert.match(h, /name="af" value="af-de-prueba"/)
})

test('un grupo de casillas repetidas no se queda en una sola', () => {
  // Es el fallo que tenía: `campos` guarda el último valor, así que marcar cinco
  // casillas guardaba una. Los repetidos van aparte.
  const F = 'bOuNd'
  const cuerpo = Buffer.from(
    ['aviso=uno', 'aviso=dos', 'aviso=tres'].map((par) => {
      const [n, v] = par.split('=')
      return `--${F}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`
    }).join('') + `--${F}--\r\n`, 'utf-8')

  const partes = partir(cuerpo, F)
  assert.equal(camposDe(partes)['aviso'], 'tres')
  assert.deepEqual(repetidosDe(partes)['aviso'], ['uno', 'dos', 'tres'])
})

test('el cliente NO puede leer la huella de la clave ni el segundo factor de nadie', async () => {
  // Es la concesión más peligrosa de todo el sistema: para enseñar un perfil hace
  // falta leer 'persona', y esa tabla guarda con qué se entra. Se concede columna a
  // columna, y las tres que no están son justo esas.
  for (const columna of ['clave_hash', 'totp_secreto', 'idp_sujeto']) {
    await assert.rejects(
      cliente((q) => q.unsafe(`select ${columna} from persona limit 1`)),
      /permission denied/,
      `el cliente pudo leer ${columna}`,
    )
  }
})

test('el cliente solo ve a los suyos, no la lista de personas del sistema', async () => {
  // Sin la política de fila, concederle 'persona' le daría los correos de todo el
  // mundo, GPS incluido.
  const filas = (await cliente((q) => q`
    select correo, organizacion_id from persona
  `)) as unknown as Array<{ correo: string; organizacion_id: string }>

  assert.ok(filas.length >= 1, 'tiene que verse a sí misma')
  assert.equal(filas.every((f) => f.organizacion_id === C), true)
  assert.equal(filas.some((f) => f.correo === 'perf@prueba.test'), false,
    'no puede ver a nadie de GPS')
})

test('GPS sí ve a las personas del cliente: administra las cuentas', async () => {
  const filas = (await dentro((q) => q`
    select correo from persona where organizacion_id = ${C}::uuid
  `)) as unknown as Array<{ correo: string }>
  assert.ok(filas.some((f) => f.correo === 'perf-cli@prueba.test'))
})
