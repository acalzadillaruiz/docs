/**
 * Los equipos y su desgaste.
 *
 * Para GPS no es contabilidad de adorno: **alquiler de equipos es uno de los cinco
 * tipos de contrato**, y un equipo alquilado genera ingreso y se gasta al mismo
 * tiempo. Si solo se mira el ingreso, el negocio parece mejor de lo que es.
 *
 * Por eso la pantalla no enseña una lista de activos con su valor: enseña, por cada
 * equipo alquilado, **lo que deja** — lo facturado menos el desgaste. Es la única
 * cifra que contesta «¿alquilar esto sale a cuenta?».
 */

import type { Consulta } from '../db/conexion.ts'
import { moneda, t, type Idioma } from '../i18n/t.ts'

export type Equipo = {
  readonly id: string
  readonly codigo: string
  readonly descripcion: string
  readonly enServicio: string
  readonly costo: string
  readonly enLibros: string
  readonly deBaja: boolean
  readonly contrato: string | null
  /** Solo para los alquilados: lo facturado, el desgaste, y la diferencia. */
  readonly ingreso: string | null
  readonly desgaste: string | null
  readonly deja: string | null
  readonly dejaCrudo: number | null
}

export async function equipos(
  q: Consulta, orgId: string, idioma: Idioma, al = new Date().toISOString().slice(0, 10),
): Promise<readonly Equipo[]> {
  const filas = (await q`
    select a.id, a.codigo, a.descripcion_es, a.descripcion_en, a.en_servicio_el,
           a.costo_ves::text as costo, a.baja_el, ct.codigo as contrato,
           valor_en_libros(a.id, ${al}::date)::text as en_libros
      from activo a
      left join contrato ct on ct.id = a.contrato_id
     where a.organizacion_id = ${orgId}::uuid
     order by a.baja_el nulls first, a.codigo
  `) as unknown as Array<Record<string, string | Date | null>>

  const salida: Equipo[] = []
  for (const f of filas) {
    const id = f['id'] as string
    let ingreso: number | null = null
    let desgaste: number | null = null
    let deja: number | null = null

    if (f['contrato']) {
      const [r] = (await q`
        select ingreso::text, desgaste::text, deja::text
          from rendimiento_alquiler(${id}::uuid, ${al}::date)
      `) as unknown as Array<{ ingreso: string; desgaste: string; deja: string }>
      if (r) {
        ingreso = Number(r.ingreso)
        desgaste = Number(r.desgaste)
        deja = Number(r.deja)
      }
    }

    salida.push({
      id,
      codigo: f['codigo'] as string,
      descripcion: (idioma === 'es' ? f['descripcion_es'] : f['descripcion_en']) as string,
      enServicio: (f['en_servicio_el'] as Date).toISOString().slice(0, 10),
      costo: moneda(idioma, Number(f['costo']), 'VES'),
      enLibros: moneda(idioma, Number(f['en_libros']), 'VES'),
      deBaja: f['baja_el'] !== null,
      contrato: (f['contrato'] as string | null) ?? null,
      ingreso: ingreso === null ? null : moneda(idioma, ingreso, 'VES'),
      desgaste: desgaste === null ? null : moneda(idioma, desgaste, 'VES'),
      deja: deja === null ? null : moneda(idioma, deja, 'VES'),
      dejaCrudo: deja,
    })
  }
  return salida
}

export type Depreciado =
  | { readonly hecho: true; readonly asiento: string }
  | { readonly hecho: false; readonly motivo: string }

/**
 * Deprecia un mes entero, de una vez.
 *
 * Se hace por mes y no por equipo porque genera **un** asiento con una línea por
 * equipo: uno por equipo llenaría el libro de asientos de cuatro líneas y haría
 * ilegible el mayor de la cuenta de depreciación.
 *
 * Las condiciones se comprueban aquí antes de llamar: una excepción dentro de una
 * transacción la aborta entera y no deja decir nada útil.
 */
export async function depreciarMes(
  q: Consulta, orgId: string, anio: number, mes: number, personaId: string, idioma: Idioma,
): Promise<Depreciado> {
  const [ya] = (await q`
    select count(*)::int as n from depreciacion d
      join activo a on a.id = d.activo_id
     where a.organizacion_id = ${orgId}::uuid and d.anio = ${anio} and d.mes = ${mes}
  `) as unknown as Array<{ n: number }>
  if (Number(ya?.n ?? 0) > 0) return { hecho: false, motivo: t(idioma, 'activo.error.mes') }

  const [periodo] = (await q`
    select 1 as x from periodo
     where organizacion_id = ${orgId}::uuid and anio = ${anio} and mes = ${mes}
       and estado = 'abierto'
  `) as unknown as Array<{ x: number }>
  if (!periodo) return { hecho: false, motivo: t(idioma, 'activo.error.periodo') }

  const [hay] = (await q`
    select count(*)::int as n from activo
     where organizacion_id = ${orgId}::uuid
       and (baja_el is null or baja_el > make_date(${anio}, ${mes}, 1))
       and en_servicio_el <= (make_date(${anio}, ${mes}, 1) + interval '1 month - 1 day')::date
  `) as unknown as Array<{ n: number }>
  if (Number(hay?.n ?? 0) === 0) return { hecho: false, motivo: t(idioma, 'activo.error.nada') }

  const [a] = (await q`
    select depreciar_mes(${orgId}::uuid, ${anio}, ${mes}, ${personaId}::uuid) as id
  `) as unknown as Array<{ id: string }>
  return { hecho: true, asiento: a!.id }
}

