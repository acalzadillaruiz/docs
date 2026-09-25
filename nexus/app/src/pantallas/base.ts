/**
 * Lo que comparten todas las pantallas.
 *
 * Existe porque ya había empezado a no compartirse. Los colores estaban escritos
 * cuatro veces, uno por pantalla, y las cuatro copias habían derivado: la hoja de
 * valuación había perdido el ámbar, la de entrada no tenía fondo, y el verde de
 * acento era un tono distinto según dónde se mirara. Nadie lo hizo a propósito —
 * es lo que pasa siempre que lo mismo vive en cuatro sitios.
 *
 * La regla del proyecto es que hay UNA pantalla para las dos superficies. Cuatro
 * paletas que van separándose es la misma avería, solo que más lenta de ver. Una
 * prueba comprueba que ninguna pantalla vuelva a declarar los suyos.
 */

import type { Idioma } from '../i18n/t.ts'

export const escapar = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Los colores, y el modo oscuro sin que el usuario elija nada.
 *
 * Se declara tres veces a propósito y no es una repetición por descuido:
 * `prefers-color-scheme` respeta lo que tenga puesto el sistema, el
 * `:root:not([data-theme="light"])` deja que la página pueda forzar el claro, y el
 * `:root[data-theme="dark"]` deja forzar el oscuro. Sin las tres, o no se respeta
 * el sistema o no se puede desobedecer.
 */
