/**
 * Dónde está el material.
 *
 * Es la pregunta que hace un cliente de procura y que no contesta ningún portal de
 * seguimiento: **«¿dónde está mi cabezal?»**. Hoy se contesta llamando al que sabe,
 * y el que sabe se acuerda de lo que mira más a menudo.
 *
 * La máquina ya estaba entera desde el primer día: la cadena de procura —orden,
 * fabricado, embarcado, nacionalizado, recibido— vive en las plantillas de hitos con
 * el papel que exige cada paso. Lo que faltaba era la vista.
 *
 * Y la vista lleva la tesis dentro: **la posición la marca el último paso
 * verificado, no el último que alguien escribió**. Si dicen que se embarcó y no hay
 * conocimiento de embarque, aquí sigue en fábrica — y eso se señala, porque es
 * justo la clase de cosa que se descubre cuando el barco ya zarpó sin la carga.
 */

import type { Consulta } from '../db/conexion.ts'
import { t, type Clave, type Idioma } from '../i18n/t.ts'

export type EnRuta = {
  readonly contratoId: string
  readonly contrato: string
  readonly cliente: string
  readonly renglon: string
  readonly tipo: string
  /** Dónde está: el último paso con papel detrás. Nulo si no ha empezado. */
  readonly paso: string | null
  readonly desde: string
  readonly dias: number
  /** Qué falta, y qué papel hace falta para demostrarlo. */
  readonly siguiente: string
  readonly exige: readonly string[]
  /** Alguien dijo que ya ocurrió y no hay papel que lo sostenga. */
  readonly dichoSinPapel: boolean
  /** El papel está subido y esperando que alguien de GPS lo mire. */
  readonly papelEsperando: boolean
}

const CLASE: Record<string, Clave> = {
  acta: 'evidencia.clase.acta',
  factura: 'evidencia.clase.factura',
  foto: 'evidencia.clase.foto',
  certificado: 'evidencia.clase.certificado',
  conocimiento: 'evidencia.clase.conocimiento',
  aduana: 'evidencia.clase.aduana',
  informe: 'evidencia.clase.informe',
  firma: 'evidencia.clase.firma',
}

const TIPO: Record<string, Clave> = {
  procura: 'contrato.tipo.procura',
  transporte: 'contrato.tipo.transporte',
}

type Fila = {
  contrato_id: string; contrato: string; cliente: string
  renglon: string; renglon_en: string; tipo: string
  paso_es: string | null; paso_en: string | null
  desde: Date; dias: number
  siguiente_es: string; siguiente_en: string
  exige: string[] | null
  dicho_sin_papel: boolean; papel_esperando: boolean
}

export async function enRuta(
  q: Consulta, orgId: string, idioma: Idioma,
): Promise<readonly EnRuta[]> {
  const filas = (await q`
    select contrato_id, contrato, cliente, renglon, renglon_en, tipo::text,
           paso_es, paso_en, desde, dias, siguiente_es, siguiente_en,
           exige, dicho_sin_papel, papel_esperando
      from en_ruta(${orgId}::uuid)
  `) as unknown as Fila[]

  const es = idioma === 'es'
  return filas.map((f): EnRuta => ({
    contratoId: f.contrato_id,
    contrato: f.contrato,
    cliente: f.cliente,
    renglon: es ? f.renglon : f.renglon_en,
    tipo: t(idioma, TIPO[f.tipo] ?? 'contrato.tipo.procura'),
    paso: (es ? f.paso_es : f.paso_en) ?? null,
    desde: f.desde.toISOString().slice(0, 10),
    dias: Number(f.dias),
    siguiente: es ? f.siguiente_es : f.siguiente_en,
    exige: (f.exige ?? []).map((c) => t(idioma, CLASE[c] ?? 'evidencia.clase.acta')),
    dichoSinPapel: f.dicho_sin_papel === true,
    papelEsperando: f.papel_esperando === true,
  }))
}

export type PorPaso = {
  readonly paso: string
  readonly cuantos: number
  readonly peorDias: number
}

/** Cuántos renglones hay parados en cada sitio de la cadena. Se mira antes de bajar. */
export async function porPaso(
  q: Consulta, orgId: string, idioma: Idioma,
): Promise<readonly PorPaso[]> {
  const filas = (await q`
    select paso_es, paso_en, cuantos, peor_dias from en_ruta_por_paso(${orgId}::uuid)
  `) as unknown as Array<{
    paso_es: string; paso_en: string; cuantos: number; peor_dias: number
  }>
  return filas.map((f) => ({
    paso: idioma === 'es' ? f.paso_es : f.paso_en,
    cuantos: Number(f.cuantos),
    peorDias: Number(f.peor_dias),
  }))
}
