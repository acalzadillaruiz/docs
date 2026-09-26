/**
 * La bandeja de lo que espera a GPS.
 *
 * Es la otra mitad del círculo. Sin esto, el cliente objeta una valuación y nadie de
 * GPS se entera hasta que a alguien se le ocurre entrar a mirar — que es exactamente
 * el agujero que hace que un portal de cliente acabe sin usarse: el cliente escribe
 * y no pasa nada.
 *
 * Se ordena por lo que lleva más tiempo esperando, no por fecha de contrato ni por
 * importe. Lo que lleva veinte días parado es más urgente que lo que llegó ayer,
 * aunque sea de menos dinero, porque el daño de dejar a un cliente sin respuesta no
 * es proporcional al importe.
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, t, type Idioma } from '../i18n/t.ts'

/** Lo que espera a GPS. */
export type ClaseGps = 'objecion' | 'sin_presentar' | 'por_cobrar'

/** Y lo que espera al cliente, que es la otra mitad del mismo círculo. */
export type ClaseCliente = 'esperando_firma' | 'objecion_contestada' | 'esperando_gps'

export type Pendiente = {
  readonly clase: ClaseGps | ClaseCliente
  readonly valuacionId: string
  readonly contratoId: string
  readonly contrato: string
  readonly cliente: string
  readonly titulo: string
  readonly detalle: string
  readonly dias: number
  readonly importe: string
  /**
   * La tercera línea de la tarjeta. En la bandeja de GPS es el nombre del cliente,
   * porque lo que distingue una fila de otra es de quién es. En la del cliente sería su
   * propio nombre en las tres filas, o sea ruido: ahí va el título del contrato.
   */
  readonly contexto?: string
}

type Fila = {
  clase: ClaseGps | ClaseCliente
  valuacion_id: string
  contrato_id: string
  contrato: string
  cliente: string
  detalle: string | null
  dias: number
  importe: string
  moneda: 'VES' | 'USD'
}

const TITULO: Record<string, { es: string; en: string }> = {
  objecion: { es: 'Objeción sin responder', en: 'Unanswered dispute' },
  sin_presentar: { es: 'Valuación sin presentar', en: 'Progress payment not submitted' },
  por_cobrar: { es: 'Aprobada y sin cobrar', en: 'Approved and unpaid' },
  esperando_firma: { es: 'Esperando tu firma', en: 'Waiting for your signature' },
  objecion_contestada: {
    es: 'GPS contestó tu objeción', en: 'GPS answered your dispute',
  },
  esperando_gps: { es: 'Esperando a GPS', en: 'Waiting for GPS' },
}

/**
 * Lo que espera a GPS, ordenado por antigüedad.
 *
 * No lleva ninguna rama para el cliente: esta consulta solo la puede hacer alguien de
 * dentro, porque toca valuaciones en estado borrador, que las políticas de fila no
 * devuelven a un cliente. Si un cliente la llamara, recibiría una lista vacía.
 */
export async function bandeja(q: Consulta, idioma: Idioma): Promise<readonly Pendiente[]> {
  const filas = (await q`
    -- Objeciones que el cliente escribió y nadie ha contestado.
    select 'objecion' as clase, v.id as valuacion_id, ct.id as contrato_id,
           ct.codigo as contrato, o.nombre as cliente,
           left(ob.motivo, 160) as detalle,
           (current_date - ob.objetada_en::date) as dias,
           v.obra::text as importe, v.moneda
      from objecion ob
      join valuacion v on v.id = ob.valuacion_id
      join contrato ct on ct.id = v.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where ob.respondida_en is null

    union all

    -- Valuaciones que se quedaron en borrador: obra hecha que ni siquiera se ha
    -- puesto delante del cliente. Es dinero parado por descuido, no por discusión.
    select 'sin_presentar', v.id, ct.id, ct.codigo, o.nombre,
           null,
           (current_date - v.periodo_hasta),
           v.obra::text, v.moneda
      from valuacion v
      join contrato ct on ct.id = v.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where v.estado = 'borrador' and v.periodo_hasta < current_date

    union all

    -- Aprobadas hace tiempo y todavía sin cobrar.
    select 'por_cobrar', v.id, ct.id, ct.codigo, o.nombre,
           null,
           (current_date - v.aprobada_el),
           v.obra::text, v.moneda
      from valuacion v
      join contrato ct on ct.id = v.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where v.estado in ('aprobada','facturada')
       and v.aprobada_el is not null
       and (current_date - v.aprobada_el) >= 30

     order by 7 desc
  `) as unknown as Fila[]

  return filas.map((f): Pendiente => ({
    clase: f.clase,
    valuacionId: f.valuacion_id,
    contratoId: f.contrato_id,
    contrato: f.contrato,
    cliente: f.cliente,
    titulo: TITULO[f.clase]![idioma],
    detalle: f.detalle ?? t(idioma, 'valuacion.titulo'),
    dias: f.dias,
    importe: moneda(idioma, Number(f.importe), f.moneda),
  }))
}

