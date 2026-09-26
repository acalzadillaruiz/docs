#!/usr/bin/env python3
"""Claves del diccionario que no usa ninguna pantalla.

Este barrido encontro en un solo dia tres huecos de verdad, y los tres eran del
mismo tipo: alguien escribio el texto de un boton o de un aviso, en los dos
idiomas, y la pantalla que tenia que pintarlo nunca se escribio.

  * 'medida.crear_hitos'  — /medidas senalaba los renglones sin hitos y no daba
    forma de crearlos. La funcion existia desde el principio.
  * 'banco.subir'         — la conciliacion no decia por donde se trae el
    extracto, y de paso se vio que decia «todo cuadra» de un mes vacio.
  * 'importar.revertida' y 'periodo.plan_puesto' — dos acciones que salian bien
    y contestaban sin decir nada.

Una clave sin usar no es un fallo por si misma: buena parte del diccionario es
vocabulario del sector declarado a proposito para fases que todavia no existen
—calidad, logistica, tesoreria, contabilidad general—. Por eso esto NO exige
que no haya ninguna: exige que no haya NINGUNA NUEVA.

La lista de las que ya estaban vive en 'sin_pantalla.txt'. Es una raya trazada
hoy, no un certificado de que esas esten bien: lo unico que afirma es que a
partir de hoy una clave escrita y no cableada se ve el mismo dia. La lista solo
puede encoger, y encogerla se ve en el diff.
"""
import json, re, pathlib, sys

AQUI = pathlib.Path(__file__).parent
RAIZ = AQUI.parent

es = json.loads((AQUI / "es.json").read_text(encoding="utf-8"))

fuentes = []
for base in ("app/src", "app/herramientas"):
    for p in sorted((RAIZ / base).rglob("*.ts")):
        fuentes.append(p.read_text(encoding="utf-8"))
texto = "\n".join(fuentes)

# Las que se nombran enteras, y las familias que se arman sobre la marcha
# —t(`hito.estado.${x}`)—, que de otro modo saldrian todas como sin usar.
literales = set(re.findall(r"'([a-z_]+(?:\.[a-z0-9_]+)+)'", texto))
prefijos = set(re.findall(r"`([a-z_]+(?:\.[a-z0-9_]+)*\.)\$\{", texto))

sin_usar = {
    k for k in es
    if not k.startswith("_")
    and k not in literales
    and not any(k.startswith(p) for p in prefijos)
}

declaradas = {
    l.strip() for l in (AQUI / "sin_pantalla.txt").read_text(encoding="utf-8").splitlines()
    if l.strip() and not l.startswith("#")
}

nuevas = sorted(sin_usar - declaradas)
# Una clave declarada que ya se usa, o que ya no existe, sale de la lista: si no,
# la raya se queda quieta mientras el diccionario se mueve.
sobran = sorted(declaradas - sin_usar)

if nuevas:
    print("CLAVES ESCRITAS Y SIN CABLEAR · FALLOS")
    print(f"  - {len(nuevas)} clave(s) que no usa ninguna pantalla y no estaban declaradas:")
    for k in nuevas[:12]:
        print(f"      {k} = {es[k][:60]}")
    if len(nuevas) > 12:
        print(f"      … y {len(nuevas) - 12} más")
    print("  Si es texto para una pantalla que falta, la pantalla es el arreglo.")
    print("  Si es vocabulario para una fase futura, añádela a i18n/sin_pantalla.txt.")
    sys.exit(1)

if sobran:
    print("CLAVES DECLARADAS QUE YA NO HACEN FALTA · FALLOS")
    print(f"  - {len(sobran)} clave(s) en sin_pantalla.txt que ya se usan o ya no existen:")
    for k in sobran[:12]:
        print(f"      {k}")
    print("  Quítalas del archivo: la raya solo puede encoger.")
    sys.exit(1)

print(f"OK · ninguna clave nueva sin pantalla que la pinte "
      f"({len(declaradas)} declaradas, {len(es)} en total)")
