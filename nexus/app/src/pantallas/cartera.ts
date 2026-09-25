/**
 * La pantalla de la cartera.
 *
 * Lo primero que se ve al entrar. Si esta pantalla no contesta «¿cómo va lo mío?»
 * de un vistazo, el cliente vuelve a llamar por teléfono y la aplicación no sirve
 * para lo que se construyó.
 *
 * Por eso lo que espera a alguien va arriba y en color, y el avance va detrás, en
 * pequeño. Es al revés de como se suele hacer, y es a propósito: el porcentaje es
 * lo bonito de enseñar y lo que menos ayuda.
 */

import type { ResumenContrato } from '../dominio/cartera.ts'
import type { Pendiente } from '../dominio/bandeja.ts'
import { pintarBandeja, ESTILOS_BANDEJA } from './bandeja.ts'
import { pintarPorRevisar, ESTILOS_AVANCE } from './evidencia.ts'
import type { PorRevisar } from '../dominio/evidencia.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: {
    titulo: 'Tus contratos',
    tituloInterno: 'Cartera',
    esperaCliente: (n: number, q: string, d: number) =>
      n === 1 ? `${q} esperando tu aprobación desde hace ${d} ${d === 1 ? 'día' : 'días'}`
              : `${n} ${q.toLowerCase()}s esperando tu aprobación, la más antigua de hace ${d} días`,
    esperaGps: (n: number, _q: string, d: number) =>
      n === 1 ? `Aprobada hace ${d} ${d === 1 ? 'día' : 'días'}, pendiente de cobro`
              : `${n} aprobadas pendientes de cobro, la más antigua de hace ${d} días`,
    tarde: (d: number) => `${d} ${d === 1 ? 'día' : 'días'} sobre lo previsto`,
    aTiempo: (d: number) => `Quedan ${d} ${d === 1 ? 'día' : 'días'}`,
    avance: 'Avance',
    nada: 'Todavía no hay ningún contrato aquí.',
    salir: 'Salir',
  },
  en: {
    titulo: 'Your contracts',
    tituloInterno: 'Portfolio',
    esperaCliente: (n: number, q: string, d: number) =>
      n === 1 ? `${q} awaiting your approval for ${d} ${d === 1 ? 'day' : 'days'}`
              : `${n} ${q.toLowerCase()}s awaiting your approval, the oldest ${d} days old`,
    esperaGps: (n: number, _q: string, d: number) =>
      n === 1 ? `Approved ${d} ${d === 1 ? 'day' : 'days'} ago, awaiting payment`
              : `${n} approved and awaiting payment, the oldest ${d} days old`,
    tarde: (d: number) => `${d} ${d === 1 ? 'day' : 'days'} past the planned date`,
    aTiempo: (d: number) => `${d} ${d === 1 ? 'day' : 'days'} left`,
    avance: 'Progress',
    nada: 'There are no contracts here yet.',
    salir: 'Sign out',
  },
} as const

