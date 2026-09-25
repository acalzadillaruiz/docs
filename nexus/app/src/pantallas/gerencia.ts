/**
 * «¿Cómo va el mes?».
 *
 * El orden manda, y no es decorativo. De arriba abajo contesta las tres preguntas de
 * fin de mes por el orden en que se hacen: si ganamos, dónde está el dinero, y qué
 * nos deja y qué nos quita.
 *
 * Y antes que nada, si el libro no cuadra, lo dice. Una pantalla de cifras sobre un
 * libro descuadrado es peor que ninguna: da confianza donde no la hay.
 *
 * Ojo con una cosa que se presta a confusión, y por eso va escrita en la propia
 * pantalla: las dos tablas de rentabilidad **no son del mes**. Son el acumulado de
 * cada contrato hasta el último día del mes elegido, que es como está construida
 * `margen_contrato` por debajo. Y tiene sentido que lo sea —un contrato de ocho meses
 * no se juzga por lo que dejó en agosto—, pero ponerlas bajo un selector de mes sin
 * decirlo sería dejar que se leyeran como lo que no son.
 */

import type { Mes, Fila } from '../dominio/gerencia.ts'
import { traductor, type Idioma } from '../i18n/t.ts'
import { pagina, escapar } from './base.ts'

const TEXTOS = {
  es: { volver: 'Volver a la cartera', anio: 'Año', mes: 'Mes', ver: 'Ver' },
  en: { volver: 'Back to the portfolio', anio: 'Year', mes: 'Month', ver: 'View' },
} as const

