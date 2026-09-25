/**
 * Los avisos: redactar y vaciar la cola.
 *
 * La base de datos ya encola el aviso en la misma transacción que el hecho. Aquí se
 * hacen las dos cosas que faltan: redactarlo en el idioma de quien lo recibe, y
 * vaciar la cola.
 *
 * Tres decisiones:
 *
 *   1. EL TEXTO SE REDACTA AL ENVIAR, no al encolar. El idioma es el de quien lo
 *      recibe, y eso solo se sabe aquí. Congelarlo en la cola dejaría además correos
 *      viejos con una redacción que ya se corrigió.
 *
 *   2. UN AVISO NUNCA LLEVA CIFRAS QUE NO SEAN DEL DESTINATARIO. Un correo se
 *      reenvía, y en cuanto sale de aquí deja de estar bajo las políticas de fila
 *      que protegen el precio de compra y el margen. Lo que va dentro son los datos
 *      que la base de datos encoló, que ya vienen filtrados, y nada más.
 *
 *   3. EL AVISO NO ES EL CONTENIDO: es un empujón hacia la aplicación. No lleva la
 *      valuación entera ni el documento adjunto. Mandar el contenido por correo es
 *      volver al correo, que es de lo que se está saliendo — y además haría que la
 *      información acabara en buzones que GPS no controla.
 */

import type { Consulta } from '../db/conexion.ts'
import { t, type Idioma } from '../i18n/t.ts'

export type TipoAviso =
  | 'objecion_nueva' | 'objecion_respondida' | 'valuacion_presentada'
  | 'valuacion_aprobada' | 'evidencia_sin_revisar' | 'hito_atrasado'

export type AvisoEnCola = {
  readonly id: string
  readonly tipo: TipoAviso
  readonly correo: string
  readonly nombre: string
  readonly idioma: Idioma
  readonly sobreId: string
  readonly datos: Readonly<Record<string, string | number>>
  readonly intentos: number
}

export type Redactado = {
  readonly para: string
  readonly asunto: string
  readonly texto: string
  readonly enlace: string
}

/**
 * Mete los datos en la plantilla. Solo sustituye lo que la plantilla pide, así que
 * un dato de más no acaba en el correo por descuido.
 */
function rellenar(plantilla: string, datos: Readonly<Record<string, unknown>>): string {
  return plantilla.replace(/\{(\w+)\}/g, (_, clave: string) => {
    const v = datos[clave]
    return v === undefined || v === null ? '—' : String(v)
  })
}

/**
 * Adónde lleva el aviso.
 *
 * Siempre a la pantalla concreta, nunca a la portada. Un aviso que deja a alguien en
 * la portada a buscar de qué le hablaban es un aviso que se cierra sin hacer nada.
 */
export function enlaceDe(a: AvisoEnCola, base: string): string {
  const raiz = base.replace(/\/+$/, '')
  switch (a.tipo) {
    case 'objecion_nueva':
    case 'objecion_respondida':
      return `${raiz}/valuaciones/${a.datos['valuacion_id'] ?? ''}`
    case 'valuacion_presentada':
    case 'valuacion_aprobada':
      return `${raiz}/valuaciones/${a.sobreId}`
    case 'hito_atrasado':
      return `${raiz}/renglones/${a.datos['renglon_id'] ?? ''}`
    case 'evidencia_sin_revisar':
      // La cola de revisión vive en la cartera, que es donde se va a actuar.
      return `${raiz}/`
  }
}

export function redactar(a: AvisoEnCola, base: string): Redactado {
  const clave = (parte: 'asunto' | 'cuerpo') =>
    t(a.idioma, `aviso.${a.tipo}.${parte}` as Parameters<typeof t>[1])

  const enlace = enlaceDe(a, base)
  const texto = [
    rellenar(t(a.idioma, 'aviso.hola'), { nombre: a.nombre }),
    '',
    rellenar(clave('cuerpo'), a.datos),
    '',
    `${t(a.idioma, 'aviso.ver')}: ${enlace}`,
    '',
    '—',
    t(a.idioma, 'aviso.firma'),
  ].join('\n')

  return {
    para: a.correo,
    // El asunto se corta: los clientes de correo lo cortan igual, y peor.
    asunto: rellenar(clave('asunto'), a.datos).slice(0, 180),
    texto,
    enlace,
  }
}

/** Por dónde sale el correo. Se pasa desde fuera para poder probar sin mandar nada. */
export type Transporte = {
  enviar(r: Redactado): Promise<void>
}

type FilaCola = {
  id: string; tipo: TipoAviso; correo: string; nombre: string; idioma: string
  sobre_id: string; datos: Record<string, string | number>; intentos: number
}

export type Resultado = {
  readonly enviados: number
  readonly fallidos: number
}

/**
 * Vacía la cola.
 *
 * Un fallo al mandar uno no detiene los demás: el servidor de correo que rechaza una
 * dirección mal escrita no tiene por qué dejar sin avisar a los otros once.
 */
export async function vaciarCola(
  q: Consulta, transporte: Transporte, base: string, cuantos = 50,
): Promise<Resultado> {
  const filas = (await q`
    select * from tomar_avisos(${cuantos})
  `) as unknown as FilaCola[]

  let enviados = 0
  let fallidos = 0
  for (const f of filas) {
    const aviso: AvisoEnCola = {
      id: f.id,
      tipo: f.tipo,
      correo: f.correo,
      nombre: f.nombre,
      idioma: f.idioma === 'en' ? 'en' : 'es',
      sobreId: f.sobre_id,
      datos: f.datos ?? {},
      intentos: f.intentos,
    }
    try {
      await transporte.enviar(redactar(aviso, base))
      await q`select aviso_enviado(${f.id}::uuid)`
      enviados++
    } catch (e) {
      // El motivo se guarda para poder mirarlo, pero NO se sube al registro con el
      // correo dentro: un registro se comparte y un correo es un dato personal.
      await q`select aviso_fallido(${f.id}::uuid, ${String((e as Error).message ?? e)})`
      fallidos++
    }
  }
  return { enviados, fallidos }
}

/** Encola lo que lleva demasiado tiempo quieto. Se llama una vez al día. */
export async function encolarLoParado(q: Consulta, dias = 3): Promise<number> {
  const [r] = (await q`
    select encolar_lo_parado(${dias}) as n
  `) as unknown as Array<{ n: number }>
  return Number(r?.n ?? 0)
}
