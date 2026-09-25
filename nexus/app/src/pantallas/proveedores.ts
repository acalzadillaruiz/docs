/**
 * Las facturas de proveedor y sus retenciones.
 *
 * Una fila por factura, con los dos botones —IVA e ISLR— y lo ya retenido con su
 * número de comprobante al lado. El comprobante es lo que el proveedor pide por
 * teléfono, así que va a la vista y en monoespaciada.
 *
 * Lo que la pantalla avisa antes de pulsar: **sin número de control, la retención de
 * IVA es del 100% y no del 75%**. Es la ley y es lo primero que se discute con un
 * proveedor, y descubrirlo después de retener significa una nota y una llamada.
 */

import type { FacturaProveedor, Concepto } from '../dominio/proveedores.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera', factura: 'Factura', base: 'Base', iva: 'IVA' },
  en: { volver: 'Back to the portfolio', factura: 'Invoice', base: 'Base', iva: 'VAT' },
} as const

export function pintarProveedores(
  lista: readonly FacturaProveedor[], conceptos: readonly Concepto[],
  idioma: Idioma, antifalsificacion: string, errores: readonly string[] = [],
  esAgente = true,
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const filas = lista.length === 0
    ? `<p class="nada">${escapar(t('proveedor.nada'))}</p>`
    : lista.map((f) => `
<div class="fp${f.control ? '' : ' sin-control'}">
  <div class="fp-c">
    <div class="fp-n">${escapar(f.proveedor)}</div>
    <div class="fp-m">${escapar(x.factura)} ${escapar(f.numero)} · ${escapar(f.rif)} · ${escapar(f.fecha)}</div>
    <div class="fp-i">${escapar(x.base)} ${escapar(f.base)} · ${escapar(x.iva)} ${escapar(f.iva)}</div>
    ${f.control ? '' : `<div class="aviso">${escapar(t('proveedor.sin_control'))}: ${
      escapar(t('proveedor.sin_control_aviso'))}</div>`}
  </div>
  <div class="fp-a">
    ${f.retenidoIva !== null ? `<div class="hecho">${escapar(x.iva)} ${escapar(f.retenidoIva)}
      <span class="comp">${escapar(f.comprobanteIva ?? '')}</span></div>`
      : !f.tieneIva || !esAgente ? ''
      : `<form method="post" action="/proveedores">
          <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
          <input type="hidden" name="documento" value="${escapar(f.id)}">
          <input type="hidden" name="clase" value="iva">
          <button type="submit">${escapar(t('proveedor.retener_iva'))}</button>
        </form>`}

    ${f.retenidoIslr !== null ? `<div class="hecho">ISLR ${escapar(f.retenidoIslr)}
      <span class="comp">${escapar(f.comprobanteIslr ?? '')}</span></div>`
      : `<form method="post" action="/proveedores" class="islr">
          <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
          <input type="hidden" name="documento" value="${escapar(f.id)}">
          <input type="hidden" name="clase" value="islr">
          <select name="concepto" aria-label="${escapar(t('proveedor.concepto'))}">
            ${conceptos.map((c) => `<option value="${escapar(c.codigo)}">${
              escapar(c.nombre)}</option>`).join('')}
          </select>
          <button type="submit">${escapar(t('proveedor.retener_islr'))}</button>
        </form>`}
  </div>
</div>`).join('')

  return pagina({
    idioma,
    titulo: t('proveedor.titulo'),
    estilos: ESTILOS_PROVEEDORES,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('proveedor.titulo'))}</h1>
  <div class="sub">${escapar(t('proveedor.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((e) => `<li>${escapar(e)}</li>`).join('')
  }</ul></div>`}
  ${esAgente ? '' : `<p class="expl aviso-agente">${escapar(t('proveedor.no_agente'))}</p>`}
  <h2>${escapar(t('proveedor.pendientes'))}</h2>
  <div class="caja">${filas}</div>
</main>`,
  })
}

export const ESTILOS_PROVEEDORES = `
.fp{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;
  padding:14px 17px;border-top:1px solid var(--ln);flex-wrap:wrap}
.fp:first-child{border-top:0}
/* Sin número de control la retención es del 100%. Se marca la fila entera: es lo
   primero que se discute con un proveedor, y descubrirlo después cuesta una llamada. */
.fp.sin-control{border-left:3px solid var(--am);background:var(--amb)}
.fp-c{flex:1;min-width:220px}
.fp-n{font-size:15px;font-weight:700;letter-spacing:-.015em}
.fp-m{margin-top:3px;font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--md)}
.fp-i{margin-top:5px;font-family:"JetBrains Mono",monospace;font-size:12.5px;color:var(--ik2)}
.aviso{margin-top:7px;font-size:12.5px;color:var(--am);font-weight:600;line-height:1.4;
  max-width:52ch}
.fp-a{display:flex;flex-direction:column;gap:8px;align-items:flex-end}
.fp-a form{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.fp-a select{font:inherit;font-size:12.5px;padding:6px 8px;border:1px solid var(--ln2);
  border-radius:8px;background:var(--cd);color:var(--ik);max-width:200px}
.fp-a button{font:inherit;font-size:12.5px;font-weight:650;padding:7px 14px;
  border:1px solid var(--ln2);border-radius:8px;background:var(--cd);color:var(--ik);
  cursor:pointer;white-space:nowrap}
.fp-a button:hover{border-color:var(--grt);color:var(--grt)}
.hecho{font-family:"JetBrains Mono",monospace;font-size:12.5px;font-weight:700;
  color:var(--grt);text-align:right}
/* El comprobante es lo que el proveedor pide por teléfono. */
.comp{display:block;margin-top:2px;font-size:10.5px;font-weight:400;color:var(--md)}
.expl{margin:14px 0 0;font-size:13.5px;color:var(--ik2);line-height:1.45;max-width:64ch}
.expl.aviso-agente{color:var(--am);font-weight:600}
.mal-caja{margin-top:18px;background:var(--cd);border:1px solid var(--rj);border-left-width:3px;
  border-radius:11px;padding:13px 17px}
.mal-caja li{color:var(--rj);font-weight:600;font-size:14px}
`
