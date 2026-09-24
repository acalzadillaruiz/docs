/**
 * Las pantallas de entrada.
 *
 * Es lo primero que ve cualquiera, incluido el ingeniero de la operadora que entra
 * por primera vez desde el teléfono, de pie, con una mano. Por eso son cuatro
 * pantallas de un solo campo cada una, y no un formulario con todo junto.
 *
 * Lo que se hace aquí y no se suele hacer:
 *
 *   - El campo del segundo factor es numérico, con `inputmode`, para que el teclado
 *     del teléfono salga ya con números. Es un detalle de un atributo que se nota
 *     seis veces al día.
 *   - El código se puede pegar entero: el navegador lo rellena solo desde el mensaje
 *     de texto si el campo declara `autocomplete="one-time-code"`.
 *   - Cuando hay que esperar, se dice **cuántos segundos**. «Demasiados intentos»
 *     sin número es lo que hace que la gente recargue veinte veces.
 */

import { traductor, type Idioma } from '../i18n/t.ts'

export type PasoEntrada =
  | { readonly paso: 'ingreso'; readonly correo?: string; readonly error?: 'rechazado' }
  | { readonly paso: 'segundo_factor'; readonly desafio: string; readonly error?: 'rechazado' }
  | { readonly paso: 'espera'; readonly segundos: number }
  | { readonly paso: 'recuperacion'; readonly error?: 'rechazado' }
  | { readonly paso: 'empresa'; readonly metodo: 'microsoft' | 'google' }
  | { readonly paso: 'invitacion'; readonly nombre: string; readonly ficha: string }

const escapar = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const TEXTOS = {
  es: {
    ingresoTitulo: 'Entra a tu cuenta',
    ingresoPie: 'Escribe el correo con el que te invitaron.',
    correo: 'Correo',
    clave: 'Clave',
    continuar: 'Continuar',
    factorTitulo: 'Tu código de seis dígitos',
    factorPie: 'Ábrelo en tu aplicación de códigos. Cambia cada treinta segundos.',
    codigo: 'Código',
    entrar: 'Entrar',
    perdiTelefono: 'Perdí el teléfono',
    recuperaTitulo: 'Usa un código de recuperación',
    recuperaPie: 'Uno de los diez que guardaste al crear la cuenta. Cada uno sirve una sola vez.',
    codigoRec: 'Código de recuperación',
    esperaTitulo: 'Demasiados intentos',
    esperaPie: (s: number) => `Inténtalo de nuevo dentro de ${s} segundo${s === 1 ? '' : 's'}.`,
    empresaTitulo: 'Entra con la cuenta de tu empresa',
    empresaPie: 'Tu empresa gestiona tu acceso. No necesitas una clave aquí.',
    invitacionTitulo: 'Crea tu clave',
    invitacionPie: 'Solo tú la vas a conocer. GPS nunca la ve.',
    claveNueva: 'Clave nueva',
    minimo: 'Doce caracteres como mínimo.',
    crear: 'Crear mi clave',
    rechazado: 'No hemos podido entrar con esos datos.',
    rechazadoCodigo: 'Ese código no es válido. Vuelve a empezar.',
  },
  en: {
    ingresoTitulo: 'Sign in to your account',
    ingresoPie: 'Use the email address you were invited with.',
    correo: 'Email',
    clave: 'Password',
    continuar: 'Continue',
    factorTitulo: 'Your six-digit code',
    factorPie: 'Open your authenticator app. It changes every thirty seconds.',
    codigo: 'Code',
    entrar: 'Sign in',
    perdiTelefono: 'I lost my phone',
    recuperaTitulo: 'Use a recovery code',
    recuperaPie: 'One of the ten you saved when the account was created. Each works once.',
    codigoRec: 'Recovery code',
    esperaTitulo: 'Too many attempts',
    esperaPie: (s: number) => `Try again in ${s} second${s === 1 ? '' : 's'}.`,
    empresaTitulo: 'Sign in with your company account',
    empresaPie: 'Your company manages your access. You do not need a password here.',
    invitacionTitulo: 'Create your password',
    invitacionPie: 'Only you will know it. GPS never sees it.',
    claveNueva: 'New password',
    minimo: 'Twelve characters minimum.',
    crear: 'Create my password',
    rechazado: 'We could not sign you in with those details.',
    rechazadoCodigo: 'That code is not valid. Start again.',
  },
} as const

