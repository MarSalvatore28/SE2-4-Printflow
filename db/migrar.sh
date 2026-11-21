#!/bin/sh
# PrintFlow · aplica las migraciones PENDIENTES de db/migrations sobre una base que ya existe (S4-04).
#
# Corre dentro del contenedor «db» (ahí están psql y pg_dump, y db/ está montado en /printflow-db):
#
#   docker compose exec -T db sh /printflow-db/migrar.sh             aplica las pendientes
#   docker compose exec -T db sh /printflow-db/migrar.sh --estado    lista aplicadas y pendientes, sin cambiar nada
#   docker compose exec -T db sh /printflow-db/migrar.sh --marcar 0NN_nombre.sql [...]
#                       registra migraciones como aplicadas SIN ejecutarlas (solo para resolver casos raros)
#
#   En la PC también: npm run migrar  (y npm run migrar -- --estado)
#   En producción, con -f docker-compose.yml -f deploy/docker-compose.prod.yml (lo hace deploy/actualizar.sh).
#
# Cómo funciona:
#   - Lleva la cuenta en la tabla public.schema_migrations (nombre, aplicada_en, origen).
#   - Aplica en orden alfabético las de db/migrations/*.sql que no estén en la tabla. Cada una va en
#     SU transacción, junto con su registro en la tabla: o queda entera y registrada, o no queda nada.
#   - Si una falla, se detiene: no aplica las siguientes.
#   - docker/postgres/init.sh usa este mismo script al crear el volumen (origen «init»), así que una
#     base nueva y una migrada quedan iguales.
#
# Adopción de una base creada ANTES de schema_migrations (tiene tablas, pero no la tabla de control):
#   el script NO toca la base para averiguar qué tiene. Copia su esquema (pg_dump --schema-only) a una
#   base temporal y prueba ahí cada migración, en orden:
#     - falla con «ya existe» (SQLSTATE 42P07, 42701, 42710, 42723, 42P06)  -> ya estaba: se registra;
#     - se aplica y CAMBIA el esquema                                       -> pendiente: se aplica después;
#     - se aplica y NO cambia nada (p. ej. CREATE ... IF NOT EXISTS)        -> ya estaba: se registra,
#       salvo que la migración también cambie datos (INSERT, UPDATE, DELETE...): entonces no se puede saber;
#     - cualquier otro error, o un caso dudoso                              -> se detiene sin cambiar nada
#       e indica qué revisar (luego se resuelve con --marcar).
#   Supone que cada migración se aplicó entera o no se aplicó (así lo hacía el init.sh de antes).
#
# Reglas para escribir migraciones (ver docs/despliegue.md, sección 6):
#   - Nombre 0NN_descripcion.sql (solo letras, números, «_», «-» y «.»). Nunca renombrar una ya mergeada.
#   - Sin BEGIN/COMMIT propios ni CREATE INDEX CONCURRENTLY: el script ya las envuelve en una transacción.
#   - Si cambia datos, que sea segura de repetir (WHERE / ON CONFLICT DO NOTHING).
set -eu

DIR=${MIGRACIONES_DIR:-/printflow-db/migrations}
BD=${PGDATABASE:-${POSTGRES_DB:-printflow}}
PGUSER=${PGUSER:-${POSTGRES_USER:-postgres}}
export PGUSER
ORIGEN=${MIGRAR_ORIGEN:-migrar}
TEMPORAL=printflow_adopcion_tmp
SQLSTATE_YA_EXISTE='42P07 42701 42710 42723 42P06'

aviso() { echo "PrintFlow: $*"; }
falla() { echo "PrintFlow: ERROR: $*" >&2; exit 1; }

# Una consulta que devuelve un valor (sin encabezados)
valor() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$BD" -c "$1"; }

