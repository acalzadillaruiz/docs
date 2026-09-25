/**
 * El avance, abierto.
 *
 * Es la pantalla que justifica el proyecto entero. Todo portal de seguimiento
 * enseña un número: 58%. Esta enseña de dónde sale ese número, hito por hito, hasta
 * el documento que sostiene cada punto.
 *
 * Tres decisiones de diseño, y ninguna es estética:
 *
 *   1. LA BARRA LLEVA DOS TRAMOS. El sólido es lo verificado; el rayado, lo que
 *      alguien declaró y todavía no se puede demostrar. Una sola barra obligaría a
 *      elegir cuál de los dos números enseñar, y cualquiera de los dos solo sería
 *      media verdad. Juntos se ve la brecha de un vistazo, sin leer una cifra.
 *
 *   2. LO QUE FALTA VA DELANTE Y EN COLOR. Un hito al que le falta la foto no es un
 *      detalle de archivo: es la razón por la que el avance no sube. Enseñarlo
 *      pequeño y abajo, que es como se suele hacer, lo convierte en algo que nadie
 *      mira hasta que llega la reunión.
 *
 *   3. EL DOCUMENTO SE NOMBRA CON SU HUELLA, acortada. No es decoración de
 *      criptógrafo: es lo que permite que dos personas en dos sitios distintos
 *      comprueben que están mirando exactamente el mismo papel.
 */

import type { Avance, Hito, Documento, PorRevisar } from '../dominio/evidencia.ts'
import { nombreClase, nombreEstado, porcentaje, CLASES } from '../dominio/evidencia.ts'
import { type Idioma } from '../i18n/t.ts'
import { escapar, pagina } from './base.ts'

const TEXTOS = {
  es: {
    titulo: 'Avance', volver: 'Volver al contrato',
    verificado: 'Verificado', declarado: 'Declarado sin respaldo',
    deDonde: 'De dónde sale este número',
    falta: 'Falta', papeles: 'Documentos', sinPapeles: 'Todavía no hay ningún documento.',
    cola: 'Documentos por revisar', colaVacia: 'No hay nada esperando revisión.',
    dias: (d: number) => `${d} ${d === 1 ? 'día' : 'días'}`, hoy: 'hoy',
    revisar: 'Revisar', ocurrio: 'Ocurrió', subido: 'Subido',
    subir: 'Subir el documento', elegir: 'Elegir archivo', clase: 'Qué documento es',
    cuando: 'Cuándo ocurrió', verificar: 'Verificar', rechazar: 'Rechazar',
    porQue: 'Por qué se rechaza', bajar: 'Descargar',
    avisoRechazo: 'Hay que decir por qué: quien subió el papel equivocado tiene que saber cuál traer.',
    nota: 'El avance sale de los hitos verificados. No hay ninguna casilla donde escribirlo.',
    brecha: 'sin demostrar',
  },
  en: {
    titulo: 'Progress', volver: 'Back to the contract',
    verificado: 'Verified', declarado: 'Claimed, unsupported',
    deDonde: 'Where this number comes from',
    falta: 'Missing', papeles: 'Documents', sinPapeles: 'No documents yet.',
    cola: 'Documents awaiting review', colaVacia: 'Nothing awaiting review.',
    dias: (d: number) => `${d} ${d === 1 ? 'day' : 'days'}`, hoy: 'today',
    revisar: 'Review', ocurrio: 'Occurred', subido: 'Uploaded',
    subir: 'Upload the document', elegir: 'Choose file', clase: 'What document is it',
    cuando: 'When it happened', verificar: 'Verify', rechazar: 'Reject',
    porQue: 'Why it is rejected', bajar: 'Download',
    avisoRechazo: 'A reason is required: whoever uploaded the wrong paper needs to know which one to bring.',
    nota: 'Progress comes from verified milestones. There is no field to type it into.',
    brecha: 'unproven',
  },
} as const

/** La huella, acortada para que quepa y siga sirviendo para comparar. */
export function huellaCorta(huella: string): string {
  return `${huella.slice(0, 8)}…${huella.slice(-4)}`
}