/** Los meses ya depreciados, para no ofrecer el botón dos veces. */
export async function mesesDepreciados(
  q: Consulta, orgId: string,
): Promise<readonly { anio: number; mes: number }[]> {
  return (await q`
    select distinct d.anio, d.mes from depreciacion d
      join activo a on a.id = d.activo_id
     where a.organizacion_id = ${orgId}::uuid
     order by d.anio desc, d.mes desc limit 24
  `) as unknown as Array<{ anio: number; mes: number }>
}

// ---------------------------------------------------------------------------
// Dar de alta un equipo.
//
// Esto NO EXISTÍA. La pantalla enseñaba los equipos, calculaba su valor en libros, el
// rendimiento de los alquilados y corría la depreciación del mes... sobre una tabla en
// la que **nada, en ninguna parte, insertaba una fila**. Un módulo entero —y alquiler
// de equipos es uno de los cinco tipos de contrato de GPS— mirando por una ventana a
// una tabla vacía para siempre.
//
// Lo encontró un barrido nuevo: tablas del esquema que la aplicación nunca escribe.
// Una tabla que nadie escribe es una función que no existe.

/** Las cuentas imputables de una naturaleza, para elegir en el formulario. */
export async function cuentasPara(
  q: Consulta, orgId: string, naturaleza: 'activo' | 'gasto', idioma: Idioma,
): Promise<readonly { codigo: string; nombre: string }[]> {
  return (await q`
    select codigo, case when ${idioma} = 'es' then nombre_es else nombre_en end as nombre
      from cuenta
     where organizacion_id = ${orgId}::uuid and naturaleza = ${naturaleza} and imputable
     order by codigo
  `) as unknown as Array<{ codigo: string; nombre: string }>
}

/** Los contratos a los que se le puede imputar el desgaste de un equipo. */
export async function contratosDeAlquiler(
  q: Consulta, orgId: string,
): Promise<readonly { id: string; codigo: string; titulo: string }[]> {
  return (await q`
    select id, codigo, titulo_es as titulo from contrato
     where organizacion_id = ${orgId}::uuid and estado in ('vigente','suspendido')
     order by tipo <> 'alquiler', codigo
  `) as unknown as Array<{ id: string; codigo: string; titulo: string }>
}

export type EquipoNuevo = {
  readonly codigo: string
  readonly descripcionEs: string
  readonly descripcionEn: string
  readonly cuenta: string
  readonly cuentaDepre: string
  readonly cuentaGasto: string
  readonly enServicio: string
  readonly moneda: 'VES' | 'USD'
  readonly costo: number
  readonly residual: number
  readonly metodo: 'linea_recta' | 'unidades_produccion'
  readonly vidaMeses: number | null
  readonly unidadesVida: number | null
  readonly contratoId: string | null
}

export type Alta =
  | { readonly hecho: true; readonly id: string }
  | { readonly hecho: false; readonly errores: readonly string[] }

/**
 * Registra un equipo.
 *
 * Todo se comprueba ANTES de insertar, y no por gusto: la tabla tiene tres claves
 * ajenas a `cuenta`, dos restricciones de coherencia y un único por código. Un
 * `try/catch` alrededor del insert no serviría —esto corre dentro de una transacción
 * y postgres vuelve a lanzar al cerrarla—, y además el mensaje de la base de datos no
 * dice qué casilla arreglar.
 *
 * Se devuelven TODOS los errores, no el primero: un formulario de trece casillas que
 * los da de uno en uno se rellena cuatro veces.
 */