export function pintarCartera(
  contratos: readonly ResumenContrato[],
  idioma: Idioma,
  esCliente: boolean,
  pendientes: readonly Pendiente[] = [],
  /**
   * Los documentos esperando revisión. Van aquí y no en una pantalla aparte por el
   * mismo motivo que la bandeja: mientras un papel está sin revisar, el avance que
   * sostiene no cuenta y el contrato parece más atrasado de lo que está. Una cola
   * que hay que acordarse de mirar es una cola que no se mira.
   */
  porRevisar: readonly PorRevisar[] = [],
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const titulo = esCliente ? x.titulo : x.tituloInterno

  const tarjetas = contratos.length === 0
    ? `<p class="nada">${escapar(x.nada)}</p>`
    : contratos.map((c) => {
        const aviso = c.espera === null ? '' : (() => {
          const texto = c.espera.deQuien === 'cliente'
            ? x.esperaCliente(c.espera.cuantas, c.espera.que, c.espera.desdeDias)
            : x.esperaGps(c.espera.cuantas, c.espera.que, c.espera.desdeDias)
          // Lo que espera al cliente se marca distinto de lo que espera a GPS:
          // uno es «tienes que hacer algo» y el otro es «estamos en ello».
          return `<div class="esp ${c.espera.deQuien}">${escapar(texto)}</div>`
        })()

        const plazo = c.diasTarde === null ? '' : c.diasTarde > 0
          ? `<span class="tarde">${escapar(x.tarde(c.diasTarde))}</span>`
          : `<span class="plazo">${escapar(x.aTiempo(-c.diasTarde))}</span>`

        return `<a class="ct${c.espera?.deQuien === 'cliente' ? ' pide' : ''}" href="/contratos/${escapar(c.id)}">
  <div class="cab">
    <div>
      <div class="cod">${escapar(c.codigo)}</div>
      ${esCliente ? '' : `<div class="cli">${escapar(c.cliente)}</div>`}
    </div>
    <div class="est">${escapar(c.estado)}</div>
  </div>
  <div class="tipo">${escapar(c.tipo)}</div>
  ${aviso}
  <div class="pie">
    <div class="av">
      <div class="barra"><i style="width:${Math.min(c.avance, 100)}%"></i></div>
      <span>${escapar(x.avance)} ${escapar(c.avanceTexto)}</span>
    </div>
    <div class="der">${plazo}<span class="mto">${escapar(c.monto)}</span></div>
  </div>
</a>`
      }).join('\n')

  return pagina({
    idioma,
    titulo,
    estilos: `
.hd .wrap{display:flex;align-items:baseline;justify-content:space-between;gap:14px}
.hd h1{margin:0;font-size:clamp(23px,5.4vw,32px);font-weight:800;letter-spacing:-.035em}
.hd form{margin:0}
.hd button{background:none;border:0;color:#A2B7C9;font:inherit;font-size:14px;
  cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:3px}
main{margin-top:-26px;padding-bottom:70px}
.ct{display:block;margin-bottom:12px;background:var(--cd);border:1px solid var(--ln);
  border-radius:15px;padding:16px 18px;box-shadow:var(--sh);text-decoration:none;color:inherit}
.ct:hover{border-color:var(--ln2)}
.ct.pide{border-left:3px solid var(--am)}
.cab{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.cli{font-size:13px;color:var(--ik2);margin-top:2px}
.est{font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;letter-spacing:.13em;
  text-transform:uppercase;color:var(--md);padding:4px 9px;border:1px solid var(--ln);
  border-radius:99px;white-space:nowrap}
.tipo{font-size:13.5px;color:var(--ik2);margin-top:7px}
.esp{margin-top:11px;padding:9px 11px;border-radius:9px;font-size:13.5px;line-height:1.45}
.esp.cliente{background:var(--amb);color:var(--am);font-weight:600}
.esp.gps{background:var(--cd2);color:var(--ik2)}
.pie{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-top:13px}
.av{flex:1;min-width:0}
.barra{height:4px;background:var(--ln);border-radius:99px;overflow:hidden;margin-bottom:6px}
.barra i{display:block;height:100%;background:var(--grt);border-radius:99px}
.av span{font-family:"JetBrains Mono",monospace;font-size:10.5px;letter-spacing:.06em;color:var(--md)}
.der{text-align:right;display:flex;flex-direction:column;gap:3px}
.mto{font-family:"JetBrains Mono",monospace;font-size:14.5px;font-weight:700;letter-spacing:-.02em}
.tarde{font-size:11.5px;color:var(--rj);font-weight:600}
.plazo{font-size:11.5px;color:var(--md)}
.nada{margin-top:30px;text-align:center;color:var(--ik2)}
${ESTILOS_BANDEJA}
${ESTILOS_AVANCE}
@media(max-width:520px){
  .ct{padding:15px 15px}
  .pie{flex-direction:column;align-items:stretch;gap:10px}
  .der{flex-direction:row;justify-content:space-between;align-items:baseline;text-align:left}
}
/* El enlace a las medidas va en la cabecera y no en un menú: un cuadro de mando al
   que hay que navegar se mira el día que se instala y nunca más. */
.medidas{display:inline-block;margin-right:14px;color:#A2B7C9;text-decoration:none;
  font-size:13.5px;font-weight:600}
.medidas:hover{color:#E9F0F6}
`,
    cabecera: `<header class="hd"><div class="wrap">
  <h1>${escapar(titulo)}</h1>
  ${esCliente ? '' : `<a class="medidas" href="/medidas">${escapar(t('medida.titulo'))} →</a>`}
  ${esCliente ? '' : `<a class="medidas" href="/contratos/nuevo">${escapar(t('alta.nuevo'))}</a>`}
  ${esCliente ? '' : `<a class="medidas" href="/importar">${escapar(t('importar.titulo'))}</a>`}
  ${esCliente ? '' : `<a class="medidas" href="/proveedores">${escapar(t('proveedor.titulo'))}</a>`}
  ${esCliente ? '' : `<a class="medidas" href="/activos">${escapar(t('activo.titulo'))}</a>`}
  ${esCliente ? '' : `<a class="medidas" href="/reexpresion">${escapar(t('reex.nombre'))}</a>`}
  ${esCliente ? '' : `<a class="medidas" href="/banco">${escapar(t('banco.titulo'))}</a>`}
  ${esCliente ? '' : `<a class="medidas" href="/periodos">${escapar(t('periodo.titulo'))}</a>`}
  <a class="medidas" href="/perfil">${escapar(t('perfil.titulo'))}</a>
  <form method="post" action="/salir"><button type="submit">${escapar(x.salir)}</button></form>
</div></header>`,
    cuerpo: `<main class="wrap">
${/*
   * La segunda cerradura: la ruta ya no le pasa pendientes a un cliente, pero si
   * algún día otro sitio llamara a esta función pasándoselos, la bandeja saldría.
   * Aquí no sale, pase lo que pase. Una prueba lo comprueba llamándola a propósito
   * con pendientes y esCliente a la vez.
   */''}${pintarBandeja(esCliente ? [] : pendientes, idioma)}
${pintarPorRevisar(esCliente ? [] : porRevisar, idioma)}
${tarjetas}
</main>`,
  })
}
