/**
 * Dónde está el material, en pantalla.
 *
 * Arriba, el resumen por paso: cuántos renglones hay parados en cada sitio de la
 * cadena y cuánto lleva el peor. Es lo que se mira de pie, antes de bajar a la lista.
 *
 * Abajo, la lista ordenada por **días parado**, el que más lleva primero. Lo que
 * lleva cuarenta días sin moverse es lo que está a punto de ser un problema; lo que
 * se movió ayer no necesita a nadie.
 *
 * Y dos marcas que no tiene ningún tablero de seguimiento:
 *
 *   - **«Dicho sin papel»**: alguien escribió que ese paso ya ocurrió y no hay
 *     documento que lo sostenga. Aquí el material sigue donde estaba.
 *   - **«Papel esperando»**: el documento está subido y lo que falta es que alguien
 *     de GPS lo mire. No es lo mismo que faltar, y confundirlos hace que se persiga
 *     al proveedor cuando el atasco está en casa.
 */

import type { EnRuta, PorPaso } from '../dominio/logistica.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera' },
  en: { volver: 'Back to the portfolio' },
} as const

export function pintarLogistica(
  lista: readonly EnRuta[], resumen: readonly PorPaso[], idioma: Idioma,
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const tarjetas = resumen.length === 0 ? '' : `<div class="pasos">${
    resumen.map((p) => `
    <div class="pa${p.peorDias >= 30 ? ' mal' : ''}">
      <span>${escapar(p.paso)}</span>
      <b>${p.cuantos}</b>
      <i>${escapar(t('log.peor').replace('{n}', String(p.peorDias)))}</i>
    </div>`).join('')
  }</div>`

  const filas = lista.length === 0
    ? `<p class="nada">${escapar(t('log.nada'))}</p>`
    : lista.map((r) => `
<a class="rt${r.dias >= 30 ? ' viejo' : ''}" href="/contratos/${escapar(r.contratoId)}">
  <div class="rt-c">
    <div class="rt-t">${escapar(r.renglon)}</div>
    <div class="rt-m">${escapar(r.contrato)} · ${escapar(r.cliente)} · ${escapar(r.tipo)}</div>
    <div class="rt-p">
      <span class="donde">${escapar(r.paso ?? t('log.sin_empezar'))}</span>
      <span class="flecha">→</span>
      <span class="falta">${escapar(r.siguiente)}</span>
    </div>
    <div class="rt-e">
      ${r.exige.length === 0 ? '' : `<span class="et">${
        escapar(t('log.exige'))} ${r.exige.map((c) => escapar(c)).join(', ')}</span>`}
      ${r.dichoSinPapel ? `<span class="et mal">${escapar(t('log.dicho_sin_papel'))}</span>` : ''}
      ${r.papelEsperando ? `<span class="et esp">${escapar(t('log.papel_esperando'))}</span>` : ''}
    </div>
  </div>
  <div class="rt-n">
    ${r.dias}<span>${escapar(t('log.dias_parado'))}</span>
  </div>
</a>`).join('')

  return pagina({
    idioma,
    titulo: t('log.titulo'),
    estilos: ESTILOS_LOGISTICA,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('log.titulo'))}</h1>
  <div class="sub">${escapar(t('log.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${tarjetas}
  <div class="caja">${filas}</div>
  <p class="expl">${escapar(t('log.posicion_explica'))}</p>
</main>`,
  })
}

export const ESTILOS_LOGISTICA = `
.pasos{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;
  margin-top:20px;background:var(--nv3)}
.pa{background:var(--nv);padding:13px 15px}
.pa span{display:block;font-family:"JetBrains Mono",monospace;font-size:8.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:#7691A8}
.pa b{display:block;margin-top:6px;font-family:"JetBrains Mono",monospace;font-size:21px;
  font-weight:700;letter-spacing:-.03em;color:#E9F0F6}
.pa i{display:block;margin-top:3px;font-style:normal;font-family:"JetBrains Mono",monospace;
  font-size:10px;color:#7691A8}
/* Un paso con algo parado más de un mes se marca en el resumen: es lo que se mira
   de pie, y si hay que bajar a la lista para enterarse, no sirve. */
.pa.mal b,.pa.mal i{color:#EFC167}
.caja{margin-top:18px}
.rt{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;
  padding:14px 17px;border-top:1px solid var(--ln);text-decoration:none;color:inherit}
.rt:first-child{border-top:0}
.rt:hover{background:var(--cd2)}
.rt.viejo{border-left:3px solid var(--am)}
.rt-c{min-width:0;flex:1}
.rt-t{font-size:15px;font-weight:650;letter-spacing:-.015em;line-height:1.3}
.rt-m{font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--md);margin-top:3px}
.rt-p{margin-top:8px;display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;font-size:14px}
.rt-p .donde{font-weight:650;color:var(--grt)}
.rt-p .flecha{color:var(--md)}
.rt-p .falta{color:var(--ik2)}
.rt-e{margin-top:7px;display:flex;flex-wrap:wrap;gap:7px}
.rt-e .et{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.09em;text-transform:uppercase;color:var(--md);border:1px solid var(--ln2);
  border-radius:99px;padding:2px 8px}
.rt-e .et.mal{color:var(--am);border-color:var(--am)}
.rt-e .et.esp{color:var(--grt);border-color:var(--grt)}
.rt-n{font-family:"JetBrains Mono",monospace;font-size:20px;font-weight:700;
  letter-spacing:-.03em;text-align:right;white-space:nowrap}
.rt-n span{display:block;margin-top:3px;font-size:9px;font-weight:400;letter-spacing:.1em;
  text-transform:uppercase;color:var(--md)}
.expl{margin:16px 0 0;font-size:13px;color:var(--md);line-height:1.5;max-width:64ch}
@media(max-width:520px){
  .rt{flex-direction:column;gap:8px}
  .rt-n{text-align:left}
  .rt-n span{display:inline;margin-left:8px}
}
`
