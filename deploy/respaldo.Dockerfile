# Imagen del servicio «backup» de producción (deploy/docker-compose.prod.yml):
# la misma versión de Postgres que la base (pg_dump y pg_restore) y curl para copiar los respaldos
# a Azure Blob Storage (deploy/backup.sh).
FROM postgres:17-alpine
RUN apk add --no-cache curl
