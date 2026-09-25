/**
 * Entrar con la cuenta de la empresa, de punta a punta.
 *
 * Lo que compra esto no es ahorrarle una clave a nadie: es que cuando la operadora
 * da de baja al ingeniero, pierde el acceso el mismo día sin que nadie de GPS tenga
 * que acordarse. Lo que se comprueba aquí es que no haya forma de entrar sin ser
 * quien el proveedor dice que eres.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createSign } from 'node:crypto'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { empresaDe, preparar, volver, type Proveedor } from '../src/dominio/sso.ts'
import { verificarFirma, type JuegoDeClaves } from '../src/servidor/jwks.ts'
import type { Afirmaciones } from '../src/dominio/empresa.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = '7e8f9a0b-0000-0000-0000-00000000000a'
const C = '7e8f9a0b-0000-0000-0000-00000000000b'
const YO = '7e8f9a0b-0000-0000-0000-00000000000d'
const ING = '7e8f9a0b-0000-0000-0000-00000000000e'
const BAJA = '7e8f9a0b-0000-0000-0000-00000000000f'
const INQUILINO = 'a1b2c3d4-0000-0000-0000-inquilino000'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const KID = 'sso-kid'
const JUEGO: JuegoDeClaves = {
  keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256' } as never],
}

const PROV: Proveedor = {
  metodo: 'microsoft',
  autorizar: 'https://login.microsoftonline.com/{inquilino}/oauth2/v2.0/authorize',
  testigo: 'https://login.microsoftonline.com/{inquilino}/oauth2/v2.0/token',
  claves: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  emisor: (i) => `https://login.microsoftonline.com/${i}/v2.0`,
  clienteId: 'gps-nexus-app',
  clienteSecreto: '(no se usa en la prueba)',
}
const VUELTA = 'https://nexus.gps/entrar/empresa/vuelta'

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf-8').toString('base64url')
function firmar(cuerpo: object): string {
  const firmado = `${b64({ alg: 'RS256', kid: KID, typ: 'JWT' })}.${b64(cuerpo)}`
  const s = createSign('RSA-SHA256')
  s.update(firmado); s.end()
  return `${firmado}.${s.sign(privateKey).toString('base64url')}`
}

const ahora = Math.floor(Date.now() / 1000)
const afirmacionesBuenas = (nonce: string, cambios: Partial<Afirmaciones> = {}) => ({
  iss: PROV.emisor(INQUILINO),
  aud: PROV.clienteId,
  tid: INQUILINO,
  sub: 'sujeto-del-ingeniero',
  email: 'ing-sso@operadora.test',
  email_verified: true,
  nonce,
  iat: ahora,
  exp: ahora + 3600,
  ...cambios,
})

/** El verificador de verdad: comprueba la firma y devuelve las afirmaciones. */
const verificar = async (testigo: string) =>
  verificarFirma(testigo, JUEGO) as Afirmaciones

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif, metodos, idp_tenant) values
        ('${G}','gps','GPS SSO','J-901200000-0','{clave_2fa}', null),
        ('${C}','operadora','Operadora SSO','J-901300000-0','{microsoft}','${INQUILINO}')
        on conflict (id) do update set metodos = excluded.metodos,
                                       idp_tenant = excluded.idp_tenant;
    `)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, clave_hash, totp_secreto)
            values (${YO}, ${G},'sso@prueba.test','Interno','clave_2fa','(h)','(s)')
            on conflict (id) do nothing`
    // 'idp_sujeto' es único, así que cada una arranca con el suyo: dos «(pendiente)»
    // chocarían, y ese choque no tiene nada que ver con lo que se prueba aquí.
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo, idp_sujeto)
            values (${ING}, ${C},'ing-sso@operadora.test','Ingeniera','microsoft','(pendiente-1)'),
                   (${BAJA}, ${C},'baja-sso@operadora.test','De baja','microsoft','(pendiente-2)')
            on conflict (id) do update set activa = true,
              idp_sujeto = case when persona.id = ${ING}::uuid then '(pendiente-1)'
                                else '(pendiente-2)' end`
    await q`update persona set activa = false where id = ${BAJA}::uuid`
    await q`delete from peticion_sso where organizacion_id = ${C}::uuid`
  })
})
after(async () => { await cerrar() })

async function ida(): Promise<{ estado: string; adonde: string }> {
  const org = (await dentro((q) => empresaDe(q, 'ing-sso@operadora.test')))!
  return dentro((q) => preparar(q, org, PROV, '/contratos', '1.2.3.4', VUELTA))
}

test('la empresa se busca por la PERSONA, no por el dominio del correo', async () => {
  // Dos empresas distintas pueden usar el mismo dominio —pasa con los grupos— y
  // adivinar por dominio metería a alguien en la empresa equivocada.
  const org = await dentro((q) => empresaDe(q, 'ing-sso@operadora.test'))
  assert.equal(org!.id, C)
  assert.deepEqual(org!.metodos, ['microsoft'])
  assert.equal(await dentro((q) => empresaDe(q, 'nadie@operadora.test')), null)
  assert.equal(await dentro((q) => empresaDe(q, 'no-es-un-correo')), null)
})

test('una persona de baja no tiene empresa: perdió el acceso', async () => {
  assert.equal(await dentro((q) => empresaDe(q, 'baja-sso@operadora.test')), null)
})

test('la ida manda al proveedor con estado, nonce y select_account', async () => {
  const { adonde } = await ida()
  const u = new URL(adonde)
  assert.equal(u.host, 'login.microsoftonline.com')
  assert.ok(u.pathname.includes(INQUILINO))
  assert.equal(u.searchParams.get('client_id'), PROV.clienteId)
  assert.equal(u.searchParams.get('response_type'), 'code')
  assert.equal(u.searchParams.get('redirect_uri'), VUELTA)
  assert.ok(u.searchParams.get('state'))
  assert.ok(u.searchParams.get('nonce'))
  // Sin esto, quien tenga otra sesión abierta en el proveedor entra con ella sin
  // enterarse y acaba viendo el portal como otra persona.
  assert.equal(u.searchParams.get('prompt'), 'select_account')
})

test('el camino bueno: vuelve, se comprueba todo, y entra', async () => {
  const { estado, adonde } = await ida()
  const nonce = new URL(adonde).searchParams.get('nonce')!

  const r = await dentro((q) => volver(q, estado, 'codigo-de-vuelta', PROV,
    async () => firmar(afirmacionesBuenas(nonce)), verificar, VUELTA))
  assert.equal(r.entra, true)
  assert.equal(r.entra && r.personaId, ING)
  assert.equal(r.entra && r.destino, '/contratos')
})

test('la petición SE QUEMA: la misma vuelta dos veces no abre dos sesiones', async () => {
  const { estado, adonde } = await ida()
  const nonce = new URL(adonde).searchParams.get('nonce')!
  const uno = async () => dentro((q) => volver(q, estado, 'c', PROV,
    async () => firmar(afirmacionesBuenas(nonce)), verificar, VUELTA))
  assert.equal((await uno()).entra, true)
  const dos = await uno()
  assert.equal(dos.entra, false)
  assert.equal(dos.entra === false && dos.motivo, 'peticion_caducada')
})

test('un estado inventado no entra, y dice lo mismo que uno caducado', async () => {
  const r = await dentro((q) => volver(q, 'estado-que-nadie-guardo', 'c', PROV,
    async () => firmar(afirmacionesBuenas('x')), verificar, VUELTA))
  assert.equal(r.entra, false)
  assert.equal(r.entra === false && r.motivo, 'peticion_caducada')
})

test('un testigo con OTRO nonce no entra: es un testigo reutilizado', async () => {
  const { estado } = await ida()
  const r = await dentro((q) => volver(q, estado, 'c', PROV,
    async () => firmar(afirmacionesBuenas('nonce-de-otra-peticion')), verificar, VUELTA))
  assert.equal(r.entra === false && r.motivo, 'nonce_distinto')
})

test('un testigo de OTRO inquilino no entra, aunque la firma sea buena', async () => {
  // Es el error clásico: sin comprobar el inquilino, cualquiera con una cuenta
  // personal de Microsoft entra en el portal del cliente.
  const { estado, adonde } = await ida()
  const nonce = new URL(adonde).searchParams.get('nonce')!
  const r = await dentro((q) => volver(q, estado, 'c', PROV,
    async () => firmar(afirmacionesBuenas(nonce, {
      tid: 'otro-inquilino', iss: PROV.emisor('otro-inquilino'),
    })), verificar, VUELTA))
  assert.equal(r.entra, false)
})

test('un testigo caducado no entra', async () => {
  const { estado, adonde } = await ida()
  const nonce = new URL(adonde).searchParams.get('nonce')!
  const r = await dentro((q) => volver(q, estado, 'c', PROV,
    async () => firmar(afirmacionesBuenas(nonce, { exp: ahora - 7200 })), verificar, VUELTA))
  assert.equal(r.entra === false && r.motivo, 'caducado')
})

test('un correo sin verificar no entra: puede ser el de otra persona', async () => {
  const { estado, adonde } = await ida()
  const nonce = new URL(adonde).searchParams.get('nonce')!
  const r = await dentro((q) => volver(q, estado, 'c', PROV,
    async () => firmar(afirmacionesBuenas(nonce, { email_verified: false })),
    verificar, VUELTA))
  assert.equal(r.entra === false && r.motivo, 'correo_sin_verificar')
})

test('un testigo FIRMADO POR OTRO no entra', async () => {
  const otra = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const { estado, adonde } = await ida()
  const nonce = new URL(adonde).searchParams.get('nonce')!
  const falsificar = async () => {
    const firmado = `${b64({ alg: 'RS256', kid: KID })}.${b64(afirmacionesBuenas(nonce))}`
    const s = createSign('RSA-SHA256')
    s.update(firmado); s.end()
    return `${firmado}.${s.sign(otra.privateKey).toString('base64url')}`
  }
  await assert.rejects(
    dentro((q) => volver(q, estado, 'c', PROV, falsificar, verificar, VUELTA)),
    /la firma no cuadra/,
  )
})

test('quien no tiene cuenta aquí NO se crea solo', async () => {
  // Que alguien de la operadora tenga cuenta en Microsoft no significa que GPS le
  // haya dado acceso a este contrato.
  const { estado, adonde } = await ida()
  const nonce = new URL(adonde).searchParams.get('nonce')!
  const r = await dentro((q) => volver(q, estado, 'c', PROV,
    async () => firmar(afirmacionesBuenas(nonce, {
      sub: 'otro-sujeto', email: 'nadie@operadora.test',
    })), verificar, VUELTA))
  assert.equal(r.entra === false && r.motivo, 'sin_cuenta')
})

test('quien está de baja no entra, aunque su empresa lo autentique', async () => {
  // Es el motivo entero por el que esto existe: la operadora lo da de baja y pierde
  // el acceso el mismo día, sin que nadie de GPS tenga que acordarse.
  const { estado, adonde } = await ida()
  const nonce = new URL(adonde).searchParams.get('nonce')!
  const r = await dentro((q) => volver(q, estado, 'c', PROV,
    async () => firmar(afirmacionesBuenas(nonce, {
      sub: 'sujeto-del-de-baja', email: 'baja-sso@operadora.test',
    })), verificar, VUELTA))
  assert.equal(r.entra === false && r.motivo, 'sin_cuenta')
})

test('la huella del sujeto se guarda la primera vez y manda a partir de entonces', async () => {
  const { estado, adonde } = await ida()
  const nonce = new URL(adonde).searchParams.get('nonce')!
  await dentro((q) => volver(q, estado, 'c', PROV,
    async () => firmar(afirmacionesBuenas(nonce)), verificar, VUELTA))

  const [p] = (await dentro((q) => q`
    select idp_sujeto from persona where id = ${ING}::uuid
  `)) as unknown as Array<{ idp_sujeto: string }>
  assert.notEqual(p!.idp_sujeto, '(pendiente-1)')

  // Y a partir de aquí manda el sujeto sobre el correo: un correo se puede cambiar
  // en el directorio de la empresa y seguir siendo la misma persona.
  const dos = await ida()
  const nonce2 = new URL(dos.adonde).searchParams.get('nonce')!
  const r = await dentro((q) => volver(q, dos.estado, 'c', PROV,
    async () => firmar(afirmacionesBuenas(nonce2, {
      email: 'ingeniera-nuevo-correo@operadora.test',
    })), verificar, VUELTA))
  assert.equal(r.entra, true)
  assert.equal(r.entra && r.personaId, ING)
})
