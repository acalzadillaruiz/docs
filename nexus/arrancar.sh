#!/usr/bin/env bash
# Arranca GPS Nexus en esta máquina, con una empresa de muestra dentro.
#
# Una sola orden:  ./arrancar.sh
#
# Levanta un PostgreSQL desechable, carga el esquema entero, siembra la empresa de
# muestra, y enciende el servidor. Al final imprime la dirección y con qué entrar,
# incluido el código de seis dígitos — sin eso la aplicación no se puede abrir, porque
# la entrada pide segundo factor.
#
# NO es un despliegue. La base de datos vive en /var/tmp y se la lleva por delante un
# reinicio; el servidor va sin TLS porque solo escucha en esta máquina. Para ponerlo
# donde lo use gente hacen falta las decisiones que están en DECISIONES-PENDIENTES.md.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
PUERTO=${NEXUS_PUERTO:-8080}
PUERTO_BD=${PUERTO_BD:-55432}
DATOS=${DATOS:-/var/tmp/nexuspg}
ALMACEN=${NEXUS_ALMACEN:-/var/tmp/nexus-documentos}

# --------------------------------------------------------------- lo que hace falta
falta() { echo "FALTA: $1"; echo "       $2"; exit 1; }

command -v node >/dev/null || falta "Node.js" "hace falta la versión 22 o más nueva: https://nodejs.org"
MAYOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$MAYOR" -ge 22 ] || falta "Node.js 22 o más nuevo" "esta es la $(node -v). El código usa TypeScript sin compilar, y eso entró en la 22."

# PostgreSQL 16. En Debian y Ubuntu los binarios no están en el PATH.
for d in /usr/lib/postgresql/16/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql@16/bin; do
  [ -d "$d" ] && export PATH="$d:$PATH"
done
command -v initdb >/dev/null || falta "PostgreSQL 16" \
  "en Debian/Ubuntu: sudo apt install postgresql-16 · en macOS: brew install postgresql@16"

[ -d "$AQUI/app/node_modules" ] || {
  echo "instalando dependencias…"
  (cd "$AQUI/app" && npm install --silent)
}

# ------------------------------------------------------------------ la base de datos
#
# Se contemplan los tres casos, porque los tres pasan: ya está corriendo, está la
# carpeta pero no el proceso, y no hay nada. El del medio es el que deja un pid huérfano
# que hace creer a pg_ctl que ya hay otro servidor.
arrancar_bd() {
  su_postgres "pg_ctl -D $DATOS -o '-k /var/tmp -p $PUERTO_BD -c listen_addresses=' -l /var/tmp/nexus-pg.log start" >/dev/null 2>&1 || true
  for _ in $(seq 10); do
    pg_isready -h /var/tmp -p "$PUERTO_BD" -q 2>/dev/null && return 0
    sleep 1
  done
  return 1
}
# PostgreSQL se niega a correr como root. Si somos root hay que bajar a otro usuario;
# si no lo somos, ya estamos bien.
su_postgres() {
  if [ "$(id -u)" = 0 ]; then su postgres -c "PATH=$PATH $1"; else sh -c "$1"; fi
}

if ! pg_isready -h /var/tmp -p "$PUERTO_BD" -q 2>/dev/null; then
  if [ -f "$DATOS/PG_VERSION" ]; then
    rm -f "$DATOS/postmaster.pid"
    echo "levantando el PostgreSQL local…"
    arrancar_bd || { echo "no arrancó; se reinicializa"; rm -rf "$DATOS"; }
  fi
  if ! pg_isready -h /var/tmp -p "$PUERTO_BD" -q 2>/dev/null; then
    echo "creando el PostgreSQL local desde cero…"
    rm -rf "$DATOS"; mkdir -p "$DATOS"
    if [ "$(id -u)" = 0 ]; then chown postgres:postgres "$DATOS"; chmod 700 "$DATOS"; fi
    su_postgres "initdb -D $DATOS -U nexus --auth=trust -E UTF8" >/dev/null
    arrancar_bd || { echo "FALLO · no hay PostgreSQL con el que arrancar"; exit 1; }
  fi
fi

P="psql -h /var/tmp -p $PUERTO_BD -U nexus"

# ------------------------------------------------------------------------ el esquema
#
# Se carga solo si la base no está. Volver a cargarlo sobre una base con datos falla a
# medias y deja el esquema en un estado que no es ni el viejo ni el nuevo.
if ! $P -lqt 2>/dev/null | cut -d\| -f1 | grep -qw nexus; then
  echo "creando la base y cargando el esquema…"
  $P -d postgres -q -c "create database nexus;"
  for sql in "$AQUI"/db/schema/[0-9]*.sql; do
    $P -d nexus -v ON_ERROR_STOP=1 -q -f "$sql" || {
      echo "FALLO cargando $(basename "$sql")"; exit 1; }
  done
  echo "sembrando la empresa de muestra…"
  (cd "$AQUI/app" && node --experimental-strip-types herramientas/sembrar.ts) >/dev/null
else
  echo "la base ya estaba; se usa tal cual (borra $DATOS para empezar de cero)"
fi

mkdir -p "$ALMACEN"

# ------------------------------------------------------------------------ el servidor
export NEXUS_PUERTO="$PUERTO"
export NEXUS_BD_SOCKET=/var/tmp
export NEXUS_BD_PUERTO="$PUERTO_BD"
export NEXUS_BD_NOMBRE=nexus
export NEXUS_BD_USUARIO=nexus
export NEXUS_ALMACEN="$ALMACEN"
export NEXUS_PERSONA_SERVICIO=c8d9e0f1-0000-0000-0000-00000000000d
# Sin TLS, y a propósito: esto solo escucha en esta máquina. La cookie de sesión se
# marca `Secure` cuando hay TLS, y con `Secure` puesta sobre http el navegador la tira
# y no se puede entrar nunca.
export NEXUS_INSEGURO=1

echo
echo "  ────────────────────────────────────────────────────────────"
echo "   GPS Nexus en  http://localhost:$PUERTO"
echo "  ────────────────────────────────────────────────────────────"
(cd "$AQUI/app" && node --experimental-strip-types herramientas/codigo.ts)
echo "   El código cambia cada 30 s. Para uno nuevo, en otra terminal:"
echo "     cd $AQUI/app && node --experimental-strip-types herramientas/codigo.ts"
echo
echo "   Ctrl-C para parar."
echo

cd "$AQUI/app"
exec node --experimental-strip-types src/servidor/arrancar.ts
