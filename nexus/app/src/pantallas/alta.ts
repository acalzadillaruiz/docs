/**
 * Dar de alta un contrato.
 *
 * Es el único formulario largo del sistema, y está hecho para rellenarse con un PDF
 * firmado abierto en otra ventana. De ahí tres cosas:
 *
 *   - Los errores salen TODOS juntos y arriba, no uno a uno. Seis viajes de ida y
 *     vuelta es cuando se abandona y se vuelve a Excel.
 *   - Lo escrito se devuelve escrito. Un formulario que se vacía al fallar es la
 *     forma más rápida de que nadie lo vuelva a usar.
 *   - El monto no se teclea: se dice de dónde sale. Un campo que la máquina calcula
 *     mejor que la persona no se le pide a la persona.
 *
 * Y no lleva NADA de JavaScript. No es purismo: la política de seguridad de esta
 * aplicación es `default-src 'none'`, así que un script en la página no se
 * ejecutaría — y relajar esa política para poder clonar una fila sería pagar con la
 * defensa más fuerte que hay contra el código inyectado a cambio de una comodidad.
 *
 * Para más renglones hay un botón que vuelve a pintar el formulario con cinco filas
 * más, conservando lo escrito. Es un viaje al servidor y es honesto: funciona en
 * cualquier navegador, con la red mala del campo, y sin depender de nada.
 */

import type { ClienteBreve, ContratoNuevo, TipoContrato } from '../dominio/alta.ts'
import { TIPOS, nombreTipo } from '../dominio/alta.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: {
    volver: 'Volver a la cartera', codigo: 'Código', titulo: 'Título (español)',
    tituloEn: 'Título (inglés)', tipo: 'Tipo de contrato', cliente: 'Cliente',
    moneda: 'Moneda', firmado: 'Firmado el', inicio: 'Inicio', fin: 'Fin previsto',
    anticipo: 'Anticipo %', amortiza: 'Amortización por valuación %',
    garantia: 'Retención de garantía %',
    descripcion: 'Descripción (español)', descripcionEn: 'Descripción (inglés)',
    cantidad: 'Cantidad', unidad: 'Unidad', norma: 'Norma', espec: 'Especificación',
    precio: 'Precio de venta', costo: 'Precio de compra',
    costoAviso: 'El cliente nunca ve esta columna.',
    borrador: 'Nace en borrador. El cliente no lo verá hasta que se ponga vigente.',
  },
  en: {
    volver: 'Back to the portfolio', codigo: 'Code', titulo: 'Title (Spanish)',
    tituloEn: 'Title (English)', tipo: 'Contract type', cliente: 'Client',
    moneda: 'Currency', firmado: 'Awarded on', inicio: 'Start', fin: 'Planned completion',
    anticipo: 'Advance %', amortiza: 'Amortisation per progress payment %',
    garantia: 'Retention %',
    descripcion: 'Description (Spanish)', descripcionEn: 'Description (English)',
    cantidad: 'Quantity', unidad: 'Unit', norma: 'Standard', espec: 'Specification',
    precio: 'Sale price', costo: 'Purchase price',
    costoAviso: 'The client never sees this column.',
    borrador: 'It starts as a draft. The client will not see it until it is made active.',
  },
} as const

/** Lo que el formulario traía, para devolverlo escrito si algo falló. */
export type Traido = {
  readonly campos?: Readonly<Record<string, string>>
  readonly renglones?: readonly Readonly<Record<string, string>>[]
}

