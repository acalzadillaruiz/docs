/**
 * Los valores fiscales, en pantalla.
 *
 * Lo primero que se ve no es una tabla: es **lo que falta para poder trabajar hoy**. Sin
 * tasa del BCV de hoy no se emite una valuación, y el error que sale al intentarlo —«no
 * hay tasa vigente»— no dice dónde se arregla. Aquí se dice antes de que nadie lo
 * intente, y cuando no falta nada también se dice, porque un hueco donde debería haber un
 * aviso no se distingue de un aviso que no salió.
 *
 * Y en cada lista, al lado de cada valor, **cuántos papeles hay debajo**. Es lo que hace
 * visible la consecuencia de corregir uno antes de corregirlo. Corregir es legítimo —un
 * dedo gordo en la tasa de ayer hay que poder arreglarlo— y es seguro, porque cada
 * retención congela lo que aplicó y cada factura guarda su alícuota; pero eso se cree
 * mejor viéndolo que leyéndolo.
 */

import type { Tasa, Valor, Concepto } from '../dominio/fiscales.ts'
import { traductor, type Clave, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera' },
  en: { volver: 'Back to the portfolio' },
} as const

export type Fiscales = {
  readonly falta: readonly string[]
  readonly tasas: readonly Tasa[]
  readonly ut: readonly Valor[]
  readonly iva: readonly Valor[]
  readonly igtf: readonly Valor[]
  readonly conceptos: readonly Concepto[]
}

const CLASES_IVA = ['general', 'reducida', 'adicional', 'exento'] as const
const SUJETOS = [
  'pj_domiciliada', 'pn_residente', 'pj_no_domiciliada', 'pn_no_residente',
] as const

