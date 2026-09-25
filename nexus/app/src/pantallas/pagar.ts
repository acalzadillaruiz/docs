/**
 * Lo que toca pagar, y el sitio donde se paga.
 *
 * La lista y el formulario van juntos a propósito. Una lista de deudas desde la que
 * no se puede pagar obliga a buscar la factura otra vez en otra pantalla, y ahí es
 * donde se acaba pagando la que no era.
 *
 * Debajo de cada deuda van **los pagos ya hechos**. Un pago que no se ve es un pago
 * que se hace dos veces, y con un proveedor eso no se descubre hasta el cierre.
 */

import type { Deuda } from '../dominio/pagar.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera' },
  en: { volver: 'Back to the portfolio' },
} as const

export type DatosPagar = {
  readonly deudas: readonly Deuda[]
  readonly medios: readonly { readonly codigo: string; readonly nombre: string }[]
  readonly hoy: string
}

function pintarDeuda(d: Deuda, datos: DatosPagar, af: string, t: ReturnType<typeof traductor>): string {
  const medios = datos.medios.map((m) =>
    `<option value="${escapar(m.codigo)}">${escapar(m.nombre)}</option>`).join('')
  return `
<div class="dd${d.dias > 60 ? ' viejo' : ''}">
  <div class="dd-h">
    <div>
      <div class="dd-t">${escapar(d.proveedor)}</div>
      <div class="dd-m">${escapar(t('pago.factura'))} ${escapar(d.factura)} · ${
        escapar(d.fecha)} · ${escapar(t('pago.dias').replace('{n}', String(d.dias)))}${
        d.contrato ? ` · ${escapar(d.contrato)}` : ''}</div>
    </div>
    <div class="dd-n">${escapar(d.saldo)}<span>${escapar(t('pago.saldo'))}</span></div>
  </div>

  ${d.pagos.length === 0 ? '' : `<div class="hechos">${d.pagos.map((p) => `
    <div class="hecho">
      <span>${escapar(p.fecha)} · ${escapar(p.medio)}${
        p.referencia ? ` · ${escapar(p.referencia)}` : ''}</span>
      <b>${escapar(p.monto)}</b>${p.asiento
        ? `<i>${escapar(t('pago.asiento'))} ${escapar(p.asiento)}</i>` : ''}
    </div>`).join('')}</div>`}

  <form method="post" action="/pagar" class="pagar">
    <input type="hidden" name="af" value="${escapar(af)}">
    <input type="hidden" name="documento" value="${escapar(d.documento)}">
    <label>${escapar(t('pago.fecha'))}
      <input type="date" name="fecha" value="${escapar(datos.hoy)}"></label>
    <label>${escapar(t('pago.medio'))}
      <select name="medio">${medios}</select></label>
    <label>${escapar(t('pago.moneda'))}
      <select name="moneda"><option value="VES">VES</option><option value="USD">USD</option></select></label>
    <label>${escapar(t('pago.monto'))}
      <input type="text" inputmode="decimal" name="monto"></label>
    <label class="ancho">${escapar(t('pago.referencia'))}
      <input type="text" name="referencia" maxlength="80"></label>
    <button type="submit">${escapar(t('pago.pagar'))}</button>
  </form>
</div>`
}

export function pintarPagar(
  d: DatosPagar, idioma: Idioma, antifalsificacion: string, errores: readonly string[] = [],
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  return pagina({
    idioma,
    titulo: t('pago.titulo'),
    estilos: ESTILOS_PAGAR,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('pago.titulo'))}</h1>
  <div class="sub">${escapar(t('pago.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((e) => `<li>${escapar(e)}</li>`).join('')
  }</ul></div>`}

  <p class="expl">${escapar(t('pago.igtf_explica'))}</p>

  ${d.deudas.length === 0
    ? `<p class="nada">${escapar(t('pago.nada'))}</p>`
    : d.deudas.map((u) => pintarDeuda(u, d, antifalsificacion, t)).join('')}
</main>`,
  })
}

export const ESTILOS_PAGAR = `
.expl{margin:16px 0 4px;font-size:13.5px;color:var(--ik2);line-height:1.45;max-width:66ch}
.dd{margin-top:14px;background:var(--cd);border:1px solid var(--ln);border-radius:15px;
  box-shadow:var(--sh);padding:16px 18px}
/* Una deuda de más de dos meses se señala. No es decoración: es lo que decide a
   quién se llama hoy. */
.dd.viejo{border-left:3px solid var(--am)}
.dd-h{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
.dd-t{font-size:15.5px;font-weight:700;letter-spacing:-.015em}
.dd-m{font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--md);margin-top:4px}
.dd-n{font-family:"JetBrains Mono",monospace;font-size:17px;font-weight:700;
  letter-spacing:-.03em;text-align:right;white-space:nowrap}
.dd-n span{display:block;margin-top:3px;font-size:9.5px;font-weight:400;letter-spacing:.1em;
  text-transform:uppercase;color:var(--md)}
.hechos{margin-top:12px;border-top:1px dashed var(--ln);padding-top:10px;display:grid;gap:6px}
.hecho{display:flex;align-items:baseline;gap:10px;font-family:"JetBrains Mono",monospace;
  font-size:11.5px;color:var(--ik2)}
.hecho span{flex:1;min-width:0}
.hecho b{font-weight:700;color:var(--ik)}
.hecho i{font-style:normal;color:var(--md);font-size:10px}
.pagar{display:flex;flex-wrap:wrap;gap:11px;align-items:flex-end;margin-top:13px;
  padding-top:12px;border-top:1px solid var(--ln)}
.pagar label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.pagar label.ancho{flex:1;min-width:170px}
.pagar input,.pagar select{display:block;margin-top:5px;width:100%;font:inherit;font-size:14px;
  padding:8px 10px;border:1px solid var(--ln2);border-radius:9px;background:var(--cd);
  color:var(--ik)}
.pagar button{font:inherit;font-size:14px;font-weight:700;padding:9px 20px;border:0;
  border-radius:9px;background:var(--nv);color:#E9F0F6;cursor:pointer}
@media(max-width:520px){
  .dd-n{text-align:left}
  .pagar label{flex:1;min-width:130px}
}
`
