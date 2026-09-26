/**
 * Invitar a alguien, y darle de baja.
 *
 * Es la puerta de entrada del producto entero. Hasta hoy no existía: la pantalla de
 * «Crea tu clave» mandaba el formulario a `/invitacion`, una ruta que no estaba
 * escrita, y nada creaba una fila en `persona`. Dar de alta a un ingeniero de una
 * operadora era abrir una consola de PostgreSQL.
 *
 * Lo que se comprueba aquí no es que los formularios pinten: es que la llave se
 * comporte como una llave. Una ficha de alta que sobrevive a su uso, que no caduca,
 * o que puede pedir cualquiera, es una cuenta regalada.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'
import { testigoAnti } from '../src/servidor/csrf.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'bb000000-0000-0000-0000-0000000000a1'
const OP = 'bb000000-0000-0000-0000-0000000000a2'
const YO = 'bb000000-0000-0000-0000-0000000000a3'
const OTRO = 'bb000000-0000-0000-0000-0000000000a4'
const CLI = 'bb000000-0000-0000-0000-0000000000a5'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLAVE = 'una clave razonable'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

const pedir = (p: Partial<Peticion>) => resolver({
  metodo: 'GET', ruta: '/', campos: {}, cookie: null, idioma: 'es', archivo: null,
  origen: `o-${Math.random().toString(36).slice(2)}`, ...p,
}, YO, false)

async function entrar(correo: string, clave = CLAVE, secreto = SECRETO): Promise<string> {
  const origen = `o-${Math.random().toString(36).slice(2)}`
  const p1 = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
    campos: { correo, clave },
  }, YO, false)
  const desafio = /name="desafio" value="([^"]+)"/.exec(p1.cuerpo!)![1]!
  const p2 = await resolver({
    metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: codigoEnPaso(desdeBase32(secreto), pasoDe(new Date())) },
  }, YO, false)
  return new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(p2.cabeceras!['Set-Cookie']!)![1]!
}

/**
 * Crea una persona de GPS con clave y segundo factor, y devuelve su id.
 *
 * Va por la base y no por el circuito de invitación a propósito: lo que estas dos pruebas
 * miden es la baja, y montar el alta entera por HTTP para llegar ahí metería en medio media
 * docena de cosas que se pueden romper por su cuenta.
 */
async function personaNueva(correo: string): Promise<string> {
  const hash = await cifrarClave(CLAVE)
  const [p] = (await dentro(async (q) => {
    await q.unsafe('set local role none')
    return q`insert into persona (organizacion_id, correo, nombre, metodo, clave_hash,
                                  totp_secreto)
             values (${G}, ${correo},'De prueba','clave_2fa', ${hash}, ${SECRETO})
             on conflict (lower(correo)) do update
               -- Los tres campos de la baja van juntos o ninguno: hay una
               -- restricción que lo exige, y limpiar solo el motivo la rompe.
               set activa = true, baja_en = null, baja_por = null, baja_motivo = null
             returning id`
  })) as unknown as Array<{ id: string }>
  // Y se le cierran las sesiones que arrastre de una ejecución anterior. Sin esto la
  // cuenta de sesiones cortadas crece cada vez que se corren las pruebas, y una prueba
  // que depende de cuántas veces se ha corrido antes falla un día sola.
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`update sesion set cerrada_en = now(), motivo_cierre = 'limpieza de prueba'
             where persona_id = ${p!.id}::uuid and cerrada_en is null`
  })
  return p!.id
}

/** Una persona con una sesión abierta ahora mismo. */
async function conSesion(correo: string): Promise<string> {
  const id = await personaNueva(correo)
  await entrar(correo)
  return id
}

/** Y una que existe pero no ha entrado. */
const sinSesion = personaNueva

/** Manda un formulario a /personas con el testigo antifalsificación que le toca. */
const aPersonas = (cookie: string, campos: Record<string, string>) => pedir({
  metodo: 'POST', ruta: '/personas', cookie,
  campos: { af: testigoAnti(cookie), ...campos },
})

