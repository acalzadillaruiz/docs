/**
 * La caja chica, en pantalla.
 *
 * Dos cosas mandan en el diseño de esta pantalla:
 *
 * La primera es que **lo gastado sin papel se ve**. Es la cifra incómoda, y por eso
 * va arriba, al lado del efectivo, y no escondida en una nota al pie. Una caja que
 * cuadra sola porque lo injustificado no se enseña no sirve para nada.
 *
 * La segunda es que **los supuestos se leen**. Este módulo se construyó sin esperar
 * a que se contestaran las preguntas de contabilidad, y eso obliga a enseñar en qué
 * se dio por supuesto qué. Un supuesto que solo vive en el código no es un supuesto:
 * es una decisión tomada a escondidas.
 */

import type { Caja, PorContrato, Vale } from '../dominio/caja.ts'
import { SUPUESTOS } from '../dominio/caja.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera' },
  en: { volver: 'Back to the portfolio' },
} as const

type Opcion = { readonly codigo: string; readonly nombre: string }

export type DatosCaja = {
  readonly cajas: readonly Caja[]
  readonly cuentas: readonly Opcion[]
  readonly contratos: readonly { readonly id: string; readonly codigo: string }[]
  readonly porContrato: readonly PorContrato[]
  readonly hoy: string
}

function pintarVale(v: Vale, t: ReturnType<typeof traductor>): string {
  return `
<div class="vl${v.repuesto ? ' rep' : ''}">
  <div class="vl-c">
    <div class="vl-t">#${v.numero} · ${escapar(v.concepto)}</div>
    <div class="vl-m">${escapar(v.fecha)} · ${escapar(v.cuenta)}${
      v.contrato ? ` · ${escapar(v.contrato)}` : ''}${
      v.beneficiario ? ` · ${escapar(v.beneficiario)}` : ''}</div>
    <div class="vl-e">
      ${v.conSoporte ? '' : `<span class="et mal">${escapar(t('caja.falta_papel'))}</span>`}
      ${v.grande ? `<span class="et mal">${escapar(t('caja.vale_grande'))}</span>` : ''}
      <span class="et">${escapar(v.repuesto ? t('caja.repuesto') : t('caja.pendiente'))}</span>
      ${v.tardo > 0
        ? `<span class="et">${escapar(t('caja.tardo').replace('{n}', String(v.tardo)))}</span>`
        : ''}
    </div>
  </div>
  <div class="vl-n">${escapar(v.monto)}</div>
</div>`
}

