/**
 * El estado de cuenta, en pantalla.
 *
 * Lo que va grande es **lo que queda por pagar**, porque es la pregunta. Debajo, línea por
 * línea: qué valuación, de qué periodo, en qué estado, cuánto se facturó, cuánto se pagó y
 * cuánto queda — con el número de factura y su número de control, que es el que el cliente
 * necesita para declarar su crédito fiscal y el que hoy pide por teléfono.
 *
 * Y lo que espera su firma se marca, porque es lo único de esta pantalla sobre lo que puede
 * actuar: el resto es información. Un estado de cuenta que no distingue lo que te toca hacer
 * de lo que solo tienes que saber se lee entero y no se hace nada.
 */

import type { Cuenta } from '../dominio/cuenta.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: {
    volver: 'Volver a mis contratos',
    titulo: 'Estado de cuenta',
    explica: 'Lo que se te ha facturado, lo que se ha pagado y lo que queda. Sale de las '
      + 'mismas valuaciones que puedes abrir una por una: aquí están sumadas.',
    queda: 'Queda por pagar',
    facturado: 'Presentado y facturado',
    pagado: 'Pagado',
    sinNada: 'Todavía no hay ninguna valuación presentada.',
    firmar: (n: number) => n === 1
      ? 'Una espera tu firma' : `${n} esperan tu firma`,
    variasMonedas: 'Hay contratos en más de una moneda, así que no se totalizan: sumar '
      + 'bolívares con dólares daría un número que no significa nada.',
    periodo: 'Periodo hasta',
    factura: 'Factura y número de control',
    sinFactura: 'Todavía sin facturar',
    neto: 'Facturado',
    pagadoCol: 'Pagado',
    saldoCol: 'Queda',
  },
  en: {
    volver: 'Back to my contracts',
    titulo: 'Statement of account',
    explica: 'What you have been invoiced, what has been paid and what is left. It comes '
      + 'from the same progress payments you can open one by one: here they are added up.',
    queda: 'Outstanding',
    facturado: 'Submitted and invoiced',
    pagado: 'Paid',
    sinNada: 'No progress payment has been submitted yet.',
    firmar: (n: number) => n === 1
      ? 'One is waiting for your signature' : `${n} are waiting for your signature`,
    variasMonedas: 'There are contracts in more than one currency, so no total is shown: '
      + 'adding bolivars to dollars would give a number that means nothing.',
    periodo: 'Period through',
    factura: 'Invoice and control number',
    sinFactura: 'Not invoiced yet',
    neto: 'Invoiced',
    pagadoCol: 'Paid',
    saldoCol: 'Left',
  },
} as const

export function pintarCuenta(c: Cuenta, idioma: Idioma): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const linea = (l: Cuenta['lineas'][number]) => `
  <a class="lc${l.estadoCrudo === 'presentada' ? ' firma' : ''}"
     href="/valuaciones/${escapar(l.valuacionId)}">
    <div class="lc-c">
      <div class="lc-n">${escapar(l.contrato)} · ${escapar(t('valuacion.titulo'))} ${l.numero}</div>
      <div class="lc-t">${escapar(l.titulo)}</div>
      <div class="lc-f">${escapar(x.periodo)} ${escapar(l.hasta)} · ${escapar(l.estado)}${
        l.factura === null
          ? ` · <em>${escapar(x.sinFactura)}</em>`
          : ` · ${escapar(x.factura)}: ${escapar(l.factura)}`}</div>
    </div>
    <div class="lc-d">
      <div><span>${escapar(x.neto)}</span><b>${escapar(l.neto)}</b></div>
      <div><span>${escapar(x.pagadoCol)}</span><b>${escapar(l.cobrado)}</b></div>
      <div class="lc-s"><span>${escapar(x.saldoCol)}</span><b>${escapar(l.saldo)}</b></div>
    </div>
  </a>`

  return pagina({
    idioma,
    titulo: x.titulo,
    estilos: ESTILOS_CUENTA,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(x.titulo)}</h1>
  <div class="sub">${escapar(x.explica)}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${c.lineas.length === 0
    ? `<p class="nada">${escapar(x.sinNada)}</p>`
    : `
  <section class="resumen">
    <div class="rs-g">
      <span>${escapar(x.queda)}</span>
      <b>${c.moneda === '' ? '—' : escapar(c.totalSaldo)}</b>
    </div>
    <div class="rs-p">
      <div><span>${escapar(x.facturado)}</span>
        <b>${c.moneda === '' ? '—' : escapar(c.totalNeto)}</b></div>
      <div><span>${escapar(x.pagado)}</span>
        <b>${c.moneda === '' ? '—' : escapar(c.totalCobrado)}</b></div>
    </div>
    ${c.moneda === '' ? `<p class="rs-x">${escapar(x.variasMonedas)}</p>` : ''}
    ${c.porFirmar === 0 ? '' : `<p class="rs-f">${escapar(x.firmar(c.porFirmar))}</p>`}
  </section>

  <div class="caja">${c.lineas.map(linea).join('')}</div>`}
</main>`,
  })
}

const ESTILOS_CUENTA = `
.nada{margin:18px 0 0;padding:15px 17px;background:var(--cd);border:1px solid var(--ln);
  border-radius:13px;font-size:14px;color:var(--md)}
.resumen{background:var(--cd);border:1px solid var(--ln);border-radius:13px;
  padding:17px 19px;display:grid;gap:14px}
.rs-g span,.rs-p span{display:block;font-family:"JetBrains Mono",monospace;font-size:9.5px;
  font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.rs-g b{display:block;margin-top:5px;font-family:"JetBrains Mono",monospace;
  font-size:clamp(24px,6vw,34px);font-weight:800;letter-spacing:-.035em;
  font-variant-numeric:tabular-nums}
.rs-p{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;
  padding-top:13px;border-top:1px solid var(--ln)}
.rs-p b{display:block;margin-top:4px;font-family:"JetBrains Mono",monospace;font-size:16px;
  font-weight:700;font-variant-numeric:tabular-nums}
.rs-x{margin:0;font-size:13px;line-height:1.5;color:var(--ik2)}
.rs-f{margin:0;font-size:14px;font-weight:650;color:var(--am);
  background:var(--amb);border-radius:9px;padding:9px 13px}
.caja{margin-top:20px;background:var(--cd);border:1px solid var(--ln);border-radius:13px;
  overflow:hidden}
.lc{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;
  padding:14px 17px;text-decoration:none;color:inherit}
.lc + .lc{border-top:1px solid var(--ln)}
.lc:hover{background:var(--cd2)}
.lc:focus-visible{outline:2px solid var(--ik);outline-offset:-2px}
.lc.firma{border-left:3px solid var(--am)}
.lc-n{font-size:15px;font-weight:650;letter-spacing:-.012em}
.lc-t{font-size:13.5px;color:var(--ik2);margin-top:2px}
.lc-f{font-size:12.5px;color:var(--md);margin-top:4px;line-height:1.45}
.lc-f em{font-style:normal}
.lc-d{display:grid;grid-template-columns:repeat(3,auto);gap:16px;text-align:right}
.lc-d span{display:block;font-family:"JetBrains Mono",monospace;font-size:9px;
  font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--md)}
.lc-d b{display:block;margin-top:3px;font-family:"JetBrains Mono",monospace;font-size:14px;
  font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.lc-s b{color:var(--ik)}
@media(max-width:620px){
  .lc{flex-direction:column;gap:11px}
  .lc-d{grid-template-columns:repeat(3,1fr);text-align:left;width:100%}
}
`
