/**
 * El mantenimiento periódico, y el barrido que impide que vuelva a pasar.
 *
 * `caducar_sesiones()` y `limpiar_peticiones_sso()` estaban escritas, probadas y
 * comentadas con «se llama desde una tarea periódica». **No había ninguna tarea
 * periódica que las llamara.** No rompían nada, y por eso llevaban meses ahí: tres
 * tablas creciendo para siempre en un sistema pensado para correr años.
 *
 * Así que aquí hay dos cosas. Las pruebas de que limpian lo que tienen que limpiar y
 * **no lo que no**, y un barrido que lee el esquema y exige que toda función de
 * limpieza que exista esté llamada desde algún sitio. Una función de mantenimiento
 * que nadie llama es peor que no tenerla: da por resuelto lo que no lo está.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { conectar, cerrar, comoPersona } from '../src/db/conexion.ts'
import {
  limpiar, tocaLimpiar, CADA_CUANTO, DIAS_INTENTOS, DIAS_SSO,
} from '../src/dominio/mantenimiento.ts'

const DESTINO = { host: '/var/tmp', port: 55432, database: 'nexus', username: 'nexus' }
const G = 'cc000000-0000-0000-0000-0000000000a1'
const YO = 'cc000000-0000-0000-0000-0000000000a2'
const SECRETO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

/**
 * Las que la aplicación no llama, y está bien que no las llame.
 *
 * Corta a propósito: cada línea hay que justificarla, porque el sitio natural de una
 * función que no llama nadie es la papelera o una pantalla nueva. Las dos peores
 * averías del proyecto estaban aquí sin estar declaradas.
 */
const CON_PERMISO = new Set([
  // La usa la propia base de datos desde un disparador, no la aplicación.
  'liberar_hitos_de_valuacion_anulada', 'persona_desactivada', 'proteger_asiento',
  'verificar_cuadre', 'capacidad_solo_interna', 'objecion_la_hace_el_cliente',
  'valuacion_no_factura_con_objecion', 'hito_exige_su_evidencia', 'avisar_objecion',
  'avisar_objecion_respondida', 'avisar_valuacion',
  // La aplicación enseña la muestra de cada columna calculada en TypeScript, así que
  // esta previsualización en SQL quedó sin uso. Se deja porque es la comprobación
  // que usa la prueba del esquema, y borrarla dejaría esa prueba sin nada que mirar.
  'previsualizar',
])

const dentro = <T>(f: Parameters<typeof comoPersona<T>>[2]) =>
  comoPersona<T>({ id: YO }, 'nexus_interno', f)

before(async () => {
  conectar(DESTINO)
  await dentro(async (q) => {
    await q.unsafe('set local role none')
    await q`insert into organizacion (id, tipo, nombre, rif)
            values (${G},'gps','GPS Mantenimiento','J-906300000-0')
            on conflict (id) do update set nombre = excluded.nombre`
    await q`insert into persona (id, organizacion_id, correo, nombre, metodo,
                                 clave_hash, totp_secreto)
            values (${YO}, ${G},'mant@prueba.test','Interno','clave_2fa',
                    'x', ${SECRETO})
            on conflict (id) do update set activa = true`
    // La mesa limpia al empezar, no al terminar: una prueba que se muere a mitad no
    // llega nunca a su limpieza del final y la siguiente se encuentra lo de ayer.
    await q`delete from sesion where origen like 'mant-%'`
    await q`delete from peticion_sso where origen like 'mant-%'`
    await q`delete from intento_acceso where correo like 'mant-%@prueba.test'`
  })
})
after(async () => { await cerrar() })

test('cierra la sesión vencida, y NO toca la que sigue viva', async () => {
  await dentro((q) => q`
    insert into sesion (persona_id, huella, origen, expira_en) values
      (${YO},'mant-h-vieja','mant-v', now() - interval '1 hour'),
      (${YO},'mant-h-viva','mant-w', now() + interval '8 hours')`)
  const r = await dentro((q) => limpiar(q))
  assert.ok(r.sesiones >= 1, 'no cerró la sesión vencida')

  const [v] = (await dentro((q) => q`
    select cerrada_en, motivo_cierre from sesion where huella = 'mant-h-vieja'
  `)) as unknown as Array<{ cerrada_en: Date | null; motivo_cierre: string }>
  assert.notEqual(v!.cerrada_en, null)
  assert.equal(v!.motivo_cierre, 'caducada')

  const [w] = (await dentro((q) => q`
    select cerrada_en from sesion where huella = 'mant-h-viva'
  `)) as unknown as Array<{ cerrada_en: Date | null }>
  assert.equal(w!.cerrada_en, null, 'cerró de más: echó a alguien que estaba dentro')
})

