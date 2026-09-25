/**
 * Reexpresión por inflación, en pantalla.
 *
 * Dos decisiones que no son de estilo:
 *
 *   - **El resultado monetario va arriba y grande**, antes de la tabla. Es lo que
 *     costó tener bolívares mientras perdían valor, y es la cifra que un CFO mira
 *     primero. Enterrarla al final de una tabla de cuarenta cuentas es esconderla.
 *   - **El ajuste se ve cuenta por cuenta.** Un ajuste global que nadie puede abrir
 *     es un número que nadie se cree, y un número que nadie se cree no se usa para
 *     decidir nada.
 *
 * Las monetarias salen marcadas y con el ajuste en blanco, no en cero: cero se lee
 * como «se calculó y dio cero», y aquí es «no se reexpresa, a propósito».
 *
 * Ojo con el signo del resultado monetario, que se lee al revés de lo que parece:
 * **positivo es pérdida**. Es lo que costó tener bolívares mientras se devaluaban, y
 * `resultado_monetario()` lo devuelve como la cifra que hace cuadrar el balance
 * reexpresado. Pintarlo en verde por ser positivo diría exactamente lo contrario de
 * lo que pasó.
 */

import type { Cuadro } from '../dominio/reexpresion.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera', anio: 'Año', mes: 'Mes' },
  en: { volver: 'Back to the portfolio', anio: 'Year', mes: 'Month' },
} as const

export function pintarReexpresion(
  c: Cuadro, idioma: Idioma, antifalsificacion: string,
  anio: number, mes: number, errores: readonly string[] = [],
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const cuerpo = c.sinIndice
    ? `<p class="nada">${escapar(t('reex.sin_indice'))}</p>`
    : c.lineas.length === 0
      ? `<p class="nada">${escapar(t('reex.sin_nada'))}</p>`
      : `<table class="rx">
  <thead><tr>
    <th>${escapar(t('reex.cuenta'))}</th>
    <th class="n">${escapar(t('reex.historico'))}</th>
    <th class="n">${escapar(t('reex.reexpresado'))}</th>
    <th class="n">${escapar(t('reex.ajuste'))}</th>
  </tr></thead>
  <tbody>${c.lineas.map((l) => `
    <tr${l.monetaria ? ' class="mon"' : ''}>
      <td><span class="cod">${escapar(l.codigo)}</span> ${escapar(l.cuenta)}${
        l.monetaria ? ` <span class="et">${escapar(t('reex.monetaria'))}</span>` : ''}</td>
      <td class="n">${escapar(l.historico)}</td>
      <td class="n">${escapar(l.reexpresado)}</td>
      <td class="n${l.monetaria ? '' : l.ajusteCrudo >= 0 ? ' bien' : ' mal'}">${
        l.monetaria ? '—' : escapar(l.ajuste)}</td>
    </tr>`).join('')}
  </tbody>
</table>`

  return pagina({
    idioma,
    titulo: t('reex.titulo'),
    estilos: ESTILOS_REEX,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('reex.titulo'))}</h1>
  <div class="sub">${escapar(t('reex.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((e) => `<li>${escapar(e)}</li>`).join('')
  }</ul></div>`}

  ${c.sinIndice ? '' : `<div class="reme">
    <div class="reme-e">${escapar(t('reex.reme'))}</div>
    <div class="reme-v ${c.remeCrudo > 0 ? 'mal' : 'bien'}">${escapar(c.reme)}</div>
    <div class="reme-q">${escapar(
      c.remeCrudo > 0 ? t('reex.reme_perdida') : t('reex.reme_ganancia'))}</div>
    <p class="reme-x">${escapar(t('reex.reme_explica'))}</p>
  </div>`}

  <form method="post" action="/reexpresion" class="mes">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <label>${escapar(x.anio)}
      <input type="number" name="anio" value="${anio}" min="2000" max="2100"></label>
    <label>${escapar(x.mes)}
      <input type="number" name="mes" value="${mes}" min="1" max="12"></label>
    <button type="submit">${escapar(t('reex.asentar'))}</button>
  </form>

  <p class="al">${escapar(t('reex.al'))} ${escapar(c.al)}</p>
  <div class="caja">${cuerpo}</div>
  <p class="expl">${escapar(t('reex.monetaria_explica'))}</p>
</main>`,
  })
}

export const ESTILOS_REEX = `
.mes{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin:18px 0 6px}
.mes label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.mes input{display:block;margin-top:5px;width:100px;font:inherit;font-size:14px;
  padding:8px 10px;border:1px solid var(--ln2);border-radius:9px;background:var(--cd);
  color:var(--ik)}
.mes button{font:inherit;font-size:14px;font-weight:700;padding:9px 20px;border:0;
  border-radius:9px;background:var(--nv);color:#E9F0F6;cursor:pointer}
/* El REME va arriba y grande: es lo que un CFO mira primero, y enterrarlo al final de
   una tabla de cuarenta cuentas es esconderlo. */
.reme{margin-top:18px;background:var(--cd);border:1px solid var(--ln2);border-radius:11px;
  padding:17px 19px}
.reme-e{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.reme-v{margin-top:5px;font-family:"JetBrains Mono",monospace;font-size:28px;
  font-weight:700;letter-spacing:-.03em}
.reme-v.bien{color:var(--grt)}
.reme-v.mal{color:var(--rj)}
.reme-q{margin-top:2px;font-size:13px;color:var(--ik2)}
.reme-x{margin:9px 0 0;font-size:12.5px;color:var(--md);line-height:1.45;max-width:64ch}
.al{margin:14px 0 8px;font-family:"JetBrains Mono",monospace;font-size:10.5px;
  letter-spacing:.09em;text-transform:uppercase;color:var(--md)}
.rx{width:100%;border-collapse:collapse}
.rx th{text-align:left;padding:10px 14px;font-family:"JetBrains Mono",monospace;
  font-size:9px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;
  color:var(--md);border-bottom:1px solid var(--ln)}
.rx th.n,.rx td.n{text-align:right;font-family:"JetBrains Mono",monospace;
  font-size:13px;white-space:nowrap}
.rx td{padding:9px 14px;border-top:1px solid var(--ln);font-size:13.5px}
.rx tr:first-child td{border-top:0}
.rx .cod{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--md);
  margin-right:6px}
.rx .et{font-family:"JetBrains Mono",monospace;font-size:8.5px;font-weight:700;
  letter-spacing:.11em;text-transform:uppercase;color:var(--am);border:1px solid var(--am);
  border-radius:5px;padding:1px 5px;margin-left:6px}
.rx tr.mon{color:var(--ik2)}
.rx td.n.bien{color:var(--grt)}
.rx td.n.mal{color:var(--rj)}
.expl{margin:12px 0 0;font-size:13px;color:var(--ik2);line-height:1.45;max-width:64ch}
.nada{padding:17px;color:var(--ik2);font-size:14px;line-height:1.5;margin:0}
.mal-caja{margin-top:18px;background:var(--cd);border:1px solid var(--rj);
  border-left-width:3px;border-radius:11px;padding:13px 17px}
.mal-caja li{color:var(--rj);font-weight:600;font-size:14px}
`
