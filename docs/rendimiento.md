# Rendimiento del consolidado con 500 máquinas (S4-05)

**Criterio:** `GET /api/reportes/consolidado/:clienteId/:periodo` responde en **menos de 5 s** con 500 máquinas.

**Resultado:** se cumple con mucho margen, antes y después de optimizar. El cliente más grande (99 máquinas) responde en unos **0,1 s** y los 20 clientes juntos, uno tras otro, en poco más de **1 s**. Igual se optimizó la consulta: su parte en la base tarda **la mitad** y ya no recorre las tablas enteras, así que no crece con los meses acumulados. **Los resultados no cambian:** los 1 000 consolidados del escenario grande y los 40 del normal (con un reemplazo) dan exactamente lo mismo, byte por byte, y Colegio Horizonte de octubre de 2026 sigue en **$395,48**.

## Escenario de prueba

`simulador/lib/escenarioGrande.js` (opción `--maquinas 500`; ver `simulador/README.md`):

- **500 máquinas entre 20 clientes:** los 2 de la demo, sin cambios, y 18 «Cliente de carga». El más grande, **Cliente de carga 01**, tiene **99 máquinas**; los demás, entre 23 y 24.
- Los tres formatos de correo, en partes iguales. Las máquinas `csv-cuentas` traen 3 cuentas de usuario cada una.
- Todos los lotes pasan por la ingesta y la aprobación de verdad (`demo.js`), sin errores:

| Historial | Meses | `reportes_oficiales` | `reportes_detalle_oficial` | Lotes aprobados |
|---|---|---|---|---|
| 10 meses | 2026-01 a 2026-10 | 5 000 | 5 010 | 200 |
| 24 meses | 2026-01 a 2027-12 | 12 000 | 12 024 | 480 |

Se midió en una PC con Windows y Docker Desktop (PostgreSQL 17 en contenedor), **con otros entornos de Docker corriendo a la vez**. Por eso los tiempos por HTTP varían bastante de una corrida a otra (abajo van los rangos). La comparación fina de la consulta se hizo con `pgbench`, dentro del contenedor de la base.

## Tiempos por HTTP (lo que ve el usuario)

`docker compose run --rm simulador medir-consolidado.js --maquinas 500 --periodo <período>`: mediana de 5 o 9 llamadas por cliente, después de una de calentamiento.

| Historial · período | Medición | Antes | Después | Criterio < 5 s |
|---|---|---|---|---|
| 10 meses · 2026-10 | Cliente más grande (99 máquinas) | 104 ms | 126 ms | cumple |
| 10 meses · 2026-10 | 20 clientes, uno tras otro | 1 915 ms | 1 344 ms | cumple |
| 10 meses · 2026-10 | 20 clientes a la vez | 780 ms | 550 ms | cumple |
| 24 meses · 2027-12 (3 corridas) | Cliente más grande (99 máquinas) | 131 ms (119 a 182) | 76 ms (61 a 115) | cumple |
| 24 meses · 2027-12 (3 corridas) | 20 clientes, uno tras otro | 1 204 ms (1 132 a 2 004) | 1 198 ms (861 a 1 258) | cumple |
| 24 meses · 2027-12 (3 corridas) | 20 clientes a la vez | 279 ms (234 a 291) | 398 ms (345 a 1 101) | cumple |

Por HTTP, la diferencia entre antes y después queda dentro del ruido: a este volumen, cada llamada pesa unos 50 a 100 ms y la mayor parte se va en planificar la consulta y en la red de Docker. Lo importante es que el cliente más grande queda **unas 40 veces por debajo de los 5 s**, y los 20 clientes juntos, uno tras otro, en **menos de la mitad**.

## Tiempos de la consulta en la base

La consulta principal del consolidado de **Cliente de carga 01** (99 máquinas) se midió con `pgbench -t 30`, con la latencia promedio, planificación incluida. Hubo 4 rondas intercaladas con el historial de 24 meses, y se muestra la mediana de las rondas:

| Consulta | Sin los índices de la 020 | Con los índices de la 020 |
|---|---|---|
| Antes (CTE `unique_reports` y sumas de detalle de toda la tabla) | 126 ms | 100 ms |
| Después (filtro en la consulta principal y sumas por reporte) | 63 ms | **54 ms** |

`EXPLAIN (ANALYZE, BUFFERS)` de la misma consulta (24 meses):

| | Antes | Después |
|---|---|---|
| Planificación | 51 ms | 52 ms |
| Ejecución | 117 ms | **37 ms** |
| Páginas leídas (`shared hit`) | 1 800 | 1 015 |
| `reportes_oficiales` | `Seq Scan` de las 12 000 filas para volver a unir el CTE | `Index Scan` de las 99 filas del cliente y período |
| `reportes_detalle_oficial` | 2 `HashAggregate` de las 12 024 filas: el actual y el anterior | `Aggregate` por reporte con `idx_detalle_oficial_reporte` (99 + 99 búsquedas) |
| Asignación del período (`LATERAL` sobre `instalaciones`) | 2 veces por reporte: CTE y consulta principal | 1 vez por reporte |

