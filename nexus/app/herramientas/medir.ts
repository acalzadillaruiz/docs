/**
 * Medir cuánto tarda cada cosa con datos de verdad.
 *
 * Existe porque una opinión sobre rendimiento no vale nada. La primera medición
 * encontró que `/medidas` pesaba **613 KB** —una tabla de quinientas filas que
 * nadie iba a leer— y la segunda encontró que `brecha_evidencia` tardaba medio
 * segundo porque llamaba a dos funciones **una vez por renglón**.
 *
 * Siembra su propia organización, aparte de la de muestra: los números tienen que
 * salir del mismo sitio cada vez, y una organización compartida con la instantánea
 * cambia de tamaño cuando cambia la instantánea.
 *
 *   node --experimental-strip-types herramientas/medir.ts [contratos]
 *
 * NO es para producción: crea datos inventados con un identificador fijo.
 */

import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import { cifrarClave } from '../src/dominio/clave.ts'
import { resolver, type Peticion } from '../src/servidor/rutas.ts'
import { codigoEnPaso, desdeBase32, pasoDe } from '../src/dominio/totp.ts'
import { NOMBRE_COOKIE } from '../src/servidor/cookies.ts'

const ORG = 'd9e0f1a2-0000-0000-0000-00000000000a'
const CLI = 'd9e0f1a2-0000-0000-0000-00000000000b'
const YO = 'd9e0f1a2-0000-0000-0000-00000000000d'

const CORREO = 'medir@prueba.test'
const CLAVE = 'una clave razonable'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

/**
 * Siembra contratos con sus renglones y sus hitos.
 *
 * Los hitos importan: sin ellos `brecha_evidencia` recorre los renglones y no
 * devuelve ni una fila, y una medición sobre cero filas mide el recorrido pero no
 * el trabajo. Es el error de la medición anterior, y por eso se siembran aquí.
 */
