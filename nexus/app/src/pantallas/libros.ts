/**
 * Los libros de ventas y de compras, en pantalla.
 *
 * De todo lo que hay en esta aplicación, esto es lo único que sale de la empresa con
 * destino al SENIAT. Así que la pantalla no está hecha para lucir: está hecha para
 * que los totales sean exactamente los de la declaración y para que el libro se baje
 * sin volver a teclear nada.
 *
 * Dos decisiones:
 *
 *   - **Los totales van arriba**, antes de la tabla. Es lo que se copia en la
 *     declaración; lo de abajo es el detalle que lo sostiene.
 *   - **Una factura de compra sin número de control sale señalada.** No es un hueco
 *     estético: sin control no hay derecho a crédito fiscal y la retención de IVA
 *     pasa al 100%. Que se vea en el libro es lo que hace que alguien la reclame a
 *     tiempo, en vez de descubrirlo al declarar.
 */

import type { Libro } from '../dominio/libros.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera', anio: 'Año', mes: 'Mes', ver: 'Ver' },
  en: { volver: 'Back to the portfolio', anio: 'Year', mes: 'Month', ver: 'View' },
} as const

export function pintarLibro(l: Libro, idioma: Idioma, antifalsificacion: string): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const ventas = l.cual === 'ventas'
  const mm = String(l.mes).padStart(2, '0')

  const tabla = l.cuantas === 0
    ? `<p class="nada">${escapar(t('libro.vacio'))}</p>`
    : `<div class="ancho"><table class="lb">
  <thead><tr>
    <th>${escapar(t('libro.fecha'))}</th>
    <th>${escapar(t(ventas ? 'libro.rif_cliente' : 'libro.rif_proveedor'))}</th>
    <th>${escapar(t('libro.nombre_col'))}</th>
    <th>${escapar(t('libro.numero'))}</th>
    <th>${escapar(t('libro.control'))}</th>
    <th class="n">${escapar(t('libro.base'))}</th>
    <th class="n">${escapar(t('libro.alicuota'))}</th>
    <th class="n">${escapar(t(ventas ? 'libro.debito' : 'libro.credito'))}</th>
    <th class="n">${escapar(t('libro.total'))}</th>
  </tr></thead>
  <tbody>${l.lineas.map((a) => `
    <tr>
      <td class="m">${escapar(a.fecha)}</td>
      <td class="m">${escapar(a.rif)}</td>
      <td>${escapar(a.nombre)}${a.afecta
        ? ` <span class="af">${escapar(t('libro.afecta'))} ${escapar(a.afecta)}</span>` : ''}</td>
      <td class="m">${escapar(a.numero)}</td>
      <td class="m">${a.control
        ? escapar(a.control)
        : `<span class="sin" title="${escapar(t('libro.sin_control_aviso'))}">${
            escapar(t('libro.sin_control'))}</span>`}</td>
      <td class="n">${escapar(a.base)}</td>
      <td class="n">${escapar(a.alicuota ?? '—')}</td>
      <td class="n">${escapar(a.iva)}</td>
      <td class="n">${escapar(a.total)}</td>
    </tr>`).join('')}
  </tbody>
</table></div>`

  return pagina({
    idioma,
    titulo: t(ventas ? 'libro.ventas' : 'libro.compras'),
    estilos: ESTILOS_LIBRO,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t(ventas ? 'libro.ventas' : 'libro.compras'))}</h1>
  <div class="sub">${escapar(t('libro.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  <form method="get" action="/libros" class="sel">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <label>${escapar(t('libro.cual'))}
      <select name="cual">
        <option value="ventas"${ventas ? ' selected' : ''}>${escapar(t('libro.ventas'))}</option>
        <option value="compras"${ventas ? '' : ' selected'}>${escapar(t('libro.compras'))}</option>
      </select></label>
    <label>${escapar(x.anio)}
      <input type="number" name="anio" value="${l.anio}" min="2000" max="2100"></label>
    <label>${escapar(x.mes)}
      <input type="number" name="mes" value="${l.mes}" min="1" max="12"></label>
    <button type="submit">${escapar(x.ver)}</button>
  </form>

  <div class="tot">
    <div class="tot-e">${escapar(t('libro.totales'))} · ${escapar(mm)}/${l.anio}</div>
    <div class="tot-g">
      <div><span>${escapar(t('libro.base'))}</span>${escapar(l.totalBase)}</div>
      <div><span>${escapar(t(ventas ? 'libro.debito' : 'libro.credito'))}</span>${escapar(l.totalIva)}</div>
      <div><span>${escapar(t('libro.exento'))}</span>${escapar(l.totalExento)}</div>
      <div><span>${escapar(t('libro.retenido'))}</span>${escapar(l.totalRetenido)}</div>
      <div class="gr"><span>${escapar(t('libro.total'))}</span>${escapar(l.total)}</div>
    </div>
    <p class="tot-x">${escapar(t('libro.totales_explica'))}</p>
  </div>

  <a class="baja" href="/libros/hoja?cual=${escapar(l.cual)}&amp;anio=${l.anio}&amp;mes=${l.mes}"
     >${escapar(t('libro.bajar'))}</a>

  <div class="caja">${tabla}</div>
  ${ventas ? '' : `<p class="expl">${escapar(t('libro.sin_control_aviso'))}</p>`}
</main>`,
  })
}

export const ESTILOS_LIBRO = `
.sel{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin:18px 0 6px}
.sel label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.sel input,.sel select{display:block;margin-top:5px;font:inherit;font-size:14px;
  padding:8px 10px;border:1px solid var(--ln2);border-radius:9px;background:var(--cd);
  color:var(--ik)}
.sel input{width:100px}
.sel button{font:inherit;font-size:14px;font-weight:700;padding:9px 20px;border:0;
  border-radius:9px;background:var(--nv);color:#E9F0F6;cursor:pointer}
/* Los totales van arriba: es lo que se copia en la declaración. */
.tot{margin-top:14px;background:var(--cd);border:1px solid var(--ln2);border-radius:13px;
  padding:16px 18px}
.tot-e{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.tot-g{margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));
  gap:12px}
.tot-g div{font-family:"JetBrains Mono",monospace;font-size:16px;font-weight:700;
  letter-spacing:-.025em}
.tot-g div.gr{font-size:20px;color:var(--grt)}
.tot-g span{display:block;font-size:8.5px;font-weight:700;letter-spacing:.13em;
  text-transform:uppercase;color:var(--md);margin-bottom:3px;font-family:"JetBrains Mono",monospace}
.tot-x{margin:11px 0 0;font-size:12.5px;color:var(--md);line-height:1.45;max-width:64ch}
/* El azul marino se lee sobre blanco y desaparece sobre el fondo oscuro, porque no
   cambia con el tema. El color de enlace sí cambia. Lo escribí yo esta misma mañana. */
.baja{display:inline-block;margin:16px 0 4px;font-size:14px;font-weight:650;
  color:var(--enl);text-decoration:none;border-bottom:1px solid var(--ln2);padding-bottom:1px}
.baja:hover{color:var(--ik)}
/* La tabla es ancha por naturaleza —son las columnas que pide el SENIAT—, así que en
   un móvil se arrastra ella sola en vez de arrastrar la página entera. */
.ancho{overflow-x:auto}
.lb{width:100%;border-collapse:collapse;font-size:13px}
.lb th{text-align:left;padding:9px 11px;font-family:"JetBrains Mono",monospace;font-size:8.5px;
  font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--md);
  border-bottom:1px solid var(--ln);white-space:nowrap}
.lb th.n,.lb td.n{text-align:right;font-family:"JetBrains Mono",monospace;white-space:nowrap}
.lb td{padding:8px 11px;border-top:1px solid var(--ln)}
.lb td.m{font-family:"JetBrains Mono",monospace;font-size:12px;white-space:nowrap}
.lb .af{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--md)}
/* Sin control no hay credito fiscal y la retencion pasa al 100%: que se vea aqui es
   lo que hace que alguien la reclame a tiempo. */
.lb .sin{color:var(--am);font-weight:700;font-size:11px}
.expl{margin:12px 0 0;font-size:13px;color:var(--ik2);line-height:1.45;max-width:64ch}
.nada{padding:17px;color:var(--ik2);font-size:14px;margin:0}
`
