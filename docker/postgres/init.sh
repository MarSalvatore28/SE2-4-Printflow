#!/bin/sh
# Crea la base de PrintFlow: aplica las migraciones y luego los seeds, en orden alfabético.
# Postgres lo ejecuta solo cuando crea el volumen por primera vez.
# Para reaplicar desde cero:  docker compose down -v && docker compose up --build
#
# Las migraciones las aplica db/migrar.sh (el mismo script que actualiza una base que ya existe):
# cada una en su transacción y registrada en schema_migrations. Así una base nueva y una migrada
# quedan iguales, y después basta `npm run migrar` para aplicar las que lleguen.
set -e

MIGRAR_ORIGEN=init sh /printflow-db/migrar.sh

for f in /printflow-db/seeds/*.sql; do
  [ -e "$f" ] || continue
  echo "PrintFlow: aplicando $f"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
done