export async function sembrarCarga(contratos: number): Promise<void> {
  await dentro(async (q) => {
    await q.unsafe(`
      set local role none;
      insert into organizacion (id, tipo, nombre, rif) values
        ('${ORG}','gps','GPS Medición','J-907700000-0'),
        ('${CLI}','operadora','Operadora Medición','J-907800000-0')
        on conflict (id) do nothing;`)
    // Con clave y segundo factor de verdad: sin poder entrar no se puede medir lo
    // que tarda una PANTALLA, que es lo que se quería medir.
    const hash = await cifrarClave(CLAVE)
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto)
            values (${YO}, ${ORG}, ${CORREO},'Medición','clave_2fa', ${hash}, ${SECRETO})
            on conflict (id) do update set clave_hash = excluded.clave_hash,
              totp_secreto = excluded.totp_secreto`
    await q.unsafe(`
      insert into tasa_bcv (vigente_el, ves_por_usd, fuente)
      select '2027-06-01'::date, 60.00,'carga_manual'
       where not exists (select 1 from tasa_bcv
                          where vigente_el = '2027-06-01' and sustituida_por is null);
      select instalar_plan_cuentas('${ORG}');`)

    const [hay] = (await q`
      select count(*)::int as n from contrato where organizacion_id = ${ORG}::uuid
    `) as unknown as Array<{ n: number }>
    if (Number(hay!.n) >= contratos) return

    await q.unsafe(`
      insert into contrato (organizacion_id, cliente_id, codigo, tipo, titulo_es, titulo_en,
                            estado, moneda, monto, tasa_id, creado_por)
      select '${ORG}'::uuid,'${CLI}'::uuid,'MED-'||lpad(i::text,5,'0'),
             (array['procura','servicio','reacondicionamiento','transporte','alquiler'])
               [1 + (i % 5)]::tipo_contrato,
             'Contrato de medición '||i,'Measurement contract '||i,
             'vigente','VES', 1000000 + i * 1000,
             (select id from tasa_bcv where vigente_el = '2027-06-01'
               and sustituida_por is null),'${YO}'::uuid
        from generate_series(1, ${contratos}) i
        on conflict (organizacion_id, codigo) do nothing;

      insert into renglon (contrato_id, numero, descripcion_es, descripcion_en,
                           cantidad, unidad, precio_unitario, costo_unitario)
      select c.id, n,'Renglón '||n,'Line '||n, 10,'und', 25000, 18000
        from contrato c cross join generate_series(1, 4) n
       where c.organizacion_id = '${ORG}'
        on conflict (contrato_id, numero) do nothing;

      -- Cinco hitos por renglón, con los cuatro estados repartidos. Así la brecha
      -- existe de verdad: hay declarado que no está verificado.
      insert into hito (renglon_id, orden, clave, nombre_es, nombre_en, peso, estado,
                        ocurrido_en, registrado_en)
      select r.id, h,'h'||h,'Hito '||h,'Milestone '||h, 20,
             (array['pendiente','declarado','evidenciado','verificado','verificado'])
               [h]::estado_hito,
             case when h = 1 then null else date '2027-06-01' + h end,
             case when h = 1 then null else (date '2027-06-01' + h + 3)::timestamptz end
        from renglon r
        join contrato c on c.id = r.contrato_id
       cross join generate_series(1, 5) h
       where c.organizacion_id = '${ORG}'
        on conflict (renglon_id, orden) do nothing;`)
  })
}

/** Lo que tarda una consulta, repetida, quedándose con la mediana. */
async function cuanto(nombre: string, sql: string, veces = 5): Promise<void> {
  const tiempos: number[] = []
  let filas = 0
  for (let i = 0; i < veces; i++) {
    const t0 = performance.now()
    const r = await dentro((q) => q.unsafe(sql))
    tiempos.push(performance.now() - t0)
    filas = (r as unknown as unknown[]).length
  }
  tiempos.sort((a, b) => a - b)
  const mediana = tiempos[Math.floor(tiempos.length / 2)]!
  console.log(
    nombre.padEnd(28),
    `${mediana.toFixed(0).padStart(6)} ms`,
    `${String(filas).padStart(5)} filas`,
  )
}

/** Entra como la persona de medición y devuelve su cookie. */
async function entrar(): Promise<string> {
  const origen = `o-medir-${Math.random().toString(36).slice(2)}`
  const p1 = await resolver({
    metodo: 'POST', ruta: '/entrar', cookie: null, idioma: 'es', origen,
    campos: { correo: CORREO, clave: CLAVE }, archivo: null,
  }, YO, false)
  const desafio = /name="desafio" value="([^"]+)"/.exec(p1.cuerpo!)![1]!
  const p2 = await resolver({
    metodo: 'POST', ruta: '/entrar/codigo', cookie: null, idioma: 'es', origen,
    campos: { desafio, codigo: codigoEnPaso(desdeBase32(SECRETO), pasoDe(new Date())) },
    archivo: null,
  }, YO, false)
  return new RegExp(`${NOMBRE_COOKIE}=([^;]+)`).exec(p2.cabeceras!['Set-Cookie']!)![1]!
}

/** Lo que tarda una PANTALLA entera, y lo que pesa. Es lo que ve la persona. */
async function pantalla(
  nombre: string, cookie: string, ruta: string, campos: Record<string, string> = {},
  veces = 3,
): Promise<void> {
  const tiempos: number[] = []
  let bytes = 0
  let codigo = 0
  for (let i = 0; i < veces; i++) {
    const t0 = performance.now()
    const r = await resolver({
      metodo: 'GET', ruta, cookie, idioma: 'es', campos, archivo: null,
      origen: `o-${Math.random().toString(36).slice(2)}`,
    } as Peticion, YO, false)
    tiempos.push(performance.now() - t0)
    bytes = (r.cuerpo ?? '').length
    codigo = r.codigo
  }
  tiempos.sort((a, b) => a - b)
  const mediana = tiempos[Math.floor(tiempos.length / 2)]!
  console.log(
    nombre.padEnd(22),
    `${mediana.toFixed(0).padStart(6)} ms`,
    `${(bytes / 1024).toFixed(0).padStart(6)} KB`,
    codigo === 200 ? '' : `· ${codigo}`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const contratos = Number(process.argv[2] ?? '500')
  conectar(process.env['NEXUS_BD']
    ?? { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' })
  console.log(`sembrando ${contratos} contratos · 4 renglones · 5 hitos cada uno…`)
  await sembrarCarga(contratos)

  const [n] = (await dentro((q) => q`
    select (select count(*) from contrato where organizacion_id = ${ORG}::uuid)::int as ctr,
           (select count(*) from renglon r join contrato c on c.id = r.contrato_id
             where c.organizacion_id = ${ORG}::uuid)::int as rg,
           (select count(*) from hito h join renglon r on r.id = h.renglon_id
              join contrato c on c.id = r.contrato_id
             where c.organizacion_id = ${ORG}::uuid)::int as hi
  `)) as unknown as Array<{ ctr: number; rg: number; hi: number }>
  console.log(`${n!.ctr} contratos · ${n!.rg} renglones · ${n!.hi} hitos\n`)

  await cuanto('brecha_evidencia', `select * from brecha_evidencia('${ORG}','2027-12-31')`)
  await cuanto('tiempo_hasta_la_verdad',
    `select * from tiempo_hasta_la_verdad('${ORG}','2027-01-01','2027-12-31')`)
  await cuanto('cobertura', `select * from cobertura('${ORG}')`)
  await cuanto('renglones_sin_hitos', `select * from renglones_sin_hitos('${ORG}')`)

  console.log('\nlas pantallas, enteras, como las ve una persona:')
  const cookie = await entrar()
  await pantalla('cartera', cookie, '/')
  await pantalla('medidas', cookie, '/medidas')
  await pantalla('gerencia', cookie, '/gerencia', { anio: '2027', mes: '6' })
  await pantalla('estados', cookie, '/estados', { al: '2027-06-30' })
  await pantalla('diario', cookie, '/diario', { anio: '2027', mes: '6' })
  await pantalla('libros', cookie, '/libros', { cual: 'ventas', anio: '2027', mes: '6' })
  await pantalla('pagar', cookie, '/pagar', { al: '2027-12-31' })
  await pantalla('caja', cookie, '/caja')
  await pantalla('activos', cookie, '/activos')
  await pantalla('periodos', cookie, '/periodos')

  await cerrar()
}
