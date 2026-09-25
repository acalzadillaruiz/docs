#!/usr/bin/env python3
"""Comprueba que el diccionario bilingue esta completo y coherente.

Se ejecuta antes de cada commit que toque i18n/. Si falla, es que alguien
anadio un texto en un idioma y se olvido del otro, que es exactamente el
descuido que convierte 'bilingue desde el primer dia' en 'bilingue a medias'.
"""
import json, sys, pathlib

AQUI = pathlib.Path(__file__).parent
es = json.loads((AQUI / "es.json").read_text(encoding="utf-8"))
en = json.loads((AQUI / "en.json").read_text(encoding="utf-8"))

fallos = []

solo_es = sorted(set(es) - set(en))
solo_en = sorted(set(en) - set(es))
if solo_es:
    fallos.append(f"{len(solo_es)} clave(s) solo en español: {', '.join(solo_es[:8])}")
if solo_en:
    fallos.append(f"{len(solo_en)} clave(s) solo en inglés: {', '.join(solo_en[:8])}")

vacias = sorted(k for k in set(es) & set(en)
                if not str(es[k]).strip() or not str(en[k]).strip())
if vacias:
    fallos.append(f"{len(vacias)} clave(s) con texto vacío: {', '.join(vacias[:8])}")

# Un texto identico en los dos idiomas casi siempre es un olvido. Las excepciones
# reales (siglas, nombres propios) se declaran aqui a proposito.
IGUALES_A_PROPOSITO = {
    "_nota", "logistica.preservacion", "logistica.expediting",
    "valuacion.periodo", "fiscal.exento",
    # Cabeceras de los libros fiscales. «Control» y «Total» se escriben igual en los
    # dos idiomas; traducirlas por traducirlas seria empeorarlas.
    "libro.control", "libro.total",
}
iguales = sorted(k for k in set(es) & set(en)
                 if k not in IGUALES_A_PROPOSITO and es[k] == en[k])
if iguales:
    fallos.append("sin traducir (igual en los dos idiomas): " + ", ".join(iguales[:8]))

n = len(set(es) & set(en))
if fallos:
    print("DICCIONARIO BILINGÜE · FALLOS")
    for f in fallos:
        print("  -", f)
    sys.exit(1)

print(f"OK · diccionario bilingüe completo: {n} términos en los dos idiomas")
