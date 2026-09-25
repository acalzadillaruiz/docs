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

# El correo de una persona es unico en toda la base. Dos archivos que INSERTEN el
# mismo chocan igual que si compartieran el prefijo de UUID, y el error que sale
# —«clave duplicada»— no dice cual es el otro archivo.
#
# Solo cuentan los que se insertan. Varios archivos usan a proposito un correo que NO
# existe, para comprobar que entrar con el falla igual que con una clave mala, y esos
# no chocan con nada porque nunca llegan a la tabla.
INSERTA_PERSONA = re.compile(r"insert\s+into\s+persona\b.*?(?:;|`)", re.S | re.I)
CORREO = re.compile(r"'([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*prueba\.test)'")

# El RIF de una organizacion tambien es unico.
RIF = re.compile(r"'(J-\d{9}-\d)'")

RELLENO = {'00000000', 'ffffffff'}


def duenos(
    patron: re.Pattern[str], descarta: set[str] = set(),
    dentro_de: re.Pattern[str] | None = None,
) -> dict[str, set[str]]:
    de_quien: dict[str, set[str]] = defaultdict(set)
    for carpeta in CARPETAS:
        for archivo in sorted(carpeta.glob('*')):
            if not archivo.name.endswith('.test.ts'):
                continue
            texto = archivo.read_text(encoding='utf-8')
            # Cuando se pide, solo se mira dentro de cierto tipo de instruccion: un
            # correo escrito para comprobar que NO existe no choca con nada.
            trozos = dentro_de.findall(texto) if dentro_de else [texto]
            for trozo in trozos:
                for valor in patron.findall(trozo):
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

    for correo, archivos in sorted(duenos(CORREO, dentro_de=INSERTA_PERSONA).items()):
        if len(archivos) > 1:
            problemas.append(
                f'el correo {correo} lo usan {len(archivos)} archivos: '
                + ', '.join(sorted(archivos)) + ' — y es unico en toda la base'
            )

    for rif, archivos in sorted(duenos(RIF).items()):
        if len(archivos) > 1:
            problemas.append(
                f'el RIF {rif} lo usan {len(archivos)} archivos: '
                + ', '.join(sorted(archivos)) + ' — y es unico en toda la base'
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
