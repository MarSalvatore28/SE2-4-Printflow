#!/bin/sh
# Crea la base de PrintFlow: aplica las migraciones y luego los seeds, en orden alfabético.
# Postgres lo ejecuta solo cuando crea el volumen por primera vez.
# Para reaplicar desde cero:  docker compose down -v && docker compose up --build
#
# Las migraciones las aplica db/migrar.sh (el mismo script que actualiza una base que ya existe):
# cada una en su transacción y registrada en schema_migrations. Así una base nueva y una migrada
# quedan iguales, y después basta `npm run migrar` para aplicar las que lleguen.
#
# Contraseña de los usuarios de prueba (db/seeds/002_usuarios_prueba.sql): la de DEMO_PASSWORD, o
# Printflow2026* si está vacía. Llega a psql como la variable «clave»; el hash se calcula en la base.
set -e

MIGRAR_ORIGEN=init sh /printflow-db/migrar.sh

CLAVE_DEMO=${DEMO_PASSWORD:-Printflow2026*}

for f in /printflow-db/seeds/*.sql; do
  [ -e "$f" ] || continue
  echo "PrintFlow: aplicando $f"
  psql -v ON_ERROR_STOP=1 -v clave="$CLAVE_DEMO" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
done
