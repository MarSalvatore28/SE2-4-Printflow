# Tareas de Roberto · Equipo B

Te toca registrar contadores a mano cuando una impresora no manda su correo (S3-04) y volver a intentar los reportes con error (S3-05). **No esperas a Samuel:** la función `validarLectura` ya existe con su contrato fijado (`src/services/validacionLecturas.js`). Hoy acepta todo; cuando Samuel termine S3-01, tu código empieza a rechazar sin que cambies nada.

| # | Tarea | Puntos | Para cuándo | Rama |
|---|---|---|---|---|
| 1 | **S3-04 · Lectura manual** | 3 | 6 dic | `feature/f3-lectura-manual` |
| 2 | **S3-05 · Reprocesar reportes con error** | 3 | 13 dic | `feature/f3-reprocesar` |
| 3 | Fallo del historial de cambios de un área | 1 | 13 dic | `fix/area-historial` |

Tus migraciones van de `030` a `039`. Las dos primeras tareas tocan los **dos repos**.

---

## 1. S3-04 · Lectura manual

**Para qué:** si una impresora no envió su correo, el operador registra los contadores leídos en la máquina, en **menos de 3 minutos**.

**Backend:**
- **Migración `030_lectura_manual.sql`:** en `reportes_oficiales` agrega `origen varchar(10) NOT NULL DEFAULT 'CORREO'` (valores `'CORREO'` y `'MANUAL'`), `observacion text` y `usuario_registro_id integer`.
- **`POST /api/lecturas/manual`**, con `requireRole('admin', 'operador')`. Recibe `{ instalacion_id, fecha_lectura, contador_bn, contador_color, observacion }`; la observación es **obligatoria**.
  1. Busca la asignación vigente: máquina, cliente, área e IP. Si no existe o no está vigente en esa fecha → 400.
  2. El período es el mes de `fecha_lectura`.
  3. Llama a `validarLectura(db, { maquinaId, instalacionId, periodo, fecha, contadorBn, contadorColor })`. Si devuelve un motivo → **400** con ese motivo, tal cual.
  4. Inserta en `reportes_oficiales` con `origen = 'MANUAL'`, `usuario_registro_id = req.user.id`, los contadores en `contador_impresiones_bn/color` (totales B/N y color, como la ingesta) y los `snap_*` de la máquina y el área.
  5. Responde 201 con la lectura creada.
- Archivos: `src/{models,controllers,routes}/lectura/`, montados con 2 líneas `// [B-F3]` en `app.js`, junto a las de Fase 3.
- **Tests** (`test/lecturaManual.test.js`) de las validaciones de entrada, sin base de datos.

**Frontend:**
- **Pantalla «Lectura manual»:** ruta `/lecturas` y entrada de menú, con líneas `// [B-F3]` en `App.tsx` y `modulos.data.ts`, `roles: ['admin', 'operador']`.
- **Formulario:**
  - buscador de la **asignación vigente** por serie, cliente o IP (usa `/api/instalacion/instalaciones/activas`);
  - fecha (hoy por defecto) y contadores B/N y color;
  - observación obligatoria.
- **Al elegir la máquina,** muestra su última lectura aprobada como referencia: ya existe `GET /api/maquinas-cambio/ultima-lectura/:maquinaId?periodo=`.
- **Si la API responde un motivo** («Retroceso de contador…»), muéstralo junto al formulario. Servicio con `apiFetch`.
- **Cronometra** el registro (de abrir la pantalla a guardar) y deja el tiempo en el PR. El criterio es menos de 3 minutos.

**Cómo probarlo:**
- Con la demo cargada, registra una lectura de noviembre para SIMA0001 y comprueba que el consolidado de noviembre la usa.
- Prueba el operador (puede) y el auditor (403 y no ve el menú).

## 2. S3-05 · Reprocesar reportes con error

**Para qué:** un reporte que entró en **ERROR** (máquina no autorizada o lectura inválida) se puede volver a validar después de corregir la causa, por ejemplo registrar la máquina o su asignación. **Máximo 3 intentos.**

**Backend:**
- **Migración `031_intentos_reproceso.sql`:** `intentos_reproceso integer NOT NULL DEFAULT 0` en `reportes_consolidado_staging`.
- **`POST /api/staging/:id/reprocesar`** (`requireRole('admin', 'operador')`), sobre un reporte de staging en ERROR (`procesar_lectura = false`):
  1. Si `intentos_reproceso >= 3` → **409** «Máximo de intentos alcanzado: descarte o corrija manualmente».
  2. Suma 1 a los intentos.
  3. **Vuelve a buscar la máquina por serie** y su asignación vigente, con la misma regla que la ingesta en `src/controllers/ingesta/ingesta.controller.js`. Sácala a una función compartida si la necesitas.
  4. Si ahora está autorizada, llama a `validarLectura`.
  5. Si todo está bien: `procesar_lectura = true`, `estado_maquina` recupera su estado, `mensaje_aviso = NULL` y se completan `maquina_id_tentativa` y `cliente_id_tentativo`. Si no: sigue en ERROR con el motivo nuevo.
  6. Responde el reporte actualizado y los intentos («2 de 3»).

**Frontend:**
- En **Notificaciones → Lotes → Ver detalle** (`src/app/Notificaciones/components/DetalleLoteModal.tsx`): por cada reporte en ERROR, un botón **«Reprocesar (n de 3)»**, solo para admin y operador (`usePermisos()`).
- Al tercer fallo, el botón se reemplaza por **«Descartar»**, que rechaza el lote (ya existe) y **«Lectura manual»**, que lleva a `/lecturas` con la máquina elegida.
- Después de reprocesar, refresca la validación del lote: si ya no hay errores, se puede aprobar.

**Cómo probarlo:**
- Genera octubre con `--errores` (el lote de `SIMX9999` queda en Error).
- Crea la máquina SIMX9999 en **Máquinas** y asígnala a un área de un cliente con contrato.
- Reprocesa: el reporte pasa a correcto.
- Repite con una máquina que siga sin asignar hasta llegar al tercer intento.

## 3. Fallo del historial de cambios de un área

`src/models/area/area.model.js` (líneas 359, 387 y 389) une `historial_ubicaciones` y `historial_maquinas` por `cambio_id`, una columna que **no existe**. Por eso `GET /api/areas/:id/historial-cambios` falla.
- Revisa el esquema (`db/migrations/001_esquema_inicial.sql`) y une por la columna correcta, o devuelve el historial a partir de `maquinas_cambio` (los reemplazos), que es lo que hoy se usa.
- Agrega un test o prueba el endpoint con curl y deja la salida en el PR.
