/**
 * La hoja de valuación, pintada.
 *
 * Es la única pantalla de contabilidad que el cliente ve entera, y la que más
 * discusiones causa. Por eso no enseña un total: enseña el camino hasta el total,
 * línea por línea, con la base y el porcentaje de cada descuento a la vista. Si el
 * cliente objeta, se señala la línea en vez de discutir sobre un número.
 *
 * Una sola función para las dos superficies. En escritorio las líneas son una tabla;
 * en el móvil, tarjetas apiladas. No son dos pantallas: es la misma, reacomodada por
 * la hoja de estilos.
 */

import type { LineaHoja } from '../dominio/valuacion.ts'
import { traductor, type Idioma } from '../i18n/t.ts'

export type DatosValuacion = {
  readonly contrato: string
  readonly cliente: string
  readonly numero: number
  readonly desde: string
  readonly hasta: string
  readonly moneda: 'VES' | 'USD'
  readonly estado: string
  readonly lineas: readonly LineaHoja[]
}

const escapar = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function pintarValuacion(d: DatosValuacion, idioma: Idioma): string {
  const t = traductor(idioma)
  const neto = d.lineas.find((l) => l.total)
  const cuerpo = d.lineas.filter((l) => !l.total)

  const filas = cuerpo
    .map((l) => {
      const clases = ['ln', l.resta ? 'resta' : '', l.orden === 3 ? 'subt' : ''].filter(Boolean)
      return `<div class="${clases.join(' ')}">
        <div class="cn">${escapar(l.concepto)}</div>
        <div class="bs" data-lb="${escapar(t('fiscal.base_imponible'))}">${l.base ?? ''}</div>
        <div class="pc" data-lb="${escapar(t('fiscal.alicuota'))}">${l.porcentaje ?? ''}</div>
        <div class="mt">${escapar(l.monto)}</div>
      </div>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="${idioma}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(t('valuacion.titulo'))} ${d.numero} · ${escapar(d.contrato)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap">
<style>
:root{
  --nv:#0B2137; --nv2:#123049; --nv3:#1B4364; --gr:#12B76A; --grt:#07734A;
  --bg:#F1F2F0; --cd:#FFFFFF; --cd2:#FAFAF8;
  --ik:#16202B; --ik2:#55616D; --md:#8A939C; --ln:#E3E4E1; --ln2:#D0D2CE;
  --rj:#A8323C; --sh:0 1px 2px rgba(22,32,43,.05),0 16px 40px -28px rgba(22,32,43,.45);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#071726; --cd:#0D2338; --cd2:#102A42; --ik:#EDF2F6; --ik2:#A6B6C4; --md:#7A8B99;
  --ln:#1A3750; --ln2:#254B69; --grt:#3FE0A5; --rj:#E8737E;
  --sh:0 1px 2px rgba(0,0,0,.45),0 16px 40px -28px rgba(0,0,0,.9);
}}
:root[data-theme="dark"]{
  --bg:#071726; --cd:#0D2338; --cd2:#102A42; --ik:#EDF2F6; --ik2:#A6B6C4; --md:#7A8B99;
  --ln:#1A3750; --ln2:#254B69; --grt:#3FE0A5; --rj:#E8737E;
  --sh:0 1px 2px rgba(0,0,0,.45),0 16px 40px -28px rgba(0,0,0,.9);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ik);font-family:Inter,system-ui,sans-serif;
  font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
.m{font-family:"JetBrains Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:780px;margin:0 auto;padding:0 18px}

.hd{background:var(--nv);color:#E9F0F6;padding-block:30px 26px}
.hd .rt{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  letter-spacing:.17em;text-transform:uppercase;color:#7691A8}
.hd .rt b{color:#48E2AA;font-weight:700}
.hd h1{margin:12px 0 0;font-size:clamp(25px,5.6vw,36px);font-weight:800;
  letter-spacing:-.035em;line-height:1.1}
.hd .sb{margin-top:10px;color:#A2B7C9;font-size:14.5px}
.est{display:inline-block;margin-top:14px;font-family:"JetBrains Mono",monospace;
  font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
  padding:5px 12px;border-radius:99px;background:#16385A;color:#8FD9FF}

.hoja{margin-top:-18px;background:var(--cd);border:1px solid var(--ln);border-radius:16px;
  box-shadow:var(--sh);overflow:hidden;position:relative}
.cab{display:grid;grid-template-columns:minmax(0,1fr) 116px 76px 150px;gap:10px;
  padding:12px 20px;background:var(--cd2);border-bottom:1px solid var(--ln);
  font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.cab .bs,.cab .pc,.cab .mt{text-align:right}
.ln{display:grid;grid-template-columns:minmax(0,1fr) 116px 76px 150px;gap:10px;
  padding:13px 20px;border-bottom:1px solid var(--ln);align-items:baseline}
.ln .cn{font-size:15px;font-weight:600;letter-spacing:-.01em}
.ln .bs,.ln .pc,.ln .mt{text-align:right;font-family:"JetBrains Mono",monospace;
  font-variant-numeric:tabular-nums}
.ln .bs,.ln .pc{font-size:12.5px;color:var(--md)}
.ln .mt{font-size:14.5px;font-weight:700;letter-spacing:-.02em}
.ln.resta .mt{color:var(--rj)}
.ln.subt{background:var(--cd2)}
.ln.subt .cn{font-weight:800}

.neto{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;
  padding:20px;background:var(--nv);color:#E9F0F6}
.neto .cn{font-size:16px;font-weight:800;letter-spacing:-.02em}
.neto .mt{font-family:"JetBrains Mono",monospace;font-size:clamp(21px,5vw,29px);
  font-weight:700;letter-spacing:-.035em;color:#48E2AA;text-align:right;
  font-variant-numeric:tabular-nums}

.nota{margin:22px 0 60px;font-size:13px;color:var(--ik2);line-height:1.6;
  padding-left:12px;border-left:2px solid var(--ln2)}

@media(max-width:620px){
  .cab{display:none}
  .ln{grid-template-columns:minmax(0,1fr) auto;row-gap:2px;padding:14px 16px}
  .ln .cn{grid-column:1;grid-row:1}
  .ln .mt{grid-column:2;grid-row:1;font-size:15.5px}
  .ln .bs,.ln .pc{grid-row:2;text-align:left;font-size:11px}
  .ln .bs{grid-column:1}
  .ln .pc{grid-column:2;text-align:right}
  .ln .bs:not(:empty)::before,.ln .pc:not(:empty)::before{
    content:attr(data-lb) " ";color:var(--ln2);letter-spacing:.06em}
  .neto{padding:18px 16px}
}
</style>
<header class="hd"><div class="wrap">
  <div class="rt">${escapar(d.contrato)} &nbsp;·&nbsp; <b>${escapar(d.cliente)}</b></div>
  <h1>${escapar(t('valuacion.titulo'))} ${d.numero}</h1>
  <div class="sb">${escapar(t('valuacion.periodo'))}: ${escapar(d.desde)} — ${escapar(d.hasta)}</div>
  <div class="est">${escapar(d.estado)}</div>
</div></header>

<main class="wrap">
  <section class="hoja">
    <div class="cab">
      <div class="cn">${escapar(t('valuacion.titulo'))}</div>
      <div class="bs">${escapar(t('fiscal.base_imponible'))}</div>
      <div class="pc">${escapar(t('fiscal.alicuota'))}</div>
      <div class="mt">${escapar(d.moneda)}</div>
    </div>
${filas}
    <div class="neto">
      <div class="cn">${escapar(neto?.concepto ?? t('valuacion.neto'))}</div>
      <div class="mt">${escapar(neto?.monto ?? '')}</div>
    </div>
  </section>
  <p class="nota">${
    idioma === 'es'
      ? 'Cada cifra sale del contrato y de la evidencia registrada. Ninguna se escribe a mano. Si algo no cuadra, se señala la línea.'
      : 'Every figure comes from the contract and the recorded evidence. None is typed in by hand. If something does not add up, point at the line.'
  }</p>
</main>
</html>`
}