function cuerpo(p: PasoEntrada, idioma: Idioma): { titulo: string; html: string } {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const err = (m: string) => `<p class="err" role="alert">${escapar(m)}</p>`

  switch (p.paso) {
    case 'ingreso':
      return {
        titulo: x.ingresoTitulo,
        html: `<p class="pie">${escapar(x.ingresoPie)}</p>
${p.error ? err(x.rechazado) : ''}
<form method="post" action="/entrar">
  <label for="correo">${escapar(x.correo)}</label>
  <input id="correo" name="correo" type="email" required autocomplete="username"
         inputmode="email" autocapitalize="none" spellcheck="false"
         value="${escapar(p.correo ?? '')}">
  <label for="clave">${escapar(x.clave)}</label>
  <input id="clave" name="clave" type="password" required autocomplete="current-password">
  <button type="submit">${escapar(x.continuar)}</button>
</form>`,
      }

    case 'segundo_factor':
      return {
        titulo: x.factorTitulo,
        html: `<p class="pie">${escapar(x.factorPie)}</p>
${p.error ? err(x.rechazadoCodigo) : ''}
<form method="post" action="/entrar/codigo">
  <input type="hidden" name="desafio" value="${escapar(p.desafio)}">
  <label for="codigo">${escapar(x.codigo)}</label>
  <input id="codigo" name="codigo" class="cod" required
         inputmode="numeric" pattern="[0-9]{6}" maxlength="6"
         autocomplete="one-time-code" autofocus>
  <button type="submit">${escapar(x.entrar)}</button>
</form>
<a class="alt" href="/entrar/recuperacion">${escapar(x.perdiTelefono)}</a>`,
      }

    case 'recuperacion':
      return {
        titulo: x.recuperaTitulo,
        html: `<p class="pie">${escapar(x.recuperaPie)}</p>
${p.error ? err(x.rechazadoCodigo) : ''}
<form method="post" action="/entrar/recuperacion">
  <label for="rec">${escapar(x.codigoRec)}</label>
  <input id="rec" name="codigo" class="cod" required autocapitalize="characters"
         spellcheck="false" autocomplete="off" autofocus>
  <button type="submit">${escapar(x.entrar)}</button>
</form>`,
      }

    case 'espera':
      return {
        titulo: x.esperaTitulo,
        html: `<p class="pie">${escapar(x.esperaPie(p.segundos))}</p>
<div class="cuenta" data-segundos="${p.segundos}" aria-live="polite">${p.segundos}</div>`,
      }

    case 'empresa': {
      const nombre = p.metodo === 'microsoft' ? 'Microsoft' : 'Google'
      return {
        titulo: x.empresaTitulo,
        html: `<p class="pie">${escapar(x.empresaPie)}</p>
<form method="post" action="/entrar/empresa">
  <input type="hidden" name="metodo" value="${escapar(p.metodo)}">
  <button type="submit" class="emp">${escapar(t('acceso.entrar_empresa'))} · ${nombre}</button>
</form>`,
      }
    }

    case 'invitacion':
      return {
        titulo: x.invitacionTitulo,
        html: `<p class="pie">${escapar(x.invitacionPie)}</p>
<form method="post" action="/invitacion">
  <input type="hidden" name="ficha" value="${escapar(p.ficha)}">
  <label for="nueva">${escapar(x.claveNueva)}</label>
  <input id="nueva" name="clave" type="password" required minlength="12"
         autocomplete="new-password" autofocus>
  <p class="min">${escapar(x.minimo)}</p>
  <button type="submit">${escapar(x.crear)}</button>
</form>`,
      }
  }
}

