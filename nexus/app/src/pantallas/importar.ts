/**
 * Traer una hoja de Excel.
 *
 * Son tres pantallas que son la misma, en tres momentos: elegir la hoja, revisar
 * cómo se entendió cada columna, y confirmar.
 *
 * La del medio es la que importa. Enseña, columna por columna, qué campo cree la
 * aplicación que es y un ejemplo de la propia hoja al lado. Sin ese ejemplo no hay
 * forma de saber si «Base» es la base imponible o el total con IVA, y esa confusión
 * mete un 16% de error en la contabilidad sin que nadie lo vea.
 */

import type { Propuesta, Revision, Lote, Campo } from '../dominio/importar.ts'
import { CAMPOS, DESTINOS, nombreCampo } from '../dominio/importar.ts'
import { traductor, type Clave, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera', archivo: 'Archivo', filas: 'filas', paso: 'Paso' },
  en: { volver: 'Back to the portfolio', archivo: 'File', filas: 'rows', paso: 'Step' },
} as const

const FORMATOS_FECHA = ['dmy', 'mdy', 'iso'] as const
const FORMATOS_NUMERO = ['ven', 'ang'] as const

/** Paso uno: elegir la hoja. */
export function pintarSubirHoja(
  idioma: Idioma, antifalsificacion: string, listaLotes: readonly Lote[],
  error = '',
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const lotes = listaLotes.length === 0 ? '' : `
<h2>${escapar(t('importar.lotes'))}</h2>
<div class="caja">${listaLotes.map((l) => `
<div class="lt">
  <div class="lt-c">
    <div class="lt-a">${escapar(l.archivo)}</div>
    <div class="lt-m">${escapar(l.cargadoEn)} · ${l.filas} ${escapar(x.filas)}</div>
  </div>
  <div class="lt-e ${escapar(l.estado)}">${escapar(
    t(`importar.estado.${l.estado}` as Clave))}</div>
  ${l.estado === 'confirmado' || l.estado === 'revertido' ? ''
    : `<a class="lt-v" href="/importar/${escapar(l.id)}">→</a>`}
</div>`).join('')}</div>`

  return pagina({
    idioma,
    titulo: t('importar.titulo'),
    estilos: ESTILOS_IMPORTAR,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('importar.titulo'))}</h1>
  <div class="sub">${escapar(t('importar.como'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${error === '' ? '' : `<div class="mal-caja">${escapar(error)}</div>`}
  <form method="post" action="/importar" enctype="multipart/form-data">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <div class="caja pad">
      <label class="c"><span>${escapar(t('importar.destino'))}</span>
        <select name="destino">
          ${DESTINOS.map((d) => `<option value="${d}">${escapar(
            t(`importar.destino.${d}` as Clave))}</option>`).join('')}
        </select></label>
      <label class="c"><span>${escapar(t('importar.subir'))}</span>
        <input type="file" name="documento" accept=".csv,text/csv,text/plain" required></label>
    </div>
    <p class="expl">${escapar(t('importar.destino.ventas_explica'))}</p>
    <button type="submit">${escapar(t('importar.subir'))}</button>
  </form>
  ${lotes}
</main>`,
  })
}

/** Paso dos y tres: revisar el mapeo, comprobar, confirmar. */
export function pintarMapeo(
  loteId: string, archivo: string, propuestas: readonly Propuesta[],
  idioma: Idioma, antifalsificacion: string,
  revision: Revision | null = null, error = '',
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const campos = CAMPOS['facturas_recibidas']

  const filas = propuestas.map((p) => {
    const opciones = campos.map((c) => `<option value="${c.campo}"${
      p.campo === c.campo ? ' selected' : ''
    }>${escapar(nombreCampo(idioma, c.campo))}${c.obligatorio ? ' *' : ''}</option>`).join('')

    const formatos = p.tipo === 'fecha' ? FORMATOS_FECHA
      : p.tipo === 'numero' ? FORMATOS_NUMERO : []

    return `
<div class="mp">
  <div class="mp-n">${p.columna}</div>
  <div class="mp-c">
    <div class="mp-h">${escapar(p.cabecera)}</div>
    <div class="mp-e">${escapar(t('importar.muestra'))}: <b>${escapar(p.muestra)}</b></div>
  </div>
  <select name="campo_${p.columna}" aria-label="${escapar(t('importar.campo'))}">
    <option value="">— ${escapar(t('importar.ignorar'))} —</option>
    ${opciones}
  </select>
  <select name="formato_${p.columna}" aria-label="${escapar(t('importar.formato'))}"${
    formatos.length === 0 ? ' disabled' : ''}>
    <option value=""></option>
    ${formatos.map((f) => `<option value="${f}"${p.formato === f ? ' selected' : ''}>${
      escapar(t(`formato.${f}` as Clave))}</option>`).join('')}
  </select>
  <input type="hidden" name="columna" value="${p.columna}">
</div>`
  }).join('')

  const resultado = !revision ? '' : `
<div class="rev ${revision.malas === 0 && revision.proveedoresFaltan.length === 0
    && revision.mesesSinPeriodo.length === 0 ? 'bien' : 'mal'}">
  <div class="rev-n"><b>${revision.buenas}</b> ${escapar(t('importar.buenas'))}${
    revision.malas === 0 ? '' : ` · <b>${revision.malas}</b> ${escapar(t('importar.malas'))}`
  }</div>
  ${revision.malas === 0 ? '' : `<ul class="rev-l">${
    revision.errores.map((e) => `<li>${escapar(String(e.fila))}: ${escapar(e.motivo)}</li>`).join('')
  }</ul><p class="expl">${escapar(t('importar.todo_o_nada'))}</p>`}
  ${revision.mesesSinPeriodo.length === 0 ? '' : `
  <h3>${escapar(t('importar.error.sin_periodo'))}</h3>
  <ul class="rev-l">${revision.mesesSinPeriodo.map((m) =>
    `<li><b>${String(m.mes).padStart(2, '0')}/${m.anio}</b> · ${m.filas} ${escapar(x.filas)}</li>`
  ).join('')}</ul>
  <p class="expl">${escapar(t('importar.abrir_periodo'))}</p>`}
  ${revision.proveedoresFaltan.length === 0 ? '' : `
  <h3>${escapar(t('importar.sin_proveedor'))}</h3>
  <ul class="rev-l">${revision.proveedoresFaltan.map((p) =>
    `<li><b>${escapar(p.rif)}</b> ${escapar(p.nombre)} · ${p.filas} ${escapar(x.filas)}</li>`
  ).join('')}</ul>
  <p class="expl">${escapar(t('importar.sin_proveedor_explica'))}</p>`}
</div>`

  const puedeConfirmar = revision !== null && revision.malas === 0 &&
    revision.proveedoresFaltan.length === 0 && revision.mesesSinPeriodo.length === 0 &&
    revision.filas > 0

  return pagina({
    idioma,
    titulo: `${t('importar.titulo')} · ${archivo}`,
    estilos: ESTILOS_IMPORTAR,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/importar">← ${escapar(t('importar.titulo'))}</a>
  <div class="cod">${escapar(x.archivo)}: ${escapar(archivo)}</div>
  <h1>${escapar(t('importar.mapeo'))}</h1>
  <div class="sub">${escapar(t('importar.mapeo_explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${error === '' ? '' : `<div class="mal-caja">${escapar(error)}</div>`}
  <form method="post" action="/importar/${escapar(loteId)}">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <div class="caja">${filas}</div>
    ${resultado}
    <div class="botones">
      <button type="submit" name="accion" value="validar" class="sec">${
        escapar(t('importar.validar'))}</button>
      ${!puedeConfirmar ? '' : `<button type="submit" name="accion" value="confirmar">${
        escapar(t('importar.confirmar'))}</button>`}
    </div>
  </form>
</main>`,
  })
}

