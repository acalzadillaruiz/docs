/**
 * Las tres cifras, en pantalla.
 *
 * Es la pantalla de dirección, y por eso está escrita al revés de como se escriben
 * las pantallas de dirección: no empieza por lo que va bien.
 *
 * Cada bloque abre con la pregunta que contesta, en una línea y en castellano
 * normal. Un cuadro de mando que hay que aprender a leer no se lee: se mira una vez
 * el día que se instala y nunca más.
 *
 * Y cuando no hay nada que señalar, lo dice y no pinta una tabla vacía. Una tabla
 * vacía parece un error del programa.
 */

import type { Medidas, FilaBrecha, FilaVerdad, FilaCobertura, FilaSinHitos } from '../dominio/medidas.ts'
import { dias } from '../dominio/medidas.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: {
    volver: 'Volver a la cartera',
    preguntaBrecha: '¿Cuánto de lo que le estamos contando al cliente se derrumbaría si lo pidiera por escrito mañana?',
    preguntaVerdad: '¿Con cuántos días de retraso estamos viendo la obra?',
    preguntaCobertura: '¿Cuánto hemos vendido sin haber comprado todavía nada debajo?',
    preguntaSinHitos: '¿A qué renglones se les olvidó crear los hitos?',
    avisoVerdad: 'Si un hecho tarda doce días en llegar, toda decisión de hoy se está tomando con una foto de hace doce días.',
    avisoCobertura: 'Es margen que parece existir y todavía hay que pagar.',
    contrato: 'Contrato', cliente: 'Cliente', renglon: 'Renglón',
    total: 'Total sin demostrar',
  },
  en: {
    volver: 'Back to the portfolio',
    preguntaBrecha: 'How much of what we are telling the client would collapse if they asked for it in writing tomorrow?',
    preguntaVerdad: 'How many days behind the field are we seeing?',
    preguntaCobertura: 'How much have we sold with nothing bought underneath yet?',
    preguntaSinHitos: 'Which line items never got their milestones?',
    avisoVerdad: 'If an event takes twelve days to arrive, every decision today is being made on a twelve-day-old photograph.',
    avisoCobertura: 'It is margin that looks real and still has to be paid for.',
    contrato: 'Contract', cliente: 'Client', renglon: 'Line item',
    total: 'Total unproven',
  },
} as const

function vacio(texto: string): string {
  return `<p class="nada">${escapar(texto)}</p>`
}

function bloqueBrecha(filas: readonly FilaBrecha[], idioma: Idioma, t: ReturnType<typeof traductor>): string {
  const x = TEXTOS[idioma]
  if (filas.length === 0) return vacio(t('medida.nada'))
  return filas.map((f) => `
<div class="fila">
  <div class="fi-c">
    <div class="fi-t">${escapar(f.contrato)}</div>
    <div class="fi-s">${escapar(f.cliente)}</div>
    <div class="bar2"><i class="b-ok" style="width:${f.demostradoPct}%"></i></div>
    <div class="fi-d">
      <span>${escapar(t('medida.declarado'))} ${escapar(f.declarado)}</span>
      <span>${escapar(t('medida.evidenciado'))} ${escapar(f.evidenciado)}</span>
    </div>
  </div>
  <div class="fi-n mal">
    ${escapar(f.brecha)}
    <span class="fi-p">${escapar(String(f.brechaPct))} %</span>
  </div>
</div>`).join('')
}

function bloqueVerdad(filas: readonly FilaVerdad[], idioma: Idioma, t: ReturnType<typeof traductor>): string {
  if (filas.length === 0) return vacio(t('medida.nada'))
  return filas.map((f) => `
<div class="fila">
  <div class="fi-c">
    <div class="fi-t">${escapar(f.contrato)}</div>
    <div class="fi-d"><span>${escapar(t('medida.hechos'))}: ${f.hechos}</span>
      <span>${escapar(t('medida.peor'))} ${escapar(dias(idioma, f.peor))}</span></div>
  </div>
  <div class="fi-n ${f.mediana >= 7 ? 'mal' : ''}">
    ${escapar(dias(idioma, f.mediana))}
    <span class="fi-p">${escapar(t('medida.mediana'))}</span>
  </div>
</div>`).join('')
}

function bloqueCobertura(filas: readonly FilaCobertura[], idioma: Idioma, t: ReturnType<typeof traductor>): string {
  const x = TEXTOS[idioma]
  if (filas.length === 0) return vacio(t('medida.nada'))
  return filas.map((f) => `
<div class="fila">
  <div class="fi-c">
    <div class="fi-t">${escapar(f.contrato)}</div>
    <div class="fi-s">${escapar(f.cliente)}</div>
    <div class="fi-d">
      <span>${escapar(t('medida.vendido'))} ${escapar(f.vendido)}</span>
      <span>${escapar(t('medida.con_respaldo'))} ${escapar(f.conRespaldo)}</span>
    </div>
  </div>
  <div class="fi-n mal">
    ${escapar(f.sinRespaldo)}
    <span class="fi-p">${escapar(String(f.sinRespaldoPct))} %</span>
  </div>
</div>`).join('')
}

