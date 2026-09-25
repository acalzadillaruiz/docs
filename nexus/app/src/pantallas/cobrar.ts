/**
 * Registrar un cobro.
 *
 * Un formulario corto, y lo corto es deliberado: registrar un cobro es lo que se
 * hace con el extracto del banco abierto al lado y prisa. Cuatro campos, y el
 * importe que queda por cobrar en grande arriba para no tener que buscarlo.
 *
 * Lo que sí se dice, porque cuesta dinero saberlo tarde: que un cobro en divisa
 * causa IGTF del 3%. El impuesto grava el pago, no la factura, así que esa decisión
 * se toma aquí y no al facturar.
 */

import type { EstadoCobro } from '../dominio/cobrar.ts'
import { MEDIOS, nombreMedio } from '../dominio/cobrar.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la valuación', numero: 'Valuación' },
  en: { volver: 'Back to the progress payment', numero: 'Progress payment' },
} as const

export function pintarCobrar(
  e: EstadoCobro, idioma: Idioma, antifalsificacion: string,
  hoy: string, errores: readonly string[] = [],
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const historial = e.cobros.length === 0 ? '' : `
<div class="caja">${e.cobros.map((c) => `
<div class="cb">
  <div class="cb-c">
    <div class="cb-f">${escapar(c.fecha)}</div>
    <div class="cb-m">${escapar(nombreMedio(idioma, c.medio))}${
      c.referencia ? ` · ${escapar(c.referencia)}` : ''}</div>
  </div>
  <div class="cb-i">${escapar(c.monto)}</div>
</div>`).join('')}</div>`

  return pagina({
    idioma,
    titulo: `${t('cobrar.titulo')} · ${e.contrato}`,
    estilos: ESTILOS_COBRAR,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/valuaciones/${escapar(e.valuacionId)}">← ${escapar(x.volver)}</a>
  <div class="cod">${escapar(e.contrato)} · ${escapar(e.cliente)}</div>
  <h1>${escapar(t('cobrar.titulo'))}</h1>
  <div class="sub">${escapar(x.numero)} ${e.numero}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((er) => `<li>${escapar(er)}</li>`).join('')
  }</ul></div>`}

  <div class="saldo ${e.cobrada ? 'ok' : ''}">
    <span>${escapar(e.cobrada ? t('cobrar.cobrado') : t('cobrar.saldo'))}</span>
    <b>${escapar(e.saldo)}</b>
  </div>

  ${e.cobrada ? '' : `
  <form method="post" action="/valuaciones/${escapar(e.valuacionId)}/cobrar">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <div class="caja pad">
      <label class="c"><span>${escapar(t('cobrar.monto'))}</span>
        <input type="number" step="0.01" min="0.01" max="${e.saldoCrudo}" name="monto"
               value="${e.saldoCrudo}" required></label>
      <label class="c"><span>${escapar(t('cobrar.fecha'))}</span>
        <input type="date" name="fecha" value="${escapar(hoy)}" required></label>
      <label class="c"><span>${escapar(t('cobrar.medio'))}</span>
        <select name="medio">
          ${MEDIOS.map((m) => `<option value="${m}">${
            escapar(nombreMedio(idioma, m))}</option>`).join('')}
        </select></label>
      <label class="c"><span>${escapar(t('cobrar.referencia'))}</span>
        <input type="text" name="referencia" maxlength="60"></label>
    </div>
    <p class="expl">${escapar(t('cobrar.aviso'))}</p>
    <p class="expl aviso">${escapar(t('cobrar.igtf_aviso'))}</p>
    <button type="submit">${escapar(t('cobrar.registrar'))}</button>
  </form>`}
  ${historial}
</main>`,
  })
}

export const ESTILOS_COBRAR = `
/* El importe que queda va grande y arriba: esto se rellena con el extracto del
   banco abierto al lado y prisa, y buscarlo cuesta más que enseñarlo. */
.saldo{display:flex;align-items:baseline;justify-content:space-between;gap:16px;
  margin-top:18px;background:var(--cd);border:1px solid var(--ln);border-left:3px solid var(--am);
  border-radius:13px;padding:16px 18px;box-shadow:var(--sh)}
.saldo.ok{border-left-color:var(--grt)}
.saldo span{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  letter-spacing:.14em;text-transform:uppercase;color:var(--md)}
.saldo b{font-family:"JetBrains Mono",monospace;font-size:26px;font-weight:700;
  letter-spacing:-.035em;color:var(--am)}
.saldo.ok b{color:var(--grt)}
.pad{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));padding:8px}
.c{display:block;padding:8px 10px}
.c span{display:block;font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md);margin-bottom:5px}
.c input,.c select{width:100%;font:inherit;font-size:14.5px;padding:8px 10px;
  border:1px solid var(--ln2);border-radius:9px;background:var(--cd);color:var(--ik)}
.expl{margin:10px 0 0;font-size:13px;color:var(--ik2);line-height:1.45;max-width:64ch}
.expl.aviso{color:var(--am)}
.cb{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 16px;
  border-top:1px solid var(--ln)}
.cb:first-child{border-top:0}
.cb-f{font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:700}
.cb-m{margin-top:3px;font-size:12.5px;color:var(--ik2)}
.cb-i{font-family:"JetBrains Mono",monospace;font-size:14.5px;font-weight:700;
  letter-spacing:-.02em;white-space:nowrap}
.mal-caja{margin-top:18px;background:var(--cd);border:1px solid var(--rj);border-left-width:3px;
  border-radius:11px;padding:13px 17px}
.mal-caja li{color:var(--rj);font-weight:600;font-size:14px}
form button{margin-top:16px;font:inherit;font-size:15px;font-weight:700;padding:11px 22px;
  border:0;border-radius:11px;background:var(--nv);color:#E9F0F6;cursor:pointer}
form button:hover{background:var(--nv3)}
`