test('borra la petición de SSO olvidada, y NO la de hace un minuto', async () => {
  await dentro((q) => q`
    insert into peticion_sso (estado, nonce, metodo, organizacion_id, origen, creada_en)
    values ('mant-vieja','n1','microsoft', ${G},'mant-v', now() - interval '9 days'),
           ('mant-nueva','n2','microsoft', ${G},'mant-w', now() - interval '1 minute')`)
  await dentro((q) => limpiar(q))
  const [n] = (await dentro((q) => q`
    select count(*) filter (where estado = 'mant-vieja')::int as vieja,
           count(*) filter (where estado = 'mant-nueva')::int as nueva
      from peticion_sso
  `)) as unknown as Array<{ vieja: number; nueva: number }>
  assert.equal(n!.vieja, 0, 'la petición olvidada se quedó ahí')
  assert.equal(n!.nueva, 1, 'se llevó por delante una petición en curso')
})

test('tira los intentos viejos, y deja INTACTA la hora que mira el freno', async () => {
  // Es la prueba que importa de las tres: si la limpieza se llevara la última hora,
  // el freno contra probar claves a ciegas dejaría de frenar sin que nadie lo note.
  await dentro((q) => q`
    insert into intento_acceso (correo, origen, exito, fase, ocurrido_en) values
      ('mant-viejo@prueba.test','mant-v', false,'clave', now() - interval '90 days'),
      ('mant-hoy@prueba.test','mant-w', false,'clave', now() - interval '5 minutes')`)
  const r = await dentro((q) => limpiar(q))
  assert.ok(r.intentos >= 1)
  const [n] = (await dentro((q) => q`
    select count(*) filter (where correo = 'mant-viejo@prueba.test')::int as viejo,
           count(*) filter (where correo = 'mant-hoy@prueba.test')::int as hoy
      from intento_acceso
  `)) as unknown as Array<{ viejo: number; hoy: number }>
  assert.equal(n!.viejo, 0, 'sigue guardando correos de hace tres meses')
  assert.equal(n!.hoy, 1, 'se llevó lo que el freno necesita para frenar')
})

test('una segunda pasada no vuelve a contar lo mismo', async () => {
  // Una limpieza que dice «cerré cuatro sesiones» cada hora sin haber cerrado
  // ninguna hace que el registro deje de significar algo.
  await dentro((q) => limpiar(q))
  const r = await dentro((q) => limpiar(q))
  assert.equal(r.sesiones, 0)
  assert.equal(r.peticiones, 0)
  assert.equal(r.intentos, 0)
})

test('los plazos son los que dicen ser', async () => {
  assert.equal(DIAS_SSO, 2)
  assert.equal(DIAS_INTENTOS, 30)
  // Y el de intentos es holgadamente mayor que la hora del freno: si algún día
  // alguien lo bajara a cero, el freno se quedaría sin con qué frenar.
  assert.ok(DIAS_INTENTOS * 24 > 1)
})

test('se limpia una vez por hora: ni cada vuelta, ni nunca', () => {
  assert.equal(tocaLimpiar(null, 1_000_000), true, 'la primera vuelta no limpió')
  assert.equal(tocaLimpiar(1_000_000, 1_000_000 + CADA_CUANTO - 1), false,
    'limpia en cada vuelta: trabajo constante contra la base de datos a cambio de nada')
  assert.equal(tocaLimpiar(1_000_000, 1_000_000 + CADA_CUANTO), true)
})

