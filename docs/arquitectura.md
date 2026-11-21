# Arquitectura de PrintFlow

Cómo está armado el sistema por dentro: piezas, flujos, datos, seguridad y calidad. Para levantarlo y probarlo, ver [`probar.md`](probar.md); para producción, [`despliegue.md`](despliegue.md).

## 1. Piezas

```text
                   ┌─────────────────────────── Docker Compose ───────────────────────────┐
 Impresoras ─correo─▶ Buzón ─▶ n8n ──POST /api/ingesta/cargar──▶ api (Node + Express) ──▶ db (PostgreSQL 17)
                   │                     (red interna)               │  ▲    Socket.IO       ▲
                   │                                                 │  │ LISTEN/NOTIFY    │
 Navegador ──HTTPS─▶ (Caddy, solo en producción) ──▶ web (nginx + React) ──/api, /socket.io──┘
                   │                                                                      │
                   │  backup (pg_dump diario, copia a Azure Blob)  ·  mailpit (correo de prueba) │
                   └──────────────────────────────────────────────────────────────────────┘
```

| Servicio | Repo | Qué hace |
|---|---|---|
| `web` | Frontend | nginx sin root: sirve la SPA de React y reenvía `/api`, `/api-docs` y `/socket.io` a la API. Bloquea `/api/ingesta` desde fuera |
| `api` | Backend | Express 5: autenticación, reglas de negocio, consolidado y facturación, auditoría y avisos en tiempo real |
| `db` | Backend | PostgreSQL 17. Las migraciones de `db/migrations` se aplican al crear la base; las pendientes, con `npm run migrar` |
| `n8n` | Backend | Lee el buzón de DOX y envía los contadores a la ingesta. En desarrollo lo reemplaza el **simulador** (`simulador/`) |
| `caddy` | Backend (`deploy/`) | Solo en producción: HTTPS automático y cabeceras de seguridad |
| `backup` | Backend (`deploy/`) | Solo en producción: respaldo diario, retención de 30 días y copia a Azure Blob Storage |
| `mailpit` | Backend | Opcional: atrapa los correos de aviso para verlos en http://localhost:8025 |

## 2. Flujo principal: del correo a la factura

1. **Ingesta** (`src/controllers/ingesta/`): n8n (o el simulador) envía cada reporte con el token `INGESTA_TOKEN`. La API crea un **lote** en `lotes_carga` y sus reportes en `reportes_consolidado_staging` / `reportes_detalle_staging`. Un `Message-ID` repetido se descarta.
2. **Validación** (`src/services/autorizacionMaquina.js`, `src/services/validacionLecturas.js`): cada reporte se marca como **Lista** o **ERROR** con su motivo:
   - máquina no registrada o sin asignación vigente;
   - **RETROCESO**, el contador es menor que la última lectura aprobada;
   - **SALTO_ANOMALO**, el incremento supera `UMBRAL_SALTO` veces el promedio;
   - **DUPLICADA**, ya hay una lectura aprobada de esa máquina en el período.
3. **Aviso en tiempo real** (`src/socket.js`): la base emite `NOTIFY`, la API lo escucha y lo reenvía por Socket.IO; la campana de la web se actualiza. El operador también recibe un **correo** (`src/services/avisos.service.js`).
4. **Revisión**: un reporte en ERROR se puede **reprocesar** (hasta 3 intentos) o reemplazar con una **lectura manual**. Un lote con errores **no se puede aprobar** (409 con el motivo de cada máquina).
5. **Aprobación** (`approveStagingBatch`): las lecturas pasan a `reportes_oficiales` / `reportes_detalle_oficial`, con quién aprobó, el área y las **tarifas del contrato congeladas** (`snap_*`).
6. **Consolidado** (`src/models/reportemes/reportemes.model.js`): consumo del período por máquina (lectura actual − anterior; en un **reemplazo**, tramo de la saliente + tramo de la entrante) y por usuario.
7. **Facturación** (`src/utils/facturacion.js`): por contrato y por mes, **cuota fija + excedente** (B/N y color por separado, o «todo como color») **+ renta**. La pantalla de Informes, el PDF y el Excel muestran los mismos números.