export function pintarAlta(
  lista: readonly ClienteBreve[], idioma: Idioma, antifalsificacion: string,
  errores: readonly string[] = [], traido: Traido = {}, filasPedidas = 3,
): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const dato = (clave: string) => traido.campos?.[clave] ?? ''
  const v = (clave: string) => escapar(dato(clave))

  const campo = (nombre: string, etiqueta: string, tipo = 'text', extra = '') => `
<label class="c">
  <span>${escapar(etiqueta)}</span>
  <input type="${tipo}" name="${escapar(nombre)}" value="${v(nombre)}" ${extra}>
</label>`

  // Lo escrito se devuelve escrito, y las filas vacías de más se ignoran al guardar.
  // Un formulario que se vacía al fallar es la forma más rápida de que nadie lo
  // vuelva a usar.
  const cuantas = Math.max(filasPedidas, traido.renglones?.length ?? 0, 3)
  const filas = Array.from({ length: cuantas },
    (_, i) => traido.renglones?.[i] ?? {}).map((r, i) => `
<div class="rg">
  <div class="rg-n">${i + 1}</div>
  <div class="rg-g">
    <label class="c ancho"><span>${escapar(x.descripcion)}</span>
      <input type="text" name="r_desc_es" value="${escapar(r['desc_es'] ?? '')}"></label>
    <label class="c ancho"><span>${escapar(x.descripcionEn)}</span>
      <input type="text" name="r_desc_en" value="${escapar(r['desc_en'] ?? '')}"></label>
    <label class="c"><span>${escapar(x.cantidad)}</span>
      <input type="number" step="0.0001" min="0" name="r_cantidad" value="${escapar(r['cantidad'] ?? '')}"></label>
    <label class="c"><span>${escapar(x.unidad)}</span>
      <input type="text" name="r_unidad" value="${escapar(r['unidad'] ?? '')}"></label>
    <label class="c"><span>${escapar(x.norma)}</span>
      <input type="text" name="r_norma" value="${escapar(r['norma'] ?? '')}"></label>
    <label class="c"><span>${escapar(x.espec)}</span>
      <input type="text" name="r_espec" value="${escapar(r['espec'] ?? '')}"></label>
    <label class="c"><span>${escapar(x.precio)}</span>
      <input type="number" step="0.0001" min="0" name="r_precio" value="${escapar(r['precio'] ?? '')}"></label>
    <label class="c int"><span>${escapar(x.costo)}</span>
      <input type="number" step="0.0001" min="0" name="r_costo" value="${escapar(r['costo'] ?? '')}"></label>
  </div>
</div>`).join('')

  return pagina({
    idioma,
    titulo: t('alta.titulo'),
    estilos: ESTILOS_ALTA,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('alta.nuevo'))}</h1>
  <div class="sub">${escapar(x.borrador)}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${errores.length === 0 ? '' : `<div class="mal">
    <ul>${errores.map((e) => `<li>${escapar(e)}</li>`).join('')}</ul>
  </div>`}
  <form method="post" action="/contratos/nuevo">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">

    <h2>${escapar(t('alta.datos'))}</h2>
    <div class="caja pad">
      <label class="c"><span>${escapar(x.cliente)}</span>
        <select name="cliente">
          <option value=""></option>
          ${lista.map((c) => `<option value="${escapar(c.id)}"${
            dato('cliente') === c.id ? ' selected' : ''
          }>${escapar(c.nombre)} · ${escapar(c.rif)}</option>`).join('')}
        </select></label>
      ${campo('codigo', x.codigo)}
      <label class="c"><span>${escapar(x.tipo)}</span>
        <select name="tipo">
          ${TIPOS.map((tp: TipoContrato) => `<option value="${tp}"${
            dato('tipo') === tp ? ' selected' : ''
          }>${escapar(nombreTipo(idioma, tp))}</option>`).join('')}
        </select></label>
      <label class="c"><span>${escapar(x.moneda)}</span>
        <select name="moneda">
          <option value="USD"${dato('moneda') === 'USD' ? ' selected' : ''}>USD</option>
          <option value="VES"${dato('moneda') === 'VES' ? ' selected' : ''}>VES</option>
        </select></label>
      ${campo('titulo_es', x.titulo)}
      ${campo('titulo_en', x.tituloEn)}
      ${campo('firmado_el', x.firmado, 'date')}
      ${campo('inicio', x.inicio, 'date')}
      ${campo('fin_previsto', x.fin, 'date')}
      ${campo('anticipo_pct', x.anticipo, 'number', 'step="0.01" min="0" max="100"')}
      ${campo('amortiza_pct', x.amortiza, 'number', 'step="0.01" min="0" max="100"')}
      ${campo('garantia_pct', x.garantia, 'number', 'step="0.01" min="0" max="100"')}
    </div>
    <p class="expl">${escapar(t('alta.monto_calculado'))}</p>
    <p class="expl">${escapar(t('alta.sin_hitos_aviso'))}</p>

    <h2>${escapar(t('alta.renglones'))}</h2>
    <p class="expl">${escapar(x.costoAviso)}</p>
    <div class="caja">${filas}</div>
    <input type="hidden" name="filas" value="${cuantas}">
    <div class="botones">
      <button type="submit" class="sec" name="accion" value="mas">${escapar(t('alta.anadir'))}</button>
      <button type="submit" name="accion" value="crear">${escapar(t('alta.crear'))}</button>
    </div>
  </form>
</main>`,
  })
}

export const ESTILOS_ALTA = `
.pad{padding:8px}
.c{display:block;padding:8px 10px}
.c span{display:block;font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md);margin-bottom:5px}
.c input,.c select{width:100%;font:inherit;font-size:14.5px;padding:8px 10px;
  border:1px solid var(--ln2);border-radius:9px;background:var(--cd);color:var(--ik)}
.c input:focus,.c select:focus{outline:2px solid var(--grt);outline-offset:1px}
/* Lo que el cliente no ve va marcado también para quien lo teclea: que se note al
   escribirlo es lo que evita que acabe pegado en un correo. */
.c.int span{color:var(--am)}
.c.int input{border-color:var(--am);background:var(--amb)}
.caja.pad{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.rg{display:grid;grid-template-columns:30px minmax(0,1fr);gap:8px;padding:12px 10px;
  border-top:1px solid var(--ln)}
.rg:first-child{border-top:0}
.rg-n{font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--md);padding-top:14px;
  text-align:center}
.rg-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
.rg-g .ancho{grid-column:1/-1}
.botones{display:flex;flex-wrap:wrap;align-items:center}
.expl{margin:9px 0 0;font-size:13px;color:var(--ik2);line-height:1.45;max-width:64ch}
.mal{margin-top:18px;background:var(--cd);border:1px solid var(--rj);border-left-width:3px;
  border-radius:11px;padding:13px 17px}
.mal ul{margin:0;padding-left:18px}
.mal li{color:var(--rj);font-weight:600;font-size:14px;margin-bottom:4px}
form button{margin-top:18px;font:inherit;font-size:15px;font-weight:700;padding:11px 22px;
  border:0;border-radius:11px;background:var(--nv);color:#E9F0F6;cursor:pointer}
form button:hover{background:var(--nv3)}
form button.sec{background:transparent;color:var(--ik2);border:1px solid var(--ln2);
  font-weight:600;padding:8px 16px;margin-right:12px}
form button.sec:hover{color:var(--ik)}
`