export async function registrarActivo(
  q: Consulta, orgId: string, e: EquipoNuevo, idioma: Idioma,
): Promise<Alta> {
  const mal: string[] = []
  const codigo = e.codigo.trim()

  if (codigo === '') mal.push(t(idioma, 'activo.error.codigo'))
  if (e.descripcionEs.trim() === '' || e.descripcionEn.trim() === '') {
    // Bilingüe desde el primer día: un equipo con nombre en un solo idioma sale como
    // un hueco en la pantalla del otro.
    mal.push(t(idioma, 'activo.error.descripcion'))
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.enServicio) || Number.isNaN(Date.parse(e.enServicio))) {
    mal.push(t(idioma, 'activo.error.fecha'))
  }
  // Se pregunta por lo que TIENE que ser, no por lo que no: con `<= 0` un NaN pasa,
  // porque toda comparación con NaN es falsa.
  if (!(e.costo > 0)) mal.push(t(idioma, 'activo.error.costo'))
  if (!(e.residual >= 0)) mal.push(t(idioma, 'activo.error.residual'))
  if (e.costo > 0 && e.residual >= 0 && !(e.residual < e.costo)) {
    mal.push(t(idioma, 'activo.error.residual_pasa'))
  }
  if (e.metodo === 'linea_recta' && !(e.vidaMeses !== null && e.vidaMeses > 0)) {
    mal.push(t(idioma, 'activo.error.vida'))
  }
  if (e.metodo === 'unidades_produccion' && !(e.unidadesVida !== null && e.unidadesVida > 0)) {
    mal.push(t(idioma, 'activo.error.unidades'))
  }

  if (codigo !== '') {
    const [ya] = (await q`
      select 1 as x from activo
       where organizacion_id = ${orgId}::uuid and codigo = ${codigo}
    `) as unknown as Array<{ x: number }>
    if (ya) mal.push(t(idioma, 'activo.error.ya'))
  }

  // Las tres cuentas, de una vez: que existan, que sean de esta empresa y que se
  // pueda imputar en ellas. Una cuenta de agrupación aceptada aquí deja el mayor con
  // saldo en un nivel que no debería tenerlo.
  const cuentas = [e.cuenta, e.cuentaDepre, e.cuentaGasto].map((c) => c.trim())
  const [n] = (await q`
    select count(*)::int as n from cuenta
     where organizacion_id = ${orgId}::uuid and imputable
       and codigo = any(${cuentas as unknown as string[]})
  `) as unknown as Array<{ n: number }>
  if (Number(n?.n ?? 0) < new Set(cuentas).size) {
    mal.push(t(idioma, 'activo.error.cuenta'))
  }

  if (e.contratoId !== null) {
    const [c] = (await q`
      select 1 as x from contrato
       where id = ${e.contratoId}::uuid and organizacion_id = ${orgId}::uuid
    `) as unknown as Array<{ x: number }>
    if (!c) mal.push(t(idioma, 'activo.error.contrato'))
  }

  // La tasa del día en que entra en servicio: es la que convierte el costo, y sin
  // ella el equipo quedaría registrado con un valor en la otra moneda inventado.
  let tasa: string | null = null
  if (mal.length === 0) {
    const [r] = (await q`
      select tasa_del_dia(${e.enServicio}::date) as id
    `) as unknown as Array<{ id: string | null }>
    tasa = r?.id ?? null
    if (tasa === null) mal.push(t(idioma, 'activo.error.tasa'))
  }

  if (mal.length > 0) return { hecho: false, errores: mal }

  // Las dos monedas son obligatorias en la tabla, así que la que no se escribió se
  // convierte con la tasa del día en que entra en servicio. Dejar una en cero haría
  // que el equipo valiera cero en la mitad de los informes.
  //
  // El valor residual va en bolívares, porque es contra `costo_ves` contra el que la
  // base de datos comprueba que no lo alcance.
  const m = e.moneda
  const [a] = (await q`
    insert into activo (organizacion_id, codigo, descripcion_es, descripcion_en,
                        cuenta, cuenta_depre, cuenta_gasto, en_servicio_el,
                        costo_ves, costo_usd, tasa_id, valor_residual,
                        metodo, vida_meses, unidades_vida, contrato_id)
    select ${orgId}::uuid, ${codigo}, ${e.descripcionEs.trim()}, ${e.descripcionEn.trim()},
           ${cuentas[0]!}, ${cuentas[1]!}, ${cuentas[2]!}, ${e.enServicio}::date,
           case when ${m} = 'VES' then ${e.costo}::numeric
                else convertir(${e.costo}::numeric, 'USD', 'VES', ${tasa}::uuid) end,
           case when ${m} = 'USD' then ${e.costo}::numeric
                else convertir(${e.costo}::numeric, 'VES', 'USD', ${tasa}::uuid) end,
           ${tasa}::uuid,
           case when ${m} = 'VES' then ${e.residual}::numeric
                else convertir(${e.residual}::numeric, 'USD', 'VES', ${tasa}::uuid) end,
           ${e.metodo}::metodo_depreciacion,
           ${e.metodo === 'linea_recta' ? e.vidaMeses : null}::int,
           ${e.metodo === 'unidades_produccion' ? e.unidadesVida : null}::numeric,
           ${e.contratoId}::uuid
    returning id`) as unknown as Array<{ id: string }>
  return { hecho: true, id: a!.id }
}
