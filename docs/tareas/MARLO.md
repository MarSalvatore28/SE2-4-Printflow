# Tareas de Marlo · Equipo A (Scrum Master, DevOps)

| # | Tarea | Puntos | Rama |
|---|---|---|---|
| 1 | Notificaciones leídas por usuario | 1 | `feature/f3-notificaciones-por-usuario` |
| 2 | Integrar los PR y pasar `develop` → `main` al cierre de cada sprint | — | — |
| 3 | Decisiones con el PO | — | — |

> **S4-04 (servidor y despliegue) es del Equipo C** (Samuel y Christian): ellos montan el servicio en Azure con su propia cuenta (Azure for Students) y deciden cómo. Marlo dejó lista y probada la configuración base (`deploy/` y `docs/despliegue.md`) como punto de partida.

---

## 1. Notificaciones leídas por usuario · HECHO

> Hecho: cada usuario tiene sus leídas (`notificaciones_leidas`, migración 032) y un lote aprobado o rechazado cuenta como leído para todos. Queda confirmarlo con el PO en la próxima reunión.

Hoy, si un usuario abre un lote o pulsa «Marcar todas como leídas», las notificaciones quedan leídas **para todos**, porque `notificaciones.leida` es global. Hay que confirmar con el PO si debe ser **por usuario**. Si es así:
- tabla `notificaciones_leidas (notificacion_id, usuario_id, fecha)`;
- la campana y los listados cuentan las no leídas **de ese usuario**.

## 2. Integración

- Revisar e integrar los PR de todos (con Kiara como QA), siempre con el CI en verde.
- Al cierre de cada sprint: la prueba completa (suites del navegador y de la API sobre una base limpia) y `develop` → `main`.

## 3. Decisiones con el PO

Llevar a la próxima reunión y anotar las respuestas en `PLAN.md`, sección 9:
1. **Regla de cobro (S3-06):** ¿cuota fija + excedente por contrato y por mes? Es la recomendada; está en `TAREAS-CHRISTIAN.md` (raíz).
2. ¿Las notificaciones se marcan como leídas **por usuario** o para todos?
3. ¿Se puede **anular un reemplazo** si el período ya está aprobado?
4. Las 5 preguntas pendientes de `PLAN.md`, sección 9: aprobación manual, identificación de la máquina, campos del contrato, nombre del rol «auditor» y cambio de máquinas en la demo final.
5. **Correos de muestra** de las impresoras reales, para agregar sus formatos al simulador.
