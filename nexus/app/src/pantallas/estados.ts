/**
 * Los estados contables.
 *
 * Tres decisiones:
 *
 *   - **Si el balance no balancea, se dice arriba y en ámbar.** El activo tiene que
 *     ser igual al pasivo más el patrimonio; si no lo es hay un asiento a medias y
 *     ninguna cifra de abajo se sostiene. Enseñarlas sin avisar es peor que no
 *     enseñarlas.
 *   - **Lo que nos deben y lo que debemos van juntos**, uno al lado del otro. Mirar
 *     solo el cobro es como se decide gastar un dinero ya comprometido.
 *   - **La antigüedad se ve de un vistazo, no leyendo números de días.** Una deuda de
 *     120 días no es la misma que una de 20 aunque el importe sea igual, así que el
 *     tramo va marcado por color: lo de más de 90 en rojo.
 */

import type { Estados, Deuda } from '../dominio/estados.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera' },
  en: { volver: 'Back to the portfolio' },
} as const

const COLOR: Record<Deuda['tramo'], string> = {
  '0-30': 'ok', '31-60': 'tib', '61-90': 'ojo', '90+': 'mal',
}

export function pintarEstados(e: Estados, idioma: Idioma, antifalsificacion: string): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const nombreSeccion = (cual: string) =>
    cual === 'activo' ? t('est.activo') : cual === 'pasivo' ? t('est.pasivo') : t('est.patrimonio')

  const deudas = (titulo: string, lista: readonly Deuda[], total: string, vacio: string) => `
<div class="col">
  <h2>${escapar(titulo)}</h2>
  ${lista.length === 0 ? `<p class="nada">${escapar(vacio)}</p>` : `
  <div class="caja"><div class="ancho"><table class="et">
    <thead><tr>
      <th>${escapar(t('est.quien'))}</th>
      <th>${escapar(t('est.referencia'))}</th>
      <th class="n">${escapar(t('est.dias'))}</th>
      <th class="n">${escapar(t('est.saldo'))}</th>
    </tr></thead>
    <tbody>${lista.map((d) => `
      <tr>
        <td>${escapar(d.quien)}</td>
        <td class="m">${escapar(d.referencia)}</td>
        <td class="n"><span class="tr ${COLOR[d.tramo]}">${d.dias}</span></td>
        <td class="n">${escapar(d.saldo)}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot><tr>
      <td colspan="3">${escapar(t('est.total'))}</td>
      <td class="n"><b>${escapar(total)}</b></td>
    </tr></tfoot>
  </table></div></div>`}
</div>`

  const vacio = e.secciones.every((s) => s.lineas.length === 0)

  return pagina({
    idioma,
    titulo: t('est.titulo'),
    estilos: ESTILOS_ESTADOS,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('est.titulo'))}</h1>
  <div class="sub">${escapar(t('est.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${e.cuadra ? '' : `<div class="aviso">
    <b>${escapar(t('est.no_balancea'))} ${escapar(e.descuadre)}</b>
    <p>${escapar(t('est.no_balancea_explica'))}</p>
  </div>`}

  <form method="get" action="/estados" class="sel">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <label>${escapar(t('est.al'))}
      <input type="date" name="al" value="${escapar(e.al)}"></label>
    <button type="submit">${escapar(t('est.ver'))}</button>
  </form>

  ${vacio ? `<p class="nada">${escapar(t('est.vacio'))}</p>` : `
  <h2>${escapar(t('est.balance'))}</h2>
  <div class="tres">${e.secciones.map((s) => `
    <div class="caja bl">
      <div class="bl-t">${escapar(nombreSeccion(s.cual))}</div>
      ${s.lineas.map((l) => `
      <div class="bl-l">
        <span class="cod">${escapar(l.codigo)}</span>
        <span class="nom">${escapar(l.cuenta)}</span>
        <span class="mto">${escapar(l.monto)}</span>
      </div>`).join('')}
      <div class="bl-f"><span>${escapar(t('est.total'))}</span><b>${escapar(s.total)}</b></div>
    </div>`).join('')}
  </div>`}

  <div class="dos">
    ${deudas(t('est.cobrar'), e.cobrar, e.totalCobrar, t('est.nada_cobrar'))}
    ${deudas(t('est.pagar'), e.pagar, e.totalPagar, t('est.nada_pagar'))}
  </div>
  <p class="expl">${escapar(t('est.juntas_explica'))}</p>

  ${e.comprobacion.length === 0 ? '' : `
  <h2>${escapar(t('est.comprobacion'))}</h2>
  <div class="caja"><div class="ancho"><table class="et">
    <thead><tr>
      <th>${escapar(t('est.cuenta'))}</th>
      <th class="n">${escapar(t('est.debe'))}</th>
      <th class="n">${escapar(t('est.haber'))}</th>
      <th class="n">${escapar(t('est.saldo'))}</th>
    </tr></thead>
    <tbody>${e.comprobacion.map((c) => `
      <tr>
        <td><span class="cod">${escapar(c.codigo)}</span> ${escapar(c.cuenta)}</td>
        <td class="n">${escapar(c.debe)}</td>
        <td class="n">${escapar(c.haber)}</td>
        <td class="n">${escapar(c.saldo)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div></div>
  <p class="expl">${escapar(t('est.comprobacion_explica'))}</p>`}
</main>`,
  })
}

export const ESTILOS_ESTADOS = `
.sel{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin:18px 0 6px}
.sel label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.sel input{display:block;margin-top:5px;font:inherit;font-size:14px;padding:8px 10px;
  border:1px solid var(--ln2);border-radius:9px;background:var(--cd);color:var(--ik)}
.sel button{font:inherit;font-size:14px;font-weight:700;padding:9px 20px;border:0;
  border-radius:9px;background:var(--nv);color:#E9F0F6;cursor:pointer}
.aviso{margin-top:18px;background:var(--amb);border:1px solid var(--am);
  border-left-width:3px;border-radius:12px;padding:14px 17px}
.aviso b{color:var(--am);font-size:15px}
.aviso p{margin:6px 0 0;font-size:13px;color:var(--ik2);line-height:1.45;max-width:64ch}
h2{margin:26px 0 10px;font-family:"JetBrains Mono",monospace;font-size:10.5px;
  font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--md)}
.tres{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:13px}
.dos{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
.bl{padding:15px 16px}
.bl-t{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md);margin-bottom:9px}
.bl-l{display:flex;align-items:baseline;gap:8px;padding:5px 0;font-size:13px}
.bl-l .cod{font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--md)}
.bl-l .nom{flex:1;min-width:0}
.bl-l .mto{font-family:"JetBrains Mono",monospace;font-size:12.5px;white-space:nowrap}
.bl-f{display:flex;justify-content:space-between;align-items:baseline;gap:10px;
  margin-top:9px;padding-top:9px;border-top:1px solid var(--ln)}
.bl-f span{font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.bl-f b{font-family:"JetBrains Mono",monospace;font-size:15px;letter-spacing:-.02em}
.ancho{overflow-x:auto}
.et{width:100%;border-collapse:collapse;font-size:13px}
.et th{text-align:left;padding:8px 11px;font-family:"JetBrains Mono",monospace;
  font-size:8.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  color:var(--md);border-bottom:1px solid var(--ln);white-space:nowrap}
.et th.n,.et td.n{text-align:right;font-family:"JetBrains Mono",monospace;white-space:nowrap}
.et td{padding:8px 11px;border-top:1px solid var(--ln)}
.et td.m{font-family:"JetBrains Mono",monospace;font-size:11.5px}
.et .cod{font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--md);margin-right:5px}
.et tfoot td{border-top:1px solid var(--ln2);font-family:"JetBrains Mono",monospace;
  font-size:9px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.et tfoot td.n{font-size:13.5px;letter-spacing:-.02em;text-transform:none;color:var(--ik)}
/* La antigüedad se ve de un vistazo. 120 días no es lo mismo que 20 aunque el
   importe sea igual, y leyendo números de días eso no salta. */
.tr{display:inline-block;min-width:34px;padding:2px 7px;border-radius:99px;
  font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700}
.tr.ok{color:var(--grt);border:1px solid var(--grt)}
.tr.tib{color:var(--ik2);border:1px solid var(--ln2)}
.tr.ojo{color:var(--am);border:1px solid var(--am)}
.tr.mal{color:var(--rj);border:1px solid var(--rj)}
.expl{margin:11px 0 0;font-size:12.5px;color:var(--md);line-height:1.45;max-width:64ch}
.nada{padding:17px;color:var(--ik2);font-size:14px;margin:0}
.col{min-width:0}
`
