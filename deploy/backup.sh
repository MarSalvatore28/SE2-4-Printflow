#!/bin/sh
# PrintFlow · respaldo de la base de datos (S4-04).
# Corre dentro del contenedor «backup» (postgres:17-alpine) con PGHOST, PGUSER, PGPASSWORD y PGDATABASE.
#
#   sh /backup.sh            un respaldo ahora y luego uno cada INTERVALO_SEGUNDOS (86400 = diario)
#   sh /backup.sh --una-vez  un solo respaldo (para probar o antes de actualizar)
#
# Deja /backups/printflow_AAAA-MM-DD_HHMM.dump (formato custom de pg_dump, comprimido) y borra
# los que tengan más de RETENCION_DIAS días (30 por defecto).
set -eu

DIR=/backups
RETENCION=${RETENCION_DIAS:-30}
INTERVALO=${INTERVALO_SEGUNDOS:-86400}

respaldar() {
  archivo="$DIR/printflow_$(date +%Y-%m-%d_%H%M).dump"
  # Se escribe en un temporal y se renombra: nunca queda un respaldo a medias con nombre válido
  pg_dump --format=custom --file="$archivo.tmp"
  mv "$archivo.tmp" "$archivo"
  echo "$(date '+%F %T') respaldo listo: $(basename "$archivo") ($(du -h "$archivo" | cut -f1))"
  find "$DIR" -name 'printflow_*.dump' -mtime +"$RETENCION" -print -delete | sed 's#.*/#  borrado por antigüedad: #'
}

mkdir -p "$DIR"
if [ "${1:-}" = "--una-vez" ]; then
  respaldar
  exit 0
fi

echo "Respaldos cada $INTERVALO s en $DIR, con retención de $RETENCION días"
while true; do
  respaldar || echo "$(date '+%F %T') ERROR: no se pudo hacer el respaldo"
  sleep "$INTERVALO"
done