export function pintarFiscales(
  d: Fiscales, idioma: Idioma, antifalsificacion: string,
  errores: readonly string[] = [], hecho: string | null = null,
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const af = escapar(antifalsificacion)

  /** El número de papeles debajo de un valor, dicho siempre — también cuando es cero. */
  const debajo = (n: number, clave: Clave = 'fiscal.usos') => n === 0
    ? `<span class="us cero">${escapar(t('fiscal.sin_usos'))}</span>`
    : `<span class="us">${n} ${escapar(t(clave))}</span>`

  // El nombre de la fuente, traducido. En la tabla es 'carga_manual' o 'bcv_api', que no
  // es ni castellano ni inglés, y pintarlo crudo dejaba media pantalla sin traducir en un
  // producto que es bilingüe por obligación. Lo que no esté en la lista sale como «de
  // otro sitio» en vez de como una clave que falta.
  const FUENTES = ['carga_manual', 'bcv_api', 'importacion_excel'] as const
  const fuenteDe = (f: string) => t(
    (FUENTES as readonly string[]).includes(f)
      ? `fiscal.fuente.${f}` as Clave
      : 'fiscal.fuente.otra')

  const filaTasa = (r: Tasa) => `
  <div class="fv${r.sustituida ? ' vieja' : ''}">
    <div class="fv-d">${escapar(r.vigenteEl)}</div>
    <div class="fv-v"><b>${escapar(r.vesPorUsd)}</b>
      ${r.variacion === null ? '' :
        `<em class="${Number(r.variacion.replace(',', '.')) >= 0 ? 'sube' : 'baja'}">${
          escapar(t('fiscal.tasa.variacion'))} ${escapar(r.variacion)} %</em>`}</div>
    <div class="fv-x">${escapar(t('fiscal.tasa.fuente'))}: ${escapar(fuenteDe(r.fuente))}${
      r.sustituida ? ` · ${escapar(t('fiscal.tasa.sustituida'))}` : ''}</div>
    <div class="fv-u">${debajo(r.usos, 'fiscal.tasa.usos')}</div>
  </div>`

  const filaValor = (r: Valor, sufijo: string) => `
  <div class="fv">
    <div class="fv-d">${escapar(r.desde)}</div>
    <div class="fv-v"><b>${escapar(r.valor)}${sufijo}</b>${
      r.clase === null ? '' :
        ` <em>${escapar(t(`fiscal.iva.clase.${r.clase}` as Clave))}</em>`}</div>
    <div class="fv-x">${r.nota === null ? '' : escapar(r.nota)}</div>
    <div class="fv-u">${debajo(r.usos)}</div>
  </div>`

  const campo = (nombre: string, clave: Clave, tipo = 'text', extra = '') =>
    `<label>${escapar(t(clave))}
      <input type="${tipo}" name="${nombre}" ${extra}></label>`

  const eligeEntre = (nombre: string, clave: Clave, opciones: readonly string[],
                      prefijo: string) =>
    `<label>${escapar(t(clave))}
      <select name="${nombre}">${opciones.map((o) =>
        `<option value="${o}">${escapar(t(`${prefijo}${o}` as Clave))}</option>`).join('')}
      </select></label>`

  return pagina({
    idioma,
    titulo: t('fiscal.titulo'),
    estilos: ESTILOS_FISCALES,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('fiscal.titulo'))}</h1>
  <div class="sub">${escapar(t('fiscal.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((e) => `<li>${escapar(e)}</li>`).join('')}</ul></div>`}
  ${hecho === null ? '' : `<div class="bien-caja">${escapar(hecho)}</div>`}

  ${d.falta.length === 0
    ? `<div class="bien-caja">${escapar(t('fiscal.al_dia'))}</div>`
    : `<div class="falta">
    <h2>${escapar(t('fiscal.falta_titulo'))}</h2>
    <ul>${d.falta.map((f) => `<li>${escapar(f)}</li>`).join('')}</ul>
  </div>`}

  <section class="fs">
    <h2>${escapar(t('fiscal.tasa.titulo'))}</h2>
    <p class="expl">${escapar(t('fiscal.tasa.explica'))}</p>
    <div class="caja">${d.tasas.length === 0
      ? `<p class="nada">${escapar(t('fiscal.tasa.sin_nada'))}</p>`
      : d.tasas.map(filaTasa).join('')}</div>
    <details class="anadir">
      <summary>${escapar(t('fiscal.anadir'))}</summary>
      <form method="post" action="/fiscales" class="pf">
        <input type="hidden" name="af" value="${af}">
        <input type="hidden" name="accion" value="tasa">
        ${campo('vigente_el', 'fiscal.tasa.dia', 'date')}
        ${campo('valor', 'fiscal.tasa.valor', 'number', 'step="0.00000001" min="0"')}
        <label class="ck an"><input type="checkbox" name="rectifica" value="si">
          ${escapar(t('fiscal.tasa.rectifica'))}</label>
        <p class="expl an">${escapar(t('fiscal.tasa.rectifica_explica'))}</p>
        <button type="submit">${escapar(t('fiscal.tasa.guardar'))}</button>
      </form>
    </details>
  </section>

  <section class="fs">
    <h2>${escapar(t('fiscal.ut.titulo'))}</h2>
    <p class="expl">${escapar(t('fiscal.ut.explica'))}</p>
    <div class="caja">${d.ut.map((r) => filaValor(r, '')).join('')}</div>
    <details class="anadir">
      <summary>${escapar(t('fiscal.anadir'))}</summary>
      <form method="post" action="/fiscales" class="pf">
        <input type="hidden" name="af" value="${af}">
        <input type="hidden" name="accion" value="ut">
        ${campo('desde', 'fiscal.desde', 'date')}
        ${campo('valor', 'fiscal.ut.valor', 'number', 'step="0.01" min="0"')}
        ${campo('extra', 'fiscal.ut.gaceta', 'text', 'maxlength="60"')}
        <button type="submit">${escapar(t('fiscal.guardar'))}</button>
      </form>
    </details>
  </section>

  <section class="fs">
    <h2>${escapar(t('fiscal.iva.titulo'))}</h2>
    <p class="expl">${escapar(t('fiscal.iva.explica'))}</p>
    <div class="caja">${d.iva.map((r) => filaValor(r, ' %')).join('')}</div>
    <details class="anadir">
      <summary>${escapar(t('fiscal.anadir'))}</summary>
      <form method="post" action="/fiscales" class="pf">
        <input type="hidden" name="af" value="${af}">
        <input type="hidden" name="accion" value="iva">
        ${campo('desde', 'fiscal.desde', 'date')}
        ${eligeEntre('extra', 'fiscal.iva.clase', CLASES_IVA, 'fiscal.iva.clase.')}
        ${campo('valor', 'fiscal.porcentaje', 'number', 'step="0.01" min="0" max="100"')}
        <button type="submit">${escapar(t('fiscal.guardar'))}</button>
      </form>
    </details>
  </section>

  <section class="fs">
    <h2>${escapar(t('fiscal.igtf.titulo'))}</h2>
    <p class="expl">${escapar(t('fiscal.igtf.explica'))}</p>
    <div class="caja">${d.igtf.map((r) => filaValor(r, ' %')).join('')}</div>
    <details class="anadir">
      <summary>${escapar(t('fiscal.anadir'))}</summary>
      <form method="post" action="/fiscales" class="pf">
        <input type="hidden" name="af" value="${af}">
        <input type="hidden" name="accion" value="igtf">
        ${campo('desde', 'fiscal.desde', 'date')}
        ${campo('valor', 'fiscal.porcentaje', 'number', 'step="0.01" min="0" max="100"')}
        <button type="submit">${escapar(t('fiscal.guardar'))}</button>
      </form>
    </details>
  </section>

  <section class="fs">
    <h2>${escapar(t('fiscal.islr.titulo'))}</h2>
    <p class="expl">${escapar(t('fiscal.islr.explica'))}</p>
    <p class="expl aviso">${escapar(t('fiscal.islr.aviso_pk'))}</p>
    <div class="caja">${d.conceptos.map((c) => `
    <div class="fv">
      <div class="fv-d">${escapar(c.codigo)}</div>
      <div class="fv-v"><b>${escapar(c.porcentaje)} %</b>
        <em>${escapar(c.nombre)}</em></div>
      <div class="fv-x">${escapar(t(`fiscal.islr.sujeto.${c.sujeto}` as Clave))} ·
        ${escapar(t('fiscal.islr.factor'))}: ${escapar(c.factorUt)} ·
        ${escapar(t('fiscal.islr.minimo'))}: ${escapar(c.minimoUt)}</div>
      <div class="fv-u">${debajo(c.retenciones, 'fiscal.islr.retenciones')}</div>
    </div>`).join('')}</div>
    <details class="anadir">
      <summary>${escapar(t('fiscal.anadir'))}</summary>
      <form method="post" action="/fiscales" class="pf">
        <input type="hidden" name="af" value="${af}">
        <input type="hidden" name="accion" value="islr">
        ${campo('codigo', 'fiscal.islr.codigo', 'text', 'maxlength="20"')}
        ${campo('desde', 'fiscal.desde', 'date')}
        ${campo('nombre_es', 'fiscal.islr.nombre_es', 'text', 'maxlength="80"')}
        ${campo('nombre_en', 'fiscal.islr.nombre_en', 'text', 'maxlength="80"')}
        ${eligeEntre('sujeto', 'fiscal.islr.sujeto', SUJETOS, 'fiscal.islr.sujeto.')}
        ${campo('valor', 'fiscal.porcentaje', 'number', 'step="0.01" min="0" max="100"')}
        ${campo('factor', 'fiscal.islr.factor', 'number', 'step="0.0001" min="0"')}
        ${campo('minimo', 'fiscal.islr.minimo', 'number', 'step="0.0001" min="0"')}
        <button type="submit">${escapar(t('fiscal.guardar'))}</button>
      </form>
    </details>
  </section>
</main>`,
  })
}

const ESTILOS_FISCALES = `
.falta{background:var(--amb);border:1px solid var(--am);border-radius:13px;
  padding:14px 17px;margin:0 0 20px}
.falta h2{margin:0 0 7px;font-size:15px;font-weight:700;color:var(--am)}
.falta ul{margin:0;padding-left:19px;font-size:14px;line-height:1.5;color:var(--ik2)}
.fs{margin:26px 0 0}
.fs h2{margin:0 0 4px;font-size:17px;font-weight:700;letter-spacing:-.018em}
.fs .expl{margin:0 0 11px;font-size:13.5px;line-height:1.5;color:var(--ik2);max-width:70ch}
.fs .expl.aviso{background:var(--amb);border-left:3px solid var(--am);
  border-radius:0 8px 8px 0;padding:8px 12px}
.caja{background:var(--cd);border:1px solid var(--ln);border-radius:13px;overflow:hidden}
.nada{margin:0;padding:15px 17px;font-size:14px;color:var(--md)}
.fv{display:grid;grid-template-columns:104px minmax(0,1fr) auto;gap:3px 14px;
  padding:11px 17px;align-items:baseline}
.fv + .fv{border-top:1px solid var(--ln)}
.fv.vieja{opacity:.55}
.fv-d{font-family:"JetBrains Mono",monospace;font-size:12.5px;font-weight:700;
  color:var(--md);font-variant-numeric:tabular-nums}
.fv-v{font-size:15px}
.fv-v b{font-family:"JetBrains Mono",monospace;font-weight:700;
  font-variant-numeric:tabular-nums}
.fv-v em{font-style:normal;font-size:13px;color:var(--ik2);margin-left:7px}
.fv-v em.sube{color:var(--rj)} .fv-v em.baja{color:var(--grt)}
.fv-x{grid-column:2;font-size:12.5px;line-height:1.45;color:var(--md)}
.fv-u{grid-column:3;grid-row:1}
.us{font-family:"JetBrains Mono",monospace;font-size:10.5px;font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;color:var(--md);white-space:nowrap}
.us.cero{opacity:.6}
.anadir{margin-top:11px}
.anadir summary{cursor:pointer;font-size:13.5px;font-weight:650;color:var(--enl)}
.pf{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:13px;
  margin-top:13px;padding:15px 17px;background:var(--cd);border:1px solid var(--ln);
  border-radius:13px}
.pf label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.pf label.an,.pf .expl.an{grid-column:1/-1}
.pf input[type=text],.pf input[type=number],.pf input[type=date],.pf select{
  display:block;margin-top:5px;width:100%;font:inherit;font-size:14px;padding:8px 10px;
  border:1px solid var(--ln2);border-radius:9px;background:var(--cd);color:var(--ik)}
.pf label.ck{display:flex;align-items:center;gap:7px;font-family:inherit;font-size:14px;
  font-weight:400;letter-spacing:0;text-transform:none;color:var(--ik)}
.pf label.ck input{margin:0;width:auto;display:inline-block}
.pf .expl{margin:0;font-size:12.5px;color:var(--md)}
.pf button{grid-column:1/-1;justify-self:start;font:inherit;font-size:14px;
  font-weight:700;padding:9px 20px;border:0;border-radius:9px;background:var(--nv);
  color:#E9F0F6;cursor:pointer}
@media(max-width:560px){
  .fv{grid-template-columns:minmax(0,1fr)}
  .fv-x,.fv-u{grid-column:1}
  .fv-u{grid-row:auto}
}
`
