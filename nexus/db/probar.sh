#!/usr/bin/env bash
# Levanta un PostgreSQL desechable, carga el esquema y corre las pruebas.
# No toca ninguna base de datos de verdad. No necesita nada instalado salvo postgresql-16.
set -euo pipefail

PUERTO=${PUERTO:-55432}
DATOS=${DATOS:-/var/tmp/nexuspg}
export PATH=/usr/lib/postgresql/16/bin:$PATH
AQUI="$(cd "$(dirname "$0")" && pwd)"

# El PostgreSQL de pruebas es desechable y vive fuera del repositorio. Entre
# ejecuciones el contenedor puede haberse llevado el proceso por delante, asi que
# aqui se contemplan los tres casos: ya esta corriendo, esta el directorio pero el
# proceso no, y no hay nada. El tercero es el unico que vuelve a inicializar.
arrancar_postgres() {
  su postgres -c "PATH=$PATH pg_ctl -D $DATOS -o '-k /var/tmp -p $PUERTO -c listen_addresses=' -l /var/tmp/pg.log start" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pg_isready -h /var/tmp -p "$PUERTO" -q 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

if ! pg_isready -h /var/tmp -p "$PUERTO" -q 2>/dev/null; then
  if [ -f "$DATOS/PG_VERSION" ]; then
    # El directorio esta bien; lo que falta es el proceso. Se quita el pid huerfano,
    # que si no hace que pg_ctl crea que ya hay otro servidor.
    rm -f "$DATOS/postmaster.pid"
    echo "levantando el PostgreSQL de pruebas…"
    arrancar_postgres || { echo "no se pudo levantar; se reinicializa"; rm -rf "$DATOS"; }
  fi
  if ! pg_isready -h /var/tmp -p "$PUERTO" -q 2>/dev/null; then
    echo "creando el PostgreSQL de pruebas desde cero…"
    rm -rf "$DATOS"; mkdir -p "$DATOS"
    chown postgres:postgres "$DATOS"; chmod 700 "$DATOS"
    su postgres -c "PATH=$PATH initdb -D $DATOS -U nexus --auth=trust -E UTF8" >/dev/null
    arrancar_postgres || { echo "FALLO · no hay PostgreSQL con el que probar"; exit 1; }
  fi
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
  # El '|| true' importa: sin el, un archivo que no imprima ninguna linea util hace
  # que grep devuelva 1 y, con 'set -e', el lanzador muera en silencio dando la
  # impresion de que todo fue bien.
  salida=$($P -d nexus -f "$f" 2>&1 | grep -E 'OK |FALLO|ERROR' | sed -E 's/^psql:[^:]+:[0-9]+: NOTICE:  //; s/^NOTICE:  //' || true)
  if [ -z "$salida" ]; then
    echo "FALLO · no imprimió ninguna comprobación (¿murió antes de empezar?)"
    fallos=$((fallos+1))
  else
    echo "$salida"
    if echo "$salida" | grep -qE 'FALLO|ERROR'; then fallos=$((fallos+1)); fi
  fi
done

# El diccionario bilingue se comprueba en la misma pasada: un texto sin traducir
# es un fallo igual que un asiento descuadrado.
echo
echo "== diccionario bilingüe =="
if python3 "$AQUI/../i18n/comprobar.py"; then :; else fallos=$((fallos+1)); fi

# Y la capa de aplicacion contra la base de datos de verdad. Deja el esquema recien
# cargado para que las pruebas de integracion encuentren una base limpia.
if [ -d "$AQUI/../app/node_modules" ]; then
  echo
  echo "== aplicación (TypeScript) =="
  cargar_esquema
  if (cd "$AQUI/../app" && npx tsc --noEmit); then :; else
    echo "FALLO · los tipos no compilan"; fallos=$((fallos+1))
  fi
  app_salida=$(cd "$AQUI/../app" && node --test --experimental-strip-types pruebas/*.test.ts 2>&1 \
                 | grep -E '^(ok|not ok|# (tests|pass|fail)) ' || true)
  echo "$app_salida"
  if echo "$app_salida" | grep -qE '^not ok|^# fail [1-9]'; then fallos=$((fallos+1)); fi
else
  echo
  echo "(se omiten las pruebas de la aplicación: falta 'npm install' en nexus/app)"
fi

echo
if [ "$fallos" -gt 0 ]; then echo "HAY $fallos ARCHIVO(S) DE PRUEBA CON FALLOS"; exit 1; fi
echo "TODAS LAS PRUEBAS PASAN"