export const ESTILOS_IMPORTAR = `
.pad{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));padding:8px}
.c{display:block;padding:8px 10px}
.c span{display:block;font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md);margin-bottom:5px}
.c input,.c select{width:100%;font:inherit;font-size:14.5px;padding:8px 10px;
  border:1px solid var(--ln2);border-radius:9px;background:var(--cd);color:var(--ik)}
.mp{display:grid;grid-template-columns:28px minmax(0,1fr) minmax(130px,1fr) minmax(110px,.8fr);
  gap:10px;padding:11px 14px;border-top:1px solid var(--ln);align-items:center}
.mp:first-child{border-top:0}
.mp-n{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--md);text-align:center}
.mp-h{font-size:14px;font-weight:700;letter-spacing:-.012em}
/* El ejemplo de la propia hoja al lado. Sin él no hay forma de saber si «Base» es
   la base imponible o el total con IVA, y esa confusión mete un 16% de error. */
.mp-e{margin-top:3px;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ik2)}
.mp-e b{color:var(--grt)}
.mp select{font:inherit;font-size:13px;padding:7px 8px;border:1px solid var(--ln2);
  border-radius:8px;background:var(--cd);color:var(--ik);max-width:100%}
.mp select:disabled{opacity:.35}
.rev{margin-top:16px;border:1px solid var(--ln);border-left-width:3px;border-radius:12px;
  padding:15px 18px;background:var(--cd)}
.rev.bien{border-left-color:var(--grt)}
.rev.mal{border-left-color:var(--am)}
.rev-n{font-size:15px}
.rev-n b{font-family:"JetBrains Mono",monospace;font-size:19px;letter-spacing:-.03em}
.rev.bien .rev-n b{color:var(--grt)}
.rev.mal .rev-n b{color:var(--am)}
.rev-l{margin:10px 0 0;padding-left:20px;font-size:13.5px;color:var(--ik2)}
.rev-l li{margin-bottom:4px}
.rev h3{margin:14px 0 0;font-size:15px;color:var(--am)}
.expl{margin:10px 0 0;font-size:13px;color:var(--ik2);line-height:1.45;max-width:64ch}
.lt{display:flex;align-items:center;gap:14px;padding:13px 16px;border-top:1px solid var(--ln)}
.lt:first-child{border-top:0}
.lt-c{flex:1;min-width:0}
.lt-a{font-size:14.5px;font-weight:650;word-break:break-all}
.lt-m{margin-top:3px;font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--md)}
.lt-e{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;letter-spacing:.1em;
  text-transform:uppercase;color:var(--md);white-space:nowrap}
.lt-e.confirmado{color:var(--grt)}
.lt-v{text-decoration:none;color:var(--ik2);font-size:20px}
.mal-caja{margin-top:18px;background:var(--cd);border:1px solid var(--rj);border-left-width:3px;
  border-radius:11px;padding:13px 17px;color:var(--rj);font-weight:600;font-size:14px}
.botones{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
form button{margin-top:18px;font:inherit;font-size:15px;font-weight:700;padding:11px 22px;
  border:0;border-radius:11px;background:var(--nv);color:#E9F0F6;cursor:pointer}
form button:hover{background:var(--nv3)}
form button.sec{background:transparent;color:var(--ik2);border:1px solid var(--ln2);
  font-weight:600;padding:10px 18px}
@media(max-width:600px){
  .mp{grid-template-columns:24px minmax(0,1fr);row-gap:7px}
  .mp select{grid-column:2}
}
`
