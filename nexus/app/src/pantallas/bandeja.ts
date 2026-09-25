/**
 * La bandeja: lo que espera a GPS.
 *
 * Va en la cartera, arriba, no en una pantalla aparte a la que hay que acordarse de
 * entrar. Una bandeja que hay que buscar no se mira, y una que no se mira no sirve
 * para nada: el cliente sigue escribiendo al vacío igual que antes.
 */

import type { Pendiente } from '../dominio/bandeja.ts'
import type { Idioma } from '../i18n/t.ts'
import { escapar } from './base.ts'

const TEXTOS = {
  es: {
    titulo: 'Te esperan a ti',
    vacia: 'No hay nada esperando respuesta.',
    dias: (d: number) => `${d} ${d === 1 ? 'día' : 'días'}`,
    hoy: 'hoy',
  },
  en: {
    titulo: 'Waiting on you',
    vacia: 'Nothing is waiting for an answer.',
    dias: (d: number) => `${d} ${d === 1 ? 'day' : 'days'}`,
    hoy: 'today',
  },
} as const

/**
 * Devuelve solo el bloque, no una página entera: se incrusta en la cartera.
 * Cadena vacía cuando no hay nada, para no dejar un encabezado huérfano diciendo
 * que no hay nada — eso ocupa sitio y no informa.
 */
export function pintarBandeja(pendientes: readonly Pendiente[], idioma: Idioma): string {
  if (pendientes.length === 0) return ''
  const x = TEXTOS[idioma]

  const filas = pendientes.map((p) => {
    // A partir de una semana se marca: antes de eso es trabajo normal, después
    // empieza a ser un cliente esperando.
    const urgente = p.dias >= 7
    return `<a class="pd${urgente ? ' urge' : ''}" href="/valuaciones/${escapar(p.valuacionId)}">
  <div class="pd-c">
    <div class="pd-t">${escapar(p.titulo)}</div>
    <div class="pd-d">${escapar(p.detalle)}</div>
    <div class="pd-m">${escapar(p.contrato)} · ${escapar(p.cliente)}</div>
  </div>
  <div class="pd-r">
    <div class="pd-di">${p.dias === 0 ? escapar(x.hoy) : escapar(x.dias(p.dias))}</div>
    <div class="pd-i">${escapar(p.importe)}</div>
  </div>
</a>`
  }).join('\n')

  return `<section class="bandeja">
  <h2 class="bd-t">${escapar(x.titulo)} <span class="bd-n">${pendientes.length}</span></h2>
  <div class="bd-l">${filas}</div>
</section>`
}

/** Los estilos del bloque. Se añaden a los de la cartera para no duplicar la hoja. */
export const ESTILOS_BANDEJA = `
.bandeja{margin-bottom:24px}
.bd-t{margin:0 0 10px;font-family:"JetBrains Mono",monospace;font-size:10.5px;font-weight:700;
  letter-spacing:.16em;text-transform:uppercase;color:var(--md);display:flex;align-items:center;gap:8px}
.bd-n{background:var(--am);color:#fff;border-radius:99px;padding:1px 8px;font-size:10px;
  letter-spacing:.06em}
.bd-l{display:grid;gap:8px}
.pd{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;
  background:var(--cd);border:1px solid var(--ln);border-radius:13px;padding:13px 16px;
  text-decoration:none;color:inherit;box-shadow:var(--sh)}
.pd:hover{border-color:var(--ln2)}
.pd.urge{border-left:3px solid var(--am)}
.pd-t{font-size:14.5px;font-weight:700;letter-spacing:-.012em}
.pd-d{font-size:13px;color:var(--ik2);margin-top:3px;line-height:1.4}
.pd-m{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.08em;
  color:var(--md);margin-top:6px}
.pd-r{text-align:right;white-space:nowrap}
.pd-di{font-family:"JetBrains Mono",monospace;font-size:12.5px;font-weight:700;color:var(--am)}
.pd-i{font-family:"JetBrains Mono",monospace;font-size:12.5px;color:var(--ik2);margin-top:4px}
@media(max-width:520px){ .pd{padding:12px 14px} .pd-d{font-size:12.5px} }
`
