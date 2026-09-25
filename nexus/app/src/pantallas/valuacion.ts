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
  readonly id: string
  readonly contratoId: string
  readonly contrato: string
  readonly cliente: string
  readonly numero: number
  readonly desde: string
  readonly hasta: string
  readonly moneda: 'VES' | 'USD'
  readonly estado: string
  readonly estadoCrudo: string
  readonly lineas: readonly LineaHoja[]
  /**
   * Los botones solo aparecen cuando la persona puede pulsarlos de verdad.
   * Enseñar un botón que va a rebotar es peor que no enseñarlo: enseña que existe
   * una acción y esconde que no te corresponde.
   */
  readonly puedeDecidir: boolean
  /** Quien está dentro de GPS puede contestar las objeciones abiertas. */
  readonly puedeResponder: boolean
  readonly antifalsificacion: string
  readonly objeciones: readonly ObjecionVista[]
}

export type ObjecionVista = {
  readonly id: string
  readonly motivo: string
  readonly cuando: string
  readonly respuesta: string | null
  readonly respondidaEn: string | null
}

const escapar = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const ACCIONES = {
  es: { aprobar: 'Aprobar esta valuación', objetar: 'Objetar', motivo: 'Qué no cuadra',
        ayuda: 'Al aprobarla queda constancia de quién y cuándo. Esto no se deshace.',
        objecionTitulo: 'Objeciones', sinRespuesta: 'Sin responder todavía',
        respondida: 'Respondida', volver: 'Volver al contrato',
        responder: 'Responder', tuRespuesta: 'Tu respuesta',
        avisoResponder: 'Mientras no se responda, esta valuación no se puede facturar.',
        placeholderR: 'Por ejemplo: se retiran las 12 horas de grúa y se corrige la valuación a la baja.',
        placeholder: 'Por ejemplo: el renglón 3 incluye 12 horas de grúa que no se ejecutaron el 14 de septiembre.' },
  en: { aprobar: 'Approve this progress payment', objetar: 'Dispute', motivo: 'What does not add up',
        ayuda: 'Approving records who and when. This cannot be undone.',
        objecionTitulo: 'Disputes', sinRespuesta: 'Not answered yet',
        respondida: 'Answered', volver: 'Back to the contract',
        responder: 'Answer', tuRespuesta: 'Your answer',
        avisoResponder: 'Until this is answered, the progress payment cannot be invoiced.',
        placeholderR: 'For example: the 12 crane hours are withdrawn and the sheet is corrected.',
        placeholder: 'For example: line 3 includes 12 crane hours that were not worked on 14 September.' },
} as const

export function pintarValuacion(d: DatosValuacion, idioma: Idioma): string {
  const t = traductor(idioma)
  const a = ACCIONES[idioma]
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

h2.sec{margin:30px 0 10px;font-family:"JetBrains Mono",monospace;font-size:10.5px;
  font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--md)}
