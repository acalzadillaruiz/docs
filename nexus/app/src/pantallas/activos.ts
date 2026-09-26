/**
 * Los equipos y lo que dejan.
 *
 * No es una lista de activos con su valor. Es, por cada equipo alquilado, **lo que
 * deja**: lo facturado menos el desgaste. Es la única cifra que contesta la pregunta
 * que de verdad se hace — «¿alquilar esto sale a cuenta?».
 *
 * Lo que deja va en verde si es positivo y en rojo si no. Un equipo que deja menos
 * de lo que se gasta no es una pérdida contable abstracta: es una máquina que habría
 * salido más barata parada.
 */

import type { Equipo } from '../dominio/activos.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera', anio: 'Año', mes: 'Mes' },
  en: { volver: 'Back to the portfolio', anio: 'Year', mes: 'Month' },
} as const

export type ParaAlta = {
  readonly cuentasActivo: readonly { readonly codigo: string; readonly nombre: string }[]
  readonly cuentasGasto: readonly { readonly codigo: string; readonly nombre: string }[]
  readonly contratos: readonly {
    readonly id: string; readonly codigo: string; readonly titulo: string
  }[]
  readonly hoy: string
}

export function pintarActivos(
  lista: readonly Equipo[], idioma: Idioma, antifalsificacion: string,
  anio: number, mes: number, errores: readonly string[] = [],
  /**
   * Lo que hace falta para el formulario de alta.
   *
   * Va al final y con valor por omisión para no romper a quien ya llamaba a esta
   * función sin él — las pruebas de pantalla, entre otros. Sin esto la pantalla sale
   * como salía: mirando una tabla que nadie podía llenar.
   */
  alta: ParaAlta | null = null,
  hecho: string | null = null,
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const af = escapar(antifalsificacion)

  const opciones = (
    cs: readonly { readonly codigo: string; readonly nombre: string }[], preferida: string,
  ) => cs.map((c) => `<option value="${escapar(c.codigo)}"${
    c.codigo === preferida ? ' selected' : ''
  }>${escapar(c.codigo)} · ${escapar(c.nombre)}</option>`).join('')

  // El formulario. Trece casillas es mucho, y por eso los tres desplegables de cuentas
  // vienen ya en la que casi siempre toca: son las del plan que instala el sistema, y
  // quien no las use tiene la lista entera al lado. Un formulario largo con todo en
  // blanco es un formulario que se abandona.
  const formulario = alta === null ? '' : `
<h2>${escapar(t('activo.alta'))}</h2>
<p class="expl">${escapar(t('activo.alta_explica'))}</p>
<form method="post" action="/activos" class="nuevo">
  <input type="hidden" name="af" value="${af}">
  <input type="hidden" name="accion" value="alta">
  <label class="an">${escapar(t('activo.codigo'))}
    <input type="text" name="codigo" maxlength="40"></label>
  <label class="an">${escapar(t('activo.descripcion_es'))}
    <input type="text" name="descripcion_es" maxlength="160"></label>
  <label class="an">${escapar(t('activo.descripcion_en'))}
    <input type="text" name="descripcion_en" maxlength="160"></label>

  <label>${escapar(t('activo.en_servicio'))}
    <input type="date" name="en_servicio" value="${escapar(alta.hoy)}"></label>
  <label>${escapar(t('activo.moneda'))}
    <select name="moneda"><option value="VES">VES</option><option value="USD">USD</option></select></label>
  <label>${escapar(t('activo.costo'))}
    <input type="text" name="costo" inputmode="decimal"></label>
  <label>${escapar(t('activo.residual'))}
    <input type="text" name="residual" inputmode="decimal" value="0"></label>

  <label class="an">${escapar(t('activo.cuenta'))}
    <select name="cuenta">${opciones(alta.cuentasActivo, '1.2.01.03')}</select></label>
  <label class="an">${escapar(t('activo.cuenta_depre'))}
    <select name="cuenta_depre">${opciones(alta.cuentasActivo, '1.2.02')}</select></label>
  <label class="an">${escapar(t('activo.cuenta_gasto'))}
    <select name="cuenta_gasto">${opciones(alta.cuentasGasto, '5.2.05')}</select></label>

  <label>${escapar(t('activo.metodo'))}
    <select name="metodo">
      <option value="linea_recta">${escapar(t('activo.metodo.linea_recta'))}</option>
      <option value="unidades_produccion">${escapar(t('activo.metodo.unidades_produccion'))}</option>
    </select></label>
  <label>${escapar(t('activo.vida_meses'))}
    <input type="number" name="vida_meses" min="1" max="1200" value="60"></label>
  <label>${escapar(t('activo.unidades_vida'))}
    <input type="text" name="unidades_vida" inputmode="decimal"></label>

  <label class="an">${escapar(t('activo.contrato'))}
    <select name="contrato">
      <option value="">${escapar(t('activo.sin_contrato'))}</option>
      ${alta.contratos.map((c) =>
        `<option value="${escapar(c.id)}">${escapar(c.codigo)} · ${escapar(c.titulo)}</option>`
      ).join('')}
    </select></label>
  <button type="submit">${escapar(t('activo.alta'))}</button>
</form>
<p class="expl">${escapar(t('activo.en_servicio_explica'))} ${
  escapar(t('activo.contrato_explica'))}</p>`

  const filas = lista.length === 0
    ? `<p class="nada">${escapar(t('activo.nada'))}</p>`
    : lista.map((e) => `
<div class="eq${e.deBaja ? ' baja' : ''}">
  <div class="eq-c">
    <div class="eq-n">${escapar(e.codigo)} · ${escapar(e.descripcion)}</div>
    <div class="eq-m">${escapar(t('activo.en_servicio'))} ${escapar(e.enServicio)}${
      e.contrato ? ` · ${escapar(t('activo.alquilado'))} ${escapar(e.contrato)}` : ''}${
      e.deBaja ? ` · ${escapar(t('activo.de_baja'))}` : ''}</div>
    ${e.deja === null ? '' : `
    <div class="eq-r">
      <span>${escapar(t('activo.ingreso'))} ${escapar(e.ingreso ?? '')}</span>
      <span>${escapar(t('activo.desgaste'))} ${escapar(e.desgaste ?? '')}</span>
    </div>`}
  </div>
  <div class="eq-v">
    <div class="eq-l"><span>${escapar(t('activo.en_libros'))}</span>${escapar(e.enLibros)}</div>
    ${e.deja === null ? '' : `<div class="eq-d ${
      (e.dejaCrudo ?? 0) >= 0 ? 'bien' : 'mal'}"><span>${
      escapar(t('activo.deja'))}</span>${escapar(e.deja)}</div>`}
  </div>
</div>`).join('')

  return pagina({
    idioma,
    titulo: t('activo.titulo'),
    estilos: ESTILOS_ACTIVOS,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('activo.titulo'))}</h1>
  <div class="sub">${escapar(t('activo.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((e) => `<li>${escapar(e)}</li>`).join('')
  }</ul></div>`}

  ${hecho === null ? '' : `<div class="bien-caja">${escapar(hecho)}</div>`}

  <form method="post" action="/activos" class="depre">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <input type="hidden" name="accion" value="depreciar">
    <label>${escapar(x.anio)}
      <input type="number" name="anio" value="${anio}" min="2000" max="2100"></label>
    <label>${escapar(x.mes)}
      <input type="number" name="mes" value="${mes}" min="1" max="12"></label>
    <button type="submit">${escapar(t('activo.depreciar'))}</button>
  </form>

  <div class="caja">${filas}</div>

  ${formulario}
</main>`,
  })
}

