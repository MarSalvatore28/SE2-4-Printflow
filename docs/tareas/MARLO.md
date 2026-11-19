# Tareas de Marlo · Equipo A (Scrum Master, DevOps)

| # | Tarea | Puntos | Rama |
|---|---|---|---|
| 1 | Notificaciones leídas por usuario | 1 | `feature/f3-notificaciones-por-usuario` |
| 2 | Integrar los PR y pasar `develop` → `main` al cierre de cada sprint | — | — |
| 3 | Decisiones para la demo · hecho (`PLAN.md`, sección 9) | — | — |

> **S4-04 (servidor y despliegue) es del Equipo C** (Samuel y Christian): ellos montan el servicio en Azure con su propia cuenta (Azure for Students) y deciden cómo. Marlo dejó lista y probada la configuración base (`deploy/` y `docs/despliegue.md`) como punto de partida.

---

## 1. Notificaciones leídas por usuario · HECHO

> Hecho: cada usuario tiene sus leídas (`notificaciones_leidas`, migración 032) y un lote aprobado o rechazado cuenta como leído para todos. La campana y los listados cuentan las no leídas **de ese usuario**. Decidido por el equipo (`PLAN.md`, sección 9).

## 2. Integración

- Revisar e integrar los PR de todos (con Kiara como QA), siempre con el CI en verde.
- Al cierre de cada sprint: la prueba completa (suites del navegador y de la API sobre una base limpia) y `develop` → `main`.

## 3. Decisiones para la demo · HECHO

Las tomó el equipo sin esperar al PO: es una demo y nos quedamos con lo que el sistema ya hace. Están en `PLAN.md`, sección 9: aprobación manual, identificación por serie, sin campos nuevos en el contrato, el rol sigue como «Auditor», el reemplazo entra en la demo, cobro con cuota fija + excedente, notificaciones por usuario, anular un reemplazo solo sin lecturas aprobadas, y los 3 formatos del simulador.
