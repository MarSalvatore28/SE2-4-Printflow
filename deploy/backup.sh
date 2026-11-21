#!/bin/sh
# PrintFlow · respaldo de la base de datos (S4-04).
# Corre dentro del contenedor «backup» (deploy/respaldo.Dockerfile: postgres:17-alpine + curl) con
# PGHOST, PGUSER, PGPASSWORD y PGDATABASE.
#
#   sh /backup.sh                       un respaldo ahora y luego uno cada INTERVALO_SEGUNDOS (86400 = diario)
#   sh /backup.sh --una-vez             un solo respaldo (para probar o antes de actualizar)
#   sh /backup.sh --listar-azure        lista los respaldos guardados en Azure
#   sh /backup.sh --bajar-azure NOMBRE  baja uno de Azure a /backups (para restaurarlo)
#
# Deja /backups/printflow_AAAA-MM-DD_HHMM.dump (formato custom de pg_dump, comprimido) y borra
# los que tengan más de RETENCION_DIAS días (30 por defecto).
#
# Copia fuera de la VM (opcional): si AZURE_BLOB_SAS_URL tiene la URL de un contenedor de Azure Blob
# Storage con un token SAS (https://CUENTA.blob.core.windows.net/CONTENEDOR?sv=...&sig=...), después de
# cada respaldo sube los de /backups que falten allá y borra allá los de más de RETENCION_DIAS días.
# Sin la variable, se salta. Si Azure falla, se avisa en el log pero el respaldo local queda igual.
set -eu

DIR=/backups
RETENCION=${RETENCION_DIAS:-30}
INTERVALO=${INTERVALO_SEGUNDOS:-86400}
AZURE=${AZURE_BLOB_SAS_URL:-}

ahora() { date '+%F %T'; }

# --- Azure Blob Storage (API REST con SAS: no hace falta la CLI de Azure) -----------------------
# La URL con SAS es un secreto: nunca se imprime.
azure_listo() {
  [ -n "$AZURE" ] || return 1
  case $AZURE in
    https://*\?*sig=*|http://*\?*sig=*) ;;
    *) echo "$(ahora) AVISO: AZURE_BLOB_SAS_URL no parece una URL de contenedor con SAS (…?sv=…&sig=…): no se copia a Azure"; return 1 ;;
  esac
  command -v curl >/dev/null 2>&1 || { echo "$(ahora) AVISO: falta curl (usa la imagen de deploy/respaldo.Dockerfile): no se copia a Azure"; return 1; }
}

blob_url() { printf '%s/%s?%s' "${AZURE%%\?*}" "$1" "${AZURE#*\?}"; }

azure_listar() {
  xml=$(curl -fsS --max-time 60 "${AZURE%%\?*}?restype=container&comp=list&prefix=printflow_&${AZURE#*\?}") || return 1
  { printf '%s\n' "$xml" | grep -o '<Name>[^<]*</Name>' || true; } | sed -e 's#<Name>##' -e 's#</Name>##'
}

# Verdadero si el texto $1 va antes que $2 en orden alfabético (los nombres llevan la fecha)
antes_que() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort | head -n 1)" = "$1" ]; }

sincronizar_azure() {
  azure_listo || return 0
  if ! remotos=$(azure_listar); then
    echo "$(ahora) ERROR: no se pudo leer el contenedor de Azure (¿venció el SAS?); se intenta en el próximo respaldo"
    return 0
  fi
  for f in "$DIR"/printflow_*.dump; do
    [ -e "$f" ] || continue
    nombre=$(basename "$f")
    printf '%s\n' "$remotos" | grep -qx "$nombre" && continue
    if curl -fsS --max-time 600 -o /dev/null -H 'x-ms-blob-type: BlockBlob' \
        -H 'Content-Type: application/octet-stream' --upload-file "$f" "$(blob_url "$nombre")"; then
      echo "  copiado a Azure: $nombre"
    else
      echo "$(ahora) ERROR: no se pudo copiar $nombre a Azure; se intenta en el próximo respaldo"
    fi
  done
  limite="printflow_$(date -d "@$(( $(date +%s) - RETENCION * 86400 ))" +%Y-%m-%d)"
  for nombre in $remotos; do
    antes_que "$nombre" "$limite" || continue
    if curl -fsS --max-time 60 -o /dev/null -X DELETE "$(blob_url "$nombre")"; then
      echo "  borrado de Azure por antigüedad: $nombre"
    else
      echo "$(ahora) ERROR: no se pudo borrar $nombre de Azure"
    fi
  done
}

# --- Respaldo local ------------------------------------------------------------------------------
respaldar() {
  archivo="$DIR/printflow_$(date +%Y-%m-%d_%H%M).dump"
  # Se escribe en un temporal y se renombra: nunca queda un respaldo a medias con nombre válido
  # (con «|| return»: dentro de «respaldar || ...» el set -e no rige)
  pg_dump --format=custom --file="$archivo.tmp" || { rm -f "$archivo.tmp"; return 1; }
  mv "$archivo.tmp" "$archivo" || return 1
  echo "$(ahora) respaldo listo: $(basename "$archivo") ($(du -h "$archivo" | cut -f1))"
  find "$DIR" -name 'printflow_*.dump' -mtime +"$RETENCION" -print -delete | sed 's#.*/#  borrado por antigüedad: #'
  sincronizar_azure
}

mkdir -p "$DIR"
case "${1:-}" in
  --una-vez)
    respaldar
    exit 0 ;;
  --listar-azure)
    azure_listo || { echo "Sin AZURE_BLOB_SAS_URL válida: no hay copia en Azure."; exit 1; }
    azure_listar
    exit 0 ;;
  --bajar-azure)
    nombre=${2:-}
    case $nombre in
      printflow_*.dump) ;;
      *) echo "Uso: sh /backup.sh --bajar-azure printflow_AAAA-MM-DD_HHMM.dump (ver --listar-azure)"; exit 1 ;;
    esac
    case $nombre in
      */*) echo "Nombre no válido: $nombre"; exit 1 ;;
      *) ;;
    esac
    azure_listo || { echo "Sin AZURE_BLOB_SAS_URL válida: no hay copia en Azure."; exit 1; }
    curl -fsS --max-time 600 -o "$DIR/$nombre.tmp" "$(blob_url "$nombre")"
    mv "$DIR/$nombre.tmp" "$DIR/$nombre"
    echo "bajado: $DIR/$nombre ($(du -h "$DIR/$nombre" | cut -f1))"
    exit 0 ;;
  "") ;;
  *) echo "Opción desconocida: $1"; exit 1 ;;
esac

if [ -n "$AZURE" ]; then destino=" y copia en Azure"; else destino=""; fi
echo "Respaldos cada $INTERVALO s en $DIR$destino, con retención de $RETENCION días"
while true; do
  respaldar || echo "$(ahora) ERROR: no se pudo hacer el respaldo"
  sleep "$INTERVALO"
done