export const ESTILOS_ACTIVOS = `
/* Lo que salió bien se dice igual de claro que lo que salió mal. */
/* Trece casillas. Se reparten en rejilla para que quepan en un teléfono sin que
   ninguna quede más estrecha que lo que hay que escribir dentro. */
.nuevo{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));
  gap:12px;align-items:end;margin:0 0 6px}
.nuevo label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.nuevo label.an{grid-column:1/-1}
.nuevo input,.nuevo select{display:block;margin-top:5px;width:100%;font:inherit;
  font-size:14px;padding:8px 10px;border:1px solid var(--ln2);border-radius:9px;
  background:var(--cd);color:var(--ik)}
.nuevo button{grid-column:1/-1;justify-self:start;font:inherit;font-size:14px;
  font-weight:700;padding:9px 20px;border:0;border-radius:9px;background:var(--nv);
  color:#E9F0F6;cursor:pointer}
.depre{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin:18px 0}
.depre label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.depre input{display:block;margin-top:5px;width:100px;font:inherit;font-size:14px;
  padding:8px 10px;border:1px solid var(--ln2);border-radius:9px;background:var(--cd);
  color:var(--ik)}
.depre button{font:inherit;font-size:14px;font-weight:700;padding:9px 20px;border:0;
  border-radius:9px;background:var(--nv);color:#E9F0F6;cursor:pointer}
.eq{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;
  padding:14px 17px;border-top:1px solid var(--ln);flex-wrap:wrap}
.eq:first-child{border-top:0}
.eq.baja{opacity:.5}
.eq-c{flex:1;min-width:220px}
.eq-n{font-size:14.5px;font-weight:700;letter-spacing:-.015em}
.eq-m{margin-top:3px;font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--md)}
.eq-r{margin-top:7px;display:flex;gap:14px;flex-wrap:wrap;
  font-family:"JetBrains Mono",monospace;font-size:11.5px;color:var(--ik2)}
.eq-v{text-align:right;display:flex;gap:22px}
.eq-l,.eq-d{font-family:"JetBrains Mono",monospace;font-size:14.5px;font-weight:700;
  letter-spacing:-.02em;white-space:nowrap}
.eq-l span,.eq-d span{display:block;font-size:9px;font-weight:700;letter-spacing:.13em;
  text-transform:uppercase;color:var(--md);margin-bottom:3px}
/* Un equipo que deja menos de lo que se gasta no es una pérdida contable abstracta:
   es una máquina que habría salido más barata parada. */
.eq-d.bien{color:var(--grt)}
.eq-d.mal{color:var(--rj)}
`
