/**
 * Los meses contables.
 *
 * La pantalla más aburrida del sistema y una de las que más bloquean: el día 1 de
 * cada mes, sin el mes nuevo abierto, no entra ni una factura ni un cobro.
 *
 * Por eso lo primero que se ve es el botón de abrir el siguiente, con su nombre ya
 * escrito. Buscar el mes en un desplegable es un paso más entre alguien y lo que ha
 * venido a hacer.
 *
 * Cerrar va detrás, más discreto, y solo se ofrece en el mes más antiguo que siga
 * abierto: cerrar marzo dejando febrero abierto deja un agujero por el que entran
 * asientos a un mes que ya se declaró.
 */

import type { Meses } from '../dominio/periodos.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera' },
  en: { volver: 'Back to the portfolio' },
} as const

export function pintarPeriodos(
  m: Meses, idioma: Idioma, antifalsificacion: string, errores: readonly string[] = [],
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const filas = m.lista.map((p) => `
<div class="pr ${p.abierto ? 'abierto' : ''}">
  <div class="pr-c">
    <div class="pr-n">${escapar(p.nombre)}</div>
    <div class="pr-m">${p.asientos} ${escapar(t('periodo.asientos'))}${
      p.cuadra ? '' : ` · <span class="desc">${escapar(p.descuadre)}</span>`}</div>
  </div>
  <div class="pr-e">${escapar(p.abierto ? t('periodo.abierto') : t('periodo.cerrado'))}</div>
  ${!p.puedeCerrar ? '' : `
  <form method="post" action="/periodos">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <input type="hidden" name="accion" value="cerrar">
    <input type="hidden" name="anio" value="${p.anio}">
    <input type="hidden" name="mes" value="${p.mes}">
    <button type="submit" class="sec">${escapar(t('periodo.cerrar'))}</button>
  </form>`}
</div>`).join('')

  return pagina({
    idioma,
    titulo: t('periodo.titulo'),
    estilos: ESTILOS_PERIODOS,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('periodo.titulo'))}</h1>
  <div class="sub">${escapar(t('periodo.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((e) => `<li>${escapar(e)}</li>`).join('')
  }</ul></div>`}

  ${!m.siguiente ? '' : `
  <form method="post" action="/periodos" class="abrir">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <input type="hidden" name="accion" value="abrir">
    <input type="hidden" name="anio" value="${m.siguiente.anio}">
    <input type="hidden" name="mes" value="${m.siguiente.mes}">
    <div>
      <span>${escapar(t('periodo.siguiente'))}</span>
      <b>${escapar(m.siguiente.nombre)}</b>
    </div>
    <button type="submit">${escapar(t('periodo.abrir'))}</button>
  </form>`}

  <div class="caja">${filas || `<p class="nada">—</p>`}</div>
  <p class="expl">${escapar(t('periodo.cerrar_aviso'))}</p>
</main>`,
  })
}

export const ESTILOS_PERIODOS = `
/* Lo primero que se ve es abrir el siguiente, con su nombre ya escrito: buscar el
   mes en un desplegable es un paso más entre alguien y lo que ha venido a hacer. */
.abrir{display:flex;align-items:center;justify-content:space-between;gap:16px;
  flex-wrap:wrap;margin-top:18px;margin-bottom:18px;background:var(--cd);
  border:1px solid var(--ln);border-left:3px solid var(--grt);border-radius:13px;
  padding:15px 18px;box-shadow:var(--sh)}
.abrir span{display:block;font-family:"JetBrains Mono",monospace;font-size:9.5px;
  font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--md)}
.abrir b{display:block;margin-top:4px;font-size:19px;font-weight:750;letter-spacing:-.02em;
  text-transform:capitalize}
.abrir button{margin:0;font:inherit;font-size:14.5px;font-weight:700;padding:10px 20px;
  border:0;border-radius:11px;background:var(--grt);color:var(--sobre-grt);cursor:pointer}
.pr{display:flex;align-items:center;gap:14px;padding:13px 16px;border-top:1px solid var(--ln)}
.pr:first-child{border-top:0}
.pr-c{flex:1;min-width:0}
.pr-n{font-size:14.5px;font-weight:650;text-transform:capitalize}
.pr-m{margin-top:3px;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--md)}
.pr-m .desc{color:var(--rj);font-weight:700}
.pr-e{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.1em;text-transform:uppercase;color:var(--md);white-space:nowrap}
.pr.abierto .pr-e{color:var(--grt)}
.pr form{margin:0}
.pr button{margin:0;font:inherit;font-size:12.5px;font-weight:650;padding:6px 14px;
  border:1px solid var(--ln2);border-radius:8px;background:transparent;color:var(--ik2);
  cursor:pointer}
.pr button:hover{color:var(--ik)}
.expl{margin:14px 0 0;font-size:13px;color:var(--ik2);line-height:1.45;max-width:66ch}
.mal-caja{margin-top:18px;background:var(--cd);border:1px solid var(--rj);border-left-width:3px;
  border-radius:11px;padding:13px 17px}
.mal-caja li{color:var(--rj);font-weight:600;font-size:14px}
`
