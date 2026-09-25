#!/usr/bin/env python3
"""
Dos archivos de prueba que comparten identificadores.

Es el fallo mas caro de los que se han encontrado aqui, porque no se ve: las filas
llevan 'on conflict do nothing', asi que el segundo archivo no inserta las suyas, se
queda con las del primero, y la prueba pasa o falla segun el orden en que corran.
Paso con un contrato (dos archivos con el mismo prefijo de UUID) y con la tasa del
BCV (la base de datos solo admite una tasa por dia, asi que dos archivos con la misma
fecha comparten tasa sin enterarse).

Solo mira las pruebas de la aplicacion, y no por descuido: el lanzador recarga el
esquema entero ANTES DE CADA archivo .sql, asi que dos archivos de base de datos
pueden compartir lo que quieran sin estorbarse. Las de TypeScript corren todas
seguidas contra una sola base, y ahi si se pisan.

Esto lo busca antes de correr nada, que es cuando todavia es barato.
"""

import re
import sys
from collections import defaultdict
from pathlib import Path

AQUI = Path(__file__).resolve().parent
CARPETAS = [AQUI.parent / 'app' / 'pruebas']

# El primer bloque de un UUID escrito en el codigo. Se descartan los que son de
# relleno ('00000000') porque se usan a proposito para nombrar lo que no existe.
PREFIJO = re.compile(r"'([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'")
# La fecha puede venir escrita, o ser 'current_date'. Las dos formas chocan igual:
# la base de datos solo admite una tasa por dia, se escriba como se escriba.
TASA = re.compile(r"tasa_bcv[^;]*?('\d{4}-\d{2}-\d{2}'|current_date)", re.S)

RELLENO = {'00000000', 'ffffffff'}


def duenos(patron: re.Pattern[str], descarta: set[str] = set()) -> dict[str, set[str]]:
    de_quien: dict[str, set[str]] = defaultdict(set)
    for carpeta in CARPETAS:
        for archivo in sorted(carpeta.glob('*')):
            if not archivo.name.endswith('.test.ts'):
                continue
            texto = archivo.read_text(encoding='utf-8')
            for valor in patron.findall(texto):
                if valor in descarta:
                    continue
                de_quien[valor].add(archivo.name)
    return de_quien


def main() -> int:
    problemas: list[str] = []

    for prefijo, archivos in sorted(duenos(PREFIJO, RELLENO).items()):
        if len(archivos) > 1:
            problemas.append(
                f'el prefijo {prefijo} lo usan {len(archivos)} archivos: '
                + ', '.join(sorted(archivos))
            )

    for fecha, archivos in sorted(duenos(TASA).items()):
        if len(archivos) > 1:
            problemas.append(
                f'la tasa del BCV del {fecha} la insertan {len(archivos)} archivos: '
                + ', '.join(sorted(archivos))
                + ' — solo cabe una tasa por dia'
            )

    if problemas:
        print('FALLO · identificadores compartidos entre archivos de prueba:')
        for p in problemas:
            print(f'  · {p}')
        return 1

    print('OK · ningún archivo de prueba comparte identificadores con otro')
    return 0


if __name__ == '__main__':
    sys.exit(main())
