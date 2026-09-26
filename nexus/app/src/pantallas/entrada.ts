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
import { pagina, escapar } from './base.ts'

export type PasoEntrada =
  | { readonly paso: 'ingreso'; readonly correo?: string; readonly error?: 'rechazado' }
  | { readonly paso: 'segundo_factor'; readonly desafio: string; readonly error?: 'rechazado' }
  | { readonly paso: 'espera'; readonly segundos: number }
  | {
      readonly paso: 'recuperacion'
      /**
       * A qué entrada pertenece. Un código de recuperación NO identifica a nadie: va
       * contra el desafío que dejó la clave ya comprobada, igual que el código del
       * teléfono. Sin esto, el formulario no tenía a quién referirse y el POST no
       * podía existir — que es exactamente lo que pasaba.
       */
      readonly desafio: string
      readonly error?: 'rechazado'
    }
  | {
      /** Entró con un código. Se le dice cuántos le quedan, aquí y no otro día. */
      readonly paso: 'gastado'
      readonly quedan: number
    }
  | {
      readonly paso: 'empresa'
      readonly metodo: 'microsoft' | 'google'
      /** Se arrastra desde el paso anterior: sin él, la vuelta no sabe de quién es. */
      readonly correo?: string
      readonly error?: 'rechazado'
    }
  | {
      readonly paso: 'invitacion'
      readonly nombre: string
      readonly ficha: string
      /** El motivo tal cual, ya traducido: la clave corta y la ficha muerta no son lo mismo. */
      readonly error?: string
    }
  | {
      /**
       * La cuenta ya existe. Esta pantalla enseña el secreto del segundo factor y los
       * diez códigos de recuperación, y es la ÚNICA vez que se ven: después de esta
       * respuesta no quedan en ninguna parte legible, ni para GPS.
       */
      readonly paso: 'creada'
      readonly correo: string
      readonly secreto: string
      readonly codigos: readonly string[]
    }

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
    gastadoTitulo: 'Entraste con un código de recuperación',
    gastadoPie: (n: number) => n === 0
      ? 'Era el último que te quedaba. Sin códigos y sin teléfono no hay forma de volver a entrar: pide unos nuevos antes de cambiar de teléfono.'
      : `Ese código ya no vale para nada más. Te quedan ${n}.`,
    gastadoPocos: 'Quedarse sin códigos y sin teléfono a la vez es como se pierde una cuenta.',
    gastadoIr: 'Entrar',
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
    gastadoTitulo: 'You signed in with a recovery code',
    gastadoPie: (n: number) => n === 0
      ? 'That was your last one. With no codes and no phone there is no way back in: ask for new ones before you change phones.'
      : `That code is now good for nothing else. You have ${n} left.`,
    gastadoPocos: 'Running out of codes and losing the phone at the same time is how an account is lost.',
    gastadoIr: 'Continue',
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
<a class="alt" href="/entrar/recuperacion?d=${encodeURIComponent(p.desafio)}">${
  escapar(x.perdiTelefono)}</a>`,
      }

    case 'recuperacion':
      return {
        titulo: x.recuperaTitulo,
        html: `<p class="pie">${escapar(x.recuperaPie)}</p>
${p.error ? err(x.rechazadoCodigo) : ''}
<form method="post" action="/entrar/recuperacion">
  <input type="hidden" name="desafio" value="${escapar(p.desafio)}">
  <label for="rec">${escapar(x.codigoRec)}</label>
  <input id="rec" name="codigo" class="cod" required autocapitalize="characters"
         spellcheck="false" autocomplete="off" autofocus>
  <button type="submit">${escapar(x.entrar)}</button>
</form>`,
      }

    case 'gastado':
      return {
        titulo: x.gastadoTitulo,
        html: `<p class="pie">${escapar(x.gastadoPie(p.quedan))}</p>
${p.quedan === 0 || p.quedan > 3 ? '' : `<p class="err">${escapar(x.gastadoPocos)}</p>`}
<a class="btn" href="/">${escapar(x.gastadoIr)}</a>`,
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
${p.error !== 'rechazado' ? '' : `<p class="mal">${escapar(x.rechazado)}</p>`}
<form method="post" action="/entrar/empresa">
  <input type="hidden" name="metodo" value="${escapar(p.metodo)}">
  <input type="hidden" name="correo" value="${escapar(p.correo ?? '')}">
  <button type="submit" class="emp">${escapar(t('acceso.entrar_empresa'))} · ${nombre}</button>
</form>`,
      }
    }

    case 'invitacion':
      return {
        titulo: x.invitacionTitulo,
        html: `<p class="pie">${escapar(x.invitacionPie)}</p>
${p.error ? err(p.error) : ''}
<form method="post" action="/invitacion">
  <input type="hidden" name="ficha" value="${escapar(p.ficha)}">
  <label for="nueva">${escapar(x.claveNueva)}</label>
  <input id="nueva" name="clave" type="password" required minlength="12"
         autocomplete="new-password" autofocus>
  <p class="min">${escapar(x.minimo)}</p>
  <button type="submit">${escapar(x.crear)}</button>
</form>`,
      }

    case 'creada':
      return {
        titulo: t('alta_cuenta.titulo'),
        html: `<p class="pie">${escapar(t('alta_cuenta.explica'))}</p>
<div class="guardar">
  <h2>${escapar(t('alta_cuenta.secreto'))}</h2>
  <code class="sec">${escapar(p.secreto)}</code>
  <p class="nota">${escapar(t('alta_cuenta.secreto_explica'))}</p>
</div>
<div class="guardar">
  <h2>${escapar(t('alta_cuenta.codigos'))}</h2>
  <ol class="rec">${p.codigos.map((c) => `<li>${escapar(c)}</li>`).join('')}</ol>
  <p class="nota">${escapar(t('alta_cuenta.codigos_explica'))}</p>
</div>
<a class="btn" href="/entrar">${escapar(t('alta_cuenta.entrar'))}</a>`,
      }
  }
}

export function pintarEntrada(p: PasoEntrada, idioma: Idioma): string {
  const { titulo, html } = cuerpo(p, idioma)
  const saludo = p.paso === 'invitacion'
    ? escapar(p.nombre)
    : p.paso === 'creada' ? escapar(p.correo) : 'GPS Nexus'

  return pagina({
    idioma,
    titulo,
    estilos: `
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
/* Lo que se enseña una sola vez se enseña grande y se puede copiar de un tirón. */
.guardar{margin-top:22px;padding:15px 16px;border:1px solid var(--am);
  border-radius:13px;background:var(--amb)}
.guardar h2{margin:0;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  letter-spacing:.14em;text-transform:uppercase;color:var(--am)}
.guardar .nota{margin:10px 0 0;font-size:12.5px;line-height:1.5;color:var(--ik2)}
.sec{display:block;margin-top:9px;padding:11px 12px;border-radius:9px;background:var(--cd);
  border:1px solid var(--ln2);font-family:"JetBrains Mono",monospace;font-size:14px;
  letter-spacing:.09em;word-break:break-all;color:var(--ik)}
.rec{margin:9px 0 0;padding:0;list-style:none;display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.rec li{padding:7px 9px;border-radius:8px;background:var(--cd);border:1px solid var(--ln2);
  font-family:"JetBrains Mono",monospace;font-size:13px;letter-spacing:.06em;
  text-align:center;color:var(--ik)}
.btn{display:block;margin-top:22px;text-align:center;text-decoration:none;font-size:16px;
  font-weight:700;padding:14px;border-radius:11px;background:var(--nv);color:#fff}
`,
    cabecera: ``,
    cuerpo: `<main class="caja">
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
}`,
  })
}
