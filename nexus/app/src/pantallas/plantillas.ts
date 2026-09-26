/**
 * Las plantillas de hitos, en pantalla.
 *
 * Es la pantalla de la que cuelga la tesis del producto: aquí se decide en qué pasos se
 * divide un renglón y cuánto pesa cada uno, y de los pasos verificados sale el avance.
 *
 * Por eso lo que va grande no es la lista de pasos: es **la suma**. Una plantilla que
 * suma 90 no da un error en ninguna parte; da contratos que nunca pasan del 90 %. La
 * suma va arriba, en verde cuando da 100 y en rojo cuando no, y cuando no da 100 dice lo
 * que eso significa en vez de dejar el número solo.
 */

import type { Plantilla } from '../dominio/plantillas.ts'
import { CLASES_EVIDENCIA } from '../dominio/plantillas.ts'
import { traductor, type Clave, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera' },
  en: { volver: 'Back to the portfolio' },
} as const

export function pintarPlantillas(
  lista: readonly Plantilla[], idioma: Idioma, antifalsificacion: string,
  errores: readonly string[] = [], hecho: string | null = null,
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const af = escapar(antifalsificacion)

  const bloque = (p: Plantilla) => `
<section class="pl">
  <div class="pl-h">
    <div>
      <h2 class="pl-t">${escapar(p.nombre)}</h2>
      <div class="pl-u">${p.renglones === 0 ? '' :
        `${p.renglones} ${escapar(t('plantilla.usada'))}`}</div>
    </div>
    <div class="pl-s ${p.sirve ? 'bien' : 'mal'}">
      <span>${escapar(t('plantilla.suma'))}</span>
      <b>${escapar(p.suma)}</b>
      <em>${escapar(t(p.sirve ? 'plantilla.sirve' : 'plantilla.no_sirve'))}</em>
    </div>
  </div>

  <div class="caja">${p.pasos.length === 0
    ? `<p class="nada">${escapar(t('plantilla.sin_pasos'))}</p>`
    : p.pasos.map((s) => `
  <div class="ps">
    <div class="ps-o">${s.orden}</div>
    <div class="ps-c">
      <div class="ps-n">${escapar(idioma === 'es' ? s.nombreEs : s.nombreEn)}</div>
      <div class="ps-k">${escapar(s.clave)}</div>
      <div class="ps-e">${s.exige.length === 0
        ? '—'
        : s.exige.map((c) => `<span>${escapar(t(`evidencia.clase.${c}` as Clave))}</span>`).join('')}</div>
    </div>
    <div class="ps-p">${escapar(s.peso)}</div>
    <form method="post" action="/plantillas" class="ps-q">
      <input type="hidden" name="af" value="${af}">
      <input type="hidden" name="accion" value="quitar">
      <input type="hidden" name="tipo" value="${escapar(p.tipo)}">
      <input type="hidden" name="orden" value="${s.orden}">
      <label>${escapar(t('plantilla.confirmar'))}
        <input type="text" name="clave" maxlength="30" autocomplete="off"></label>
      <button type="submit" class="flojo">${escapar(t('plantilla.quitar'))}</button>
    </form>
  </div>`).join('')}</div>

  <details class="anadir">
    <summary>${escapar(t('plantilla.paso'))}</summary>
    <form method="post" action="/plantillas" class="pf">
      <input type="hidden" name="af" value="${af}">
      <input type="hidden" name="accion" value="paso">
      <input type="hidden" name="tipo" value="${escapar(p.tipo)}">
      <label>${escapar(t('plantilla.orden'))}
        <input type="number" name="orden" min="1" max="99"
               value="${p.pasos.length + 1}"></label>
      <label>${escapar(t('plantilla.clave'))}
        <input type="text" name="clave" maxlength="30" spellcheck="false"></label>
      <label>${escapar(t('plantilla.peso'))}
        <input type="text" name="peso" inputmode="decimal"></label>
      <label class="an">${escapar(t('plantilla.nombre_es'))}
        <input type="text" name="nombre_es" maxlength="80"></label>
      <label class="an">${escapar(t('plantilla.nombre_en'))}
        <input type="text" name="nombre_en" maxlength="80"></label>
      <fieldset class="an">
        <legend>${escapar(t('plantilla.exige'))}</legend>
        ${CLASES_EVIDENCIA.map((c) => `<label class="ck">
          <input type="checkbox" name="exige" value="${c}">
          ${escapar(t(`evidencia.clase.${c}` as Clave))}</label>`).join('')}
      </fieldset>
      <button type="submit">${escapar(t('plantilla.guardar'))}</button>
    </form>
    <p class="expl">${escapar(t('plantilla.clave_explica'))}</p>
    <p class="expl">${escapar(t('plantilla.exige_explica'))}</p>
  </details>
</section>`

  return pagina({
    idioma,
    titulo: t('plantilla.titulo'),
    estilos: ESTILOS_PLANTILLAS,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('plantilla.titulo'))}</h1>
  <div class="sub">${escapar(t('plantilla.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((e) => `<li>${escapar(e)}</li>`).join('')}</ul></div>`}
  ${hecho === null ? '' : `<div class="bien-caja">${escapar(hecho)}</div>`}

  <p class="expl aviso">${escapar(t('plantilla.suma_explica'))}</p>
  ${lista.some((p) => p.renglones > 0)
    ? `<p class="expl">${escapar(t('plantilla.usada_explica'))}</p>` : ''}

  ${lista.map(bloque).join('')}
</main>`,
  })
}

export const ESTILOS_PLANTILLAS = `
.expl{margin:0 0 11px;font-size:13.5px;color:var(--ik2);line-height:1.45;max-width:66ch}
.expl.aviso{margin-top:18px;background:var(--amb);border-left:3px solid var(--am);
  border-radius:0 11px 11px 0;padding:12px 15px;color:var(--ik2)}
.pl{margin-top:26px}
.pl-h{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;
  flex-wrap:wrap;margin-bottom:10px}
.pl-t{margin:0;font-size:17px;font-weight:700;letter-spacing:-.02em;text-transform:none;
  font-family:inherit;color:var(--ik)}
.pl-u{margin-top:3px;font-family:"JetBrains Mono",monospace;font-size:10.5px;
  letter-spacing:.06em;color:var(--md)}
/* La SUMA es lo que hay que ver desde la puerta: una plantilla que no da 100 produce
   contratos que nunca acaban de avanzar, y el número solo no lo dice. */
.pl-s{text-align:right;padding:8px 13px;border-radius:11px;border:1px solid var(--ln)}
.pl-s span{display:block;font-family:"JetBrains Mono",monospace;font-size:8.5px;
  font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.pl-s b{display:block;font-family:"JetBrains Mono",monospace;font-size:22px;
  font-weight:700;letter-spacing:-.03em;margin-top:2px}
.pl-s em{display:block;font-style:normal;font-size:11.5px;margin-top:2px}
.pl-s.bien{border-color:var(--grt)} .pl-s.bien b,.pl-s.bien em{color:var(--grt)}
.pl-s.mal{border-color:var(--rj);background:var(--cd)}
.pl-s.mal b,.pl-s.mal em{color:var(--rj)}
.ps{display:grid;grid-template-columns:34px minmax(0,1fr) auto auto;gap:12px;
  align-items:center;padding:11px 15px;border-top:1px solid var(--ln)}
.ps:first-child{border-top:0}
.ps-o{font-family:"JetBrains Mono",monospace;font-size:12.5px;font-weight:700;
  color:var(--md);text-align:center}
.ps-n{font-size:14.5px;font-weight:650;letter-spacing:-.012em}
.ps-k{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.08em;
  color:var(--md);margin-top:2px}
.ps-e{margin-top:5px;display:flex;flex-wrap:wrap;gap:5px;font-size:11.5px;color:var(--ik2)}
.ps-e span{background:var(--cd2);border:1px solid var(--ln);border-radius:6px;
  padding:1px 7px}
.ps-p{font-family:"JetBrains Mono",monospace;font-size:15px;font-weight:700;
  letter-spacing:-.02em}
.ps form{margin:0}
.ps button.flojo{font:inherit;font-size:12.5px;padding:5px 11px;border-radius:8px;
  background:transparent;color:var(--ik2);border:1px solid var(--ln2);cursor:pointer}
.anadir{margin-top:10px}
.anadir summary{cursor:pointer;font-size:14px;font-weight:650;color:var(--enl);
  padding:7px 0}
.pf{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;
  align-items:end;margin:8px 0 10px}
.pf label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.pf label.an,.pf fieldset.an{grid-column:1/-1}
.pf input[type=text],.pf input[type=number]{display:block;margin-top:5px;width:100%;
  font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--ln2);
  border-radius:9px;background:var(--cd);color:var(--ik)}
.pf fieldset{border:1px solid var(--ln);border-radius:11px;padding:10px 13px;margin:0}
.pf legend{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md);padding:0 5px}
.pf label.ck{display:inline-flex;align-items:center;gap:6px;margin:3px 13px 3px 0;
  font-family:inherit;font-size:13.5px;font-weight:400;letter-spacing:0;
  text-transform:none;color:var(--ik)}
.pf label.ck input{margin:0}
.pf button{grid-column:1/-1;justify-self:start;font:inherit;font-size:14px;
  font-weight:700;padding:9px 20px;border:0;border-radius:9px;background:var(--nv);
  color:#E9F0F6;cursor:pointer}
@media(max-width:560px){
  .ps{grid-template-columns:28px minmax(0,1fr);row-gap:8px}
  .ps-p{grid-column:2;justify-self:start}
  .ps form{grid-column:2}
  .pl-s{text-align:left}
}
`
