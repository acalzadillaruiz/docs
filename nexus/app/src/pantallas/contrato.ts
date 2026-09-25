/**
 * La ficha de contrato.
 *
 * Contesta la segunda pregunta: «vale, ¿y qué está pasando exactamente?».
 *
 * La norma y la especificación de cada renglón van a la vista, no escondidas tras un
 * desplegable. En un contrato petrolero eso no es un dato técnico de relleno: que un
 * cabezal sea API 6A PSL-3 y no otra cosa es la mitad de lo que se compró, y es lo
 * primero que se discute el día que llega algo y no encaja.
 */

import type { FichaContrato } from '../dominio/contrato.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { porcentaje } from '../dominio/evidencia.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Todos los contratos', renglones: 'Qué se contrató',
        valuaciones: 'Valuaciones', sinValuaciones: 'Todavía no hay ninguna valuación.',
        firmado: 'Firmado', inicio: 'Inicio', fin: 'Fin previsto',
        anticipo: 'Anticipo', garantia: 'Retención de garantía',
        total: 'Total', ver: 'Ver la hoja', cant: 'Cantidad', margen: 'Margen', costo: 'Costo',
        verAvance: 'Ver de dónde sale', sinRespaldo: 'sin demostrar' },
  en: { volver: 'All contracts', renglones: 'What was contracted',
        valuaciones: 'Progress payments', sinValuaciones: 'No progress payments yet.',
        firmado: 'Awarded', inicio: 'Start', fin: 'Planned completion',
        anticipo: 'Advance', garantia: 'Retention',
        total: 'Total', ver: 'Open the sheet', cant: 'Quantity', margen: 'Margin', costo: 'Cost',
        verAvance: 'See where it comes from', sinRespaldo: 'unproven' },
} as const

