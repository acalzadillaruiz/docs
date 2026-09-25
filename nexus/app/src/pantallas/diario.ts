/**
 * El libro diario.
 *
 * Cada asiento se enseña ENTERO —cabecera y líneas juntas—, no en una lista que hay
 * que pinchar. Un contador no busca un asiento: los recorre. Obligarle a abrir
 * treinta pantallas para leer un mes es lo que hace que acabe pidiendo una
 * exportación y trabajando fuera del sistema.
 *
 * Y va marcado lo que en otros sitios no se ve: cuánto tardó el hecho en llegar al
 * sistema, y si el asiento es un reverso o fue reversado.
 */

import type { Diario, Apunte } from '../dominio/diario.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera', anio: 'Año', mes: 'Mes', ver: 'Ver' },
  en: { volver: 'Back to the portfolio', anio: 'Year', mes: 'Month', ver: 'View' },
} as const

export function pintarDiario(d: Diario, idioma: Idioma, antifalsificacion: string): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const mm = String(d.mes).padStart(2, '0')

  const apunte = (a: Apunte) => `
<div class="as${a.reversado ? ' anulado' : ''}">
  <div class="as-c">
    <div class="as-n">#${a.numero}</div>
    <div class="as-d">
      <div class="as-t">${escapar(a.descripcion)}</div>
      <div class="as-m">
        <span>${escapar(t('diario.ocurrido'))} ${escapar(a.ocurrido)}</span>
        <span>${escapar(t('diario.registrado'))} ${escapar(a.registrado)}</span>
        ${a.tardanza === 0 ? '' : `<span class="${a.tardanza > 7 ? 'tarde' : ''}">${
          escapar(t('diario.tardanza'))} ${a.tardanza} ${escapar(t('diario.dias'))}</span>`}
        <span class="org">${escapar(a.origen)}</span>
        ${a.esReverso ? `<span class="marca">${escapar(t('diario.reverso'))}</span>` : ''}
        ${a.reversado ? `<span class="marca">${escapar(t('diario.reversado'))}</span>` : ''}
      </div>
    </div>
  </div>
  <div class="ancho"><table class="ln">
    <tbody>${a.lineas.map((l) => `
      <tr>
        <td class="cta"><span class="cod">${escapar(l.cuenta)}</span> ${escapar(l.nombre)}${
          l.contrato ? ` <span class="ctr">${escapar(l.contrato)}</span>` : ''}</td>
        <td class="n">${escapar(l.debe)}</td>
        <td class="n hb">${escapar(l.haber)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>
</div>`

  return pagina({
    idioma,
    titulo: t('diario.titulo'),
    estilos: ESTILOS_DIARIO,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('diario.titulo'))}</h1>
  <div class="sub">${escapar(t('diario.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${d.cuadra ? '' : `<div class="aviso">
    <b>${escapar(t('diario.descuadre'))} ${escapar(d.descuadre)}</b>
    <p>${escapar(t('diario.descuadre_explica'))}</p>
  </div>`}

  <form method="get" action="/diario" class="sel">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <label>${escapar(x.anio)}
      <input type="number" name="anio" value="${d.anio}" min="2000" max="2100"></label>
    <label>${escapar(x.mes)}
      <input type="number" name="mes" value="${d.mes}" min="1" max="12"></label>
    <button type="submit">${escapar(x.ver)}</button>
  </form>

  ${d.apuntes.length === 0
    ? `<p class="nada">${escapar(t('diario.vacio'))}</p>`
    : `<div class="tot">${escapar(t('diario.total'))} · ${escapar(mm)}/${d.anio}
         <b>${escapar(d.total)}</b></div>
       ${d.apuntes.map(apunte).join('')}
       <p class="expl">${escapar(t('diario.tardanza_explica'))}</p>
       <p class="expl">${escapar(t('diario.reversado_explica'))}</p>`}
</main>`,
  })
}

export const ESTILOS_DIARIO = `
.sel{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin:18px 0 6px}
.sel label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.sel input{display:block;margin-top:5px;width:100px;font:inherit;font-size:14px;
  padding:8px 10px;border:1px solid var(--ln2);border-radius:9px;background:var(--cd);
  color:var(--ik)}
.sel button{font:inherit;font-size:14px;font-weight:700;padding:9px 20px;border:0;
  border-radius:9px;background:var(--nv);color:#E9F0F6;cursor:pointer}
.aviso{margin-top:18px;background:var(--amb);border:1px solid var(--am);
  border-left-width:3px;border-radius:12px;padding:14px 17px}
.aviso b{color:var(--am);font-size:15px}
.aviso p{margin:6px 0 0;font-size:13px;color:var(--ik2);line-height:1.45;max-width:64ch}
.tot{margin:16px 0 10px;font-family:"JetBrains Mono",monospace;font-size:9.5px;
  font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.tot b{font-size:16px;letter-spacing:-.02em;color:var(--ik);margin-left:8px}
/* Cada asiento entero, cabecera y lineas juntas. Un contador no busca un asiento:
   los recorre. */
.as{background:var(--cd);border:1px solid var(--ln);border-radius:13px;
  margin-bottom:11px;overflow:hidden}
.as.anulado{opacity:.62}
.as-c{display:flex;gap:11px;padding:13px 15px 10px}
.as-n{font-family:"JetBrains Mono",monospace;font-size:12.5px;font-weight:700;
  color:var(--md);white-space:nowrap}
.as-d{flex:1;min-width:0}
.as-t{font-size:14.5px;font-weight:650;letter-spacing:-.01em}
.as-m{margin-top:4px;display:flex;gap:12px;flex-wrap:wrap;
  font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--md)}
.as-m .tarde{color:var(--am);font-weight:700}
.as-m .org{color:var(--ik2)}
.as-m .marca{color:var(--am);border:1px solid var(--am);border-radius:5px;padding:0 5px}
.ancho{overflow-x:auto;border-top:1px solid var(--ln)}
.ln{width:100%;border-collapse:collapse;font-size:13px}
.ln td{padding:7px 15px;border-top:1px solid var(--ln)}
.ln tr:first-child td{border-top:0}
.ln td.n{text-align:right;font-family:"JetBrains Mono",monospace;white-space:nowrap;
  width:1%}
.ln td.n.hb{color:var(--ik2)}
.ln .cod{font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--md);
  margin-right:5px}
.ln .ctr{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--md);
  border:1px solid var(--ln2);border-radius:5px;padding:0 5px;margin-left:5px}
.expl{margin:11px 0 0;font-size:12.5px;color:var(--md);line-height:1.45;max-width:64ch}
.nada{padding:17px;color:var(--ik2);font-size:14px;margin:0}
`
