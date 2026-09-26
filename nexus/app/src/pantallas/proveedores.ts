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

import type { FacturaProveedor, Concepto, Regimen } from '../dominio/proveedores.ts'
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
  /**
   * El régimen de IVA registrado. Va al final y con valor por omisión para no romper a
   * quien ya llamaba a esta función sin él.
   */
  regimen: readonly Regimen[] = [],
  hoy = new Date().toISOString().slice(0, 10),
  hecho: string | null = null,
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const af = escapar(antifalsificacion)

  // El aviso decía «hay que registrarlo en su régimen de IVA» y no había forma de
  // registrarlo: la tabla la escribían solo las pruebas. Sin una fila aquí, la
  // retención de IVA a proveedores —que para un contribuyente especial es una
  // obligación, no una opción— no se podía hacer nunca.
  const formulario = `
<h2>${escapar(t('regimen.titulo'))}</h2>
<p class="expl">${escapar(t('regimen.explica'))}</p>
<form method="post" action="/proveedores" class="reg">
  <input type="hidden" name="af" value="${af}">
  <input type="hidden" name="accion" value="regimen">
  <label>${escapar(t('regimen.desde'))}
    <input type="date" name="r_desde" value="${escapar(hoy)}"></label>
  <label class="an">${escapar(t('regimen.especial'))}
    <select name="r_especial">
      <option value="si">${escapar(t('regimen.especial.si'))}</option>
      <option value="no">${escapar(t('regimen.especial.no'))}</option>
    </select></label>
  <label>${escapar(t('regimen.normal'))}
    <input type="text" name="r_normal" inputmode="decimal" value="75"></label>
  <label>${escapar(t('regimen.falla'))}
    <input type="text" name="r_falla" inputmode="decimal" value="100"></label>
  <button type="submit">${escapar(t('regimen.guardar'))}</button>
</form>
<p class="expl">${escapar(t('regimen.falla_explica'))}</p>

<h2>${escapar(t('regimen.historico'))}</h2>
<div class="caja">${regimen.length === 0
  ? `<p class="nada">${escapar(t('regimen.sin_historico'))}</p>`
  : regimen.map((r) => `
<div class="rg">
  <div class="rg-c">
    <div class="rg-d">${escapar(r.desde)}</div>
    <div class="rg-e">${escapar(t(r.esEspecial
      ? 'regimen.especial.si' : 'regimen.especial.no'))}</div>
  </div>
  <div class="rg-p">
    <span>${escapar(r.normal)} %</span>
    <span class="rg-f">${escapar(r.falla)} %</span>
  </div>
  <div class="rg-n">${r.retenciones} ${escapar(t('regimen.retenciones'))}</div>
</div>`).join('')}</div>`

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
  ${hecho === null ? '' : `<div class="bien-caja">${escapar(hecho)}</div>`}
  ${esAgente ? '' : `<p class="expl aviso-agente">${escapar(t('proveedor.no_agente'))}</p>`}
  <h2>${escapar(t('proveedor.pendientes'))}</h2>
  <div class="caja">${filas}</div>

  ${formulario}
</main>`,
  })
}

export const ESTILOS_PROVEEDORES = `
/* Lo que salió bien se dice igual de claro que lo que salió mal. */
.reg{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;
  align-items:end;margin:0 0 6px}
.reg label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.reg label.an{grid-column:span 2}
.reg input,.reg select{display:block;margin-top:5px;width:100%;font:inherit;font-size:14px;
  padding:8px 10px;border:1px solid var(--ln2);border-radius:9px;background:var(--cd);
  color:var(--ik)}
.reg button{grid-column:1/-1;justify-self:start;font:inherit;font-size:14px;font-weight:700;
  padding:9px 20px;border:0;border-radius:9px;background:var(--nv);color:#E9F0F6;
  cursor:pointer}
.rg{display:flex;align-items:baseline;justify-content:space-between;gap:14px;
  padding:13px 17px;border-top:1px solid var(--ln);flex-wrap:wrap}
.rg:first-child{border-top:0}
.rg-d{font-family:"JetBrains Mono",monospace;font-size:14px;font-weight:700;
  letter-spacing:-.01em}
.rg-e{font-size:13px;color:var(--ik2);margin-top:3px}
.rg-p{display:flex;gap:10px;font-family:"JetBrains Mono",monospace;font-size:13.5px;
  font-weight:700}
/* El porcentaje de la factura defectuosa va en ámbar: es el que duele. */
.rg-p .rg-f{color:var(--am)}
.rg-n{font-family:"JetBrains Mono",monospace;font-size:10.5px;letter-spacing:.06em;
  color:var(--md)}
@media(max-width:520px){ .reg label.an{grid-column:1/-1} }
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
`
