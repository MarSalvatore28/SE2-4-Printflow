# Reparto de lo que falta · Sprints 3 y 4

Estado al 21/11/2026: **todo el desarrollo está hecho, probado y en `main`.** Solo falta, del Equipo C, poner el servidor en Azure (la VM, el contenedor de respaldos y los secretos del despliegue; ver `docs/despliegue.md`) y la UAT con el PO. La prueba de punta a punta (`npm run e2e`) da 115 comprobaciones sin fallos y el guion de la demo está en [`docs/guion-demo.md`](../guion-demo.md).

Estado al 20/11/2026: las Fases 0, 1 y 2 están en `main`, con máquinas y reemplazos, notificaciones en vivo, lotes, informes, usuarios, roles, el simulador del correo, la lectura manual (S3-04) y el reprocesar (S3-05). También están las **validaciones de lecturas (S3-01, Samuel, #58)**, el **importe del consolidado (S3-06, Christian, #57)** y la **pantalla de informes con facturación y el PDF (S4-01)**: Colegio Horizonte de octubre da **$395,48**. Este documento reparte **todo lo que falta** para cerrar el proyecto.

Los repos son **`MarSalvatore28/SE2-4-Printflow`** (backend) y **`MarSalvatore28/SE2-4-Printflow-Frontend`**. Cada integrante tiene que aceptar la invitación que le llegó por correo para poder hacer push.

**Todo es urgente: es lo que falta para el medio parcial.** Lo más pesado del backend es de **Samuel** y **Christian**. Marlo terminó la lectura manual, el reprocesar, la pantalla de informes con facturación y el PDF. **Para probar cualquier cosa, sigue [`docs/probar.md`](../probar.md), paso a paso.** Gabriela, Roberto y Kiara tienen tareas propias más chicas y que no dependen de nadie.

**Cada tarea se puede hacer sin esperar a otra persona.** Donde había una dependencia, el contrato se fijó por adelantado (ver «Contratos compartidos»).

| Persona | Documento | Qué le toca | Puntos | Estado |
|---|---|---|---|---|
| **Samuel** (líder técnico backend) | [TAREAS-SAMUEL.md](../../TAREAS-SAMUEL.md) | ~~S3-01 validaciones~~ (#58), ~~S3-02 auditoría~~ (#67), ~~tests de login~~ (#68), ~~4 fallos~~ (#64), ~~prueba E2E~~ (#73), ~~migraciones en producción~~ (#69). **Falta:** la UAT con el PO y poner la VM en marcha | ~18 | **Desarrollo hecho** |
| **Christian** | [TAREAS-CHRISTIAN.md](../../TAREAS-CHRISTIAN.md) | ~~S3-06 importe~~ (#57), ~~tarifas congeladas~~ (#65), ~~anular un reemplazo~~ (#66 y frontend #37), ~~S4-05 rendimiento~~ (#71), ~~endpoints 501~~ (#72 y frontend #40), ~~despliegue automático, respaldos y monitoreo~~ (#70). **Falta:** configurar Azure y los secretos | ~18 | **Desarrollo hecho** |
| **Roberto** | [TAREAS-ROBERTO.md](../../TAREAS-ROBERTO.md) | Pruebas automáticas del frontend (Vitest en el CI), limpieza de Asignaciones y Máquinas | ~4 | **Hecho** (frontend #22 y #25) |
| **Gabriela** | [TAREAS-GABRIELA.md](../../TAREAS-GABRIELA.md) | ~~Accesibilidad de los componentes compartidos~~ (frontend #38), ~~web usable en el celular~~ (frontend #39) | ~4 | **Hecho** |
| **Kiara** | [TAREAS-KIARA.md](../../TAREAS-KIARA.md) | ~~S4-02 Excel~~ (frontend #36), ~~guion de la demo~~ (`docs/guion-demo.md`). Sigue la QA de los PR | ~3 | **Hecho** |
| **Marlo** | [MARLO.md](MARLO.md) · [lectura manual y reprocesar](marlo-lectura-manual-y-reprocesar.md) · [informes y PDF](marlo-informes-y-pdf.md) | S3-03 aviso por correo, S3-04 lectura manual y S3-05 reprocesar (**hechos**), informes con facturación y S4-01 PDF (**hechos**, frontend #31 y #32), integración de los PR y decisiones para la demo (**hechas**, `PLAN.md` §9) | ~17 | **Hecho** |

## Contratos compartidos (lo que hace que cada uno sea independiente)

### 1. `validarLectura` (S3-01 ↔ S3-04 y S3-05)
Está en `src/services/validacionLecturas.js`, con su contrato documentado y `test/validacionLecturas.contrato.test.js`. **Ya está implementado** (Samuel, #58): rechaza RETROCESO, SALTO_ANOMALO y DUPLICADA.
- La **lectura manual** y el **reprocesar** ya están en `develop` y la llaman.
- **Samuel** reemplaza su contenido con las 3 reglas **sin cambiar la firma**.

La lectura manual, el reprocesar, la ingesta y la aprobación del lote ya rechazan con esas reglas.

### 2. Importe del consolidado (S3-06 ↔ S4-01)
`GET /api/reportes/consolidado/:clienteId/:periodo` devuelve (Christian, #57; **la pantalla de informes y el PDF lo muestran**):

```jsonc
{
  "detalles": [ { "info": {...}, "consumo": { "total_bn": 4030, "total_color": 679, "gran_total": 4709 },
                  "financiero": { "monto_total": "0.00", "monto_referencial": "0.00" } } ],
  "resumen": { "...lo de hoy...": 0,
    "facturacion": [ {
      "contrato_id": 1, "modo": "DIFERENCIAR",            // o "TODO_COLOR"
      "contrato_fecha_inicio": "2026-01-01",               // para nombrar el contrato en pantalla
      "contrato_fecha_fin": null,                          // sin fecha de fin: vigente
      "bn":    { "consumo": 13960, "incluidas": 5000, "excedente": 8960, "cuota_fija": "100.00", "monto_excedente": "224.00" },
      "color": { "consumo": 679,   "incluidas": 500,  "excedente": 179,  "cuota_fija": "50.00",  "monto_excedente": "21.48" },
      "renta": "0.00",
      "total": "395.48"
    } ],
    "monto_total_general": "395.48"
  }
}
```

Si un cliente no tiene lecturas en el período, `facturacion` viene vacío y la pantalla lo indica sin romperse. Con filtro por área o máquina se factura el contrato completo y cada elemento trae `filtrado: true`.

### 3. Migraciones: un rango de números por persona
Para que no choquen dos archivos con el mismo número:

| Persona | Rango | Ejemplo |
|---|---|---|
| Samuel | `010` a `019` | `010_lectura_unica.sql`, `011_registro_auditoria.sql` |
| Christian | `020` a `029` | `020_indices_consolidado.sql` |
| Marlo (lectura manual, reprocesar y notificaciones) | `030` a `039` | `030_lectura_manual.sql`, `031_intentos_reproceso.sql`, `032_notificaciones_leidas.sql` |
| Kiara | `040` a `049` | (solo si la necesita) |

Las migraciones se aplican en orden alfabético la primera vez que se crea el volumen: `docker compose down -v` y `docker compose up -d --build`.

## Reglas para todos

- **Una rama por tarea** desde `develop` actualizado (`feature/<sprint>-<tema>`) y un **PR a `develop`** con la plantilla. El CI (`test`, `docker` y `smoke`) debe quedar en verde. Revisa Kiara (QA) o Marlo.
- **Una mejora, un commit**, en español (`feat(...)`, `fix(...)`, `test(...)`).
- **Cómo probar, sin pedirle claves a nadie:** [`docs/probar.md`](../probar.md). `npm run configurar` crea tu `.env` con claves propias; el token sale de Postman (colección en `docs/postman/`), de Swagger o de `npm run token`.
- **Pruebas con datos del simulador** (`simulador/README.md`): `preparar-datos.js` y `demo.js`. Usuarios: `admin@`, `operador@` y `auditor@printflow.local` / `Printflow2026*`.
- **Permisos:** toda ruta nueva que modifica datos lleva `requireRole(...)` (`src/middlewares/role.middleware.js`). En el frontend, los botones se muestran según `usePermisos()`.
- **Frontend:** los servicios usan `apiFetch` (`src/services/api.ts`), nunca `fetch` directo.
- **Textos en español, en minúscula salvo al inicio** («Cerrar sesión», no «Cerrar Sesión»).
- **Nunca** se suben `.env`, credenciales ni datos reales de clientes.
- Si tienes que tocar un archivo de otra persona, avisa en el grupo y que sea un cambio pequeño.