export function pintarContrato(f: FichaContrato, idioma: Idioma, esCliente: boolean): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const pct = (n: number) => porcentaje(idioma, n)

  const dato = (etiqueta: string, valor: string | null) =>
    valor === null ? '' : `<div class="d"><span>${escapar(etiqueta)}</span><b>${escapar(valor)}</b></div>`

  const renglones = f.renglones.map((r) => {
    // Los dos tramos, también aquí: el sólido es lo verificado y el rayado lo que
    // alguien declaró y todavía no se puede demostrar. Enseñar solo el primero
    // escondería el problema; enseñar solo el segundo lo exageraría.
    const v = Math.max(0, Math.min(100, r.avance))
    const d = Math.max(0, Math.min(100 - v, r.declarado - r.avance))
    return `
<div class="rg">
  <div class="rg-n">${r.numero}</div>
  <div class="rg-c">
    <div class="rg-d">${escapar(r.descripcion)}</div>
    ${r.norma || r.especificacion ? `<div class="norma">${
      [r.norma, r.especificacion].filter(Boolean).map((v2) => escapar(v2!)).join(' · ')
    }</div>` : ''}
    <div class="rg-m">
      <span>${escapar(r.cantidad)} ${escapar(r.unidad)}</span>
      <span>×</span>
      <span>${escapar(r.precioUnitario)}</span>
      ${r.costoUnitario ? `<span class="int">${escapar(x.costo)} ${escapar(r.costoUnitario)}</span>` : ''}
      ${r.margenPct ? `<span class="int">${escapar(x.margen)} ${escapar(r.margenPct)}</span>` : ''}
    </div>
    <a class="rg-a" href="/renglones/${escapar(r.id)}">
      <span class="rg-bar"><i class="rg-bv" style="width:${v}%"></i><i class="rg-bd" style="width:${d}%"></i></span>
      <span class="rg-pv">${escapar(pct(r.avance))}</span>
      ${d > 0 ? `<span class="rg-pd">+${escapar(pct(r.declarado - r.avance))} ${escapar(x.sinRespaldo)}</span>` : ''}
      <span class="rg-vm">${escapar(x.verAvance)} →</span>
    </a>
  </div>
  <div class="rg-t">${escapar(r.total)}</div>
</div>`
  }).join('\n')

  const valuaciones = f.valuaciones.length === 0
    ? `<p class="nada">${escapar(x.sinValuaciones)}</p>`
    : f.valuaciones.map((v) => `
<a class="vl${v.estadoCrudo === 'presentada' ? ' pide' : ''}" href="/valuaciones/${escapar(v.id)}">
  <div>
    <div class="vl-n">${escapar(t('valuacion.numero'))} ${v.numero}</div>
    <div class="vl-p">${escapar(v.periodo)}</div>
  </div>
  <div class="vl-d">
    <span class="vl-e">${escapar(v.estado)}</span>
    <span class="vl-o">${escapar(v.obra)}</span>
  </div>
</a>`).join('\n')

  return pagina({
    idioma,
    titulo: f.codigo,
    estilos: `
.kp{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1px;
  margin-top:22px;background:var(--nv3)}
.kp .d{background:var(--nv);padding:11px 13px}
.kp .d span{display:block;font-family:"JetBrains Mono",monospace;font-size:8.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:#7691A8}
.kp .d b{display:block;margin-top:5px;font-family:"JetBrains Mono",monospace;font-size:14px;
  font-weight:700;letter-spacing:-.02em}
.rg{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:12px;padding:14px 17px;
  border-top:1px solid var(--ln)}
.rg:first-child{border-top:0}
.rg-n{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--md);padding-top:3px}
.rg-d{font-size:15px;font-weight:650;letter-spacing:-.012em;line-height:1.3}
.norma{margin-top:4px;font-family:"JetBrains Mono",monospace;font-size:10.5px;letter-spacing:.05em;
  color:var(--grt);font-weight:700}
.rg-m{margin-top:6px;display:flex;flex-wrap:wrap;gap:7px;align-items:baseline;
  font-family:"JetBrains Mono",monospace;font-size:11.5px;color:var(--ik2)}
.rg-m .int{color:var(--am);background:var(--amb);padding:1px 7px;border-radius:99px;font-size:10.5px}
.rg-t{font-family:"JetBrains Mono",monospace;font-size:14.5px;font-weight:700;
  letter-spacing:-.02em;text-align:right;white-space:nowrap}
.rg-a{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:9px;
  text-decoration:none;color:inherit}
.rg-a:hover .rg-vm{color:var(--ik)}
.rg-bar{display:flex;height:6px;width:96px;border-radius:99px;overflow:hidden;background:var(--ln)}
.rg-bv{background:var(--grt)}
.rg-bd{background:repeating-linear-gradient(135deg,var(--am) 0 3px,transparent 3px 6px);
  background-color:var(--amb)}
.rg-pv{font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:700;color:var(--grt)}
.rg-pd{font-family:"JetBrains Mono",monospace;font-size:10.5px;font-weight:700;color:var(--am);
  background:var(--amb);padding:1px 7px;border-radius:99px}
.rg-vm{font-size:11.5px;color:var(--md);margin-left:auto}
.vl{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 17px;
  border-top:1px solid var(--ln);text-decoration:none;color:inherit}
.vl:first-child{border-top:0}
.vl:hover{background:var(--cd2)}
.vl.pide{border-left:3px solid var(--am)}
.vl-n{font-size:15px;font-weight:650;letter-spacing:-.012em}
.vl-p{font-size:12.5px;color:var(--ik2);margin-top:2px}
.vl-d{text-align:right;display:flex;flex-direction:column;gap:3px}
.vl-e{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;letter-spacing:.12em;
  text-transform:uppercase;color:var(--md)}
.vl-o{font-family:"JetBrains Mono",monospace;font-size:14px;font-weight:700;letter-spacing:-.02em}
@media(max-width:520px){
  .rg{grid-template-columns:24px minmax(0,1fr);row-gap:7px}
  .rg-t{grid-column:2;text-align:left}
}
`,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <div class="cod">${escapar(f.codigo)} · ${escapar(f.tipo)}${esCliente ? '' : ` · ${escapar(f.cliente)}`}</div>
  <h1>${escapar(f.titulo)}</h1>
  <div class="sub">${escapar(f.estado)}</div>
  <div class="kp">
    ${dato(t('contrato.monto'), f.monto)}
    ${dato(x.firmado, f.firmado)}
    ${dato(x.inicio, f.inicio)}
    ${dato(x.fin, f.finPrevisto)}
    ${dato(x.anticipo, f.anticipoPct)}
    ${dato(x.garantia, f.garantiaPct)}
  </div>
</div></header>
`,
    cuerpo: `<main class="wrap">
  <h2>${escapar(x.renglones)}</h2>
  <section class="caja">${renglones || `<p class="nada">—</p>`}</section>
  <h2>${escapar(x.valuaciones)}</h2>
  <section class="caja">${valuaciones}</section>
</main>`,
  })
}
