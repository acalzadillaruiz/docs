/**
 * El perfil. Dos decisiones y ninguna más.
 *
 * Las casillas vienen marcadas, porque por omisión se recibe todo. Un aviso que hay
 * que activar es un aviso que nadie activa — y el problema no es que se pierda ese
 * aviso, es que quien no recibe ninguno deja de mirar la aplicación.
 *
 * El correo y la empresa se enseñan y no se editan. Cambiar el correo de acceso es
 * cambiar la identidad con la que se entra, y eso no se hace en la misma pantalla
 * donde se marcan casillas.
 */

import type { Perfil } from '../dominio/perfil.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera', hecho: 'Guardado.' },
  en: { volver: 'Back to the portfolio', hecho: 'Saved.' },
} as const

export function pintarPerfil(
  p: Perfil, idioma: Idioma, antifalsificacion: string, guardado = false,
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)

  const casillas = p.preferencias.map((pr) => `
<label class="cas">
  <input type="checkbox" name="aviso" value="${escapar(pr.tipo)}"${pr.quiere ? ' checked' : ''}>
  <span>${escapar(pr.nombre)}</span>
</label>`).join('')

  return pagina({
    idioma,
    titulo: t('perfil.titulo'),
    estilos: ESTILOS_PERFIL,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <div class="cod">${escapar(p.organizacion)}</div>
  <h1>${escapar(p.nombre)}</h1>
  <div class="sub">${escapar(p.correo)}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${guardado ? `<p class="hecho">${escapar(x.hecho)}</p>` : ''}
  <form method="post" action="/perfil">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">

    <h2>${escapar(t('perfil.idioma'))}</h2>
    <div class="caja pad">
      <label class="cas">
        <input type="radio" name="idioma" value="es"${p.idioma === 'es' ? ' checked' : ''}>
        <span>${escapar(t('perfil.espanol'))}</span>
      </label>
      <label class="cas">
        <input type="radio" name="idioma" value="en"${p.idioma === 'en' ? ' checked' : ''}>
        <span>${escapar(t('perfil.ingles'))}</span>
      </label>
    </div>

    <h2>${escapar(t('perfil.avisos'))}</h2>
    <p class="expl">${escapar(t('perfil.avisos_explica'))}</p>
    <div class="caja pad">${casillas}</div>

    <p class="expl">${escapar(t('perfil.solo_tuyo'))}</p>
    <button type="submit">${escapar(t('perfil.guardar'))}</button>
  </form>
</main>`,
  })
}

export const ESTILOS_PERFIL = `
.pad{padding:6px 4px}
.cas{display:flex;align-items:flex-start;gap:11px;padding:11px 14px;cursor:pointer;
  border-radius:9px}
.cas:hover{background:var(--cd2)}
.cas input{margin:3px 0 0;width:17px;height:17px;accent-color:var(--grt);flex:none}
.cas span{font-size:14.5px;line-height:1.35}
.expl{margin:9px 0 11px;font-size:13.5px;color:var(--ik2);line-height:1.45;max-width:62ch}
.hecho{margin:18px 0 0;background:var(--cd);border:1px solid var(--grt);border-radius:11px;
  padding:11px 15px;color:var(--grt);font-weight:650;font-size:14px}
form button{margin-top:18px;font:inherit;font-size:15px;font-weight:700;padding:11px 22px;
  border:0;border-radius:11px;background:var(--nv);color:#E9F0F6;cursor:pointer}
form button:hover{background:var(--nv3)}
`