/**
 * Lo que espera al CLIENTE, que es la otra mitad del mismo círculo.
 *
 * La bandeja de arriba nació porque «el cliente escribe y no pasa nada» es lo que deja un
 * portal sin usarse. El espejo de ese agujero seguía abierto: **GPS presenta una valuación y
 * el cliente no sabe que le espera nada** salvo que lea el correo, y si el correo se perdió
 * —o lo mandó el sistema el día que el servidor de correo estaba caído— no hay ninguna otra
 * forma de enterarse. Entraba, veía su lista de contratos igual que ayer, y se iba.
 *
 * Tres filas, y la tercera es la que hace creíble a las otras dos:
 *
 *   1. **Esperando tu firma.** Lo que el cliente debe.
 *   2. **GPS contestó tu objeción.** Ya puede volver a mirarla: `aprobar` acepta una
 *      valuación objetada, así que la respuesta la desbloquea de verdad.
 *   3. **Esperando a GPS.** Lo que GPS le debe a él. Un portal que solo enseña las deudas
 *      de un lado se lee como una máquina de cobrar; éste enseña las dos.
 *
 * La comprobación de organización va ESCRITA aquí y no delegada en las políticas de fila.
 * Apoyarse en que la base ya filtra funciona y hace la garantía invisible: una prueba de
 * aislamiento pasaría con esta condición quitada, porque sería el filtro de la base el que la
 * salva. Ya pasó una vez en este proyecto.
 */
export async function bandejaCliente(
  q: Consulta, orgId: string, idioma: Idioma,
): Promise<readonly Pendiente[]> {
  const filas = (await q`
    -- Presentadas y sin firmar: lo que el cliente debe mirar.
    select 'esperando_firma' as clase, v.id as valuacion_id, ct.id as contrato_id,
           ct.codigo as contrato, o.nombre as cliente,
           null::text as detalle,
           (current_date - v.presentada_el) as dias,
           v.obra::text as importe, v.moneda,
           case when ${idioma} = 'es' then ct.titulo_es else ct.titulo_en end as contexto
      from valuacion v
      join contrato ct on ct.id = v.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where ct.cliente_id = ${orgId}::uuid
       and v.estado = 'presentada' and v.presentada_el is not null

    union all

    -- Objetada y ya contestada: la pelota vuelve a estar en su campo. Se exige que NO quede
    -- ninguna objeción sin responder, porque con una abierta el que espera sigue siendo GPS.
    select 'objecion_contestada', v.id, ct.id, ct.codigo, o.nombre,
           left(ob.respuesta, 160),
           (current_date - ob.respondida_en::date),
           v.obra::text, v.moneda,
           case when ${idioma} = 'es' then ct.titulo_es else ct.titulo_en end
      from objecion ob
      join valuacion v on v.id = ob.valuacion_id
      join contrato ct on ct.id = v.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where ct.cliente_id = ${orgId}::uuid
       and v.estado = 'objetada'
       and ob.respondida_en is not null
       and not exists (select 1 from objecion o2
                        where o2.valuacion_id = v.id and o2.respondida_en is null)

    union all

    -- Y lo que GPS le debe: su objeción sin contestar.
    select 'esperando_gps', v.id, ct.id, ct.codigo, o.nombre,
           left(ob.motivo, 160),
           (current_date - ob.objetada_en::date),
           v.obra::text, v.moneda,
           case when ${idioma} = 'es' then ct.titulo_es else ct.titulo_en end
      from objecion ob
      join valuacion v on v.id = ob.valuacion_id
      join contrato ct on ct.id = v.contrato_id
      join organizacion o on o.id = ct.cliente_id
     where ct.cliente_id = ${orgId}::uuid
       and ob.respondida_en is null

     order by 7 desc
  `) as unknown as Array<Fila & { contexto: string }>

  return filas.map((f): Pendiente => ({
    clase: f.clase,
    valuacionId: f.valuacion_id,
    contratoId: f.contrato_id,
    contrato: f.contrato,
    cliente: f.cliente,
    titulo: TITULO[f.clase]![idioma],
    detalle: f.detalle ?? t(idioma, 'valuacion.titulo'),
    dias: f.dias,
    importe: moneda(idioma, Number(f.importe), f.moneda),
    contexto: f.contexto,
  }))
}