function pintarUnaCaja(c: Caja, d: DatosCaja, af: string, t: ReturnType<typeof traductor>): string {
  const opciones = d.cuentas.map((o) =>
    `<option value="${escapar(o.codigo)}">${escapar(o.codigo)} · ${escapar(o.nombre)}</option>`).join('')
  const contratos = [`<option value="">${escapar(t('caja.sin_contrato'))}</option>`]
    .concat(d.contratos.map((o) =>
      `<option value="${escapar(o.id)}">${escapar(o.codigo)}</option>`)).join('')

  return `
<section class="cj">
  <div class="cj-h">
    <h2>${escapar(c.nombre)}${c.cerrada ? ` · ${escapar(t('caja.cerrada'))}` : ''}</h2>
    <div class="cj-r">${escapar(t('caja.responsable'))}: ${escapar(c.responsable)}</div>
  </div>

  <div class="kp">
    <div class="d"><span>${escapar(t('caja.fondo'))}</span><b>${escapar(c.fondo)}</b></div>
    <div class="d"><span>${escapar(t('caja.efectivo'))}</span><b>${escapar(c.efectivo)}</b></div>
    <div class="d"><span>${escapar(t('caja.por_reponer'))}</span><b>${escapar(c.porReponer)}</b></div>
    <div class="d${c.sinSoporteCrudo > 0 ? ' alerta' : ''}">
      <span>${escapar(t('caja.sin_soporte'))}</span><b>${escapar(c.sinSoporte)}</b></div>
  </div>

  <div class="bar2"><i class="b-ok" style="width:${Math.max(0, Math.min(100, c.efectivoPct))}%"></i></div>
  ${c.hayQueReponer && !c.cerrada
    ? `<p class="avisa">${escapar(t('caja.hay_que_reponer'))}</p>` : ''}

  ${c.cerrada ? '' : `
  <form method="post" action="/caja" class="vale">
    <input type="hidden" name="af" value="${escapar(af)}">
    <input type="hidden" name="que" value="vale">
    <input type="hidden" name="caja" value="${escapar(c.id)}">
    <label>${escapar(t('caja.fecha'))}
      <input type="date" name="fecha" value="${escapar(d.hoy)}"></label>
    <label class="ancho">${escapar(t('caja.concepto'))}
      <input type="text" name="concepto" maxlength="200"></label>
    <label>${escapar(t('caja.monto'))}
      <input type="text" inputmode="decimal" name="monto"></label>
    <label>${escapar(t('caja.beneficiario'))}
      <input type="text" name="beneficiario" maxlength="120"></label>
    <label class="ancho">${escapar(t('caja.cuenta'))}
      <select name="cuenta">${opciones}</select></label>
    <label>${escapar(t('caja.contrato'))}
      <select name="contrato">${contratos}</select></label>
    <label>${escapar(t('caja.soporte'))}
      <input type="text" name="soporte" maxlength="200"></label>
    <button type="submit">${escapar(t('caja.anotar'))}</button>
  </form>

  <div class="acciones">
    <form method="post" action="/caja">
      <input type="hidden" name="af" value="${escapar(af)}">
      <input type="hidden" name="que" value="reponer">
      <input type="hidden" name="caja" value="${escapar(c.id)}">
      <label>${escapar(t('caja.fecha'))}
        <input type="date" name="fecha" value="${escapar(d.hoy)}"></label>
      <button type="submit"${c.porReponerCrudo > 0 ? '' : ' disabled'}>${
        escapar(t('caja.reponer'))}</button>
    </form>
    <form method="post" action="/caja">
      <input type="hidden" name="af" value="${escapar(af)}">
      <input type="hidden" name="que" value="cerrar">
      <input type="hidden" name="caja" value="${escapar(c.id)}">
      <label>${escapar(t('caja.fecha'))}
        <input type="date" name="fecha" value="${escapar(d.hoy)}"></label>
      <button type="submit" class="flojo">${escapar(t('caja.cerrar'))}</button>
    </form>
  </div>`}

  <h3>${escapar(t('caja.vales'))}</h3>
  <div class="caja">${c.vales.length === 0
    ? `<p class="nada">${escapar(t('caja.sin_vales'))}</p>`
    : c.vales.map((v) => pintarVale(v, t)).join('')}</div>
</section>`
}

export function pintarCaja(
  d: DatosCaja, idioma: Idioma, antifalsificacion: string, errores: readonly string[] = [],
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  return pagina({
    idioma,
    titulo: t('caja.titulo'),
    estilos: ESTILOS_CAJA,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('caja.titulo'))}</h1>
  <div class="sub">${escapar(t('caja.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((e) => `<li>${escapar(e)}</li>`).join('')
  }</ul></div>`}

  ${d.cajas.length === 0 ? `<p class="nada">${escapar(t('caja.nada'))}</p>` : ''}
  ${d.cajas.map((c) => pintarUnaCaja(c, d, antifalsificacion, t)).join('')}

  <section class="cj">
    <h2>${escapar(t('caja.abrir'))}</h2>
    <form method="post" action="/caja" class="vale">
      <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
      <input type="hidden" name="que" value="abrir">
      <label class="ancho">${escapar(t('caja.nombre'))}
        <input type="text" name="nombre" maxlength="80"></label>
      <label>${escapar(t('caja.moneda'))}
        <select name="moneda"><option value="VES">VES</option><option value="USD">USD</option></select></label>
      <label>${escapar(t('caja.fondo'))}
        <input type="text" inputmode="decimal" name="fondo"></label>
      <label>${escapar(t('caja.fecha'))}
        <input type="date" name="fecha" value="${escapar(d.hoy)}"></label>
      <button type="submit">${escapar(t('caja.abrir'))}</button>
    </form>
  </section>

  <section class="cj">
    <h2>${escapar(t('caja.por_contrato'))}</h2>
    <p class="expl">${escapar(t('caja.por_contrato_explica'))}</p>
    <div class="caja">${d.porContrato.length === 0
      ? `<p class="nada">${escapar(t('caja.sin_vales'))}</p>`
      : d.porContrato.map((f) => `
    <div class="vl">
      <div class="vl-c">
        <div class="vl-t">${escapar(f.contrato)}</div>
        <div class="vl-m">${escapar(f.cliente)} · ${f.vales} ${escapar(t('caja.vales'))}</div>
      </div>
      <div class="vl-n">${escapar(f.gastado)}${f.sinPapelCrudo > 0
        ? `<span class="vl-p mal">${escapar(t('caja.falta_papel'))} ${escapar(f.sinPapel)}</span>`
        : ''}</div>
    </div>`).join('')}</div>
  </section>

  <section class="sup">
    <h2>${escapar(t('caja.supuestos'))}</h2>
    <p class="expl">${escapar(t('caja.supuestos_explica'))}</p>
    <ol>${SUPUESTOS.map((s) => `<li>${escapar(t(s))}</li>`).join('')}</ol>
  </section>
</main>`,
  })
}