migraciones() {
  for f in "$DIR"/*.sql; do
    [ -e "$f" ] || continue
    nombre=$(basename "$f")
    case $nombre in
      *[!A-Za-z0-9_.-]*) falla "nombre de migración no permitido: '$nombre' (solo letras, números, _ - .)" ;;
    esac
    echo "$nombre"
  done
}

# Líneas de SQL que no son comentario
sin_comentarios() { grep -v -E '^[[:space:]]*--' "$1" || true; }

revisar_archivo() {
  if sin_comentarios "$1" | grep -q -i -E '^[[:space:]]*(begin|commit|rollback|start[[:space:]]+transaction)[[:space:]]*;'; then
    falla "$(basename "$1") tiene BEGIN/COMMIT propios: quítalos, migrar.sh ya la aplica en una transacción"
  fi
  if sin_comentarios "$1" | grep -q -i -w 'concurrently'; then
    falla "$(basename "$1") usa CONCURRENTLY, que no puede ir dentro de una transacción"
  fi
}

cambia_datos() {
  sin_comentarios "$1" | grep -q -i -E '(^|[[:space:];(])(insert|update|delete|copy|truncate|merge)[[:space:]]'
}

existe_control() { [ "$(valor "SELECT to_regclass('public.schema_migrations') IS NOT NULL")" = "t" ]; }

aplicada() { [ -n "$(valor "SELECT 1 FROM public.schema_migrations WHERE nombre = '$1'")" ]; }

CREAR_CONTROL="CREATE TABLE IF NOT EXISTS public.schema_migrations (
  nombre      varchar(255) PRIMARY KEY,
  aplicada_en timestamp with time zone NOT NULL DEFAULT now(),
  origen      varchar(20)  NOT NULL DEFAULT 'migrar'
);
COMMENT ON TABLE public.schema_migrations IS 'Migraciones de db/migrations ya aplicadas (db/migrar.sh). origen: init, migrar, adopcion o marcada';"

# Crea la tabla de control y registra los nombres dados, todo en una transacción
registrar() {
  origen=$1; shift
  {
    echo "$CREAR_CONTROL"
    for n in "$@"; do
      echo "INSERT INTO public.schema_migrations (nombre, origen) VALUES ('$n', '$origen') ON CONFLICT (nombre) DO NOTHING;"
    done
  } | psql -X -q -v ON_ERROR_STOP=1 --single-transaction -d "$BD" >/dev/null
}

# --- Adopción (ver arriba) ---------------------------------------------------------------------
borrar_temporal() {
  psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $TEMPORAL" >/dev/null 2>&1 || true
}

# Resumen del esquema de la base temporal. Sin comentarios ni las líneas \restrict/\unrestrict, que
# pg_dump 17.6+ escribe con una clave al azar en cada volcado.
huella() {
  pg_dump --schema-only --no-owner --no-privileges -d "$TEMPORAL" \
    | grep -v -E '^(--|[\]restrict |[\]unrestrict |$)' | md5sum | cut -d' ' -f1
}

adoptar() {
  aviso "la base '$BD' ya tiene tablas pero no tiene schema_migrations: se averigua qué migraciones ya tiene."
  aviso "(se prueban en una copia vacía de su esquema, '$TEMPORAL'; la base real no se toca)"
  trap borrar_temporal EXIT
  borrar_temporal
  psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $TEMPORAL TEMPLATE template0" >/dev/null
  pg_dump --schema-only --no-owner --no-privileges -d "$BD" \
    | psql -X -q -v ON_ERROR_STOP=1 -d "$TEMPORAL" >/dev/null
  # Sin cambios, dos volcados seguidos deben dar lo mismo; si no, la comparación no sirve
  [ "$(huella)" = "$(huella)" ] || falla "el volcado del esquema no es estable: no se puede adoptar la base sola"

  ya=""; dudosas=""
  for nombre in $(migraciones); do
    f="$DIR/$nombre"
    revisar_archivo "$f"
    antes=$(huella)
    if salida=$(psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose --single-transaction -d "$TEMPORAL" -f "$f" 2>&1); then
      if [ "$antes" != "$(huella)" ]; then
        echo "  $nombre: pendiente (cambia el esquema)"
      elif cambia_datos "$f"; then
        echo "  $nombre: DUDOSA (no cambia el esquema, pero cambia datos: no se sabe si ya corrió)"
        dudosas="$dudosas $nombre"
      else
        echo "  $nombre: ya estaba (no cambia nada)"
        ya="$ya $nombre"
      fi
    else
      codigo=$(printf '%s\n' "$salida" | sed -n 's/.*ERROR: *\([0-9A-Z]\{5\}\):.*/\1/p' | head -n 1)
      case " $SQLSTATE_YA_EXISTE " in
        *" $codigo "*)
          echo "  $nombre: ya estaba ($(printf '%s\n' "$salida" | grep -m 1 'ERROR' | sed 's/.*ERROR: *//'))"
          ya="$ya $nombre" ;;
        *)
          echo "  $nombre: DUDOSA, error inesperado al probarla:"
          printf '%s\n' "$salida" | grep -E 'ERROR|LINE|DETAIL' | head -n 5 | sed 's/^/      /'
          dudosas="$dudosas $nombre" ;;
      esac
    fi
  done
  borrar_temporal
  trap - EXIT

  if [ -n "$dudosas" ]; then
    echo
    echo "PrintFlow: no se adoptó la base: hay migraciones que no se pueden decidir solas:$dudosas"
    echo "  Revisa en la base si cada una ya está aplicada. Luego registra TODAS las que ya están"
    echo "  (las «ya estaba» de arriba más las dudosas que sí estén) y vuelve a correr el script:"
    echo "    sh /printflow-db/migrar.sh --marcar$ya <dudosas-que-ya-estén>"
    echo "  No se cambió nada en la base."
    exit 1
  fi

  # shellcheck disable=SC2086 # nombres validados: sin espacios
  registrar adopcion $ya
  aviso "adopción lista: $(echo "$ya" | wc -w) migraciones registradas como ya aplicadas."
}

