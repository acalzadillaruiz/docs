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

export function pintarActivos(
  lista: readonly Equipo[], idioma: Idioma, antifalsificacion: string,
  anio: number, mes: number, errores: readonly string[] = [],
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

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

  <form method="post" action="/activos" class="depre">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <label>${escapar(x.anio)}
      <input type="number" name="anio" value="${anio}" min="2000" max="2100"></label>
    <label>${escapar(x.mes)}
      <input type="number" name="mes" value="${mes}" min="1" max="12"></label>
    <button type="submit">${escapar(t('activo.depreciar'))}</button>
  </form>

  <div class="caja">${filas}</div>
</main>`,
  })
}

export const ESTILOS_ACTIVOS = `
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
.mal-caja{margin-top:18px;background:var(--cd);border:1px solid var(--rj);border-left-width:3px;
  border-radius:11px;padding:13px 17px}
.mal-caja li{color:var(--rj);font-weight:600;font-size:14px}
`
