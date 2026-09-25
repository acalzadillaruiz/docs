/**
 * La pantalla que propone una valuación.
 *
 * No es un formulario donde se escribe cuánto se factura: es una propuesta que la
 * máquina ya ha calculado, con el detalle de qué hitos la componen, y dos campos que
 * la máquina no puede saber — el periodo y cómo se cobra.
 *
 * Lo importante está en lo que NO se enseña: no hay ninguna casilla donde teclear la
 * obra. Ponerla, aunque fuera «por si acaso», convertiría todo lo anterior en
 * decoración: el día que la cifra propuesta no gustara, alguien la reescribiría.
 */

import type { Propuesta } from '../dominio/valuar.ts'
import { pesoTexto } from '../dominio/valuar.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver al contrato', numero: 'Valuación número' },
  en: { volver: 'Back to the contract', numero: 'Progress payment number' },
} as const

export function pintarValuar(
  p: Propuesta, idioma: Idioma, antifalsificacion: string,
  desde: string, hasta: string, errores: readonly string[] = [],
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const lineas = p.lineas.length === 0
    ? `<p class="nada">${escapar(t('valuar.nada'))}</p>`
    : p.lineas.map((l) => `
<div class="ln">
  <div class="ln-n">${l.numero}</div>
  <div class="ln-c">
    <div class="ln-d">${escapar(l.descripcion)}</div>
    <div class="ln-h">${escapar(t('valuar.hitos_que'))}: ${
      l.hitos.map((h) => escapar(h)).join(' · ')
    }</div>
  </div>
  <div class="ln-p">${escapar(pesoTexto(idioma, l.peso))}</div>
  <div class="ln-v">${escapar(l.valor)}</div>
</div>`).join('')

  const caidos = p.caidos.length === 0 ? '' : `
<h2>${escapar(t('valuar.caido'))}</h2>
<p class="expl">${escapar(t('valuar.caido_explica'))}</p>
<div class="caja">${p.caidos.map((c) => `
<div class="ln">
  <div class="ln-n">${c.valuacion}</div>
  <div class="ln-c"><div class="ln-d">${escapar(c.hito)}</div></div>
  <div class="ln-v mal">${escapar(c.valor)}</div>
</div>`).join('')}</div>`

  return pagina({
    idioma,
    titulo: `${t('valuar.titulo')} · ${p.contrato}`,
    estilos: ESTILOS_VALUAR,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/contratos/${escapar(p.contratoId)}">← ${escapar(x.volver)}</a>
  <div class="cod">${escapar(p.contrato)} · ${escapar(p.cliente)}</div>
  <h1>${escapar(t('valuar.titulo'))}</h1>
  <div class="sub">${escapar(x.numero)} ${p.siguienteNumero}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((e) => `<li>${escapar(e)}</li>`).join('')
  }</ul></div>`}

  <h2>${escapar(t('valuar.propuesta'))}</h2>
  <p class="expl">${escapar(t('valuar.explica'))}</p>
  <div class="caja">${lineas}</div>

  ${p.lineas.length === 0 ? '' : `
  <div class="obra">
    <span>${escapar(t('valuar.obra'))}</span>
    <b>${escapar(p.obra)}</b>
  </div>

  <form method="post" action="/contratos/${escapar(p.contratoId)}/valuar">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <div class="caja pad">
      <label class="c"><span>${escapar(t('valuar.periodo_desde'))}</span>
        <input type="date" name="desde" value="${escapar(desde)}" required></label>
      <label class="c"><span>${escapar(t('valuar.periodo_hasta'))}</span>
        <input type="date" name="hasta" value="${escapar(hasta)}" required></label>
    </div>
    <label class="cas"><input type="checkbox" name="ret_iva" value="1">
      <span>${escapar(t('valuar.ret_iva'))}</span></label>
    <label class="cas"><input type="checkbox" name="divisa" value="1">
      <span>${escapar(t('valuar.divisa'))}</span></label>
    <button type="submit">${escapar(t('valuar.crear'))}</button>
  </form>`}
  ${caidos}
</main>`,
  })
}

export const ESTILOS_VALUAR = `
.expl{margin:0 0 11px;font-size:13.5px;color:var(--ik2);line-height:1.45;max-width:64ch}
.ln{display:grid;grid-template-columns:28px minmax(0,1fr) auto auto;gap:12px;
  padding:13px 16px;border-top:1px solid var(--ln);align-items:baseline}
.ln:first-child{border-top:0}
.ln-n{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--md)}
.ln-d{font-size:14.5px;font-weight:650;letter-spacing:-.012em}
.ln-h{margin-top:4px;font-family:"JetBrains Mono",monospace;font-size:10.5px;
  letter-spacing:.06em;color:var(--grt)}
.ln-p{font-family:"JetBrains Mono",monospace;font-size:12.5px;color:var(--ik2);
  white-space:nowrap}
.ln-v{font-family:"JetBrains Mono",monospace;font-size:14.5px;font-weight:700;
  letter-spacing:-.02em;text-align:right;white-space:nowrap}
.ln-v.mal{color:var(--am)}
/* La obra va aparte y grande, y no hay ninguna casilla donde teclearla. Ponerla
   «por si acaso» convertiría todo lo anterior en decoración. */
.obra{display:flex;align-items:baseline;justify-content:space-between;gap:16px;
  margin-top:16px;background:var(--cd);border:1px solid var(--ln);border-left:3px solid var(--grt);
  border-radius:13px;padding:16px 18px;box-shadow:var(--sh)}
.obra span{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  letter-spacing:.14em;text-transform:uppercase;color:var(--md)}
.obra b{font-family:"JetBrains Mono",monospace;font-size:26px;font-weight:700;
  letter-spacing:-.035em;color:var(--grt)}
.pad{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));padding:8px}
.c{display:block;padding:8px 10px}
.c span{display:block;font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md);margin-bottom:5px}
.c input{width:100%;font:inherit;font-size:14.5px;padding:8px 10px;border:1px solid var(--ln2);
  border-radius:9px;background:var(--cd);color:var(--ik)}
.cas{display:flex;align-items:flex-start;gap:11px;padding:10px 4px;cursor:pointer}
.cas input{margin:2px 0 0;width:17px;height:17px;accent-color:var(--grt);flex:none}
.cas span{font-size:14.5px}
.mal-caja{margin-top:18px;background:var(--cd);border:1px solid var(--rj);border-left-width:3px;
  border-radius:11px;padding:13px 17px}
.mal-caja li{color:var(--rj);font-weight:600;font-size:14px}
form button{margin-top:16px;font:inherit;font-size:15px;font-weight:700;padding:11px 22px;
  border:0;border-radius:11px;background:var(--nv);color:#E9F0F6;cursor:pointer}
form button:hover{background:var(--nv3)}
@media(max-width:520px){
  .ln{grid-template-columns:24px minmax(0,1fr);row-gap:6px}
  .ln-p,.ln-v{grid-column:2;text-align:left}
}
`