# --- Comandos ----------------------------------------------------------------------------------
estado() {
  if ! existe_control; then
    aviso "la base '$BD' todavía no tiene schema_migrations (la próxima ejecución la crea o la adopta)."
    migraciones | sed 's/^/  ?  /'
    return 0
  fi
  pendientes=0
  for nombre in $(migraciones); do
    if aplicada "$nombre"; then
      echo "  ok  $nombre"
    else
      echo "  --  $nombre   (pendiente)"
      pendientes=$((pendientes + 1))
    fi
  done
  archivos="''"
  for nombre in $(migraciones); do archivos="$archivos, '$nombre'"; done
  valor "SELECT '  registradas sin archivo: ' || string_agg(nombre, ', ' ORDER BY nombre)
         FROM public.schema_migrations WHERE nombre NOT IN ($archivos) HAVING count(*) > 0"
  aviso "$pendientes pendiente(s)."
}

marcar() {
  [ $# -gt 0 ] || falla "uso: migrar.sh --marcar 0NN_nombre.sql [...]"
  for n in "$@"; do
    [ -e "$DIR/$n" ] || falla "no existe $DIR/$n"
  done
  registrar marcada "$@"
  aviso "registradas como aplicadas (sin ejecutarlas): $*"
}

aplicar() {
  if ! existe_control; then
    if [ "$(valor "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")" -gt 0 ]; then
      adoptar
    else
      registrar "$ORIGEN"
    fi
  fi

  hechas=0
  for nombre in $(migraciones); do
    aplicada "$nombre" && continue
    f="$DIR/$nombre"
    revisar_archivo "$f"
    aviso "aplicando $nombre"
    if ! psql -X -q -v ON_ERROR_STOP=1 --single-transaction -d "$BD" -f "$f" \
        -c "INSERT INTO public.schema_migrations (nombre, origen) VALUES ('$nombre', '$ORIGEN')"; then
      falla "falló $nombre: se deshizo entera y no se aplicaron las siguientes. Corrígela y vuelve a correr el script."
    fi
    hechas=$((hechas + 1))
  done

  if [ "$hechas" -eq 0 ]; then
    aviso "la base '$BD' está al día: no hay migraciones pendientes."
  else
    aviso "$hechas migración(es) aplicada(s)."
  fi
}

migraciones >/dev/null   # valida los nombres antes de empezar (aquí falla() sí detiene el script)

case "${1:-}" in
  "") aplicar ;;
  --estado) estado ;;
  --marcar) shift; marcar "$@" ;;
  *) falla "opción desconocida: $1 (usa --estado o --marcar)" ;;
esac
