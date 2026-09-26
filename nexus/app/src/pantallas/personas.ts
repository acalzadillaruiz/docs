/**
 * Personas y accesos.
 *
 * Es la pantalla que faltaba para que este portal se pudiera usar: hasta ahora la
 * única forma de dar de alta a alguien era escribir SQL a mano.
 *
 * Dos decisiones que se leen en la pantalla:
 *
 *   - **El enlace de alta se enseña aquí y no se manda por correo.** Una llave
 *     enviada a un buzón que nadie ha comprobado es una cuenta regalada. Quien
 *     invita lo copia y lo manda por donde sepa que llega.
 *   - **Dar de baja cierra la sesión en el acto.** Marcar la cuenta como inactiva y
 *     dejarle la sesión abierta es dar de baja a alguien que sigue dentro.
 */

import type { Persona, Pendiente } from '../dominio/personas.ts'
import { traductor, type Clave, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera' },
  en: { volver: 'Back to the portfolio' },
} as const

export type DatosPersonas = {
  readonly gente: readonly Persona[]
  readonly invitaciones: readonly Pendiente[]
  readonly empresas: readonly { readonly id: string; readonly nombre: string; readonly interna: boolean }[]
  /** El enlace recién creado. Se enseña UNA vez, justo después de invitar. */
  readonly enlace: string | null
}

export function pintarPersonas(
  d: DatosPersonas, idioma: Idioma, antifalsificacion: string,
  errores: readonly string[] = [],
  /**
   * Lo que salió bien. No lo tenía: dar de baja a alguien y reactivarlo contestaban sin
   * decir nada, y había que deducir de la lista que había funcionado. Deducir de una
   * ausencia es lo que este sistema no deja hacer en ninguna otra parte.
   */
  hecho: string | null = null,
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const af = escapar(antifalsificacion)

  const gente = d.gente.length === 0
    ? `<p class="nada">${escapar(t('persona.nadie'))}</p>`
    : d.gente.map((p) => `
<div class="pe${p.activa ? '' : ' baja'}">
  <div class="pe-c">
    <div class="pe-n">${escapar(p.nombre)}${p.interna
      ? ` <span class="et">${escapar(t('persona.interna'))}</span>` : ''}</div>
    <div class="pe-m">${escapar(p.correo)} · ${escapar(p.organizacion)} · ${
      escapar(t(`persona.metodo.${p.metodo}` as Clave))}</div>
    <div class="pe-u">${p.ultimoAcceso
      ? `${escapar(t('persona.ultimo'))} ${escapar(p.ultimoAcceso)}`
      : escapar(t('persona.nunca'))}${p.activa ? '' : ` · ${escapar(t('persona.inactiva'))}`}${
      p.bajaMotivo === null ? '' : `: ${escapar(p.bajaMotivo)}`}</div>
  </div>
  ${p.activa
    // La baja pide el motivo escrito. Antes era un botón solo, con el identificador
    // ya puesto en un campo escondido: un formulario que se manda vacío y deja a
    // alguien fuera. El barrido de formularios en blanco lo encontró haciéndolo.
    ? `<form method="post" action="/personas" class="anular">
    <input type="hidden" name="af" value="${af}">
    <input type="hidden" name="accion" value="baja">
    <input type="hidden" name="persona" value="${escapar(p.id)}">
    <label>${escapar(t('persona.motivo'))}
      <input type="text" name="motivo" maxlength="120"></label>
    <button type="submit" class="flojo">${escapar(t('persona.baja'))}</button>
  </form>`
    : `<form method="post" action="/personas">
    <input type="hidden" name="af" value="${af}">
    <input type="hidden" name="accion" value="alta">
    <input type="hidden" name="persona" value="${escapar(p.id)}">
    <button type="submit">${escapar(t('persona.alta'))}</button>
  </form>`}
</div>`).join('')

  const invitaciones = d.invitaciones.length === 0
    ? `<p class="nada">${escapar(t('persona.sin_pendientes'))}</p>`
    : d.invitaciones.map((i) => `
<div class="pe${i.caducada ? ' baja' : ''}">
  <div class="pe-c">
    <div class="pe-n">${escapar(i.nombre)}</div>
    <div class="pe-m">${escapar(i.correo)} · ${escapar(i.organizacion)}</div>
    <div class="pe-u">${escapar(t('persona.caduca'))} ${escapar(i.caduca)}${
      i.caducada ? ` · ${escapar(t('persona.caducada'))}` : ''}</div>
  </div>
  <form method="post" action="/personas" class="anular">
    <input type="hidden" name="af" value="${af}">
    <input type="hidden" name="accion" value="revocar">
    <input type="hidden" name="invitacion" value="${escapar(i.id)}">
    <label>${escapar(t('persona.motivo'))}
      <input type="text" name="motivo" maxlength="120"></label>
    <button type="submit" class="flojo">${escapar(t('persona.revocar'))}</button>
  </form>
</div>`).join('')

  return pagina({
    idioma,
    titulo: t('persona.titulo'),
    estilos: ESTILOS_PERSONAS,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('persona.titulo'))}</h1>
  <div class="sub">${escapar(t('persona.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal-caja"><ul>${
    errores.map((e) => `<li>${escapar(e)}</li>`).join('')
  }</ul></div>`}
  ${hecho === null ? '' : `<div class="bien-caja">${escapar(hecho)}</div>`}

  ${d.enlace === null ? '' : `
  <div class="enlace">
    <b>${escapar(t('persona.enlace'))}</b>
    <code>${escapar(d.enlace)}</code>
    <p>${escapar(t('persona.enlace_explica'))}</p>
  </div>`}

  <h2>${escapar(t('persona.invitar'))}</h2>
  <form method="post" action="/personas" class="inv">
    <input type="hidden" name="af" value="${af}">
    <input type="hidden" name="accion" value="invitar">
    <label class="ancho">${escapar(t('persona.nombre'))}
      <input type="text" name="nombre" maxlength="120"></label>
    <label class="ancho">${escapar(t('persona.correo'))}
      <input type="email" name="correo" maxlength="160"></label>
    <label>${escapar(t('persona.empresa'))}
      <select name="empresa">${d.empresas.map((e) =>
        `<option value="${escapar(e.id)}">${escapar(e.nombre)}</option>`).join('')}</select></label>
    <label>${escapar(t('persona.idioma'))}
      <select name="idioma"><option value="es">Español</option><option value="en">English</option></select></label>
    <button type="submit">${escapar(t('persona.invitar'))}</button>
  </form>

  <h2>${escapar(t('persona.pendientes'))}</h2>
  <div class="caja">${invitaciones}</div>

  <h2>${escapar(t('persona.titulo'))}</h2>
  <div class="caja">${gente}</div>
</main>`,
  })
}

