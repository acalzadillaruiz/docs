/**
 * El estado de un contrato, en pantalla.
 *
 * Dos cosas van delante de todo lo demás:
 *
 *   1. **Si terminó tarde, y cuánto.** Es el dato por el que existe `fin_real`, y el que
 *      nadie podía contestar: la columna no la escribía nadie. Un contrato cerrado sin
 *      decir cuándo terminó de verdad es un contrato del que no se aprende nada.
 *   2. **Lo que falta para poder liquidarlo, con su cifra.** No un botón que se pulsa y
 *      contesta «no se puede», que manda a buscar; una frase que dice «quedan 12.400 sin
 *      cobrar», que manda a cobrar.
 *
 * Y el motivo escrito es un campo obligatorio y no un adorno: es lo que impide que un
 * formulario mandado sin tocar nada suspenda un contrato — el fallo que ya salió dos veces,
 * con dar de baja a una persona y con quitar un paso de una plantilla.
 */

import type { Situacion, EstadoContrato } from '../dominio/ciclo.ts'
import { traductor, type Clave, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver al contrato' },
  en: { volver: 'Back to the contract' },
} as const

/** Días entre dos fechas ISO. Positivo si la primera es posterior. */
function dias(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)
}

export function pintarCiclo(
  s: Situacion, codigo: string, contratoId: string, idioma: Idioma,
  antifalsificacion: string, errores: readonly string[] = [], hecho: string | null = null,
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const af = escapar(antifalsificacion)
  const nombreDe = (e: EstadoContrato) => t(`contrato.estado.${e}` as Clave)

  // Tarde o pronto, dicho en días. Solo cuando hay las dos fechas: sin fin previsto no hay
  // con qué comparar, y decir «a tiempo» sin plazo sería inventarse que se cumplió.
  const puntualidad = (() => {
    if (s.finReal === null || s.finPrevisto === null) return ''
    const d = dias(s.finReal, s.finPrevisto)
    if (d === 0) return `<div class="pu igual">${escapar(t('ciclo.a_tiempo'))}</div>`
    return `<div class="pu ${d > 0 ? 'tarde' : 'pronto'}"><b>${Math.abs(d)}</b> ${
      escapar(t(d > 0 ? 'ciclo.tarde' : 'ciclo.pronto'))}</div>`
  })()

  const cambiaFecha = s.pasos.includes('cerrado')

  return pagina({
    idioma,
    titulo: t('ciclo.titulo'),
    estilos: ESTILOS_CICLO,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/contratos/${escapar(contratoId)}">← ${escapar(x.volver)}</a>
  <div class="cod">${escapar(codigo)}</div>
  <h1>${escapar(t('ciclo.titulo'))}</h1>
  <div class="sub">${escapar(t('ciclo.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((e) => `<li>${escapar(e)}</li>`).join('')}</ul></div>`}
  ${hecho === null ? '' : `<div class="bien-caja">${escapar(hecho)}</div>`}

  <section class="ahora">
    <div class="ah-e">
      <span>${escapar(t('ciclo.ahora'))}</span>
      <b>${escapar(nombreDe(s.estado))}</b>
    </div>
    <div class="ah-f">
      <div><span>${escapar(t('ciclo.fin_previsto'))}</span>
        <b>${escapar(s.finPrevisto ?? '—')}</b></div>
      <div><span>${escapar(t('ciclo.fin_real'))}</span>
        <b>${s.finReal === null
          ? `<em>${escapar(t('ciclo.sin_fin_real'))}</em>`
          : escapar(s.finReal)}</b></div>
    </div>
    ${puntualidad}
  </section>

  ${s.estado === 'liquidado'
    ? `<p class="expl final">${escapar(t('ciclo.final'))}</p>`
    : s.faltaLiquidar.length === 0
      ? `<p class="expl bien">${escapar(t('ciclo.puede_liquidar'))}</p>`
      : `<div class="falta">
    <h2>${escapar(t('ciclo.falta_titulo'))}</h2>
    <ul>${s.faltaLiquidar.map((f) => `<li>${escapar(f)}</li>`).join('')}</ul>
  </div>`}

  ${s.pasos.length === 0 ? '' : `
  <section class="fs">
    <h2>${escapar(t('ciclo.hacia'))}</h2>
    <form method="post" action="/contratos/${escapar(contratoId)}/estado" class="pf">
      <input type="hidden" name="af" value="${af}">
      <label>${escapar(t('ciclo.titulo'))}
        <select name="a">${s.pasos.map((e) =>
          `<option value="${e}">${escapar(nombreDe(e))}</option>`).join('')}
        </select></label>
      ${cambiaFecha
        ? `<label>${escapar(t('ciclo.fecha_fin'))}
        <input type="date" name="fin_real"></label>` : ''}
      <label class="an">${escapar(t('ciclo.motivo'))}
        <input type="text" name="motivo" maxlength="200" autocomplete="off"></label>
      <p class="expl an">${escapar(t('ciclo.motivo_explica'))}</p>
      <button type="submit">${escapar(t('ciclo.hacer'))}</button>
    </form>
  </section>`}

  <section class="fs">
    <h2>${escapar(t('ciclo.historia'))}</h2>
    <div class="caja">${s.historia.length === 0
      ? `<p class="nada">${escapar(t('ciclo.sin_historia'))}</p>`
      : s.historia.map((c) => `
    <div class="cb">
      <div class="cb-d">${escapar(c.cuando)}</div>
      <div class="cb-c">
        <div class="cb-p">${escapar(nombreDe(c.de))} → <b>${escapar(nombreDe(c.a))}</b></div>
        <div class="cb-m">${escapar(c.motivo)}</div>
        <div class="cb-q">${escapar(c.quien)}${
          c.finReal === null ? '' : ` · ${escapar(t('ciclo.fin_real'))} ${escapar(c.finReal)}`}</div>
      </div>
    </div>`).join('')}</div>
  </section>
</main>`,
  })
}

const ESTILOS_CICLO = `
.cod{font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;
  letter-spacing:.14em;text-transform:uppercase;color:#7691A8}
.ahora{background:var(--cd);border:1px solid var(--ln);border-radius:13px;
  padding:16px 19px;display:grid;gap:13px}
.ah-e span,.ah-f span{display:block;font-family:"JetBrains Mono",monospace;font-size:9.5px;
  font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.ah-e b{display:block;margin-top:4px;font-size:22px;font-weight:800;letter-spacing:-.03em}
.ah-f{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:13px}
.ah-f b{display:block;margin-top:4px;font-family:"JetBrains Mono",monospace;font-size:15px;
  font-weight:700;font-variant-numeric:tabular-nums}
.ah-f em{font-style:normal;font-family:Inter,sans-serif;font-size:13px;font-weight:400;
  color:var(--md)}
.pu{font-size:14px;padding:9px 13px;border-radius:10px;background:var(--cd2);
  border:1px solid var(--ln)}
.pu b{font-family:"JetBrains Mono",monospace;font-size:17px;font-weight:700}
.pu.tarde{color:var(--rj);border-color:var(--rj)}
.pu.pronto,.pu.igual{color:var(--grt);border-color:var(--grt)}
.falta{margin-top:17px;background:var(--amb);border:1px solid var(--am);border-radius:13px;
  padding:14px 17px}
.falta h2{margin:0 0 7px;font-size:15px;font-weight:700;color:var(--am)}
.falta ul{margin:0;padding-left:19px;font-size:14px;line-height:1.5;color:var(--ik2)}
.expl{margin:17px 0 0;font-size:13.5px;line-height:1.5;color:var(--ik2);max-width:70ch}
.expl.bien{color:var(--grt);font-weight:600}
.expl.final{font-weight:600}
.fs{margin:26px 0 0}
.fs h2{margin:0 0 11px;font-size:17px;font-weight:700;letter-spacing:-.018em}
.caja{background:var(--cd);border:1px solid var(--ln);border-radius:13px;overflow:hidden}
.nada{margin:0;padding:15px 17px;font-size:14px;color:var(--md)}
.cb{display:grid;grid-template-columns:96px minmax(0,1fr);gap:4px 15px;padding:12px 17px}
.cb + .cb{border-top:1px solid var(--ln)}
.cb-d{font-family:"JetBrains Mono",monospace;font-size:12.5px;font-weight:700;
  color:var(--md);font-variant-numeric:tabular-nums}
.cb-p{font-size:14.5px}
.cb-m{font-size:13.5px;line-height:1.45;color:var(--ik2);margin-top:2px}
.cb-q{font-family:"JetBrains Mono",monospace;font-size:10.5px;font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;color:var(--md);margin-top:4px}
.pf{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:13px;
  padding:15px 17px;background:var(--cd);border:1px solid var(--ln);border-radius:13px}
.pf label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.pf label.an,.pf .expl.an{grid-column:1/-1}
.pf .expl.an{margin:0;font-size:12.5px}
.pf input[type=text],.pf input[type=date],.pf select{display:block;margin-top:5px;
  width:100%;font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--ln2);
  border-radius:9px;background:var(--cd);color:var(--ik)}
.pf button{grid-column:1/-1;justify-self:start;font:inherit;font-size:14px;font-weight:700;
  padding:9px 20px;border:0;border-radius:9px;background:var(--nv);color:#E9F0F6;
  cursor:pointer}
@media(max-width:520px){
  .cb{grid-template-columns:minmax(0,1fr)}
  .cb-c{grid-column:1}
}
`
