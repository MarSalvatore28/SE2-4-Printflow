# Tareas de Samuel · Equipo C (líder técnico backend)

Te toca **lo más delicado del backend**: que el sistema rechace las lecturas malas (S3-01), que quede registro de quién cambió qué (S3-02), la prueba de punta a punta con el PO (S4-06) y, con Christian, **publicar el sistema en internet** (S4-04). Ninguna depende de otra persona: el contrato de `validarLectura` ya está fijado (ver `docs/tareas/README.md`).

> **Necesitamos dejar esto listo ya. Lo hacemos ahora, empezando por la tarea 1.** No hay fecha de entrega: es urgente para el medio parcial.
> Una tarea está **terminada** solo cuando tiene las 4 cosas:
> 1. **Tus commits** en tu rama (uno por mejora, a tu nombre).
> 2. Un **PR a `develop`** con «Cómo probarlo» completo.
> 3. El **CI en verde** (`test`, `docker` y `smoke`).
> 4. Una **prueba de que funciona** con datos del simulador: la salida de los tests y una captura o un video corto en el PR.

| # | Tarea | Puntos | Rama |
|---|---|---|---|
| 1 | **S3-01 · Validaciones de lecturas** | 5 | `feature/f3-validaciones` |
| 2 | **S3-02 · Auditoría** | 3 | `feature/f3-auditoria` |
| 3 | Tests de login y seguridad (caja 3, mejora 3.5) | 2 | `test/f0-login` |
| 4 | Cuatro fallos del backend (abajo) | 2 | `fix/staging-ingesta` |
| 5 | **S4-06 · Prueba E2E y defectos de la UAT con el PO** | 3 | `feature/f4-e2e` |
| 6 | **S4-04 · Despliegue en Azure: puesta en marcha y migraciones** (con Christian) | 3 | `feature/f4-migraciones-produccion` |

Tus migraciones van de `010` a `019`.

---

## 1. S3-01 · Validaciones de lecturas

**Qué existe:** `src/services/validacionLecturas.js` con la firma y el contrato (léelo entero). Hoy devuelve `null`. La lectura manual y el reprocesar (los hace Marlo) ya lo llaman. **No cambies la firma.**

**Qué hacer:**
1. **Implementa las 3 reglas en `validarLectura(db, lectura)`.** Las lecturas aprobadas están en `reportes_oficiales`, con `contador_impresiones_bn` y `contador_impresiones_color`, que son los totales B/N y color acumulados.
   - **RETROCESO:** el contador es menor que el de la última lectura aprobada de esa máquina en un período anterior. Motivo: «Retroceso de contador: B/N 12.000 < 12.500 (lectura de 2026-10)».
   - **SALTO_ANOMALO:** el incremento contra la última lectura supera `UMBRAL_SALTO × promedio` de los incrementos de los últimos 6 meses (`UMBRAL_SALTO` en `.env`, 3 por defecto; agrégalo a `.env.example`). Sin historial suficiente (menos de 2 meses), no se aplica.
   - **DUPLICADA:** ya existe en `reportes_oficiales` una lectura de esa máquina para ese período.
   - **Reemplazos:** si la máquina es la **entrante** de un reemplazo de ese período (`maquinas_cambio` y `cabecera_contadores_cambio`), su «lectura anterior» es su contador inicial registrado, no una lectura aprobada.
2. **Migración `010_lectura_unica.sql`:** índice único `(maquina_id, periodo)` en `reportes_oficiales`. Comprueba antes que la demo y los reemplazos no lo violan: en un reemplazo, saliente y entrante son máquinas distintas.
3. **Conéctalo a la ingesta** (`src/controllers/ingesta/ingesta.controller.js`): por cada reporte de una máquina autorizada, llama a `validarLectura`. Si devuelve un motivo, el reporte queda en **ERROR** como ya se hace con «Máquina no autorizada»: `estado_maquina = 'ERROR'`, `procesar_lectura = false` y `mensaje_aviso = motivo`. Así se ve en las alertas del lote, el lote no se puede aprobar y se puede reprocesar.
4. **Vuelve a validar al aprobar** (`approveStagingBatch` o `validarLoteStaging`): entre la ingesta y la aprobación pudo aprobarse otra lectura. Si alguna falla, la aprobación responde 409 con el motivo.
5. **Tests unitarios de las 3 reglas** en `test/validacionLecturas.test.js`, con un `db` simulado (un objeto con `query` que devuelve filas preparadas), sin base de datos. No toques `validacionLecturas.contrato.test.js`.

**Cómo probarlo:**
- **RETROCESO:** con datos de la demo (agosto a octubre aprobados), arma a mano un correo de noviembre con un contador menor que el de octubre. Puedes editar un `.eml` generado o agregar una opción al simulador: por ejemplo `--retroceso SIMA0001`.
- **DUPLICADA:** reenvía un lote del mismo mes con otro `Message-ID`.
- **SALTO_ANOMALO:** multiplica por 10 el consumo de una máquina.
- En los 3 casos el lote queda en «Error» con el motivo visible en **Notificaciones → Lotes → Ver detalle**.

## 2. S3-02 · Auditoría