## 3. Datos

| Grupo | Tablas |
|---|---|
| Catálogos | `clientes`, `contratos`, `areas`, `maquinas`, `modelos`, `tipos_impresion`, `tipos_formato_impresion` |
| Asignaciones y reemplazos | `instalaciones` (máquina ↔ área ↔ contrato, con fechas), `maquinas_cambio`, `cabecera_contadores_cambio` |
| Lecturas por aprobar | `lotes_carga`, `reportes_consolidado_staging`, `reportes_detalle_staging` |
| Lecturas aprobadas | `reportes_oficiales` (una por máquina y período: índice único), `reportes_detalle_oficial` |
| Usuarios y avisos | `usuarios`, `roles`, `notificaciones`, `tipos_notificacion`, `notificaciones_leidas` |
| Trazabilidad | `registro_auditoria` (quién, qué, cuándo, desde qué IP, antes y después), `schema_migrations` |

Las migraciones van numeradas por rangos (`docs/tareas/README.md`). Una vez en `main`, una migración no se edita: se agrega otra.

## 4. Backend por capas

| Carpeta | Responsabilidad |
|---|---|
| `src/routes/` | Rutas, permisos por rol (`requireRole`) y documentación Swagger |
| `src/controllers/` | Validan la petición y arman la respuesta HTTP |
| `src/models/` | Consultas SQL, siempre con parámetros (`$1`) y en transacción cuando hay varias escrituras |
| `src/services/` | Reglas compartidas: validación de lecturas, autorización de máquinas, auditoría, correo |
| `src/utils/` | Funciones puras con pruebas: facturación, consumo en reemplazos, fechas en hora de Ecuador, validaciones |
| `src/middlewares/` | `protect` (JWT), `requireRole`, token de la ingesta |

## 5. Seguridad

| Capa | Qué hay |
|---|---|
| Autenticación | JWT firmado con `SECRET_KEY` (propia de cada instalación), 30 min sin uso con renovación en cada respuesta (`X-Nuevo-Token`). Contraseñas con bcrypt |
| Autorización | Tres roles (admin, operador, auditor) leídos de la base en cada petición: un cambio de rol vale al instante |
| Ingesta | Token propio y solo desde la red interna de Docker: nginx responde 403 desde fuera |
| Datos | Consultas parametrizadas; auditoría de los cambios dentro de la misma transacción (si no se puede auditar, no se guarda) |
| Secretos | Nada en el repo: `npm run configurar` genera las claves de cada uno; las contraseñas de prueba se calculan al crear la base (`DEMO_PASSWORD`) |
| Contenedores | La API corre como `node`, la web con nginx sin root y los respaldos con su propio usuario; imágenes sin scripts de instalación |
| GitHub | `main` y `develop` protegidas (solo por PR con el CI y SonarCloud en verde, sin push forzado); alertas de Dependabot y escaneo de secretos activos |

## 6. Calidad y pruebas

| Qué | Dónde | Cuándo corre |
|---|---|---|
| Pruebas unitarias del backend | `test/*.test.js` (`npm test`) | En cada PR (CI `test`) |
| Prueba de humo | Base, migraciones, login y token con los 3 roles | En cada PR (CI `smoke`) |
| Prueba de punta a punta | `test/e2e/e2e.js` (`npm run e2e`): 3 meses de la demo, validaciones, reemplazo, seguridad y auditoría | A mano, antes de cada entrega ([`e2e.md`](e2e.md)) |
| Pruebas del frontend | Vitest (`npm test` del frontend) | En cada PR (CI `build`) |
| Lint del frontend | ESLint en 0 errores | En cada PR (bloquea) |
| Análisis estático | SonarCloud en los dos repos | En cada PR y en `main` (barrera de calidad) |
| Rendimiento | Consolidado con 500 máquinas en menos de 5 s ([`rendimiento.md`](rendimiento.md)) | A mano |

## 7. Flujo de trabajo

`feature/*` o `fix/*` desde `develop` → PR a `develop` con el CI en verde → PR de entrega `develop` → `main`. Un commit por mejora, en español. Detalle en el README de cada repo.
