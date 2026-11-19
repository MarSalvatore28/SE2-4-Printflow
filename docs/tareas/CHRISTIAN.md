# Tareas de Christian · Equipo C

Te toca **lo que se factura**: que el consolidado deje de salir en $0 (S3-06), que una tarifa nueva no cambie los meses ya cerrados, poder anular un reemplazo y que el informe responda en menos de 5 segundos con 500 máquinas (S4-05). Nada depende de otra persona: el formato de la respuesta del importe ya está acordado con Gabriela (ver `README.md`).

| # | Tarea | Puntos | Para cuándo | Rama |
|---|---|---|---|---|
| 1 | **S3-06 · Cálculo del importe del consolidado** | 8 | 10 dic | `feature/f3-importe` |
| 2 | Congelar las tarifas al aprobar | 1 | 13 dic | `feature/f3-tarifas-congeladas` |
| 3 | **Anular un reemplazo de máquina** | 3 | 13 dic | `feature/f3-anular-reemplazo` |
| 4 | **S4-05 · Rendimiento: menos de 5 s con 500 máquinas** | 2 | 20 dic | `feature/f4-rendimiento` |
| 5 | Endpoints 501 de reportes y limpieza | 1 | 20 dic | `fix/reportes-pendientes` |

Tus migraciones van de `020` a `029`.

---

## 1. S3-06 · Cálculo del importe

**Dónde:** `src/models/reportemes/reportemes.model.js` (`getReporteConsolidado`). Hoy el importe es `gran_total × snap_costo_impresion_bn` (cerca de la línea 285): está mal y sale en $0. El **consumo ya está bien** y verificado a mano, incluidos los reemplazos. No lo cambies.

**Regla** (recomendada; confírmala con el PO en la próxima reunión): **cuota fija + excedente, por contrato y por mes.**
- **Cuota fija:** `incluidas × costo`. Se cobra completa aunque no se usen las páginas.
- **Excedente:** `max(0, consumo − incluidas) × costo_excedente`.
- Se calcula **por separado para B/N y color**, sumando el consumo de **todas las máquinas del cliente bajo ese contrato** en el período (`instalaciones.contrato_id`). No por máquina.
- `contratos.facturacion_de_impresora`:
  - «Diferenciar B/N de Color»: lo de arriba.
  - «Todo como color»: todas las páginas (B/N + color) cuentan como color.
- **Renta:** suma de `instalaciones.costo_renta_mensual` de las asignaciones vigentes en el período. Ya hay una consulta de renta en el mismo modelo (`rentaEquipos`); reutilízala.
- **Total del contrato:** cuotas fijas + excedentes + renta.

Columnas en `contratos`: `impresiones_bn_incluidas`, `impresiones_color_incluidas`, `costo_impresion_bn`, `costo_impresion_color`, `costo_x_excedente_impresion_bn`, `costo_x_excedente_impresion_color` y `facturacion_de_impresora`.

**Respuesta (acordada con Gabriela, no la cambies sin avisarle):** `resumen.facturacion[]` (un elemento por contrato), `resumen.monto_total_general` y, por máquina, `financiero.monto_referencial` (= consumo × tarifa por página, solo informativo). La forma exacta está en `README.md`, «Contratos compartidos», punto 2. Los montos van como texto con 2 decimales.

**Cómo hacerlo bien:**
- Pon el cálculo en una **función pura** (por ejemplo `src/utils/facturacion.js`) que reciba consumos y contrato y devuelva el desglose. Así se prueba sin base de datos, como `src/utils/maquinasCambio.consumo.js`.
- **Tests con números a mano** en `test/facturacion.test.js`, al menos 6 casos:
  - por debajo de las incluidas;
  - justo en las incluidas;
  - con excedente (1 000 incluidas, consumo de 1 200, excedente a $0,025 → cuota + $5);
  - «Todo como color»;
  - con renta;
  - dos máquinas del mismo contrato que juntas superan las incluidas.
- **Prueba con la demo:** Colegio Horizonte, octubre de 2026, debe dar **$395,48**:
  - B/N: 5 000 × 0,02 = $100 y 8 960 × 0,025 = $224;
  - color: 500 × 0,10 = $50 y 179 × 0,12 = $21,48.

  Compruébalo y déjalo en el PR.
- El **filtro por área o por máquina** del consolidado: la facturación sigue siendo la del contrato completo (acláralo en la respuesta con un campo `filtrado: true`) o se recalcula solo con lo filtrado. Decide y documenta.

## 2. Congelar las tarifas al aprobar

`reportes_oficiales` tiene `snap_costo_impresion_*`, `snap_costo_copia_*` y `fecha_congelacion`, pero nadie los llena. Al aprobar un lote (`approveStagingBatch`), copia las tarifas del contrato vigente. El importe de meses ya aprobados usa esas tarifas congeladas: si mañana cambia el contrato, octubre no cambia.

**Prueba:** aprueba octubre, cambia la tarifa del contrato y comprueba que el consolidado de octubre da lo mismo.

**Coordina con Samuel:** él también toca `approveStagingBatch` (fallo 3 de su lista). Son cambios en partes distintas de la misma consulta; el que mergee segundo, rebasa.

## 3. Anular un reemplazo

Hoy no se puede deshacer un reemplazo registrado por error.
- **`POST /api/maquinas-cambio/:id/anular`** (`requireRole('admin')`), en **una transacción**:
  - reactiva la asignación de la saliente (`activo = true`, `fecha_retiro = NULL`);
  - retira o borra la de la entrante;
  - marca el cambio como anulado (columna `anulado` o `estado`: migración `021_...`);
  - borra o anula las cabeceras de contadores.
- **Solo si el período no tiene lecturas aprobadas** con ese cambio; si las tiene → 409.
- Todo lo que liste o use reemplazos debe ignorar los anulados.
- **Frontend:** botón «Anular» en Máquinas → Reemplazos, solo para el admin (`usePermisos().puedeEditarCatalogos`), con `ModalConfirmacion`.
- **Prueba:** registra y anula, y comprueba que las asignaciones vuelven a como estaban.

## 4. S4-05 · Rendimiento con 500 máquinas

1. **Datos:** amplía el simulador para generar un escenario grande, por ejemplo `simulador/escenario-grande.json` o una opción `--maquinas 500` que reparta 500 máquinas entre 20 clientes. Que `preparar-datos.js` y `generar-correos.js` lo acepten.
2. **Mide** `GET /api/reportes/consolidado/:clienteId/:periodo` para el cliente más grande y para todos. Usa `EXPLAIN ANALYZE` en las consultas del consolidado.
3. **Optimiza:** índices en la migración `020_indices_consolidado.sql`. Por ejemplo, `reportes_oficiales (cliente_id, periodo)`, `reportes_detalle_oficial (reporte_oficial_id)` y `instalaciones (maquina_id, fecha_instalacion)`. Reescribe subconsultas si hace falta.
4. **Criterio:** menos de 5 s con 500 máquinas. Deja en el PR la tabla de tiempos antes y después.

## 5. Endpoints 501 y limpieza

- `GET /api/reportes/periodo/:periodo` y `GET /api/reportes/cliente/:id` responden **501**. Impleméntalos o bórralos, junto con sus rutas y su Swagger.
- **Borra** `src/services/maquina_asignacion/` y `src/types/maquina_asignacion/` del **frontend**: nadie los importa (caja 6, mejora 3.4). Comprueba con `npm run build`.
- `src/config/swagger.js`: el título dice «BackContadores API» y el servidor, `http://localhost:3000`. Pon «PrintFlow API» y quita el servidor fijo.