function pintarDocumento(d: Documento, idioma: Idioma, r: Revision | null): string {
  const x = TEXTOS[idioma]
  const marca = d.estado === 'verificada' ? 'ok' : d.estado === 'rechazada' ? 'no' : 'esp'

  // Los botones solo salen cuando de verdad se pueden pulsar: de dentro, y sobre un
  // documento que todavía no se ha revisado. Enseñar uno que va a rebotar enseña que
  // la acción existe y esconde que no te corresponde.
  const botones = r && d.estado === 'sin_revisar' ? `
  <form class="doc-f" method="post" action="/evidencia/${escapar(d.id)}/verificar">
    <input type="hidden" name="af" value="${escapar(r.antifalsificacion)}">
    <input type="hidden" name="volver" value="${escapar(r.volver)}">
    <button type="submit" class="b-ok">${escapar(x.verificar)}</button>
  </form>
  <form class="doc-f" method="post" action="/evidencia/${escapar(d.id)}/rechazar">
    <input type="hidden" name="af" value="${escapar(r.antifalsificacion)}">
    <input type="hidden" name="volver" value="${escapar(r.volver)}">
    <input type="text" name="motivo" required maxlength="500"
           placeholder="${escapar(x.porQue)}">
    <button type="submit" class="b-no">${escapar(x.rechazar)}</button>
  </form>` : ''

  return `<div class="doc ${marca}">
  <div class="doc-c">
    <a class="doc-n" href="/evidencia/${escapar(d.id)}/archivo">${escapar(d.nombre)}</a>
    <div class="doc-m">${escapar(nombreClase(idioma, d.clase))} · <span class="hu">${escapar(huellaCorta(d.huella))}</span></div>
    ${d.motivoRechazo ? `<div class="doc-r">${escapar(d.motivoRechazo)}</div>` : ''}
    ${botones}
  </div>
  <div class="doc-e">${escapar(
    d.estado === 'verificada' ? x.verificado
      : d.estado === 'rechazada' ? (idioma === 'es' ? 'Rechazado' : 'Rejected')
      : (idioma === 'es' ? 'Sin revisar' : 'Unreviewed'),
  )}</div>
</div>`
}

/**
 * Lo que hace falta para poder escribir desde esta pantalla.
 *
 * Nulo cuando quien mira es un cliente. No es que se le escondan los botones: es que
 * sin esto no hay nada que pintar, así que no hay forma de que salgan por descuido.
 */
export type Revision = {
  readonly antifalsificacion: string
  /** Adónde volver después de escribir. El servidor lo sanea igualmente. */
  readonly volver: string
}

function pintarHito(h: Hito, idioma: Idioma, r: Revision | null): string {
  const x = TEXTOS[idioma]
  // Lo que falta va primero y marcado. Es la razón por la que el avance no sube.
  const falta = h.falta.length === 0 ? '' : `<div class="falta">${escapar(x.falta)}: ${
    h.falta.map((c) => escapar(nombreClase(idioma, c))).join(' · ')
  }</div>`

  const docs = h.documentos.length === 0 ? '' :
    `<div class="docs">${h.documentos.map((d) => pintarDocumento(d, idioma, r)).join('')}</div>`

  // El formulario de subir va DENTRO del hito al que pertenece, no en un botón
  // suelto arriba que luego pregunta a cuál. Quien sube un papel viene ya del hito.
  const subir = !r ? '' : `
  <form class="sub" method="post" enctype="multipart/form-data"
        action="/hitos/${escapar(h.id)}/evidencia">
    <input type="hidden" name="af" value="${escapar(r.antifalsificacion)}">
    <input type="hidden" name="volver" value="${escapar(r.volver)}">
    <select name="clase" required aria-label="${escapar(x.clase)}">
      ${(h.falta.length > 0 ? h.falta : h.exige.length > 0 ? h.exige : CLASES)
        .map((c) => `<option value="${escapar(c)}">${escapar(nombreClase(idioma, c))}</option>`)
        .join('')}
    </select>
    <input type="date" name="ocurrido_en" aria-label="${escapar(x.cuando)}">
    <input type="file" name="documento" required accept="${ACEPTA}"
           aria-label="${escapar(x.elegir)}">
    <button type="submit">${escapar(x.subir)}</button>
  </form>`

  return `<div class="hito ${h.estado}" id="hito-${escapar(h.id)}">
  <div class="hi-p">${escapar(porcentaje(idioma, h.peso))}</div>
  <div class="hi-c">
    <div class="hi-n">${escapar(h.nombre)}</div>
    <div class="hi-e">${escapar(nombreEstado(idioma, h.estado))}${
      h.ocurridoEn ? ` · ${escapar(x.ocurrio)} ${escapar(h.ocurridoEn)}` : ''
    }</div>
    ${falta}
    ${docs}
    ${subir}
  </div>
</div>`
}

/** Lo que el selector de archivo ofrece de entrada. El servidor lo comprueba igual. */
const ACEPTA = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.tif,.tiff'

/**
 * El bloque del avance de un renglón. Devuelve solo el bloque: se incrusta en la
 * ficha del contrato, porque el avance no es una pantalla aparte — es lo que se va
 * a mirar de la ficha.
 */