export const ESTILOS_BASE = `
:root{
  --nv:#0B2137; --nv2:#123049; --nv3:#1B4364; --gr:#12B76A; --grt:#07734A;
  --bg:#F1F2F0; --cd:#FFFFFF; --cd2:#FAFAF8;
  --ik:#16202B; --ik2:#55616D; --md:#666F78; --ln:#E3E4E1; --ln2:#D0D2CE;
  --enl:#1B4364; --sobre-grt:#FFFFFF;
  --am:#946307; --amb:#FDF3DF; --rj:#A8323C;
  --sh:0 1px 2px rgba(22,32,43,.05);
  --shx:0 1px 2px rgba(22,32,43,.05),0 16px 40px -28px rgba(22,32,43,.45);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#071726; --cd:#0D2338; --cd2:#102A42; --ik:#EDF2F6; --ik2:#A6B6C4; --md:#7A8B99;
  --ln:#1A3750; --ln2:#254B69; --grt:#3FE0A5; --am:#EFC167; --amb:#33280C; --rj:#E8737E;
  --enl:#9CC4E4; --sobre-grt:#071726;
  --sh:0 1px 2px rgba(0,0,0,.45);
  --shx:0 1px 2px rgba(0,0,0,.45),0 16px 40px -28px rgba(0,0,0,.9);
}}
:root[data-theme="dark"]{
  --bg:#071726; --cd:#0D2338; --cd2:#102A42; --ik:#EDF2F6; --ik2:#A6B6C4; --md:#7A8B99;
  --ln:#1A3750; --ln2:#254B69; --grt:#3FE0A5; --am:#EFC167; --amb:#33280C; --rj:#E8737E;
  --enl:#9CC4E4; --sobre-grt:#071726;
  --sh:0 1px 2px rgba(0,0,0,.45);
  --shx:0 1px 2px rgba(0,0,0,.45),0 16px 40px -28px rgba(0,0,0,.9);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ik);font-family:Inter,system-ui,sans-serif;
  font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
.m{font-family:"JetBrains Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:760px;margin:0 auto;padding:0 18px}
/* ------------------------------------------------------------------ el foco
   Quien no usa ratón necesita ver DÓNDE está. Hasta ahora casi toda la aplicación
   se fiaba del anillo que pone el navegador por su cuenta: un trazo de 1 px casi
   negro, que sobre la cabecera azul marino no se ve en absoluto.

   Va aquí y no en cada pantalla por lo de siempre: diez sitios con diez anillos
   distintos son diez sitios donde se olvida uno.

   El color es la propia tinta, que ya cambia con el tema: oscura sobre claro, clara
   sobre oscuro. En la cabecera, que es azul marino en los dos temas, hace falta uno
   claro a la fuerza. */
:where(a,button,input,select,textarea,summary,[tabindex]):focus-visible{
  outline:2px solid var(--ik);outline-offset:2px;border-radius:3px}
/* Un campo de FECHA se recorre por dentro —día, mes, año—, y mientras el foco está
   en una de sus partes el campo en sí no cuenta como enfocado: la pseudoclase de
   foco no lo casa y el anillo no llega a pintarse. Quien tabula por un formulario con fechas no ve
   nada. El que sí se pinta es el de su etiqueta, que envuelve al campo. */
label:focus-within{outline:2px solid var(--ik);outline-offset:2px;border-radius:10px}
/* ----------------------------------------------------------------- los errores
   La caja donde una pantalla dice lo que salió mal. Estaba copiada en ocho
   pantallas y YA se había desviado en cuatro versiones distintas: una con el color
   en la lista y otra en la caja, con saltos de línea diferentes. Ocho copias de una
   regla son ocho sitios donde cambiarla y siete donde olvidarse.

   Va aquí por lo mismo que el anillo del foco: una pantalla nueva que use la clase
   la tiene bien sin acordarse de copiar nada, y ninguna se queda enseñando el error
   como texto suelto por haberse olvidado de definirla. */
.mal-caja{margin-top:18px;background:var(--cd);border:1px solid var(--rj);
  border-left-width:3px;border-radius:11px;padding:13px 17px}
.mal-caja ul{margin:0;padding-left:18px}
.mal-caja li,.mal-caja p{color:var(--rj);font-weight:600;font-size:14px;margin:0}
.mal-caja li + li{margin-top:5px}
.hd :where(a,button,input,select):focus-visible,.hd label:focus-within{
  outline-color:#E9F0F6}
.hd{background:var(--nv);color:#E9F0F6;padding-block:22px 34px}
.volver{display:inline-block;color:#A2B7C9;text-decoration:none;font-size:13.5px;margin-bottom:16px}
.volver:hover{color:#E9F0F6}
.cod{font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;letter-spacing:.16em;
  color:#7691A8}
.hd h1{margin:9px 0 0;font-size:clamp(22px,5.2vw,31px);font-weight:800;letter-spacing:-.035em;
  line-height:1.15}
.sub{margin-top:9px;color:#A2B7C9;font-size:14px}
main{margin-top:-20px;padding-bottom:70px}
h2{margin:26px 0 10px;font-family:"JetBrains Mono",monospace;font-size:10.5px;font-weight:700;
  letter-spacing:.16em;text-transform:uppercase;color:var(--md)}
.caja{background:var(--cd);border:1px solid var(--ln);border-radius:15px;box-shadow:var(--sh);
  overflow:hidden}
.nada{margin:0;padding:22px 17px;color:var(--ik2);text-align:center}
`

/** Las tipografías. En su propia constante para no repetir las tres etiquetas. */
export const FUENTES = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap">`

export type Pagina = {
  readonly idioma: Idioma
  /** Lo que sale en la pestaña. Dice de qué va esta página, no solo el producto. */
  readonly titulo: string
  /** Los estilos propios de esta pantalla. Los comunes ya van puestos. */
  readonly estilos: string
  readonly cabecera: string
  readonly cuerpo: string
}

/**
 * El documento entero. `lang` va siempre: sin él, el lector de pantalla lee en
 * inglés un texto en español, y el traductor del navegador se ofrece a traducir
 * una página que ya está en el idioma de quien la mira.
 */
export function pagina(p: Pagina): string {
  return `<!doctype html>
<html lang="${p.idioma}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(p.titulo)} · GPS Nexus</title>
${FUENTES}
<style>${ESTILOS_BASE}${p.estilos}</style>
${p.cabecera}
${p.cuerpo}
</html>`
}