export function pintarGerencia(m: Mes, idioma: Idioma, antifalsificacion: string): string {
  const x = TEXTOS[idioma]
  const t = traductor(idioma)
  const mm = String(m.mes).padStart(2, '0')

  const tabla = (titulo: string, cabecera: string, filas: readonly Fila[]) =>
    filas.length === 0 ? '' : `
<h2>${escapar(titulo)}</h2>
<div class="caja"><div class="ancho"><table class="gt">
  <thead><tr>
    <th>${escapar(cabecera)}</th>
    <th class="n">${escapar(t('ger.contratos'))}</th>
    <th class="n">${escapar(t('ger.valuado'))}</th>
    <th class="n">${escapar(t('ger.costo'))}</th>
    <th class="n">${escapar(t('ger.margen'))}</th>
    <th class="n">${escapar(t('ger.margen_pct'))}</th>
  </tr></thead>
  <tbody>${filas.map((f) => `
    <tr>
      <td>${escapar(f.nombre)}</td>
      <td class="n">${f.contratos}</td>
      <td class="n">${escapar(f.valuado)}</td>
      <td class="n">${escapar(f.costo)}</td>
      <td class="n ${f.margenPct >= 0 ? 'bien' : 'mal'}">${escapar(f.margen)}</td>
      <td class="n ${f.margenPct >= 0 ? 'bien' : 'mal'}">${f.margenPct}%</td>
    </tr>`).join('')}
  </tbody>
</table></div></div>`

  const gana = m.resultado.resultadoCrudo >= 0

  return pagina({
    idioma,
    titulo: t('ger.titulo'),
    estilos: ESTILOS_GERENCIA,
    cabecera: `<header class="hd"><div class="wrap">
  <a class="volver" href="/">← ${escapar(x.volver)}</a>
  <h1>${escapar(t('ger.titulo'))}</h1>
  <div class="sub">${escapar(t('ger.explica'))}</div>
</div></header>`,
    cuerpo: `<main class="wrap">
  ${m.cuadra ? '' : `<div class="aviso">
    <b>${escapar(t('ger.descuadre'))} ${escapar(m.descuadre)}</b>
    <p>${escapar(t('ger.descuadre_explica'))}</p>
  </div>`}

  <form method="get" action="/gerencia" class="sel">
    <input type="hidden" name="af" value="${escapar(antifalsificacion)}">
    <label>${escapar(x.anio)}
      <input type="number" name="anio" value="${m.anio}" min="2000" max="2100"></label>
    <label>${escapar(x.mes)}
      <input type="number" name="mes" value="${m.mes}" min="1" max="12"></label>
    <button type="submit">${escapar(x.ver)}</button>
  </form>

  <!-- 1. ¿Ganamos o perdimos? -->
  <div class="doble">
    <div class="cif">
      <div class="cif-e">${escapar(t('ger.resultado'))} · ${escapar(mm)}/${m.anio}</div>
      <div class="cif-v ${gana ? 'bien' : 'mal'}">${escapar(m.resultado.resultado)}</div>
      <div class="cif-q">${escapar(gana ? t('ger.ganancia') : t('ger.perdida'))} ·
        ${escapar(m.resultado.resultadoUsd)}</div>
      <div class="cif-d">
        <span>${escapar(t('ger.ingresos'))} ${escapar(m.resultado.ingresos)}</span>
        <span>${escapar(t('ger.gastos'))} ${escapar(m.resultado.gastos)}</span>
      </div>
    </div>

    <!-- 2. ¿Y dónde está el dinero? -->
    <div class="cif">
      <div class="cif-e">${escapar(t('ger.sin_cobrar'))}</div>
      <div class="cif-v ${m.sinCobrarCrudo > 0 ? 'ojo' : ''}">${escapar(m.sinCobrar)}</div>
      <p class="cif-x">${escapar(t('ger.sin_cobrar_explica'))}</p>
    </div>
  </div>

  <!-- 3. ¿Qué nos deja dinero y qué nos lo quita? -->
  ${tabla(t('ger.por_cliente'), t('ger.cliente'), m.porCliente)}
  ${tabla(t('ger.por_servicio'), t('ger.servicio'), m.porServicio)}
  ${m.porCliente.length === 0 && m.porServicio.length === 0
    ? `<p class="nada">${escapar(t('ger.nada'))}</p>`
    : `<p class="expl">${escapar(t('ger.acumulado_explica'))}</p>`}

  ${m.pyg.length === 0 ? '' : `
  <h2>${escapar(t('ger.pyg'))}</h2>
  <div class="caja"><div class="ancho"><table class="gt">
    <tbody>${m.pyg.map((l) => `
      <tr class="${l.seccion}">
        <td><span class="cod">${escapar(l.codigo)}</span> ${escapar(l.cuenta)}</td>
        <td class="n">${escapar(l.monto)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div></div>
  <p class="expl">${escapar(t('ger.pyg_explica'))}</p>`}

  ${m.contratos.length === 0 ? '' : `
  <h2>${escapar(t('ger.cartera'))}</h2>
  <div class="caja"><div class="ancho"><table class="gt">
    <thead><tr>
      <th>${escapar(t('ger.contrato'))}</th>
      <th>${escapar(t('ger.cliente'))}</th>
      <th class="n">${escapar(t('ger.valuado'))}</th>
      <th class="n">${escapar(t('ger.costo'))}</th>
      <th class="n">${escapar(t('ger.margen'))}</th>
      <th class="n">${escapar(t('ger.margen_pct'))}</th>
    </tr></thead>
    <tbody>${m.contratos.map((c) => `
      <tr>
        <td class="m">${escapar(c.contrato)}</td>
        <td>${escapar(c.cliente)}</td>
        <td class="n">${escapar(c.valuado)}</td>
        <td class="n">${escapar(c.costo)}</td>
        <td class="n ${c.margenPct >= 0 ? 'bien' : 'mal'}">${escapar(c.margen)}</td>
        <td class="n ${c.margenPct >= 0 ? 'bien' : 'mal'}">${c.margenPct}%</td>
      </tr>`).join('')}
    </tbody>
  </table></div></div>
  ${m.contratosOcultos === 0 ? '' : `<p class="expl">${
    escapar(t('medida.ocultas').replace('{n}', String(m.contratosOcultos)))}</p>`}
  <p class="expl">${escapar(t('ger.cartera_explica'))}</p>`}

  <h2>${escapar(t('ger.flujo'))}</h2>
  <div class="caja"><div class="ancho"><table class="gt">
    <thead><tr>
      <th>${escapar(t('ger.semana'))}</th>
      <th class="n">${escapar(t('ger.entra'))}</th>
      <th class="n">${escapar(t('ger.sale'))}</th>
      <th class="n">${escapar(t('ger.neto'))}</th>
    </tr></thead>
    <tbody>${m.semanas.map((s) => `
      <tr>
        <td class="m">${escapar(s.semana)}</td>
        <td class="n">${escapar(s.entra)}</td>
        <td class="n">${escapar(s.sale)}</td>
        <td class="n ${s.netoCrudo >= 0 ? 'bien' : 'mal'}">${escapar(s.neto)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div></div>
  <p class="expl">${escapar(t('ger.flujo_explica'))}</p>
  <p class="expl int">${escapar(t('ger.interno'))}</p>
</main>`,
  })
}

export const ESTILOS_GERENCIA = `
.sel{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin:18px 0 6px}
.sel label{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.sel input{display:block;margin-top:5px;width:100px;font:inherit;font-size:14px;
  padding:8px 10px;border:1px solid var(--ln2);border-radius:9px;background:var(--cd);
  color:var(--ik)}
.sel button{font:inherit;font-size:14px;font-weight:700;padding:9px 20px;border:0;
  border-radius:9px;background:var(--nv);color:#E9F0F6;cursor:pointer}
/* Si el libro no cuadra se dice ARRIBA. Una pantalla de cifras sobre un libro
   descuadrado da confianza donde no la hay. */
.aviso{margin-top:18px;background:var(--amb);border:1px solid var(--am);
  border-left-width:3px;border-radius:12px;padding:14px 17px}
.aviso b{color:var(--am);font-size:15px}
.aviso p{margin:6px 0 0;font-size:13px;color:var(--ik2);line-height:1.45;max-width:64ch}
.doble{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;
  margin-top:14px}
.cif{background:var(--cd);border:1px solid var(--ln2);border-radius:13px;padding:17px 19px}
.cif-e{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--md)}
.cif-v{margin-top:6px;font-family:"JetBrains Mono",monospace;font-size:27px;
  font-weight:700;letter-spacing:-.03em}
.cif-v.bien{color:var(--grt)}
.cif-v.mal{color:var(--rj)}
.cif-v.ojo{color:var(--am)}
.cif-q{margin-top:3px;font-size:13px;color:var(--ik2)}
.cif-d{margin-top:11px;display:flex;gap:16px;flex-wrap:wrap;
  font-family:"JetBrains Mono",monospace;font-size:11.5px;color:var(--ik2)}
.cif-x{margin:9px 0 0;font-size:12.5px;color:var(--md);line-height:1.45;max-width:52ch}
h2{margin:26px 0 10px;font-family:"JetBrains Mono",monospace;font-size:10.5px;
  font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--md)}
.ancho{overflow-x:auto}
.gt{width:100%;border-collapse:collapse;font-size:13.5px}
.gt th{text-align:left;padding:9px 12px;font-family:"JetBrains Mono",monospace;
  font-size:8.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  color:var(--md);border-bottom:1px solid var(--ln);white-space:nowrap}
.gt th.n,.gt td.n{text-align:right;font-family:"JetBrains Mono",monospace;white-space:nowrap}
.gt td{padding:9px 12px;border-top:1px solid var(--ln)}
/* El codigo de contrato no se parte: «GPS-2027-007» en tres lineas no se lee, y es
   la columna por la que se busca. */
.gt td.m{font-family:"JetBrains Mono",monospace;font-size:12px;white-space:nowrap}
/* El ingreso y el gasto se distinguen sin leer el signo. */
.gt tr.ingresos td:first-child{border-left:3px solid var(--grt)}
.gt tr.gastos td:first-child{border-left:3px solid var(--ln2)}
.gt td.n.bien{color:var(--grt)}
.gt td.n.mal{color:var(--rj)}
.expl{margin:11px 0 0;font-size:12.5px;color:var(--md);line-height:1.45;max-width:64ch}
.expl.int{color:var(--am);font-weight:600}
.nada{padding:17px;color:var(--ik2);font-size:14px;margin:0}
`