.objs{display:grid;gap:10px}
.obj{background:var(--cd);border:1px solid var(--ln);border-radius:13px;padding:14px 16px}
.obj.abierta{border-left:3px solid #946307}
.obj-m{font-size:14.5px;line-height:1.5}
.obj-f{margin-top:6px;font-family:"JetBrains Mono",monospace;font-size:10px;
  letter-spacing:.11em;text-transform:uppercase;color:var(--md)}
.obj-e{margin-top:8px;font-size:13px;color:#946307;font-weight:600}
.obj-r{margin-top:10px;padding-top:10px;border-top:1px solid var(--ln);font-size:14px;
  color:var(--ik2);line-height:1.5}
.resp{margin-top:12px;padding-top:12px;border-top:1px solid var(--ln)}
.resp label{display:block;font-family:"JetBrains Mono",monospace;font-size:9.5px;
  font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--md)}
.resp textarea{width:100%;margin-top:6px;font:inherit;font-size:15px;padding:11px;
  border:1px solid var(--ln2);border-radius:10px;background:transparent;color:var(--ik);
  resize:vertical}
.resp button{margin-top:9px;width:100%;font:inherit;font-size:15px;font-weight:700;
  padding:12px;border:0;border-radius:10px;background:var(--nv);color:#fff;cursor:pointer}
.acc{margin-top:26px;background:var(--cd);border:1px solid var(--ln);border-radius:15px;
  padding:20px 18px}
.acc form{margin:0}
.acc button{width:100%;font:inherit;font-size:16px;font-weight:700;padding:14px;border:0;
  border-radius:11px;cursor:pointer;letter-spacing:-.012em}
.acc button.ap{background:var(--grt);color:#fff}
.acc button.ob{background:transparent;color:var(--ik);border:1px solid var(--ln2);margin-top:10px}
.ayuda{margin:10px 0 0;font-size:12.5px;color:var(--md);text-align:center;line-height:1.45}
.obj-nueva{margin-top:16px;border-top:1px solid var(--ln);padding-top:14px}
.obj-nueva summary{cursor:pointer;font-size:14px;color:var(--ik2);text-align:center;
  list-style:none}
.obj-nueva summary::-webkit-details-marker{display:none}
.obj-nueva label{display:block;margin-top:14px;font-family:"JetBrains Mono",monospace;
  font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--md)}
.obj-nueva textarea{width:100%;margin-top:7px;font:inherit;font-size:15px;padding:12px;
  border:1px solid var(--ln2);border-radius:11px;background:transparent;color:var(--ik);
  resize:vertical}
.volver{margin-top:28px;text-align:center}
.volver a{color:var(--ik2);text-decoration:none;font-size:14px}
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

  ${d.objeciones.length === 0 ? '' : `<h2 class="sec">${escapar(a.objecionTitulo)}</h2>
  <div class="objs">${d.objeciones.map((o) => `
    <div class="obj${o.respuesta === null ? ' abierta' : ''}">
      <div class="obj-m">${escapar(o.motivo)}</div>
      <div class="obj-f">${escapar(o.cuando)}</div>
      ${o.respuesta !== null
        ? `<div class="obj-r">${escapar(o.respuesta)}</div>
           <div class="obj-f">${escapar(a.respondida)} · ${escapar(o.respondidaEn ?? '')}</div>`
        : d.puedeResponder
          ? `<div class="obj-e">${escapar(a.avisoResponder)}</div>
             <form method="post" action="/objeciones/${escapar(o.id)}/responder" class="resp">
               <input type="hidden" name="af" value="${escapar(d.antifalsificacion)}">
               <input type="hidden" name="volver" value="/valuaciones/${escapar(d.id)}">
               <label for="r-${escapar(o.id)}">${escapar(a.tuRespuesta)}</label>
               <textarea id="r-${escapar(o.id)}" name="respuesta" rows="3" required
                         placeholder="${escapar(a.placeholderR)}"></textarea>
               <button type="submit">${escapar(a.responder)}</button>
             </form>`
          : `<div class="obj-e">${escapar(a.sinRespuesta)}</div>`}
    </div>`).join('')}</div>`}

  ${!d.puedeDecidir ? '' : `
  <section class="acc">
    <form method="post" action="/valuaciones/${escapar(d.id)}/aprobar">
      <input type="hidden" name="af" value="${escapar(d.antifalsificacion)}">
      <button type="submit" class="ap">${escapar(a.aprobar)}</button>
      <p class="ayuda">${escapar(a.ayuda)}</p>
    </form>
    <details class="obj-nueva">
      <summary>${escapar(a.objetar)}</summary>
      <form method="post" action="/valuaciones/${escapar(d.id)}/objetar">
        <input type="hidden" name="af" value="${escapar(d.antifalsificacion)}">
        <label for="motivo">${escapar(a.motivo)}</label>
        <textarea id="motivo" name="motivo" rows="4" required
                  placeholder="${escapar(a.placeholder)}"></textarea>
        <button type="submit" class="ob">${escapar(a.objetar)}</button>
      </form>
    </details>
  </section>`}

  <p class="volver"><a href="/contratos/${escapar(d.contratoId)}">← ${escapar(a.volver)}</a></p>
</main>
</html>`
}
