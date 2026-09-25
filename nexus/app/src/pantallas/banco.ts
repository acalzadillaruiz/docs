/**
 * Conciliación bancaria.
 *
 * Dos bloques, y el orden importa: primero lo que la máquina propone, porque es lo
 * que se despacha rápido; después **lo que no casa**, que es la parte que nadie
 * quiere mirar y la única que de verdad hace falta.
 *
 * Cada propuesta dice a cuántos días de diferencia está el candidato. Un casamiento
 * del mismo día es casi seguro; uno de cuatro días merece una mirada, y sin ese dato
 * las dos se ven igual.
 */

import type { Conciliacion } from '../dominio/banco.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera' },
  en: { volver: 'Back to the portfolio' },
} as const

export function pintarBanco(
  c: Conciliacion, idioma: Idioma, antifalsificacion: string,
  errores: readonly string[] = [],
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const propuestas = c.propuestas.length === 0 ? '' : `
<h2>${escapar(t('banco.propuestas'))}</h2>
<div class="caja">${c.propuestas.map((p) => `
<div class="mv">
  <div class="mv-c">
    <div class="mv-d">${escapar(p.descripcion || '—')}</div>
    <div class="mv-m">${escapar(p.fecha)} · ${
      p.dias === 0 ? escapar(t('banco.mismo_dia'))
                   : `${p.dias} ${escapar(t('banco.dias'))}`}</div>
  </div>
  <div class="mv-i">${escapar(p.monto)}</div>
  <form method="post" action="/banco">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <input type="hidden" name="accion" value="casar">
    <input type="hidden" name="movimiento" value="${escapar(p.movimiento)}">
    <input type="hidden" name="clase" value="${escapar(p.casaCon)}">
    <input type="hidden" name="candidato" value="${escapar(p.candidato)}">
    <input type="hidden" name="desde" value="${escapar(c.desde)}">
    <input type="hidden" name="hasta" value="${escapar(c.hasta)}">
    <button type="submit">${escapar(t('banco.casar'))}</button>
  </form>
</div>`).join('')}</div>`

  const descuadres = c.descuadres.length === 0
    ? `<p class="nada">${escapar(t('banco.nada'))}</p>`
    : c.descuadres.map((d) => `
<div class="mv ${d.esDelBanco ? 'banco' : 'libro'}">
  <div class="mv-c">
    <div class="mv-d">${escapar(d.detalle)}</div>
    <div class="mv-m">${escapar(d.fecha)} · ${escapar(
      d.esDelBanco ? t('banco.solo_banco') : t('banco.solo_libro'))}</div>
  </div>
  <div class="mv-i">${escapar(d.monto)}</div>
  ${!d.esDelBanco ? '' : `
  <form method="post" action="/banco" class="nota">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <input type="hidden" name="accion" value="nota">
    <input type="hidden" name="movimiento" value="${escapar(d.id)}">
    <input type="hidden" name="desde" value="${escapar(c.desde)}">
    <input type="hidden" name="hasta" value="${escapar(c.hasta)}">
    <input type="text" name="nota" required maxlength="300"
           placeholder="${escapar(t('banco.nota'))}">
    <button type="submit" class="sec">${escapar(t('banco.aceptar'))}</button>
  </form>`}
</div>`).join('')

  return pagina({
    idioma,
    titulo: t('banco.titulo'),
    estilos: ESTILOS_BANCO,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('banco.titulo'))}</h1>
  <div class="sub">${escapar(t('banco.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((e) => `<li>${escapar(e)}</li>`).join('')
  }</ul></div>`}

  <form method="get" action="/banco" class="rango">
    <label>${escapar(t('banco.desde'))}
      <input type="date" name="desde" value="${escapar(c.desde)}"></label>
    <label>${escapar(t('banco.hasta'))}
      <input type="date" name="hasta" value="${escapar(c.hasta)}"></label>
    <button type="submit">${escapar(t('banco.ver'))}</button>
  </form>

  ${propuestas}

  <h2>${escapar(t('banco.descuadres'))}</h2>
  <p class="expl">${escapar(t('banco.descuadres_explica'))}</p>
  <div class="caja">${descuadres}</div>
</main>`,
  })
}

export const ESTILOS_BANCO = `
.rango{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-top:18px}
.rango label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.rango input{display:block;margin-top:5px;font:inherit;font-size:14px;padding:8px 10px;
  border:1px solid var(--ln2);border-radius:9px;background:var(--cd);color:var(--ik)}
.rango button{font:inherit;font-size:14px;font-weight:650;padding:9px 18px;
  border:1px solid var(--ln2);border-radius:9px;background:var(--cd);color:var(--ik);
  cursor:pointer}
.mv{display:flex;align-items:center;gap:14px;padding:13px 16px;border-top:1px solid var(--ln);
  flex-wrap:wrap}
.mv:first-child{border-top:0}
/* Los dos lados del descuadre se ven distintos: uno es dinero que se movió sin que
   la contabilidad se enterara; el otro, contabilidad sin dinero detrás. */
.mv.banco{border-left:3px solid var(--am)}
.mv.libro{border-left:3px solid var(--rj)}
.mv-c{flex:1;min-width:200px}
.mv-d{font-size:14px;font-weight:650}
.mv-m{margin-top:3px;font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--md)}
.mv-i{font-family:"JetBrains Mono",monospace;font-size:14px;font-weight:700;
  letter-spacing:-.02em;white-space:nowrap}
.mv form{display:flex;gap:6px;align-items:center;margin:0}
.mv form.nota{flex:1;min-width:240px}
.mv input[type=text]{flex:1;min-width:140px;font:inherit;font-size:12.5px;padding:6px 9px;
  border:1px solid var(--ln2);border-radius:8px;background:var(--cd);color:var(--ik)}
.mv button{font:inherit;font-size:12.5px;font-weight:650;padding:7px 14px;border:0;
  border-radius:8px;background:var(--nv);color:#E9F0F6;cursor:pointer;white-space:nowrap}
.mv button.sec{background:transparent;color:var(--ik2);border:1px solid var(--ln2)}
.expl{margin:0 0 11px;font-size:13.5px;color:var(--ik2);line-height:1.45;max-width:66ch}
.mal-caja{margin-top:18px;background:var(--cd);border:1px solid var(--rj);border-left-width:3px;
  border-radius:11px;padding:13px 17px}
.mal-caja li{color:var(--rj);font-weight:600;font-size:14px}
`
