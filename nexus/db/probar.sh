#!/usr/bin/env bash
# Levanta un PostgreSQL desechable, carga el esquema y corre las pruebas.
# No toca ninguna base de datos de verdad. No necesita nada instalado salvo postgresql-16.
set -euo pipefail

PUERTO=${PUERTO:-55432}
DATOS=${DATOS:-/var/tmp/nexuspg}
export PATH=/usr/lib/postgresql/16/bin:$PATH
AQUI="$(cd "$(dirname "$0")" && pwd)"

if ! pg_isready -h /var/tmp -p "$PUERTO" -q 2>/dev/null; then
  rm -rf "$DATOS"; mkdir -p "$DATOS"
  chown postgres:postgres "$DATOS"; chmod 700 "$DATOS"
  su postgres -c "PATH=$PATH initdb -D $DATOS -U nexus --auth=trust -E UTF8" >/dev/null
  su postgres -c "PATH=$PATH pg_ctl -D $DATOS -o '-k /var/tmp -p $PUERTO -c listen_addresses=' -l /var/tmp/pg.log start" >/dev/null
  sleep 2
fi

P="psql -h /var/tmp -p $PUERTO -U nexus"

# Cada archivo de prueba corre contra una base recien creada. Asi ninguna prueba
# depende de lo que dejo la anterior, ni la estorba.
cargar_esquema() {
  $P -d postgres -q -c "drop database if exists nexus;" -c "create database nexus;"
  local sql
  for sql in "$AQUI"/schema/[0-9]*.sql; do
    $P -d nexus -v ON_ERROR_STOP=1 -q -f "$sql"
  done
}

echo "esquema:"
for sql in "$AQUI"/schema/[0-9]*.sql; do echo "  $(basename "$sql")"; done
echo

fallos=0
for f in "$AQUI"/pruebas/[0-9]*.sql; do
  cargar_esquema
  echo "== $(basename "$f") =="
  salida=$($P -d nexus -f "$f" 2>&1 | grep -E 'OK |FALLO|ERROR' | sed -E 's/^psql:[^:]+:[0-9]+: NOTICE:  //; s/^NOTICE:  //')
  echo "$salida"
  if echo "$salida" | grep -qE 'FALLO|ERROR'; then fallos=$((fallos+1)); fi
done

# El diccionario bilingue se comprueba en la misma pasada: un texto sin traducir
# es un fallo igual que un asiento descuadrado.
echo
echo "== diccionario bilingüe =="
if python3 "$AQUI/../i18n/comprobar.py"; then :; else fallos=$((fallos+1)); fi

echo
if [ "$fallos" -gt 0 ]; then echo "HAY $fallos ARCHIVO(S) DE PRUEBA CON FALLOS"; exit 1; fi
echo "TODAS LAS PRUEBAS PASAN"