export function pintarEntrada(p: PasoEntrada, idioma: Idioma): string {
  const { titulo, html } = cuerpo(p, idioma)
  const saludo = p.paso === 'invitacion' ? escapar(p.nombre) : 'GPS Nexus'

  return `<!doctype html>
<html lang="${idioma}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(titulo)} · GPS Nexus</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap">
<style>
:root{
  --nv:#0B2137; --nv2:#123049; --nv3:#1B4364; --gr:#12B76A;
  --cd:#FFFFFF; --ik:#16202B; --ik2:#55616D; --md:#8A939C;
  --ln:#E3E4E1; --ln2:#D0D2CE; --rj:#A8323C;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --cd:#0D2338; --ik:#EDF2F6; --ik2:#A6B6C4; --md:#7A8B99;
  --ln:#1A3750; --ln2:#254B69; --rj:#E8737E;
}}
:root[data-theme="dark"]{
  --cd:#0D2338; --ik:#EDF2F6; --ik2:#A6B6C4; --md:#7A8B99;
  --ln:#1A3750; --ln2:#254B69; --rj:#E8737E;
}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;background:var(--nv);color:var(--ik);
  font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.5;
  display:grid;place-items:center;padding:24px 18px;-webkit-font-smoothing:antialiased}
.caja{width:100%;max-width:400px;background:var(--cd);border-radius:18px;padding:30px 26px 26px;
  box-shadow:0 24px 60px -30px rgba(0,0,0,.7)}
.marca{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  letter-spacing:.2em;text-transform:uppercase;color:var(--md)}
h1{margin:12px 0 0;font-size:24px;font-weight:800;letter-spacing:-.03em;line-height:1.2}
.pie{margin:9px 0 0;font-size:14px;color:var(--ik2);line-height:1.5}
form{margin-top:22px}
label{display:block;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  letter-spacing:.14em;text-transform:uppercase;color:var(--md);margin-bottom:6px}
input{width:100%;font:inherit;font-size:16px;padding:13px 14px;border:1px solid var(--ln2);
  border-radius:11px;background:transparent;color:var(--ik);margin-bottom:16px}
input:focus{outline:2px solid var(--nv3);outline-offset:-1px;border-color:transparent}
input.cod{font-family:"JetBrains Mono",monospace;font-size:26px;letter-spacing:.34em;
  text-align:center;padding-inline:8px}
button{width:100%;font:inherit;font-size:16px;font-weight:700;padding:14px;border:0;
  border-radius:11px;background:var(--nv);color:#fff;cursor:pointer;letter-spacing:-.01em}
button:hover{background:var(--nv2)}
button.emp{background:var(--nv3)}
.alt{display:block;margin-top:18px;text-align:center;font-size:14px;color:var(--ik2)}
.min{margin:-8px 0 16px;font-size:12.5px;color:var(--md)}
.err{margin:16px 0 0;padding:11px 13px;border-radius:10px;font-size:14px;
  color:var(--rj);border:1px solid var(--rj)}
.cuenta{margin-top:22px;text-align:center;font-family:"JetBrains Mono",monospace;
  font-size:46px;font-weight:700;letter-spacing:-.04em;color:var(--nv3)}
</style>
<main class="caja">
  <div class="marca">${saludo}</div>
  <h1>${escapar(titulo)}</h1>
  ${html}
</main>
${
  p.paso === 'espera'
    ? `<script>
(() => {
  const e = document.querySelector('.cuenta');
  let n = Number(e.dataset.segundos);
  const i = setInterval(() => {
    n -= 1;
    e.textContent = String(Math.max(n, 0));
    if (n <= 0) { clearInterval(i); location.href = '/entrar'; }
  }, 1000);
})();
</script>`
    : ''
}
</html>`
}