export const ESTILOS_CAJA = `
.cj{margin-top:26px}
.cj-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.cj h2{margin:0;font-size:20px;font-weight:750;letter-spacing:-.02em}
.cj h3{margin:22px 0 8px;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  letter-spacing:.14em;text-transform:uppercase;color:var(--md)}
.cj-r{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--md)}
.kp{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;
  margin-top:14px;background:var(--nv3)}
.kp .d{background:var(--nv);padding:13px 15px}
.kp .d span{display:block;font-family:"JetBrains Mono",monospace;font-size:8.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:#7691A8}
.kp .d b{display:block;margin-top:6px;font-family:"JetBrains Mono",monospace;font-size:17px;
  font-weight:700;letter-spacing:-.03em;color:#E9F0F6}
/* Lo gastado sin papel se enseña en ámbar cuando lo hay. No es decoración: es la
   única cifra de esta pantalla que señala a una persona concreta. */
.kp .d.alerta b{color:#EFC167}
.bar2{display:flex;height:6px;margin-top:10px;border-radius:99px;overflow:hidden;
  background:repeating-linear-gradient(135deg,var(--am) 0 3px,transparent 3px 6px);
  background-color:var(--amb)}
.bar2 .b-ok{background:var(--grt)}
.avisa{margin:10px 0 0;font-size:13.5px;color:var(--am);font-weight:600}
.expl{margin:6px 0 11px;font-size:13.5px;color:var(--ik2);line-height:1.45;max-width:66ch}
.vale{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin:16px 0 0}
.vale label,.acciones label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.vale label.ancho{flex:1;min-width:220px}
.vale input,.vale select,.acciones input{display:block;margin-top:5px;width:100%;font:inherit;
  font-size:14px;padding:8px 10px;border:1px solid var(--ln2);border-radius:9px;
  background:var(--cd);color:var(--ik)}
.vale button,.acciones button{font:inherit;font-size:14px;font-weight:700;padding:9px 20px;
  border:0;border-radius:9px;background:var(--nv);color:#E9F0F6;cursor:pointer}
.vale button[disabled],.acciones button[disabled]{opacity:.45;cursor:not-allowed}
.acciones{display:flex;flex-wrap:wrap;gap:22px;margin-top:16px}
.acciones form{display:flex;gap:10px;align-items:flex-end}
.acciones .flojo{background:transparent;color:var(--ik2);border:1px solid var(--ln2)}
.vl{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;
  padding:13px 17px;border-top:1px solid var(--ln)}
.vl:first-child{border-top:0}
.vl.rep{opacity:.62}
.vl-c{min-width:0;flex:1}
.vl-t{font-size:15px;font-weight:650;letter-spacing:-.015em;line-height:1.25}
.vl-m{font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--md);margin-top:3px}
.vl-e{margin-top:7px;display:flex;flex-wrap:wrap;gap:7px}
.vl-e .et{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.1em;text-transform:uppercase;color:var(--md);border:1px solid var(--ln2);
  border-radius:99px;padding:2px 8px}
.vl-e .et.mal{color:var(--am);border-color:var(--am)}
.vl-n{font-family:"JetBrains Mono",monospace;font-size:15px;font-weight:700;
  letter-spacing:-.025em;text-align:right;white-space:nowrap}
.vl-p{display:block;margin-top:4px;font-size:10px;font-weight:400;letter-spacing:.06em;
  text-transform:uppercase}
.vl-p.mal{color:var(--am)}
.sup{margin-top:34px;padding:18px 20px;background:var(--cd);border:1px solid var(--ln);
  border-left:3px solid var(--am);border-radius:12px}
.sup h2{margin:0;font-size:17px;font-weight:750;letter-spacing:-.02em}
.sup ol{margin:0;padding-left:20px;font-size:13.5px;line-height:1.55;color:var(--ik2)}
.sup li{margin-top:9px}
@media(max-width:520px){
  .vl{flex-direction:column;gap:6px}
  .vl-n{text-align:left}
  .acciones form{flex-wrap:wrap}
}
`
