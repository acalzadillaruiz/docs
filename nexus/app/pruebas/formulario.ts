/**
 * Devolver un formulario tal como el navegador lo devolvería.
 *
 * Existe por un fallo concreto que una prueba NO encontró: la de la importación
 * escribía a mano las columnas, los campos y los formatos, en tres listas
 * perfectamente alineadas. El navegador no manda eso. El `<select>` del formato va
 * deshabilitado en las columnas de texto, y un select deshabilitado **no se manda**,
 * así que llegaban menos formatos que campos y cada formato caía en la columna de al
 * lado. La fecha de una factura se leía con el formato de otra columna.
 *
 * Una prueba que fabrica la entrada en vez de devolver la que salió comprueba que el
 * servidor entiende lo que la prueba imagina, no lo que la pantalla manda.
 */

/** Los `<select>` con opción elegida, por nombre de casilla. */
export function elegidos(html: string): Record<string, string> {
  const salida: Record<string, string> = {}
  for (const m of html.matchAll(/<select name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const nombre = m[1]!
    // Un select deshabilitado no lo manda el navegador, así que aquí tampoco.
    if (/<select name="[^"]+"[^>]*\sdisabled/.test(m[0])) continue
    const elegido = /<option value="([^"]*)"[^>]*\sselected/.exec(m[2]!)
    salida[nombre] = elegido?.[1] ?? ''
  }
  return salida
}

/** Los `<input type="hidden">` repetidos con un mismo nombre. */
export function ocultosRepetidos(html: string, nombre: string): string[] {
  return [...html.matchAll(
    new RegExp(`<input type="hidden" name="${nombre}" value="([^"]*)"`, 'g'),
  )].map((m) => m[1]!)
}

/** El formulario de mapeo del importador, listo para devolverlo. */
export function mapeoDe(html: string): {
  columnas: string[]
  campos: Record<string, string>
} {
  const columnas = ocultosRepetidos(html, 'columna')
  const todos = elegidos(html)
  const campos: Record<string, string> = {}
  for (const n of columnas) {
    for (const cual of ['campo', 'formato']) {
      const clave = `${cual}_${n}`
      if (clave in todos) campos[clave] = todos[clave]!
    }
  }
  return { columnas, campos }
}
