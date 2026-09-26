#!/usr/bin/env bash
# Un respaldo de la base y de los documentos.
#
#   ./respaldar.sh
#
# Y en el cron del servidor, todas las noches a las 03:17 (no a las 03:00: a esa hora
# arranca todo el mundo sus tareas y el disco se pelea consigo mismo):
#
#   17 3 * * * cd /ruta/a/docs/nexus/despliegue && ./respaldar.sh >> respaldos/log 2>&1
#
# Un respaldo que nadie ha restaurado nunca no es un respaldo. Al final esto imprime la
# orden exacta para restaurarlo, y conviene probarla una vez, en una base de prueba, el
# mismo día que se monta el servidor. El día que haga falta de verdad no es el día de
# aprender a hacerlo.
set -euo pipefail

cd "$(dirname "$0")"
CUANTOS=${CUANTOS:-14}
CUANDO=$(date +%Y-%m-%d-%H%M)
mkdir -p respaldos

# La base. `pg_dump` desde dentro del contenedor, así no hace falta tener el cliente de
# PostgreSQL instalado en el servidor.
docker compose exec -T bd pg_dump -U nexus -d nexus --format=custom \
  > "respaldos/nexus-$CUANDO.dump"

# Y los documentos, que son la mitad que no está en la base: sin las actas de recepción,
# el avance de un contrato deja de poder demostrarse, y de eso va todo esto.
docker compose run --rm -v "$PWD/respaldos:/salida" \
  --entrypoint sh app -c "tar czf /salida/documentos-$CUANDO.tgz -C /documentos ." \
  >/dev/null

# Se tiran los más viejos de CUANTOS días. Un disco lleno de respaldos es un servidor
# caído, y entonces no hay ni servicio ni respaldo.
find respaldos -name 'nexus-*.dump'      -mtime "+$CUANTOS" -delete
find respaldos -name 'documentos-*.tgz'  -mtime "+$CUANTOS" -delete

TAM_BD=$(du -h "respaldos/nexus-$CUANDO.dump" | cut -f1)
TAM_DOC=$(du -h "respaldos/documentos-$CUANDO.tgz" | cut -f1)
echo "$(date '+%F %T')  base $TAM_BD · documentos $TAM_DOC"

# Un respaldo de cero bytes es lo que pasa cuando el contenedor no estaba levantado, y
# se descubre el día que hace falta. Mejor gritar ahora.
[ -s "respaldos/nexus-$CUANDO.dump" ] || { echo "AVISO: el respaldo de la base salió vacío"; exit 1; }

cat <<FIN

  Para restaurarlo (y conviene probarlo UNA vez antes de necesitarlo):

    docker compose exec -T bd psql -U nexus -d postgres -c 'create database prueba;'
    docker compose exec -T bd pg_restore -U nexus -d prueba < respaldos/nexus-$CUANDO.dump
FIN
