/**
 * El mayor de una cuenta.
 *
 * Tres decisiones:
 *
 *   - **El saldo arrastrado en su propia columna, a la derecha del todo.** Es lo que
 *     se sigue con el dedo hacia abajo hasta encontrar dónde se torció.
 *   - **Solo se ofrecen las cuentas que tienen movimiento.** El plan tiene ochenta;
 *     ofrecerlas todas obliga a buscar entre setenta que están a cero.
 *   - **El debe y el haber vacíos, no en cero.** Un cero en una columna de importes
 *     se lee como un importe.
 */

import type { Mayor } from '../dominio/mayor.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera' },
  en: { volver: 'Back to the portfolio' },
} as const

export function pintarMayor(m: Mayor, idioma: Idioma, antifalsificacion: string): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const cuerpo = m.cuenta === null
    ? `<p class="nada">${escapar(t('mayor.elegir'))}</p>`
    : m.movimientos.length === 0
      ? `<p class="nada">${escapar(t('mayor.sin_movimiento'))}</p>`
      : `<div class="ancho"><table class="my">
  <thead><tr>
    <th>${escapar(t('mayor.fecha'))}</th>
    <th class="n">${escapar(t('mayor.asiento'))}</th>
    <th>${escapar(t('mayor.concepto'))}</th>
    <th class="n">${escapar(t('mayor.debe'))}</th>
    <th class="n">${escapar(t('mayor.haber'))}</th>
    <th class="n sal">${escapar(t('mayor.saldo'))}</th>
  </tr></thead>
  <tbody>${m.movimientos.map((v) => `
    <tr>
      <td class="m">${escapar(v.fecha)}</td>
      <td class="n m">#${v.asiento}</td>
      <td>${escapar(v.concepto)} <span class="org">${escapar(v.origen)}</span></td>
      <td class="n">${escapar(v.debe)}</td>
      <td class="n hb">${escapar(v.haber)}</td>
      <td class="n sal ${v.saldoCrudo >= 0 ? '' : 'neg'}">${escapar(v.saldo)}</td>
    </tr>`).join('')}
  </tbody>
  <tfoot><tr>
    <td colspan="3">${escapar(t('mayor.totales'))}</td>
    <td class="n">${escapar(m.totalDebe)}</td>
    <td class="n">${escapar(m.totalHaber)}</td>
    <td class="n sal"><b>${escapar(m.saldoFinal)}</b></td>
  </tr></tfoot>
</table></div>`

  return pagina({
    idioma,
    titulo: t('mayor.titulo'),
    estilos: ESTILOS_MAYOR,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('mayor.titulo'))}</h1>
  <div class="sub">${escapar(t('mayor.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  <form method="get" action="/mayor" class="sel">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <label class="ancha">${escapar(t('mayor.cuenta'))}
      <select name="cuenta">
        <option value=""></option>
        ${m.cuentas.map((c) => `<option value="${escapar(c.codigo)}"${
          m.cuenta?.codigo === c.codigo ? ' selected' : ''
        }>${escapar(c.codigo)} · ${escapar(c.nombre)}</option>`).join('')}
      </select></label>
    <label>${escapar(t('mayor.desde'))}
      <input type="date" name="desde" value="${escapar(m.desde)}"></label>
    <label>${escapar(t('mayor.hasta'))}
      <input type="date" name="hasta" value="${escapar(m.hasta)}"></label>
    <button type="submit">${escapar(t('mayor.ver'))}</button>
  </form>

  ${m.cuenta === null ? '' : `<div class="cab">
    <div class="cab-c"><span class="cod">${escapar(m.cuenta.codigo)}</span>
      ${escapar(m.cuenta.nombre)}</div>
    <div class="cab-s">
      <span>${escapar(t('mayor.saldo_final'))}</span>
      <b class="${m.saldoFinalCrudo >= 0 ? '' : 'neg'}">${escapar(m.saldoFinal)}</b>
    </div>
  </div>`}

  <div class="caja">${cuerpo}</div>
  <p class="expl">${escapar(t('mayor.saldo_explica'))}</p>
  <p class="expl">${escapar(t('mayor.solo_con_movimiento'))}</p>
</main>`,
  })
}

export const ESTILOS_MAYOR = `
.sel{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin:18px 0 6px}
.sel label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.sel label.ancha{flex:1;min-width:200px}
.sel input,.sel select{display:block;margin-top:5px;width:100%;font:inherit;font-size:14px;
  padding:8px 10px;border:1px solid var(--ln2);border-radius:9px;background:var(--cd);
  color:var(--ik)}
.sel button{font:inherit;font-size:14px;font-weight:700;padding:9px 20px;border:0;
  border-radius:9px;background:var(--nv);color:#E9F0F6;cursor:pointer}
.cab{display:flex;align-items:baseline;justify-content:space-between;gap:14px;
  flex-wrap:wrap;margin:16px 0 9px}
.cab-c{font-size:16px;font-weight:700;letter-spacing:-.02em}
.cab-c .cod{font-family:"JetBrains Mono",monospace;font-size:12.5px;color:var(--md);
  margin-right:6px}
.cab-s{text-align:right}
.cab-s span{display:block;font-family:"JetBrains Mono",monospace;font-size:9px;
  font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.cab-s b{font-family:"JetBrains Mono",monospace;font-size:19px;letter-spacing:-.025em}
.cab-s b.neg{color:var(--rj)}
.ancho{overflow-x:auto}
.my{width:100%;border-collapse:collapse;font-size:13px}
.my th{text-align:left;padding:9px 12px;font-family:"JetBrains Mono",monospace;
  font-size:8.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  color:var(--md);border-bottom:1px solid var(--ln);white-space:nowrap}
.my th.n,.my td.n{text-align:right;font-family:"JetBrains Mono",monospace;white-space:nowrap}
.my td{padding:8px 12px;border-top:1px solid var(--ln)}
.my td.m{font-family:"JetBrains Mono",monospace;font-size:11.5px}
.my td.n.hb{color:var(--ik2)}
/* El saldo arrastrado va separado: es la columna que se sigue con el dedo hacia
   abajo hasta encontrar donde se torcio. */
.my .sal{border-left:1px solid var(--ln);font-weight:700}
.my td.sal.neg{color:var(--rj)}
.my .org{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--md);
  border:1px solid var(--ln2);border-radius:5px;padding:0 5px;margin-left:5px}
.my tfoot td{border-top:1px solid var(--ln2);font-family:"JetBrains Mono",monospace;
  font-size:9px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.my tfoot td.n{font-size:13px;letter-spacing:-.02em;text-transform:none;color:var(--ik)}
.expl{margin:11px 0 0;font-size:12.5px;color:var(--md);line-height:1.45;max-width:64ch}
.nada{padding:17px;color:var(--ik2);font-size:14px;margin:0}
`