function bloqueSinHitos(filas: readonly FilaSinHitos[], idioma: Idioma, t: ReturnType<typeof traductor>): string {
  if (filas.length === 0) return vacio(t('medida.nada'))
  return filas.map((f) => `
<a class="fila" href="/contratos/${escapar(f.contratoId)}">
  <div class="fi-c">
    <div class="fi-t">${escapar(f.renglon)}</div>
    <div class="fi-s">${escapar(f.contrato)}</div>
  </div>
  <div class="fi-n">${escapar(f.valor)}</div>
</a>`).join('')
}

export function pintarMedidas(m: Medidas, idioma: Idioma): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const seccion = (titulo: string, pregunta: string, explica: string, cuerpo: string) => `
<section class="med">
  <h2>${escapar(titulo)}</h2>
  <p class="preg">${escapar(pregunta)}</p>
  <p class="expl">${escapar(explica)}</p>
  <div class="caja">${cuerpo}</div>
</section>`

  return pagina({
    idioma,
    titulo: t('medida.titulo'),
    estilos: ESTILOS_MEDIDAS,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <div class="cod">${escapar(t('medida.solo_dentro'))}</div>
  <h1>${escapar(t('medida.titulo'))}</h1>
  <div class="sub">${escapar(t('medida.subtitulo'))}</div>
  ${m.brechaTotal.length === 0 ? '' : `<div class="kp"><div class="d">
    <span>${escapar(x.total)}</span>
    <b>${m.brechaTotal.map((v) => escapar(v)).join(' · ')}</b>
  </div></div>`}
</div></header>`,
    cuerpo: `<main class="wrap">
${seccion(t('medida.brecha'), x.preguntaBrecha, t('medida.brecha_explicacion'),
  bloqueBrecha(m.brecha, idioma, t))}
${seccion(t('medida.tiempo_verdad'), x.preguntaVerdad, x.avisoVerdad,
  bloqueVerdad(m.verdad, idioma, t))}
${seccion(t('medida.cobertura'), x.preguntaCobertura, x.avisoCobertura,
  bloqueCobertura(m.cobertura, idioma, t))}
${seccion(t('medida.sin_hitos'), x.preguntaSinHitos, t('medida.sin_hitos_explica'),
  bloqueSinHitos(m.sinHitos, idioma, t))}
</main>`,
  })
}

export const ESTILOS_MEDIDAS = `
.kp{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;
  margin-top:22px;background:var(--nv3)}
.kp .d{background:var(--nv);padding:13px 15px}
.kp .d span{display:block;font-family:"JetBrains Mono",monospace;font-size:8.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:#7691A8}
.kp .d b{display:block;margin-top:6px;font-family:"JetBrains Mono",monospace;font-size:19px;
  font-weight:700;letter-spacing:-.03em;color:#EFC167}
.med{margin-top:26px}
/* La pregunta va grande y la explicación pequeña, no al revés: un cuadro de mando
   que hay que aprender a leer se mira el día que se instala y nunca más. */
.preg{margin:0 0 6px;font-size:17px;font-weight:700;letter-spacing:-.02em;line-height:1.3}
.expl{margin:0 0 11px;font-size:13.5px;color:var(--ik2);line-height:1.45;max-width:64ch}
.fila{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;
  padding:14px 17px;border-top:1px solid var(--ln);text-decoration:none;color:inherit}
.fila:first-child{border-top:0}
a.fila:hover{background:var(--cd2)}
.fi-c{min-width:0;flex:1}
.fi-t{font-size:15px;font-weight:700;letter-spacing:-.015em;line-height:1.25}
.fi-s{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.08em;
  color:var(--md);margin-top:3px}
.fi-d{margin-top:7px;display:flex;flex-wrap:wrap;gap:12px;
  font-family:"JetBrains Mono",monospace;font-size:11.5px;color:var(--ik2)}
.bar2{display:flex;height:6px;margin-top:8px;border-radius:99px;overflow:hidden;
  background:repeating-linear-gradient(135deg,var(--am) 0 3px,transparent 3px 6px);
  background-color:var(--amb)}
.bar2 .b-ok{background:var(--grt)}
.fi-n{font-family:"JetBrains Mono",monospace;font-size:16px;font-weight:700;
  letter-spacing:-.025em;text-align:right;white-space:nowrap}
.fi-n.mal{color:var(--am)}
.fi-p{display:block;margin-top:4px;font-size:10.5px;font-weight:400;color:var(--md);
  letter-spacing:.06em;text-transform:uppercase}
@media(max-width:520px){
  .fila{flex-direction:column;gap:8px}
  .fi-n{text-align:left}
  .fi-p{display:inline;margin-left:8px}
}
`