test('NINGUNA función de limpieza del esquema se queda sin quien la llame', async () => {
  // El barrido que habría encontrado esto solo. Lee el esquema, saca las funciones
  // que limpian o caducan algo, y exige que cada una esté nombrada desde el código
  // que se ejecuta —no desde otra prueba, que es donde estaban las dos huérfanas.
  const dir = new URL('../../db/schema/', import.meta.url)
  const archivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const funciones = new Set<string>()
  for (const f of archivos) {
    const texto = await readFile(new URL(f, dir), 'utf8')
    for (const m of texto.matchAll(
      /create or replace function ((?:limpiar|caducar|purgar)_[a-z_]+)\s*\(/g)) {
      funciones.add(m[1]!)
    }
  }
  assert.ok(funciones.size >= 3,
    `solo se leyeron ${funciones.size} funciones de limpieza del esquema`)

  // Dónde se puede llamar a una: el código de la aplicación y las herramientas.
  //
  // Se quitan los comentarios antes de contar, y no es un detalle: la primera
  // versión de este barrido daba por llamada a `caducar_sesiones` porque el
  // comentario de cabecera de este mismo archivo la nombraba. Un barrido que se
  // conforma con que alguien la mencione es exactamente el barrido que no habría
  // encontrado el fallo que viene a impedir.
  const fuentes: string[] = []
  const recoger = async (base: URL) => {
    for (const e of await readdir(base, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), base)
      if (e.isDirectory()) await recoger(u)
      else if (e.name.endsWith('.ts')) fuentes.push(sinComentarios(await readFile(u, 'utf8')))
    }
  }
  await recoger(new URL('../src/', import.meta.url))
  await recoger(new URL('../herramientas/', import.meta.url))
  // Y el propio esquema: una función puede llamar a otra, como hace mantenimiento().
  for (const f of archivos) fuentes.push(sinComentarios(await readFile(new URL(f, dir), 'utf8')))

  const huerfanas = [...funciones].filter((fn) => {
    // Se cuentan las APARICIONES, no los archivos: una función puede definirse y
    // llamarse en el mismo archivo, como `limpiar_intentos_acceso` dentro de
    // `mantenimiento()`, y contar archivos la daba por huérfana estando llamada.
    const usos = fuentes.reduce((n, t) => n + t.split(fn).length - 1, 0)
    // Una sola aparición es su propia definición: nadie más la nombra.
    return usos <= 1
  })
  assert.deepEqual(huerfanas, [],
    'funciones de limpieza que no llama nadie —la máquina montada y sin puerta—: ' +
    huerfanas.join(', '))
})

test('NINGUNA función del esquema se queda sin que nadie la llame', async () => {
  // El barrido de arriba mira solo las de limpieza. Éste mira TODAS, y es el que
  // encontró las dos peores del proyecto:
  //
  //   * `gastar_codigo()` — se entregaban diez códigos de recuperación y no había
  //     forma de usar uno. Quien perdía el teléfono se quedaba fuera para siempre.
  //   * `asentar_valuacion()` — se emitía la factura y el ingreso no entraba al
  //     libro. La llamaban solo las pruebas, en su propio fixture.
  //
  // Una función del esquema que no llama nadie es, casi siempre, una pantalla que
  // falta. Lo que NO vale como llamada es una prueba: ahí estaban las dos.
  const dir = new URL('../../db/schema/', import.meta.url)
  const archivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

  const sinComentarios = (t: string) => t
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/(--|\/\/).*$/, '')).join('\n')

  const esquema: string[] = []
  const definidas = new Map<string, string>()
  for (const f of archivos) {
    const limpio = sinComentarios(await readFile(new URL(f, dir), 'utf8'))
    esquema.push(limpio)
    for (const m of limpio.matchAll(/create or replace function ([a-z_0-9]+)\s*\(/g)) {
      if (!definidas.has(m[1]!)) definidas.set(m[1]!, f)
    }
  }
  assert.ok(definidas.size >= 100,
    `solo se leyeron ${definidas.size} funciones del esquema: el barrido no barrió`)

  const app: string[] = []
  const recogerApp = async (base: URL, saltar: readonly string[] = []) => {
    for (const e of await readdir(base, { withFileTypes: true })) {
      if (saltar.includes(e.name)) continue
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), base)
      if (e.isDirectory()) await recogerApp(u, saltar)
      else if (e.name.endsWith('.ts')) app.push(sinComentarios(await readFile(u, 'utf8')))
    }
  }
  await recogerApp(new URL('../src/', import.meta.url))
  await recogerApp(new URL('../herramientas/', import.meta.url))

  const cuenta = (textos: string[], fn: string) =>
    textos.reduce((n, t) => n + t.split(fn).length - 1, 0)

  const huerfanas = [...definidas.entries()]
    .filter(([fn]) => !CON_PERMISO.has(fn))
    // Una sola aparición en el esquema es su propia definición, y cero en la
    // aplicación es que nadie la llama desde el código que se ejecuta.
    .filter(([fn]) => cuenta(app, fn) === 0 && cuenta(esquema, fn) <= 1)
    .map(([fn, arch]) => `${fn} (${arch})`)

  assert.deepEqual(huerfanas, [],
    'funciones del esquema que no llama nadie —casi siempre, una pantalla que falta—:\n  ' +
    huerfanas.join('\n  '))
})