export function pintarAvance(a: Avance, idioma: Idioma, r: Revision | null = null): string {
  const x = TEXTOS[idioma]
  // Los dos tramos de la barra. El rayado empieza donde acaba el sólido.
  const v = Math.max(0, Math.min(100, a.verificado))
  const d = Math.max(0, Math.min(100 - v, a.declarado - a.verificado))

  return `<section class="avance">
  <div class="av-h">
    <div class="av-n">${escapar(porcentaje(idioma, a.verificado))}</div>
    <div class="av-l">${escapar(x.verificado)}</div>
    ${a.brecha > 0 ? `<div class="av-b">+${escapar(porcentaje(idioma, a.brecha))} ${escapar(x.brecha)}</div>` : ''}
  </div>
  <div class="barra" role="img" aria-label="${escapar(x.verificado)} ${escapar(porcentaje(idioma, a.verificado))}">
    <div class="ba-v" style="width:${v}%"></div>
    <div class="ba-d" style="width:${d}%"></div>
  </div>
  <p class="av-nota">${escapar(x.nota)}</p>
  <h3 class="av-t">${escapar(x.deDonde)}</h3>
  <div class="hitos">${a.hitos.map((h) => pintarHito(h, idioma, r)).join('')}</div>
</section>`
}

/**
 * La cola de revisión. Solo de dentro: revisar es de GPS.
 *
 * Cadena vacía cuando no hay nada, para no dejar un encabezado huérfano diciendo
 * que no hay nada.
 */
export function pintarPorRevisar(cola: readonly PorRevisar[], idioma: Idioma): string {
  if (cola.length === 0) return ''
  const x = TEXTOS[idioma]

  const filas = cola.map((c) => {
    // Una semana en la cola ya está falseando el informe: el avance que sostiene
    // ese papel no cuenta, y el contrato parece más atrasado de lo que está.
    const urge = c.dias >= 7
    return `<a class="rv${urge ? ' urge' : ''}" href="/contratos/${escapar(c.contratoId)}#hito-${escapar(c.hitoId)}">
  <div class="rv-c">
    <div class="rv-n">${escapar(c.nombre)}</div>
    <div class="rv-d">${escapar(nombreClase(idioma, c.clase))} · ${escapar(c.hito)}</div>
    <div class="rv-m">${escapar(c.contrato)} · ${escapar(c.cliente)}</div>
  </div>
  <div class="rv-di">${c.dias === 0 ? escapar(x.hoy) : escapar(x.dias(c.dias))}</div>
</a>`
  }).join('')

  return `<section class="porrevisar">
  <h2 class="rv-t">${escapar(x.cola)} <span class="rv-cn">${cola.length}</span></h2>
  <div class="rv-l">${filas}</div>
</section>`
}

