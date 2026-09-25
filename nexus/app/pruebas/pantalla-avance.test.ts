/**
 * La pantalla del avance: la que justifica el proyecto entero.
 *
 * Lo que se comprueba aquí es que no se pueda leer como los portales de siempre.
 * Un 58% solo, sin nada detrás, es exactamente lo que ya existe y no sirve.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pintarAvance, pintarPorRevisar, huellaCorta, ESTILOS_AVANCE,
} from '../src/pantallas/evidencia.ts'
import type { Avance, Hito, PorRevisar } from '../src/dominio/evidencia.ts'

const HUELLA = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

const hito = (p: Partial<Hito>): Hito => ({
  id: 'h1', renglonId: 'r1', orden: 1, clave: 'fabricado', nombre: 'Fabricado',
  peso: 30, estado: 'pendiente', exige: [], falta: [],
  planificada: null, pronosticada: null, ocurridoEn: null, registradoEn: null,
  documentos: [], ...p,
})

const AVANCE: Avance = {
  renglonId: 'r1',
  verificado: 30,
  declarado: 50,
  brecha: 20,
  hitos: [
    hito({
      id: 'h1', clave: 'fabricado', nombre: 'Fabricado', peso: 30, estado: 'verificado',
      exige: ['certificado'], ocurridoEn: '2026-09-10',
      documentos: [{
        id: 'd1', clase: 'certificado', huella: HUELLA, nombre: 'mtr-colada-44821.pdf',
        bytes: 91233, tipoMime: 'application/pdf', ocurridoEn: '2026-09-10',
        subidaEn: '2026-09-12', estado: 'verificada', motivoRechazo: null,
      }],
    }),
    hito({
      id: 'h2', clave: 'recibido', nombre: 'Recibido en sitio', peso: 20,
      estado: 'declarado', exige: ['acta', 'foto'], falta: ['foto'],
      documentos: [{
        id: 'd2', clase: 'acta', huella: HUELLA.replace('ba', 'cc'),
        nombre: 'acta & recepción <final>.pdf', bytes: 4411, tipoMime: 'application/pdf',
        ocurridoEn: null, subidaEn: '2026-09-20', estado: 'sin_revisar', motivoRechazo: null,
      }],
    }),
    hito({ id: 'h3', clave: 'entregado', nombre: 'Entregado', peso: 50 }),
  ],
}

test('la barra lleva DOS tramos: lo verificado y lo declarado sin respaldo', () => {
  const h = pintarAvance(AVANCE, 'es')
  // Un solo tramo obligaría a elegir qué número enseñar, y cualquiera de los dos
  // sería media verdad.
  assert.match(h, /class="ba-v" style="width:30%"/)
  assert.match(h, /class="ba-d" style="width:20%"/)
})

test('la brecha se dice en la cara, no escondida abajo', () => {
  const h = pintarAvance(AVANCE, 'es')
  assert.match(h, /class="av-b">\+20 % sin demostrar/)
})

test('sin brecha no se enseña una insignia diciendo que no hay brecha', () => {
  const limpio: Avance = { ...AVANCE, verificado: 50, declarado: 50, brecha: 0 }
  const h = pintarAvance(limpio, 'es')
  assert.equal(h.includes('av-b'), false)
})

test('lo que falta va delante y en color: es la razón de que el avance no suba', () => {
  const h = pintarAvance(AVANCE, 'es')
  assert.match(h, /<div class="falta">Falta: Fotografía<\/div>/)
  // Y va ANTES de la lista de documentos de ese hito, no detrás.
  const bloque = h.slice(h.indexOf('Recibido en sitio'))
  assert.ok(bloque.indexOf('class="falta"') < bloque.indexOf('class="docs"'))
})

test('el documento se nombra con su huella, acortada pero comparable', () => {
  assert.equal(huellaCorta(HUELLA), 'ba7816bf…15ad')
  const h = pintarAvance(AVANCE, 'es')
  assert.match(h, /class="hu">ba7816bf…15ad</)
})

test('un documento sin revisar se ve distinto de uno verificado', () => {
  const h = pintarAvance(AVANCE, 'es')
  assert.match(h, /class="doc ok"/)
  assert.match(h, /class="doc esp"/)
})

test('el nombre de un archivo con < o & no rompe la página', () => {
  const h = pintarAvance(AVANCE, 'es')
  assert.match(h, /acta &amp; recepción &lt;final&gt;\.pdf/)
  assert.equal(h.includes('<final>'), false)
})

test('se dice que el avance no se teclea, con todas las letras', () => {
  const es = pintarAvance(AVANCE, 'es')
  const en = pintarAvance(AVANCE, 'en')
  assert.match(es, /No hay ninguna casilla donde escribirlo/)
  assert.match(en, /There is no field to type it into/)
})

test('es una sola pantalla para escritorio y móvil, no dos plantillas', () => {
  // La misma cadena sirve a las dos superficies: lo único que cambia es la hoja de
  // estilos. Si algún día apareciera una segunda plantilla, esta prueba lo diría.
  assert.match(ESTILOS_AVANCE, /@media\(max-width:520px\)/)
  const uno = pintarAvance(AVANCE, 'es')
  assert.equal(uno.includes('movil'), false)
  assert.equal(uno.includes('mobile'), false)
  assert.equal(uno.includes('escritorio'), false)
})

test('un hito sin empezar se atenúa, no desaparece', () => {
  const h = pintarAvance(AVANCE, 'es')
  // Desaparecer haría que la suma de los pesos visibles no diera 100 y nadie
  // entendería por qué.
  assert.match(h, /class="hito pendiente"/)
  assert.match(h, /Entregado/)
})

const COLA: readonly PorRevisar[] = [
  { evidenciaId: 'e1', hitoId: 'h2', contratoId: 'c1', contrato: 'GPS-2026-001',
    cliente: 'Operadora', hito: 'Recibido', clase: 'acta', nombre: 'acta.pdf', dias: 12 },
  { evidenciaId: 'e2', hitoId: 'h1', contratoId: 'c1', contrato: 'GPS-2026-001',
    cliente: 'Operadora', hito: 'Fabricado', clase: 'certificado', nombre: 'mtr.pdf', dias: 0 },
]

test('la cola marca lo que lleva más de una semana parado', () => {
  const h = pintarPorRevisar(COLA, 'es')
  assert.match(h, /class="rv urge"/)
  assert.match(h, /12 días/)
  assert.match(h, />hoy</)
  // Solo el viejo se marca.
  assert.equal((h.match(/rv urge/g) ?? []).length, 1)
})

test('la cola vacía no deja un encabezado huérfano', () => {
  assert.equal(pintarPorRevisar([], 'es'), '')
})

test('la cola lleva al hito concreto, no a la lista entera', () => {
  const h = pintarPorRevisar(COLA, 'es')
  assert.match(h, /href="\/contratos\/c1#hito-h2"/)
})

test('la pantalla sale entera en los dos idiomas', () => {
  const en = pintarAvance(AVANCE, 'en')
  assert.match(en, /Verified/)
  assert.match(en, /Missing: Photograph/)
  assert.equal(en.includes('Falta'), false)
  assert.equal(en.includes('‹falta:'), false, 'ninguna clave sin traducir')
})