/**
 * Tablas que la aplicación no escribe a propósito, y por qué.
 *
 * Una tabla que nadie escribe es, casi siempre, **una función que no existe**. Así se
 * encontró que no había forma de dar de alta un equipo, con `/activos` entera mirando
 * por una ventana a una tabla vacía para siempre.
 *
 * Las que quedan aquí son las que siguen sin puerta, y están escritas con nombre y
 * apellido en vez de calladas, porque cada una es una pantalla pendiente:
 */
/**
 * Lo que NO es la aplicación, aunque viva en `herramientas/`.
 *
 * Este barrido leía `herramientas/` entero como si fuera la aplicación, y ahí está el
 * sembrador de la empresa de muestra. Resultado: cuatro tablas —`tasa_bcv`,
 * `alicuota_iva`, `unidad_tributaria` y `concepto_islr`— pasaban el barrido porque las
 * escribía el SEMBRADOR, y en uso real nadie podía tocarlas. El barrido que existe para
 * encontrar pantallas que faltan lo estaba contentando un fixture, que es exactamente lo
 * que este barrido existe para no dejar pasar.
 *
 * `migrar.ts` e `instalar.ts` sí cuentan: son parte del despliegue y lo que escriben lo
 * escribe el sistema de verdad.
 */
/**
 * El texto sin comentarios. Hace falta en los dos barridos que buscan nombres: contar el
 * nombre de una función dentro de un comentario hizo que el barrido de funciones sin llamar
 * pasara con la llamada quitada.
 */
const sinComentarios = (t: string) => t
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map((l) => l.replace(/(--|\/\/).*$/, '')).join('\n')

const NO_ES_LA_APP = [
  'sembrar.ts',   // la empresa de muestra: datos inventados, no un camino de uso
  'medir.ts',     // el banco de pruebas de rendimiento
  'exportar.ts',  // el recorrido navegable; siembra para tener qué exportar
] as const

const NO_ESCRIBE_LA_APP = new Map<string, string>([
  // El modelo de capacidades por persona está escrito y no se usa: hoy el alcance lo
  // decide ser de GPS o ser cliente. No se borra porque es la base de los permisos
  // finos, pero mientras nada lo escriba ni lo lea, es decoración.
  ['capacidad', 'modelo de permisos finos sin usar: hoy el alcance es interno/cliente'],
  ['persona_capacidad', 'igual: ni se escribe ni se lee'],
])

