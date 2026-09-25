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

const escapar = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const TEXTOS = {
  es: { volver: 'Todos los contratos', renglones: 'Qué se contrató',
        valuaciones: 'Valuaciones', sinValuaciones: 'Todavía no hay ninguna valuación.',
        firmado: 'Firmado', inicio: 'Inicio', fin: 'Fin previsto',
        anticipo: 'Anticipo', garantia: 'Retención de garantía',
        total: 'Total', ver: 'Ver la hoja', cant: 'Cantidad', margen: 'Margen', costo: 'Costo' },
  en: { volver: 'All contracts', renglones: 'What was contracted',
        valuaciones: 'Progress payments', sinValuaciones: 'No progress payments yet.',
        firmado: 'Awarded', inicio: 'Start', fin: 'Planned completion',
        anticipo: 'Advance', garantia: 'Retention',
        total: 'Total', ver: 'Open the sheet', cant: 'Quantity', margen: 'Margin', costo: 'Cost' },
} as const

export function pintarContrato(f: FichaContrato, idioma: Idioma, esCliente: boolean): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const dato = (etiqueta: string, valor: string | null) =>
    valor === null ? '' : `<div class="d"><span>${escapar(etiqueta)}</span><b>${escapar(valor)}</b></div>`

  const renglones = f.renglones.map((r) => `
<div class="rg">
  <div class="rg-n">${r.numero}</div>
  <div class="rg-c">
    <div class="rg-d">${escapar(r.descripcion)}</div>
    ${r.norma || r.especificacion ? `<div class="norma">${
      [r.norma, r.especificacion].filter(Boolean).map((v) => escapar(v!)).join(' · ')
    }</div>` : ''}
    <div class="rg-m">
      <span>${escapar(r.cantidad)} ${escapar(r.unidad)}</span>
      <span>×</span>
      <span>${escapar(r.precioUnitario)}</span>
      ${r.costoUnitario ? `<span class="int">${escapar(x.costo)} ${escapar(r.costoUnitario)}</span>` : ''}
      ${r.margenPct ? `<span class="int">${escapar(x.margen)} ${escapar(r.margenPct)}</span>` : ''}
    </div>
  </div>
  <div class="rg-t">${escapar(r.total)}</div>
</div>`).join('\n')

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

  return `<!doctype html>
<html lang="${idioma}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(f.codigo)} · GPS Nexus</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap">
<style>
:root{
  --nv:#0B2137; --nv3:#1B4364; --grt:#07734A;
  --bg:#F1F2F0; --cd:#FFFFFF; --cd2:#FAFAF8;
  --ik:#16202B; --ik2:#55616D; --md:#8A939C; --ln:#E3E4E1; --ln2:#D0D2CE;
  --am:#946307; --amb:#FDF3DF; --sh:0 1px 2px rgba(22,32,43,.05);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#071726; --cd:#0D2338; --cd2:#102A42; --ik:#EDF2F6; --ik2:#A6B6C4; --md:#7A8B99;
  --ln:#1A3750; --ln2:#254B69; --grt:#3FE0A5; --am:#EFC167; --amb:#33280C;
  --sh:0 1px 2px rgba(0,0,0,.45);
}}
:root[data-theme="dark"]{
  --bg:#071726; --cd:#0D2338; --cd2:#102A42; --ik:#EDF2F6; --ik2:#A6B6C4; --md:#7A8B99;
  --ln:#1A3750; --ln2:#254B69; --grt:#3FE0A5; --am:#EFC167; --amb:#33280C;
  --sh:0 1px 2px rgba(0,0,0,.45);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ik);font-family:Inter,system-ui,sans-serif;
  font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:0 18px}
.hd{background:var(--nv);color:#E9F0F6;padding-block:22px 34px}
.volver{display:inline-block;color:#A2B7C9;text-decoration:none;font-size:13.5px;margin-bottom:16px}
.volver:hover{color:#E9F0F6}
.cod{font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;letter-spacing:.16em;
  color:#7691A8}
.hd h1{margin:9px 0 0;font-size:clamp(22px,5.2vw,31px);font-weight:800;letter-spacing:-.035em;
  line-height:1.15}
.sub{margin-top:9px;color:#A2B7C9;font-size:14px}
.kp{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1px;
  margin-top:22px;background:var(--nv3)}
.kp .d{background:var(--nv);padding:11px 13px}
.kp .d span{display:block;font-family:"JetBrains Mono",monospace;font-size:8.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:#7691A8}
.kp .d b{display:block;margin-top:5px;font-family:"JetBrains Mono",monospace;font-size:14px;
  font-weight:700;letter-spacing:-.02em}
main{margin-top:-20px;padding-bottom:70px}
h2{margin:26px 0 10px;font-family:"JetBrains Mono",monospace;font-size:10.5px;font-weight:700;
  letter-spacing:.16em;text-transform:uppercase;color:var(--md)}
.caja{background:var(--cd);border:1px solid var(--ln);border-radius:15px;box-shadow:var(--sh);
  overflow:hidden}
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
.nada{margin:0;padding:22px 17px;color:var(--ik2);text-align:center}
@media(max-width:520px){
  .rg{grid-template-columns:24px minmax(0,1fr);row-gap:7px}
  .rg-t{grid-column:2;text-align:left}
}
</style>
<header class="hd"><div class="wrap">
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
<main class="wrap">
  <h2>${escapar(x.renglones)}</h2>
  <section class="caja">${renglones || `<p class="nada">—</p>`}</section>
  <h2>${escapar(x.valuaciones)}</h2>
  <section class="caja">${valuaciones}</section>
</main>
</html>`
}