/** Los estilos. Se añaden a la hoja de la ficha para no duplicarla. */
export const ESTILOS_AVANCE = `
.avance{background:var(--cd);border:1px solid var(--ln);border-radius:15px;
  box-shadow:var(--sh);padding:18px 17px}
.av-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.av-n{font-family:"JetBrains Mono",monospace;font-size:34px;font-weight:700;letter-spacing:-.04em;
  line-height:1;color:var(--grt)}
.av-l{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;letter-spacing:.14em;
  text-transform:uppercase;color:var(--md)}
.av-b{margin-left:auto;font-family:"JetBrains Mono",monospace;font-size:11.5px;font-weight:700;
  color:var(--am);background:var(--amb);padding:2px 9px;border-radius:99px}
.barra{display:flex;height:9px;margin-top:13px;border-radius:99px;overflow:hidden;
  background:var(--ln)}
.ba-v{background:var(--grt)}
/* El tramo rayado es lo declarado sin respaldo. Se ve distinto a propósito: un
   relleno sólido lo haría pasar por avance de verdad. */
.ba-d{background:repeating-linear-gradient(135deg,var(--am) 0 4px,transparent 4px 8px);
  background-color:var(--amb)}
.av-nota{margin:11px 0 0;font-size:12.5px;color:var(--ik2);line-height:1.45}
.av-t{margin:22px 0 10px;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  letter-spacing:.14em;text-transform:uppercase;color:var(--md)}
.hitos{display:grid;gap:1px;background:var(--ln);border-radius:11px;overflow:hidden}
.hito{display:grid;grid-template-columns:52px minmax(0,1fr);gap:12px;padding:12px 14px;
  background:var(--cd)}
.hito.verificado{background:var(--cd)}
.hito.pendiente{opacity:.55}
.hi-p{font-family:"JetBrains Mono",monospace;font-size:12.5px;font-weight:700;color:var(--md);
  padding-top:2px;white-space:nowrap}
.hito.verificado .hi-p{color:var(--grt)}
.hi-n{font-size:14.5px;font-weight:650;letter-spacing:-.012em;line-height:1.3}
.hi-e{margin-top:3px;font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--md)}
.falta{margin-top:7px;font-size:12.5px;font-weight:650;color:var(--am);background:var(--amb);
  border-radius:8px;padding:5px 9px;display:inline-block}
.docs{margin-top:9px;display:grid;gap:6px}
.doc{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;
  background:var(--cd2);border:1px solid var(--ln);border-radius:9px;padding:8px 11px}
.doc.ok{border-left:3px solid var(--grt)}
.doc.esp{border-left:3px solid var(--am)}
.doc.no{border-left:3px solid var(--md);opacity:.7}
.doc-n{font-size:13px;font-weight:600;word-break:break-all;color:inherit;
  text-decoration:underline;text-decoration-color:var(--ln2);text-underline-offset:2px}
.doc-n:hover{text-decoration-color:var(--ik2)}
.doc-f{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}
.doc-f input[type=text]{flex:1;min-width:150px;font:inherit;font-size:12.5px;padding:5px 9px;
  border:1px solid var(--ln2);border-radius:7px;background:var(--cd);color:var(--ik)}
.doc-f button,.sub button{font:inherit;font-size:12.5px;font-weight:650;padding:5px 12px;
  border:1px solid var(--ln2);border-radius:7px;background:var(--cd);color:var(--ik);cursor:pointer}
.doc-f .b-ok{border-color:var(--grt);color:var(--grt)}
.doc-f .b-no{border-color:var(--md)}
.sub{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center;
  padding-top:10px;border-top:1px dashed var(--ln)}
.sub select,.sub input[type=date],.sub input[type=file]{font:inherit;font-size:12.5px;
  padding:5px 8px;border:1px solid var(--ln2);border-radius:7px;background:var(--cd);
  color:var(--ik);max-width:100%}
.sub button{border-color:var(--grt);color:var(--grt)}
.doc-m{margin-top:2px;font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--md)}
.hu{letter-spacing:.04em}
.doc-r{margin-top:4px;font-size:12px;color:var(--ik2);line-height:1.4}
.doc-e{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;letter-spacing:.1em;
  text-transform:uppercase;color:var(--md);white-space:nowrap;padding-top:2px}
.porrevisar{margin-bottom:24px}
.rv-t{margin:0 0 10px;font-family:"JetBrains Mono",monospace;font-size:10.5px;font-weight:700;
  letter-spacing:.16em;text-transform:uppercase;color:var(--md);display:flex;align-items:center;gap:8px}
.rv-cn{background:var(--am);color:#fff;border-radius:99px;padding:1px 8px;font-size:10px}
.rv-l{display:grid;gap:8px}
.rv{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;
  background:var(--cd);border:1px solid var(--ln);border-radius:13px;padding:13px 16px;
  text-decoration:none;color:inherit;box-shadow:var(--sh)}
.rv:hover{border-color:var(--ln2)}
.rv.urge{border-left:3px solid var(--am)}
.rv-n{font-size:14.5px;font-weight:700;letter-spacing:-.012em;word-break:break-all}
.rv-d{font-size:13px;color:var(--ik2);margin-top:3px}
.rv-m{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.08em;
  color:var(--md);margin-top:6px}
.rv-di{font-family:"JetBrains Mono",monospace;font-size:12.5px;font-weight:700;color:var(--am);
  white-space:nowrap}
@media(max-width:520px){
  .hito{grid-template-columns:44px minmax(0,1fr);gap:9px;padding:11px 12px}
  .av-n{font-size:30px}
  .av-b{margin-left:0}
}
`

/**
 * La página entera del avance de un renglón.
 *
 * Se llega desde el renglón del contrato, pulsando sobre la barra. No es una
 * pantalla a la que se entre por un menú: se entra preguntándole al número de
 * dónde sale, que es la única razón por la que alguien querría verla.
 */
export function pintarPaginaAvance(
  a: Avance, cabecera: DatosCabecera, idioma: Idioma, r: Revision | null = null,
): string {
  const x = TEXTOS[idioma]
  return pagina({
    idioma,
    titulo: `${x.titulo} · ${cabecera.renglon}`,
    estilos: ESTILOS_AVANCE,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/contratos/${escapar(cabecera.contratoId)}">← ${escapar(x.volver)}</a>
  <div class="cod">${escapar(cabecera.contrato)}${
    cabecera.norma ? ` · ${escapar(cabecera.norma)}` : ''
  }</div>
  <h1>${escapar(cabecera.renglon)}</h1>
  <div class="sub">${escapar(cabecera.cantidad)}</div>
</div></header>`,
    cuerpo: `<main class="wrap">${pintarAvance(a, idioma, r)}</main>`,
  })
}

export type DatosCabecera = {
  readonly contratoId: string
  readonly contrato: string
  readonly renglon: string
  readonly cantidad: string
  readonly norma: string | null
}