test('las tablas que la aplicación no escribe están DICHAS, no calladas', async () => {
  // Es el barrido que encontró que no se podía dar de alta un equipo. No exige que
  // todas las tablas se escriban —hay tablas de referencia—: exige que las que no se
  // escriben estén nombradas arriba con el motivo. Una tabla vacía en silencio es un
  // módulo que no funciona y nadie se ha enterado.
  const dir = new URL('../../db/schema/', import.meta.url)
  const archivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

  const sinComentarios = (t: string) => t
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/(--|\/\/).*$/, '')).join('\n')

  const tablas = new Map<string, string>()
  // Y las funciones del esquema, con su cuerpo: una tabla puede escribirse solo desde
  // dentro de la base de datos, y entonces la aplicación la escribe llamando a esa
  // función sin nombrar la tabla nunca. `intento_acceso` es así: la escribe
  // `anotar_intento()`, y sin esto el barrido la daba por muda estando bien.
  const funciones = new Map<string, string>()
  for (const f of archivos) {
    const limpio = sinComentarios(await readFile(new URL(f, dir), 'utf8'))
    for (const m of limpio.matchAll(/create table (?:if not exists )?([a-z_0-9]+)/g)) {
      if (!tablas.has(m[1]!)) tablas.set(m[1]!, f)
    }
    // El cuerpo de cada función: desde su cabecera hasta el `$$;` que la cierra.
    for (const m of limpio.matchAll(
      /create or replace function ([a-z_0-9]+)\s*\([\s\S]*?\$\$;/g)) {
      funciones.set(m[1]!, m[0])
    }
  }
  assert.ok(tablas.size >= 40, `solo se leyeron ${tablas.size} tablas: el barrido no barrió`)

  const app: string[] = []
  const recogerApp = async (base: URL, saltar: readonly string[] = []) => {
    for (const e of await readdir(base, { withFileTypes: true })) {
      if (saltar.includes(e.name)) continue
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), base)
      if (e.isDirectory()) await recogerApp(u, saltar)
      else if (e.name.endsWith('.ts')) app.push(sinComentarios(await readFile(u, 'utf8')))
    }
  }
  await recogerApp(new URL('../src/', import.meta.url))
  await recogerApp(new URL('../herramientas/', import.meta.url), NO_ES_LA_APP)
  const texto = app.join('\n')

  const mudas: string[] = []
  for (const [tabla, archivo] of tablas) {
    // Lo que cuenta es que la APLICACIÓN la escriba, directamente o llamando a una
    // función que lo haga. Lo segundo no se puede ver desde aquí, así que basta con
    // que el nombre aparezca en un insert, update o delete del código.
    const escribe = new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+${tabla}\\b`, 'i')
    if (escribe.test(texto)) continue
    // O que una función del esquema que la aplicación llama la escriba por ella.
    if (NO_ESCRIBE_LA_APP.has(tabla)) continue
    // O que la escriba una función del esquema a la que la aplicación sí llama.
    const porFuncion = [...funciones.entries()].some(([nombre, cuerpo]) =>
      escribe.test(cuerpo) && new RegExp(`\\b${nombre}\\s*\\(`).test(texto))
    if (porFuncion) continue
    mudas.push(`${tabla} (${archivo})`)
  }
  assert.deepEqual(mudas, [],
    'tablas que la aplicación no escribe ni nombra, y no están declaradas ' +
    '—casi siempre, una pantalla que falta—:\n  ' + mudas.join('\n  '))
})

test('y las declaradas siguen sin escribirse: la lista solo puede encoger', async () => {
  // Si una ya tiene su pantalla, sale de la lista. Si no, la lista miente y vuelve a
  // dar por resuelto lo que no lo está — que es de lo que va todo este archivo.
  const app: string[] = []
  const recogerApp = async (base: URL) => {
    for (const e of await readdir(base, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), base)
      if (e.isDirectory()) await recogerApp(u)
      else if (e.name.endsWith('.ts')) app.push(await readFile(u, 'utf8'))
    }
  }
  await recogerApp(new URL('../src/', import.meta.url))
  const texto = app.join('\n')
  const yaTienen = [...NO_ESCRIBE_LA_APP.keys()].filter((t) =>
    new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+${t}\\b`, 'i').test(texto))
  assert.deepEqual(yaTienen, [],
    `ya se escriben desde la aplicación: quítalas de NO_ESCRIBE_LA_APP: ${yaTienen.join(', ')}`)
})

