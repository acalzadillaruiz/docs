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

/**
 * Un formulario devuelto **tal como lo mandaría un navegador sin tocar nada**.
 *
 * Las reglas no son intuitivas, y cada una de ellas ha escondido ya un fallo o puede
 * esconderlo:
 *
 *   - Un control `disabled` **no se manda**. Ni vacío: no aparece.
 *   - Un `<select>` sin ninguna opción marcada manda **la primera**, no una cadena
 *     vacía. Es lo contrario de lo que se supone al escribir la prueba a mano.
 *   - Una casilla sin marcar **no se manda**; marcada, manda su `value`, o `on` si
 *     no tiene.
 *   - Un `<input>` sin `value` manda la cadena vacía, que **sí** se manda.
 *
 * Una prueba que no respeta esto comprueba que el servidor entiende lo que la prueba
 * imagina, no lo que la pantalla manda.
 */
export type Enviado = {
  readonly accion: string
  readonly metodo: string
  readonly campos: Record<string, string>
  readonly repetidos: Record<string, string[]>
}

/** Los `<form>` de una página, con lo que mandaría cada uno sin tocar nada. */
export function formularios(html: string): Enviado[] {
  const salida: Enviado[] = []
  for (const f of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    const atributos = f[1]!
    const dentro = f[2]!
    const accion = /action="([^"]*)"/.exec(atributos)?.[1] ?? ''
    const metodo = (/method="([^"]*)"/.exec(atributos)?.[1] ?? 'get').toUpperCase()

    const campos: Record<string, string> = {}
    const repetidos: Record<string, string[]> = {}
    const poner = (nombre: string, valor: string) => {
      if (nombre in campos) {
        repetidos[nombre] = [...(repetidos[nombre] ?? [campos[nombre]!]), valor]
      }
      campos[nombre] = valor
    }

    for (const i of dentro.matchAll(/<input\b([^>]*)>/g)) {
      const a = i[1]!
      if (/\sdisabled/.test(a)) continue
      const nombre = /name="([^"]*)"/.exec(a)?.[1]
      if (!nombre) continue
      const tipo = (/type="([^"]*)"/.exec(a)?.[1] ?? 'text').toLowerCase()
      if (tipo === 'submit' || tipo === 'button' || tipo === 'file' || tipo === 'image') continue
      const valor = /value="([^"]*)"/.exec(a)?.[1] ?? ''
      if (tipo === 'checkbox' || tipo === 'radio') {
        if (!/\schecked/.test(a)) continue
        poner(nombre, valor || 'on')
        continue
      }
      poner(nombre, valor)
    }

    for (const s of dentro.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
      if (/\sdisabled/.test(s[1]!)) continue
      const nombre = /name="([^"]*)"/.exec(s[1]!)?.[1]
      if (!nombre) continue
      const opciones = [...s[2]!.matchAll(/<option value="([^"]*)"([^>]*)>/g)]
      const marcada = opciones.find((o) => /\sselected/.test(o[2]!))
      // Sin ninguna marcada, el navegador manda la PRIMERA. No una cadena vacía.
      poner(nombre, (marcada ?? opciones[0])?.[1] ?? '')
    }

    for (const t of dentro.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
      if (/\sdisabled/.test(t[1]!)) continue
      const nombre = /name="([^"]*)"/.exec(t[1]!)?.[1]
      if (nombre) poner(nombre, t[2]!)
    }

    salida.push({ accion, metodo, campos, repetidos })
  }
  return salida
}
