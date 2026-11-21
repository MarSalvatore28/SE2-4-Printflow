# Imagen del servicio «backup» de producción (deploy/docker-compose.prod.yml):
# la misma versión de Postgres que la base (pg_dump y pg_restore) y curl para copiar los respaldos
# a Azure Blob Storage (deploy/backup.sh).
FROM postgres:17-alpine
RUN apk add --no-cache curl

# Corre sin root. El usuario tiene el mismo UID que el dueño de ./backups en la VM (1000, el primer
# usuario de Ubuntu); deploy/actualizar.sh crea esa carpeta antes de levantar los servicios.
ARG UID_RESPALDO=1000
RUN adduser -D -u "${UID_RESPALDO}" respaldo \
 && mkdir -p /backups && chown respaldo /backups
USER respaldo