/** La ficha que viaja en el enlace que enseña la pantalla, una sola vez. */
const fichaDe = (cuerpo: string): string | null => {
  const m = /\/invitacion\?f=([A-Z2-7]+)/.exec(cuerpo)
  return m ? m[1]! : null
}

let yo = ''
let cli = ''

before(async () => {
  conectar(DESTINO)
  const hash = await cifrarClave(CLAVE)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${G}','gps','GPS Personas','J-906100000-0'),
        ('${OP}','operadora','Operadora Personas','J-906200000-0')
        on conflict (id) do update set nombre = excluded.nombre;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto) values
              (${YO}, ${G},'pers@prueba.test','Quien invita','clave_2fa', ${hash}, ${SECRETO}),
              (${OTRO}, ${G},'pers-otro@prueba.test','Otro interno','clave_2fa', ${hash}, ${SECRETO}),
              (${CLI}, ${OP},'pers-cli@prueba.test','De la operadora','clave_2fa', ${hash}, ${SECRETO})
            on conflict (id) do update set clave_hash = excluded.clave_hash, activa = true`
    // Cada pasada empieza con la mesa limpia: una prueba que se muere a medias no
    // llega nunca a su limpieza del final, y la siguiente se encuentra lo de ayer.
    await q`delete from invitacion where organizacion_id in (${G}, ${OP})`
    await q`delete from codigo_recuperacion where persona_id in (
              select id from persona where correo like 'nueva-%@prueba.test')`
    await q`delete from sesion where persona_id in (
              select id from persona where correo like 'nueva-%@prueba.test')`
    await q`delete from persona where correo like 'nueva-%@prueba.test'`
  })
  yo = await entrar('pers@prueba.test')
  cli = await entrar('pers-cli@prueba.test')
})
after(async () => { await cerrar() })

test('el enlace de alta se enseña UNA vez: no hay forma de volver a pedirlo', async () => {
  const r = await aPersonas(yo, {
    accion: 'invitar', nombre: 'Nueva Persona',
    correo: 'nueva-una@prueba.test', empresa: OP, idioma: 'es',
  })
  assert.equal(r.codigo, 200)
  const ficha = fichaDe(r.cuerpo ?? '')
  assert.ok(ficha, 'la pantalla no enseñó el enlace de alta')

  // Se vuelve a abrir la pantalla: la invitación sigue ahí, el enlace no.
  const otra = await pedir({ ruta: '/personas', cookie: yo })
  assert.equal(otra.codigo, 200)
  assert.match(otra.cuerpo ?? '', /nueva-una@prueba\.test/, 'la invitación no aparece')
  assert.equal(fichaDe(otra.cuerpo ?? ''), null,
    'el enlace de alta se puede volver a leer: entonces no es una llave')
})

test('y lo que se guarda es la HUELLA, nunca la ficha', async () => {
  const r = await aPersonas(yo, {
    accion: 'invitar', nombre: 'Nueva Huella',
    correo: 'nueva-huella@prueba.test', empresa: OP, idioma: 'es',
  })
  const ficha = fichaDe(r.cuerpo ?? '')!
  const [fila] = (await dentro((q) => q`
    select huella from invitacion where correo = 'nueva-huella@prueba.test'
  `)) as unknown as Array<{ huella: string }>
  assert.ok(fila, 'no se guardó la invitación')
  assert.notEqual(fila.huella, ficha,
    'la ficha está en la tabla en claro: quien la lea entra con lo que encuentre')
  assert.ok(!fila.huella.includes(ficha.slice(0, 12)))
})

test('aceptarla crea la cuenta con clave, segundo factor y diez códigos', async () => {
  const inv = await aPersonas(yo, {
    accion: 'invitar', nombre: 'Nueva Completa',
    correo: 'nueva-completa@prueba.test', empresa: OP, idioma: 'es',
  })
  const ficha = fichaDe(inv.cuerpo ?? '')!

  // La pantalla se abre sin sesión: quien llega todavía no tiene cuenta.
  const abierta = await pedir({ ruta: '/invitacion', campos: { f: ficha } })
  assert.equal(abierta.codigo, 200)
  assert.match(abierta.cuerpo ?? '', /Nueva Completa/)

  const hecha = await pedir({
    metodo: 'POST', ruta: '/invitacion',
    campos: { ficha, clave: 'otra clave razonable' },
  })
  assert.equal(hecha.codigo, 200)
  assert.match(hecha.cuerpo ?? '', /nueva-completa@prueba\.test/)

  const [p] = (await dentro((q) => q`
    select pe.id, pe.metodo::text as metodo, pe.organizacion_id, pe.activa,
           pe.totp_secreto is not null as tiene_totp,
           pe.clave_hash is not null as tiene_clave,
           (select count(*)::int from codigo_recuperacion c where c.persona_id = pe.id) as codigos
      from persona pe where pe.correo = 'nueva-completa@prueba.test'
  `)) as unknown as Array<Record<string, unknown>>
  assert.ok(p, 'no se creó la persona')
  assert.equal(p['metodo'], 'clave_2fa')
  assert.equal(p['organizacion_id'], OP, 'entró en la empresa equivocada')
  assert.equal(p['activa'], true)
  assert.equal(p['tiene_totp'], true)
  assert.equal(p['tiene_clave'], true)
  assert.equal(p['codigos'], 10, 'los códigos de recuperación no son diez')

  // Y el secreto que enseña la pantalla es el que quedó guardado: si fueran dos
  // distintos, la persona configuraría su aplicación con uno que no sirve.
  const secreto = /class="sec">([A-Z2-7]+)</.exec(hecha.cuerpo ?? '')?.[1]
  assert.ok(secreto, 'la pantalla no enseñó el secreto del segundo factor')
  const [g] = (await dentro((q) => q`
    select totp_secreto from persona where correo = 'nueva-completa@prueba.test'
  `)) as unknown as Array<{ totp_secreto: string }>
  assert.equal(g!.totp_secreto, secreto)

  // La prueba de que la cuenta sirve de verdad: entra con ella.
  const suya = await entrar('nueva-completa@prueba.test', 'otra clave razonable', secreto)
  assert.ok(suya.length > 10)
})

test('la misma ficha no vale dos veces', async () => {
  const inv = await aPersonas(yo, {
    accion: 'invitar', nombre: 'Nueva Dos Veces',
    correo: 'nueva-dosveces@prueba.test', empresa: OP, idioma: 'es',
  })
  const ficha = fichaDe(inv.cuerpo ?? '')!
  const una = await pedir({
    metodo: 'POST', ruta: '/invitacion', campos: { ficha, clave: 'otra clave razonable' },
  })
  assert.equal(una.codigo, 200)
  const dos = await pedir({
    metodo: 'POST', ruta: '/invitacion', campos: { ficha, clave: 'tercera clave buena' },
  })
  assert.equal(dos.codigo, 404, 'la ficha gastada siguió abriendo la puerta')
})

test('una ficha anulada tampoco, y una caducada tampoco', async () => {
  const anulada = await aPersonas(yo, {
    accion: 'invitar', nombre: 'Nueva Anulada',
    correo: 'nueva-anulada@prueba.test', empresa: OP, idioma: 'es',
  })
  const fa = fichaDe(anulada.cuerpo ?? '')!
  const [id] = (await dentro((q) => q`
    select id from invitacion where correo = 'nueva-anulada@prueba.test'
  `)) as unknown as Array<{ id: string }>
  const rev = await aPersonas(yo, {
    accion: 'revocar', invitacion: id!.id, motivo: 'se invitó a quien no era',
  })
  assert.equal(rev.codigo, 200)
  const r1 = await pedir({ ruta: '/invitacion', campos: { f: fa } })
  assert.equal(r1.codigo, 404)

  const vieja = await aPersonas(yo, {
    accion: 'invitar', nombre: 'Nueva Vieja',
    correo: 'nueva-vieja@prueba.test', empresa: OP, idioma: 'es',
  })
  const fv = fichaDe(vieja.cuerpo ?? '')!
  await dentro((q) => q`
    update invitacion set caduca_en = now() - interval '1 day'
     where correo = 'nueva-vieja@prueba.test'`)
  const r2 = await pedir({ ruta: '/invitacion', campos: { f: fv } })
  assert.equal(r2.codigo, 404, 'una invitación caducada siguió valiendo')
  const r3 = await pedir({
    metodo: 'POST', ruta: '/invitacion', campos: { ficha: fv, clave: 'otra clave razonable' },
  })
  assert.equal(r3.codigo, 404)
})

test('anular una invitación exige un motivo escrito', async () => {
  const inv = await aPersonas(yo, {
    accion: 'invitar', nombre: 'Nueva Sin Motivo',
    correo: 'nueva-sinmotivo@prueba.test', empresa: OP, idioma: 'es',
  })
  assert.ok(fichaDe(inv.cuerpo ?? ''))
  const [id] = (await dentro((q) => q`
    select id from invitacion where correo = 'nueva-sinmotivo@prueba.test'
  `)) as unknown as Array<{ id: string }>
  const r = await aPersonas(yo, { accion: 'revocar', invitacion: id!.id, motivo: '' })
  assert.equal(r.codigo, 400)
  const [sigue] = (await dentro((q) => q`
    select revocada_en from invitacion where id = ${id!.id}::uuid
  `)) as unknown as Array<{ revocada_en: Date | null }>
  assert.equal(sigue!.revocada_en, null, 'se anuló sin dejar dicho por qué')
})

test('el cliente NO ve esta pantalla, ni puede invitar a nadie', async () => {
  const mirar = await pedir({ ruta: '/personas', cookie: cli })
  assert.equal(mirar.codigo, 404)
  const escribir = await pedir({
    metodo: 'POST', ruta: '/personas', cookie: cli,
    campos: {
      af: testigoAnti(cli), accion: 'invitar', nombre: 'Colada',
      correo: 'nueva-colada@prueba.test', empresa: OP, idioma: 'es',
    },
  })
  assert.equal(escribir.codigo, 404)
  const [hay] = (await dentro((q) => q`
    select count(*)::int as n from invitacion where correo = 'nueva-colada@prueba.test'
  `)) as unknown as Array<{ n: number }>
  assert.equal(hay!.n, 0, 'un cliente invitó a alguien a su propia empresa')
})

test('dar de baja corta la sesión en el acto, no cuando cierre el navegador', async () => {
  const inv = await aPersonas(yo, {
    accion: 'invitar', nombre: 'Nueva Baja',
    correo: 'nueva-baja@prueba.test', empresa: OP, idioma: 'es',
  })
  const ficha = fichaDe(inv.cuerpo ?? '')!
  const hecha = await pedir({
    metodo: 'POST', ruta: '/invitacion', campos: { ficha, clave: 'otra clave razonable' },
  })
  const secreto = /class="sec">([A-Z2-7]+)</.exec(hecha.cuerpo ?? '')![1]!
  const suya = await entrar('nueva-baja@prueba.test', 'otra clave razonable', secreto)

  // Está dentro: su cartera se abre.
  assert.equal((await pedir({ ruta: '/', cookie: suya })).codigo, 200)

  const [p] = (await dentro((q) => q`
    select id from persona where correo = 'nueva-baja@prueba.test'
  `)) as unknown as Array<{ id: string }>
  const baja = await aPersonas(yo, {
    accion: 'baja', persona: p!.id, motivo: 'dejó la empresa',
  })
  assert.equal(baja.codigo, 200)

  // Y ya no. Sin esperar a nada: la misma cookie deja de valer en la misma petición.
  const fuera = await pedir({ ruta: '/', cookie: suya })
  assert.equal(fuera.codigo, 303, 'seguía dentro con la cuenta dada de baja')

  // Lo de arriba NO demuestra que la sesión se cerrara. `quienEs` ya filtra por
  // `p.activa`, así que ese 303 sale igual con la fila de sesión intacta y abierta:
  // es la segunda cerradura funcionando, no la primera. Lo que hay que mirar es la
  // fila, porque una sesión que sigue abierta en la tabla vuelve a valer en cuanto
  // alguien reactive la cuenta — y entonces la baja no habrá cortado nada.
  const [ses] = (await dentro((q) => q`
    select cerrada_en, motivo_cierre, cerrada_por from sesion
     where persona_id = ${p!.id}::uuid order by iniciada_en desc limit 1
  `)) as unknown as Array<{
    cerrada_en: Date | null; motivo_cierre: string | null; cerrada_por: string | null
  }>
  assert.ok(ses, 'no quedó rastro de la sesión')
  assert.notEqual(ses.cerrada_en, null,
    'la cuenta está de baja pero su sesión sigue abierta en la tabla')
  assert.equal(ses.motivo_cierre, 'persona desactivada')
  // Y QUIÉN lo ordenó. `cerrada_por` estaba declarada desde el primer día y no la
  // escribía nadie: lo encontró el barrido de columnas que nadie nombra. Cerrar la sesión
  // de alguien es echarlo del sistema en ese momento, y para la única pregunta que se hace
  // después —quién la echó— la respuesta estaba a medias: quedaba el motivo y no el autor.
  assert.equal(ses.cerrada_por, YO,
    'cerró la sesión de alguien sin dejar dicho quién lo ordenó')

  // Y se dice CUÁNTAS se cortaron. Antes esta función llamaba a cerrar_sesiones_de()
  // después de la baja y devolvía cero siempre, porque el disparador ya las había
  // cerrado: decía «no tenía ninguna abierta» de alguien que estaba dentro.
  const [n] = (await dentro((q) => q`
    select desactivar_persona(${OTRO}::uuid, ${YO}::uuid, 'se fue') as n
  `)) as unknown as Array<{ n: number }>
  assert.equal(typeof n!.n, 'number')
  await dentro((q) => q`select reactivar_persona(${OTRO}::uuid)`)
})

test('dar de baja DICE cuántas sesiones cortó, y no se deduce de la lista', async () => {
  // La función de la base devolvía ese número y la aplicación lo tiraba. Lo encontró un
  // repaso de funciones del esquema cuyo resultado nadie recoge, y no es cortesía: quien da
  // de baja a alguien quiere saber si estaba dentro en ese momento. Y hay una razón más
  // fuerte — **esta misma cuenta estuvo rota**, devolviendo cero siempre, y nadie lo vio
  // precisamente porque nadie la miraba. Un número que se enseña es un número que se
  // comprueba solo.
  const quien = await conSesion('cuenta-sesiones@prueba.test')
  const r = await aPersonas(yo, {
    accion: 'baja', persona: quien, motivo: 'se va del proyecto',
  })
  assert.equal(r.codigo, 200)
  assert.match(r.cuerpo ?? '', /class="bien-caja"/,
    'la baja salió bien y la pantalla no lo dijo')
  assert.match(r.cuerpo ?? '', /1 sesion/i,
    'no dijo cuántas sesiones cortó, que es lo único que no se ve en la lista')

  // Y de alguien que no estaba dentro, lo dice también: «ninguna» es una respuesta, y un
  // hueco donde debería ir el número no se distingue de un número que no llegó.
  const dormido = await sinSesion('cuenta-dormida@prueba.test')
  const r2 = await aPersonas(yo, {
    accion: 'baja', persona: dormido, motivo: 'tampoco sigue',
  })
  assert.equal(r2.codigo, 200)
  assert.match(r2.cuerpo ?? '', /ninguna sesi/i,
    'de alguien sin sesiones abiertas no dijo nada')
})

test('dar de baja sin decir por qué no da de baja a nadie', async () => {
  // La primera versión de esta pantalla lo hacía con un botón solo y el
  // identificador metido en un campo escondido. El barrido que manda todos los
  // formularios en blanco lo pilló dejando fuera a la gente de otras pruebas: un
  // formulario que se manda vacío y desactiva a alguien. Un navegador manda
  // formularios en blanco igual que ese barrido, y un dedo también.
  const r = await aPersonas(yo, { accion: 'baja', persona: OTRO, motivo: '' })
  assert.equal(r.codigo, 400)
  const [p] = (await dentro((q) => q`
    select activa from persona where id = ${OTRO}::uuid
  `)) as unknown as Array<{ activa: boolean }>
  assert.equal(p!.activa, true, 'un formulario en blanco dejó a alguien fuera')

  // Y el motivo queda escrito, para quien tenga que revisarlo después.
  await aPersonas(yo, { accion: 'baja', persona: OTRO, motivo: 'se fue de la empresa' })
  const [b] = (await dentro((q) => q`
    select activa, baja_motivo, baja_por from persona where id = ${OTRO}::uuid
  `)) as unknown as Array<{ activa: boolean; baja_motivo: string; baja_por: string }>
  assert.equal(b!.activa, false)
  assert.equal(b!.baja_motivo, 'se fue de la empresa')
  assert.equal(b!.baja_por, YO)

  // Volver a darla de alta borra el rastro: ya no describe a quien está dentro.
  const alta = await aPersonas(yo, { accion: 'alta', persona: OTRO })
  assert.equal(alta.codigo, 200)
  const [a] = (await dentro((q) => q`
    select activa, baja_motivo from persona where id = ${OTRO}::uuid
  `)) as unknown as Array<{ activa: boolean; baja_motivo: string | null }>
  assert.equal(a!.activa, true)
  assert.equal(a!.baja_motivo, null)
})

test('nadie puede darse de baja a sí mismo', async () => {
  const r = await aPersonas(yo, { accion: 'baja', persona: YO })
  assert.equal(r.codigo, 400)
  const [p] = (await dentro((q) => q`
    select activa from persona where id = ${YO}::uuid
  `)) as unknown as Array<{ activa: boolean }>
  assert.equal(p!.activa, true, 'se dejó a sí mismo fuera')
})

test('no se invita dos veces al mismo correo, ni a quien ya tiene cuenta', async () => {
  const uno = await aPersonas(yo, {
    accion: 'invitar', nombre: 'Nueva Repetida',
    correo: 'nueva-repetida@prueba.test', empresa: OP, idioma: 'es',
  })
  assert.equal(uno.codigo, 200)
  const dos = await aPersonas(yo, {
    accion: 'invitar', nombre: 'Nueva Repetida',
    correo: 'nueva-repetida@prueba.test', empresa: OP, idioma: 'es',
  })
  assert.equal(dos.codigo, 400)
  assert.equal(fichaDe(dos.cuerpo ?? ''), null, 'salió una segunda llave para el mismo buzón')

  const ya = await aPersonas(yo, {
    accion: 'invitar', nombre: 'Ya existe',
    correo: 'pers-otro@prueba.test', empresa: G, idioma: 'es',
  })
  assert.equal(ya.codigo, 400)
  assert.equal(fichaDe(ya.cuerpo ?? ''), null)
})

test('una clave corta no crea la cuenta, y lo dice sin gastar la ficha', async () => {
  const inv = await aPersonas(yo, {
    accion: 'invitar', nombre: 'Nueva Corta',
    correo: 'nueva-corta@prueba.test', empresa: OP, idioma: 'es',
  })
  const ficha = fichaDe(inv.cuerpo ?? '')!
  const r = await pedir({
    metodo: 'POST', ruta: '/invitacion', campos: { ficha, clave: 'corta' },
  })
  assert.equal(r.codigo, 400)
  const [hay] = (await dentro((q) => q`
    select count(*)::int as n from persona where correo = 'nueva-corta@prueba.test'
  `)) as unknown as Array<{ n: number }>
  assert.equal(hay!.n, 0)
  // Y la ficha sigue viva: equivocarse al escribir la clave no puede costar el alta.
  const otra = await pedir({
    metodo: 'POST', ruta: '/invitacion', campos: { ficha, clave: 'otra clave razonable' },
  })
  assert.equal(otra.codigo, 200)
})

test('una ficha inventada contesta lo mismo que una muerta', async () => {
  const inventada = await pedir({ ruta: '/invitacion', campos: { f: 'AAAAAAAAAAAAAAAA' } })
  const vacia = await pedir({ ruta: '/invitacion' })
  assert.equal(inventada.codigo, 404)
  assert.equal(vacia.codigo, 404)
  assert.equal(inventada.cuerpo?.length, vacia.cuerpo?.length,
    'la diferencia ya dice cuál de las dos existía')
})
