# Tareas de Marlo · Equipo A (Scrum Master, DevOps)

| # | Tarea | Puntos | Rama |
|---|---|---|---|
| 1 | **S4-04 · Despliegue de demostración** | 5 | `feature/f4-despliegue` |
| 2 | Notificaciones leídas por usuario | 1 | `feature/f3-notificaciones-por-usuario` |
| 3 | Integrar los PR y pasar `develop` → `main` al cierre de cada sprint | — | — |
| 4 | Decisiones con el PO | — | — |

---

## 1. S4-04 · Despliegue de demostración

En **Azure for Students** o un servicio gratuito, **nunca en el servidor de DOX** (`PLAN.md`):
- **HTTPS** con certificado válido (Let's Encrypt) y **redirección de HTTP a HTTPS**.
- **Docker Compose** en una VM, o servicios administrados. `db` no expuesto a internet.
- `.env` de producción con claves nuevas (`SECRET_KEY`, `INGESTA_TOKEN` y `DB_PASSWORD`), **nunca** las de desarrollo.
- **Respaldo diario** de la base de datos, que conserve 30 días (`pg_dump` con cron y rotación). Prueba una restauración.
- Usuarios de demostración con contraseñas distintas de `Printflow2026*`.
- Documentar en `docs/despliegue.md` cómo actualizar la versión y cómo restaurar un respaldo.

## 2. Notificaciones leídas por usuario

Hoy, si un usuario abre un lote o pulsa «Marcar todas como leídas», las notificaciones quedan leídas **para todos**, porque `notificaciones.leida` es global. Hay que confirmar con el PO si debe ser **por usuario**. Si es así:
- tabla `notificaciones_leidas (notificacion_id, usuario_id, fecha)`;
- la campana y los listados cuentan las no leídas **de ese usuario**.

## 3. Integración

- Revisar e integrar los PR de todos (con Kiara como QA), siempre con el CI en verde.
- Al cierre de cada sprint: la prueba completa (suites del navegador y de la API sobre una base limpia) y `develop` → `main`.

## 4. Decisiones con el PO

Llevar a la próxima reunión y anotar las respuestas en `PLAN.md`, sección 9:
1. **Regla de cobro (S3-06):** ¿cuota fija + excedente por contrato y por mes? Es la recomendada; está en `CHRISTIAN.md`.
2. ¿Las notificaciones se marcan como leídas **por usuario** o para todos?
3. ¿Se puede **anular un reemplazo** si el período ya está aprobado?
4. Las 5 preguntas pendientes de `PLAN.md`, sección 9: aprobación manual, identificación de la máquina, campos del contrato, nombre del rol «auditor» y cambio de máquinas en la demo final.
5. **Correos de muestra** de las impresoras reales, para agregar sus formatos al simulador.