test('y el bucle que corre siempre es quien las llama', async () => {
  // Que existan llamadas no basta: tienen que estar en lo que se queda corriendo.
  // Antes estaban llamadas desde las pruebas del esquema y desde ningún sitio más.
  const avisar = await readFile(new URL('../herramientas/avisar.ts', import.meta.url), 'utf8')
  assert.match(avisar, /from '\.\.\/src\/dominio\/mantenimiento\.ts'/,
    'el único proceso que corre siempre no sabe nada del mantenimiento')
  assert.match(avisar, /await limpiar\(q\)/)
  assert.match(avisar, /tocaLimpiar\(/,
    'limpia en cada vuelta en vez de una vez por hora')
})

/**
 * Las columnas que nadie nombra: el barrido que destapó que un contrato no podía terminar.
 *
 * Los otros tres barridos miran funciones, términos del diccionario y tablas. Faltaba el
 * grano más fino, y es donde estaba escondido lo más grave que ha aparecido:
 * `contrato.fin_real` no la escribía nadie, y tirando de ese hilo salió que
 * `estado_contrato` declara CINCO estados y la aplicación sabía llegar a dos. Un contrato
 * terminado se quedaba vigente para siempre.
 *
 * Se pregunta a la base de datos qué columnas existen, y luego se busca cada nombre en el
 * código y en el resto del esquema. Se excluye a propósito la propia declaración de la
 * tabla: nombrar una columna al crearla no es usarla, y sin quitarla el barrido no
 * encontraría nada nunca.
 */
const COLUMNAS_SIN_USO = new Map<string, string>([
  // El modelo de permisos finos sin usar, igual que sus dos tablas.
  ['capacidad.modulo', 'el modelo de capacidades no se usa (decisión 5)'],
  ['persona_capacidad.concedida_en', 'el modelo de capacidades no se usa (decisión 5)'],
  ['persona_capacidad.concedida_por', 'igual'],
  // Se escribe por defecto y no se lee. Es el dato con el que se sabría cuánto lleva
  // abierta una sesión; hoy «último acceso» sale de `persona.ultimo_acceso`.
  ['sesion.iniciada_en', 'se escribe por defecto y no la lee nadie todavía'],
])

test('las columnas que nadie nombra están DICHAS, no calladas', async () => {
  const columnas = (await dentro((q) => q`
    select table_name || '.' || column_name as col
      from information_schema.columns
     where table_schema = 'public'
     order by table_name, ordinal_position
  `)) as unknown as Array<{ col: string }>

  // Si el barrido deja de leer columnas, tiene que fallar en vez de pasar en vano. Esto
  // ya salvó al barrido de tablas una vez, y a este le hizo falta el primer día: lanzado
  // desde otro directorio, los comodines no encontraban nada y daba las 470 por huérfanas.
  assert.ok(columnas.length > 400,
    `solo se leyeron ${columnas.length} columnas: el barrido no barrió`)

  const dir = new URL('../../db/schema/', import.meta.url)
  const sqls = await Promise.all(
    (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
      .map(async (f) => sinComentarios(await readFile(new URL(f, dir), 'utf8'))))

  const fuentes: string[] = []
  const recoger = async (base: URL, saltar: readonly string[] = []) => {
    for (const e of await readdir(base, { withFileTypes: true })) {
      if (saltar.includes(e.name)) continue
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), base)
      if (e.isDirectory()) await recoger(u, saltar)
      else if (e.name.endsWith('.ts')) fuentes.push(await readFile(u, 'utf8'))
    }
  }
  await recoger(new URL('../src/', import.meta.url))
  await recoger(new URL('../herramientas/', import.meta.url), NO_ES_LA_APP)
  assert.ok(fuentes.length > 40, `solo se leyeron ${fuentes.length} archivos de código`)
  const codigo = fuentes.join('\n')

  const mudas: string[] = []
  for (const { col } of columnas) {
    const [tabla, nombre] = col.split('.') as [string, string]
    if (COLUMNAS_SIN_USO.has(col)) continue
    const palabra = new RegExp(`\\b${nombre}\\b`)
    if (palabra.test(codigo)) continue
    // En el esquema, sin el CREATE TABLE de su propia tabla: declararla no es usarla.
    const sinDeclarar = new RegExp(
      `create table (?:if not exists )?${tabla}\\s*\\([^;]*?\\);`, 'is')
    if (sqls.some((t) => palabra.test(t.replace(sinDeclarar, ' ')))) continue
    mudas.push(col)
  }

  assert.deepEqual(mudas, [],
    'columnas que ni la aplicación ni el esquema nombran, y no están declaradas ' +
    'arriba con su motivo:\n  ' + mudas.join('\n  '))
})