export const ESTILOS_PERSONAS = `
.inv{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin:0 0 6px}
.inv label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.inv label.ancho{flex:1;min-width:200px}
.inv input,.inv select{display:block;margin-top:5px;width:100%;font:inherit;font-size:14px;
  padding:8px 10px;border:1px solid var(--ln2);border-radius:9px;background:var(--cd);
  color:var(--ik)}
.inv button{font:inherit;font-size:14px;font-weight:700;padding:9px 20px;border:0;
  border-radius:9px;background:var(--nv);color:#E9F0F6;cursor:pointer}
/* El enlace de alta: se enseña una vez, así que se enseña grande y se dice por qué. */
.enlace{margin-top:18px;background:var(--amb);border:1px solid var(--am);
  border-radius:14px;padding:17px 19px}
.enlace b{color:var(--am);font-size:14.5px}
.enlace code{display:block;margin:10px 0;padding:11px 13px;background:var(--cd);
  border:1px solid var(--ln2);border-radius:9px;font-family:"JetBrains Mono",monospace;
  font-size:12.5px;word-break:break-all;color:var(--ik)}
.enlace p{margin:0;font-size:13px;line-height:1.5;color:var(--ik2);max-width:64ch}
.pe{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;
  padding:13px 17px;border-top:1px solid var(--ln);flex-wrap:wrap}
.pe:first-child{border-top:0}
.pe.baja{opacity:.6}
.pe-c{min-width:0;flex:1}
.pe-n{font-size:15px;font-weight:650;letter-spacing:-.015em}
.pe-n .et{font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  letter-spacing:.12em;color:var(--grt);border:1px solid var(--grt);border-radius:99px;
  padding:1px 7px;vertical-align:2px}
.pe-m{font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--md);margin-top:3px}
.pe-u{font-size:12.5px;color:var(--ik2);margin-top:5px}
.pe form{margin:0}
.pe button{font:inherit;font-size:13px;font-weight:650;padding:7px 14px;border:0;
  border-radius:8px;background:var(--nv);color:#E9F0F6;cursor:pointer}
.pe button.flojo{background:transparent;color:var(--ik2);border:1px solid var(--ln2)}
.anular{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}
.anular label{font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  letter-spacing:.12em;text-transform:uppercase;color:var(--md)}
.anular input{display:block;margin-top:4px;font:inherit;font-size:13px;padding:6px 9px;
  border:1px solid var(--ln2);border-radius:8px;background:var(--cd);color:var(--ik)}
@media(max-width:520px){ .pe{flex-direction:column} }
`
