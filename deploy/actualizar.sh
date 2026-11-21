#!/bin/sh
# PrintFlow · actualiza producción (S4-04). Lo corre por SSH el workflow .github/workflows/deploy.yml,
# y también se puede correr a mano en la VM:
#
#   cd ~/SE2-4-Printflow && sh deploy/actualizar.sh            lo último de la rama actual (main)
#   cd ~/SE2-4-Printflow && sh deploy/actualizar.sh <commit>   el backend hasta ese commit de origin
#
# Pasos; si uno falla se detiene, muestra el estado y los logs, y termina con código distinto de 0:
#   1. respaldo de la base (backup.sh --una-vez), si la base ya está corriendo;
#   2. git pull (solo avance rápido) del backend y del frontend;
#   3. construye las imágenes nuevas: si no compilan, producción sigue como estaba;
#   4. aplica las migraciones pendientes (db/migrar.sh);
#   5. up -d: reemplaza solo los contenedores que cambiaron;
#   6. comprueba que la API responde /health.
#
# Usa el .env de la raíz del backend (FRONTEND_PATH, por defecto ../SE2-4-Printflow-Frontend).
# Para probarlo en la PC sin pisar otro entorno: COMPOSE_PROJECT_NAME=pf-prueba sh deploy/actualizar.sh
set -eu

cd "$(dirname "$0")/.."

dc() { docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml "$@"; }
paso() { echo; echo "==> $(date '+%F %T') $*"; }

# shellcheck disable=SC2317 # se llama desde el trap EXIT
al_salir() {
  codigo=$?
  [ "$codigo" -eq 0 ] && return 0
  echo
  echo "==> ERROR: la actualización se detuvo (código $codigo). Estado y últimos logs:" >&2
  dc ps || true
  dc logs --no-color --tail 60 api db || true
  exit "$codigo"
}
trap al_salir EXIT

[ -f .env ] || { echo "No hay .env en $(pwd): ver docs/despliegue.md, sección 3"; exit 1; }
FRONT=$(sed -n 's/^FRONTEND_PATH=//p' .env | tail -n 1 | tr -d '\r"')
FRONT=${FRONT:-../SE2-4-Printflow-Frontend}
[ -d "$FRONT/.git" ] || { echo "No encuentro el repo del frontend en $FRONT"; exit 1; }

# Las carpetas que se montan en los contenedores las crea el usuario del despliegue: si las crea
# Docker quedan de root, y ni el respaldo ni la API (corren sin root, UID 1000) pueden escribir.
mkdir -p backups buzon-salida

if [ "${1:-}" != "--despues-del-pull" ]; then
  COMMIT=${1:-}
  case $COMMIT in
    "") ;;
    *[!0-9a-f]*) echo "Commit no válido: $COMMIT"; exit 1 ;;
    *) ;;  # un hash: git merge --ff-only confirma que existe
  esac

  paso "1/6 Respaldo de la base"
  if [ -n "$(dc ps --status running --quiet db)" ]; then
    dc run --rm -T backup --una-vez
  else
    echo "La base no está corriendo (¿primer despliegue?): no hay nada que respaldar."
  fi

  paso "2/6 Código nuevo (git pull)"
  antes=$(git rev-parse --short HEAD)
  if [ -n "$COMMIT" ]; then
    git fetch --quiet origin
    git merge --ff-only "$COMMIT"
  else
    git pull --ff-only
  fi
  echo "backend:  $antes -> $(git rev-parse --short HEAD)  ($(git log -1 --format=%s))"
  antes=$(git -C "$FRONT" rev-parse --short HEAD)
  git -C "$FRONT" pull --ff-only
  echo "frontend: $antes -> $(git -C "$FRONT" rev-parse --short HEAD)  ($(git -C "$FRONT" log -1 --format=%s))"

  # El resto lo hace la versión NUEVA de este script (pudo cambiar con el pull)
  trap - EXIT
  exec sh deploy/actualizar.sh --despues-del-pull
fi

paso "3/6 Construye las imágenes"
dc build

paso "4/6 Migraciones pendientes"
dc up -d --wait db
dc exec -T db sh /printflow-db/migrar.sh

paso "5/6 Levanta la versión nueva"
dc up -d --wait --wait-timeout 180

paso "6/6 Comprueba que la API responde"
for _ in $(seq 1 30); do
  if dc exec -T api node -e "fetch('http://localhost:9000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null; then
    dc ps
    docker image prune --force >/dev/null 2>&1 || true
    echo
    echo "==> $(date '+%F %T') Listo: producción en el commit $(git rev-parse --short HEAD) del backend y $(git -C "$FRONT" rev-parse --short HEAD) del frontend."
    exit 0
  fi
  sleep 2
done
echo "La API no respondió /health en 60 s."
exit 1