test('y la lista de columnas sin uso solo puede encoger', async () => {
  // El mismo freno que el de las tablas: una columna declarada aquí que ya se usa tiene
  // que salir de la lista, o la lista se convierte en un cajón donde todo cabe.
  const columnas = (await dentro((q) => q`
    select table_name || '.' || column_name as col
      from information_schema.columns where table_schema = 'public'
  `)) as unknown as Array<{ col: string }>
  const existen = new Set(columnas.map((c) => c.col))

  const fuentes: string[] = []
  const recoger = async (base: URL, saltar: readonly string[] = []) => {
    for (const e of await readdir(base, { withFileTypes: true })) {
      if (saltar.includes(e.name)) continue
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), base)
      if (e.isDirectory()) await recoger(u, saltar)
      else if (e.name.endsWith('.ts')) fuentes.push(await readFile(u, 'utf8'))
    }
  }
  await recoger(new URL('../src/', import.meta.url))
  const codigo = fuentes.join('\n')

  const sobran: string[] = []
  for (const [col, motivo] of COLUMNAS_SIN_USO) {
    if (!existen.has(col)) { sobran.push(`${col} ya no existe (${motivo})`); continue }
    const nombre = col.split('.')[1]!
    if (new RegExp(`\\b${nombre}\\b`).test(codigo)) {
      sobran.push(`${col} ya la usa la aplicación (${motivo})`)
    }
  }
  assert.deepEqual(sobran, [],
    'entradas que ya no hacen falta en COLUMNAS_SIN_USO:\n  ' + sobran.join('\n  '))
})

/**
 * Valores de enum que nadie escribe: el barrido del nivel que faltaba.
 *
 * Es la misma forma del agujero más grande de esta semana. `estado_contrato` declaraba
 * cinco estados y la aplicación sabía llegar a dos, así que un contrato terminado se
 * quedaba vigente para siempre. Un valor de enum que nadie escribe es una posibilidad que
 * el esquema promete y el producto no tiene.
 *
 * Se busca el valor como literal entrecomillado, que es como se escribe de verdad, y se
 * quita la declaración del propio tipo: nombrarlo al crear el enum no es usarlo.
 */
const ENUMS_SIN_USO = new Map<string, string>([
  // Un periodo va de abierto a cerrado y ya. El estado de en medio serviría para congelar
  // las operaciones mientras se hacen los asientos de ajuste, y eso es una decisión sobre
  // el proceso de cierre —quién puede asentar durante él— no un arreglo de programación.
  ['estado_periodo.en_cierre', 'el cierre va de abierto a cerrado; el paso intermedio es una decisión de proceso'],
])

test('los valores de enum que nadie escribe están DICHOS, no callados', async () => {
  const valores = (await dentro((q) => q`
    select t.typname || '.' || e.enumlabel as v
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
     order by t.typname, e.enumsortorder
  `)) as unknown as Array<{ v: string }>

  // Si el barrido deja de mirar, tiene que fallar. La primera vez que lo lancé contestó
  // «0 valores de enum» tan contento: la base de datos se había caído, y un barrido que no
  // encuentra nada porque no puede mirar se parece mucho a uno que no encuentra nada.
  assert.ok(valores.length > 60,
    `solo se leyeron ${valores.length} valores de enum: el barrido no barrió`)

  const dir = new URL('../../db/schema/', import.meta.url)
  const sqls = await Promise.all(
    (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
      .map(async (f) => sinComentarios(await readFile(new URL(f, dir), 'utf8'))))

  const fuentes: string[] = []
  const recoger = async (base: URL, saltar: readonly string[] = []) => {
    for (const e of await readdir(base, { withFileTypes: true })) {
      if (saltar.includes(e.name)) continue
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), base)
      if (e.isDirectory()) await recoger(u, saltar)
      else if (e.name.endsWith('.ts')) fuentes.push(sinComentarios(await readFile(u, 'utf8')))
    }
  }
  await recoger(new URL('../src/', import.meta.url))
  await recoger(new URL('../herramientas/', import.meta.url), NO_ES_LA_APP)
  assert.ok(fuentes.length > 40, `solo se leyeron ${fuentes.length} archivos de código`)
  const codigo = fuentes.join('\n')

  const inalcanzables: string[] = []
  for (const { v } of valores) {
    if (ENUMS_SIN_USO.has(v)) continue
    const [tipo, etiqueta] = v.split('.') as [string, string]
    const literal = new RegExp(`['"]${etiqueta}['"]`)
    if (literal.test(codigo)) continue
    const sinDeclarar = new RegExp(`create type ${tipo}\\s+as enum\\s*\\([^)]*\\)`, 'is')
    if (sqls.some((t) => literal.test(t.replace(sinDeclarar, ' ')))) continue
    inalcanzables.push(v)
  }

  assert.deepEqual(inalcanzables, [],
    'valores de enum que la aplicación nunca escribe, y no están declarados arriba con su ' +
    'motivo. Cada uno es una posibilidad que el esquema promete y el producto no tiene:\n  ' +
    inalcanzables.join('\n  '))
})