Con 10 meses, la proporción es la misma: antes, de 126 a 141 ms; después, de 71 a 80 ms.

## Qué se cambió

1. **`db/migrations/020_indices_consolidado.sql`** (se puede aplicar más de una vez):
   - `reportes_oficiales (cliente_id, periodo)`: los **períodos disponibles** de un cliente pasan a un `Index Only Scan` sin ordenar. En el consolidado, el planificador todavía elige `idx_reportes_periodo` con filtro por cliente, porque con 20 clientes cuestan casi lo mismo. Con muchos más clientes por período, el índice compuesto es el que conviene.
   - `instalaciones (maquina_id, fecha_instalacion)`: la entrante de un reemplazo (`ORDER BY fecha_instalacion LIMIT 1`) sale del índice sin ordenar.
   - `reportes_detalle_oficial (reporte_oficial_id)` **ya existía** (`idx_detalle_oficial_reporte`, migración 001): no se duplicó.
2. **`getReporteConsolidado`** (`src/models/reportemes/reportemes.model.js`):
   - Se quitó el CTE `unique_reports`. Calculaba la asignación del período solo para filtrar, y después la consulta principal la volvía a calcular y unía con un recorrido completo de `reportes_oficiales`. El filtro por cliente, período, área y máquina va ahora en el `WHERE` de la consulta principal. Es la misma condición, sobre las mismas columnas.
   - Las sumas de los detalles por usuario (actual y anterior) eran subconsultas con `GROUP BY` sobre **toda** la tabla `reportes_detalle_oficial`, y crecían con cada mes y cada cliente. Ahora son `LEFT JOIN LATERAL` por reporte. Sin detalle, las sumas siguen en `NULL`, igual que antes.

## Que los resultados no cambian

- **Escenario grande (24 meses):** con `getReporteConsolidado` de antes y de después se generaron **1 000 consolidados**: 20 clientes × 10 períodos, sin filtro, por 2 áreas y por 2 máquinas. Los dos JSON son **idénticos** (`cmp`, 9,4 MB cada uno).
- **Escenario normal**, con la base recreada desde cero y la migración 020 aplicada al iniciar:
  - las respuestas HTTP del consolidado de Horizonte y Andina, de septiembre y octubre (y Horizonte por área), son **idénticas byte por byte** a las de antes del cambio;
  - Colegio Horizonte de 2026-10 sigue en **$395,48** (B/N: $100 + $224; color: $50 + $21,48), con el mismo `resumen.facturacion`.
- **Con un reemplazo** (SIMB0002 → SIMF0006, noviembre de 2026, registrado por la API y aprobado), los 40 consolidados del escenario normal dan **idénticos** antes y después. Horizonte de noviembre: $388,87, con 1 cambio.
- **Después de actualizar con `develop`** (tarifas congeladas al aprobar y anulación de reemplazos):
  - se repitió la comparación con el modelo de `develop`: los 40 consolidados del escenario normal (con el reemplazo) y los 300 del escenario grande con 3 meses dan **idénticos**, y Horizonte de octubre sigue en $395,48;
  - en esa corrida, con la PC sin otros entornos, el cliente más grande respondió en **28 ms**, los 20 clientes uno tras otro en **381 ms** y los 20 a la vez en **201 ms**.

## Lo que queda

- **Planificar** la consulta cuesta unos 50 ms, que hoy son la mitad del tiempo de cada llamada: tiene más de 15 uniones. Si algún día hace falta bajar de ahí, se puede usar una sentencia preparada con nombre, para que PostgreSQL reutilice el plan. Probado con `pgbench -M prepared`: de 77 a 46 ms. No se hizo porque el criterio ya se cumple con mucho margen.
- `INSTALACION_DEL_PERIODO` (la asignación de la máquina en el período) es ahora lo más caro de la ejecución: un `LATERAL` con orden por reporte, alrededor de 0,3 ms por máquina. Lo comparte el informe por usuario. No se tocó para no cambiar sus reglas.

## Cómo repetirlo

```powershell
docker compose down -v
docker compose up -d --build db api web
docker compose run --rm -T simulador preparar-datos.js --maquinas 500 | docker compose exec -T db psql -U postgres -d printflow
docker compose run --rm simulador demo.js --maquinas 500 --desde 2026-01 --hasta 2026-10 --sin-errores   # unos 4 minutos
docker compose run --rm simulador medir-consolidado.js --maquinas 500 --periodo 2026-10
```

Para el plan de la consulta: `EXPLAIN (ANALYZE, BUFFERS)` + la consulta de `getReporteConsolidado`, con `$1` = id del cliente, `$2` = período y `$3` = período anterior, en `docker compose exec db psql -U postgres -d printflow`.
