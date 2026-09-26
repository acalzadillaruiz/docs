/**
 * Acceso a la base de datos.
 *
 * Regla central, y el motivo de que este archivo exista: **no se puede consultar
 * sin declarar quién pregunta**. El aislamiento entre empresas vive en políticas
 * de fila de PostgreSQL, y esas políticas leen `app.persona_id`. Si alguien abre
 * una conexión y se olvida de fijarlo, las políticas no devuelven nada — pero es
 * mejor que ni siquiera sea posible olvidarlo.
 *
 * Por eso aquí no se exporta el cliente de base de datos. Se exporta `comoPersona`,
 * que fija la persona, ejecuta lo que le pidas dentro de una transacción, y lo
 * suelta. No hay otra puerta.
 */

import postgres from 'postgres'

/** Quién está preguntando. Sale del token de sesión, nunca de la petición. */
export type Persona = { readonly id: string }

/**
 * Lo que recibe el código de dominio: puede consultar, pero ya viene atado a una
 * persona. No hay forma de pedirle que consulte "como otro".
 */
export type Consulta = postgres.TransactionSql<{}>

let sql: postgres.Sql<{}> | null = null

/**
 * `destino` puede ser una URL (`postgres://…`) o los datos sueltos. Lo segundo hace
 * falta para conectar por socket de Unix, que es como se habla con una base de datos
 * que corre en la misma máquina: ahí no hay anfitrión ni puerto que poner en una URL.
 */
export type Destino = string | { host: string; port: number; database: string; username: string }

export function conectar(destino: Destino): void {
  sql?.end({ timeout: 5 })
  const opciones = {
    // El rol decide qué columnas se pueden leer. Nunca se conecta como propietario
    // de las tablas: el propietario se salta las políticas de fila.
    max: 10,
    idle_timeout: 20,
    onnotice: () => {},
  } as const
  sql = typeof destino === 'string'
    ? postgres(destino, opciones)
    : postgres({ ...destino, ...opciones })
}

export async function cerrar(): Promise<void> {
  await sql?.end({ timeout: 5 })
  sql = null
}

/**
 * Ejecuta `trabajo` con la conexión desnuda: sin rol y sin persona.
 *
 * Existe para UNA cosa: cargar el esquema en un servidor. Las políticas de fila y los
 * roles son precisamente lo que ese trabajo crea, así que no puede correr debajo de
 * ellos.
 *
 * Nada más debería usarla. Todo lo que atiende una petición pasa por `comoPersona`,
 * que es lo que hace que la base devuelva lo que a cada uno le toca y nada más; una
 * consulta que se salte eso se salta el aislamiento entre operadoras.
 */
export async function comoDueno<T>(trabajo: (q: Consulta) => Promise<T>): Promise<T> {
  if (!sql) throw new SinConexion()
  // Dentro de una transacción, igual que `comoPersona`: si la carga de un archivo de
  // esquema falla a la mitad, no deja medio esquema puesto. En PostgreSQL el DDL
  // también se deshace, y eso es justo lo que hace seguro desplegar.
  return sql.begin(async (q) => trabajo(q as Consulta)) as Promise<T>
}

export class SinConexion extends Error {
  constructor() {
    super('No hay conexión a la base de datos. Llama a conectar() primero.')
  }
}

/**
 * Ejecuta `trabajo` como `persona`, dentro de una transacción.
 *
 * `set_config(..., true)` lo hace local a la transacción: al terminar se suelta
 * solo, aunque el trabajo lance una excepción. Una conexión devuelta al pozo
 * nunca se lleva puesta la identidad de la petición anterior.
 */
export async function comoPersona<T>(
  persona: Persona,
  rol: 'nexus_interno' | 'nexus_cliente',
  trabajo: (q: Consulta) => Promise<T>,
): Promise<T> {
  if (!sql) throw new SinConexion()
  return sql.begin(async (q) => {
    await q.unsafe(`set local role ${rol}`)
    await q`select set_config('app.persona_id', ${persona.id}, true)`
    return trabajo(q as Consulta)
  }) as Promise<T>
}