1. **Migración `011_registro_auditoria.sql`:** `registro_auditoria (id, tabla, id_registro, accion, usuario_id, fecha, valor_anterior jsonb, valor_nuevo jsonb, ip)`, con índices por `(tabla, id_registro)` y por fecha.
2. **`src/services/auditoria.js`:** `registrarAuditoria(db, { tabla, idRegistro, accion, usuarioId, antes, despues, ip })`. Dentro de la transacción de quien llama, si la hay. Si falla la auditoría, falla la operación.
3. **Dónde se llama** (con `req.user.id` y `req.ip`):
   - alta y cambio de **contratos**;
   - alta, cambio y retiro de **asignaciones**;
   - **reemplazos**;
   - **aprobación y rechazo de lotes**;
   - alta, cambio y activación de **usuarios**;
   - alta de **lectura manual**: cuando se mergee la lectura manual, agrégale la línea en un PR aparte.
4. **Que la lectura tenga trazabilidad:** al aprobar, guarda en `reportes_oficiales.usuario_validacion_id` quién aprobó (ya está `req.user.id`), y que la respuesta de una lectura incluya `lote_origen_id` y `usuario_validacion_id`.
5. **No se hace** la pantalla de consulta de la bitácora (HU-12, fuera de alcance). Basta un `GET /api/auditoria?tabla=&id_registro=` solo para admin, para demostrarlo.

Avisa en el grupo antes de tocar los controladores de los demás. Son 1 o 2 líneas por endpoint.

## 3. Tests de login y seguridad

En `test/auth.test.js`, como pedía la caja 3. Al inicio pon `process.env.SECRET_KEY = 'test'` y `require('module-alias/register')`.
- `generateToken` y `verifyToken` devuelven el mismo `id`.
- Un token firmado con otra clave lanza error.
- `protect` sin cabecera responde 401 y con un token falso, también 401.
- `protect` agrega la cabecera `X-Nuevo-Token`.

## 4. Fallos del backend que son tuyos

Encontrados al integrar. Cada uno va en su commit:
1. **Fecha de corte en UTC:** la ingesta guarda `fecha_corte` a medianoche UTC, que en Ecuador es el día anterior a las 19:00. Por eso el informe dice «inicio del período 2026/11/01» en un reporte de octubre. Guárdala como fecha local (`America/Guayaquil`) o como `date`.
2. **`validarLoteStaging` toma el cliente del primer reporte** (`LIMIT 1`). Un lote con reportes de dos clientes se valida mal. Valida por cada cliente o rechaza lotes mixtos.
3. **`approveStagingBatch` no copia `snap_area_nombre` ni `contador_copias_*`** a `reportes_oficiales`. El consolidado de meses pasados depende de eso.
4. **`protect` copia el `rol` viejo dentro del token renovado.** El backend no lo usa porque consulta el rol en la base, pero si se cambia el rol de un usuario el dato queda desactualizado. Vuelve a leerlo o quítalo del token.

## 5. S4-06 · Prueba E2E y UAT (cierre del proyecto)

1. **Script E2E automatizado** en `test/e2e/`, que corra contra Docker:
   - base limpia, `preparar-datos.js` y correos de 3 meses;
   - aprobación por la API;
   - consolidado comparado contra el cálculo a mano del escenario (`simulador/lib/escenario.js` ya trae `contadoresAlCierre`);
   - un caso de cada validación de S3-01;
   - el reemplazo de noviembre.

   Que se pueda correr con un comando y documentarlo en `docs/`.
2. **UAT con el PO**: recorrido guiado y lista de defectos encontrados como issues. Corrige los que sean del backend.

## 6. S4-04 · Despliegue en Azure: puesta en marcha y migraciones (con Christian)

El despliegue es **del Equipo C**. Ya existe la configuración base, probada en local (`deploy/docker-compose.prod.yml`, `deploy/Caddyfile` y `deploy/backup.sh`), y la guía `docs/despliegue.md`. Tú la pones en marcha y resuelves lo que falta para mantenerla.

1. **Poner el sistema en internet** siguiendo `docs/despliegue.md`:
   - VM B2s Ubuntu en Azure for Students, con su etiqueta DNS;
   - `.env` de producción con claves nuevas;
   - `up -d --build` con el archivo de producción;
   - datos de la demo y **contraseñas nuevas** para los 3 usuarios.

   Si algo de la guía no funciona tal cual en la VM, **corrígelo en un commit**.
2. **Migraciones sobre una base que ya existe.** Hoy `docker/postgres/init.sh` solo aplica `db/migrations` y `db/seeds` al **crear** el volumen. En producción, tus migraciones `010`/`011` y las de Christian y las de la lectura manual **no se aplicarían**.
   - Crea una tabla `schema_migrations (nombre, aplicada_en)` y un script `db/migrar.sh` (o `npm run migrar`) que aplique en orden **solo las migraciones pendientes**, cada una en su transacción. Si una falla, se detiene.
   - Que `init.sh` registre también las que aplica, para que una base nueva y una migrada queden iguales.
   - Pruébalo: base creada con las migraciones de hoy, agregas una nueva, corres el script y se aplica solo esa. Si lo corres otra vez, no hace nada.
   - Documenta en `docs/despliegue.md`, sección 6, cómo actualizar con el script.
3. **Comprobación en producción:** la lista de la sección 7 de `docs/despliegue.md`, con capturas en el PR (candado HTTPS, login con los 3 roles, `/api/ingesta` → 403 y un respaldo restaurado).
