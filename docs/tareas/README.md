# Reparto de lo que falta · Sprints 3 y 4

Estado al 18/11/2026: las Fases 0, 1 y 2 están en `main`, con máquinas y reemplazos, notificaciones en vivo, lotes, informes, usuarios, roles y el simulador del correo. Este documento reparte **todo lo que falta** para cerrar el proyecto.

**Todo es urgente: es lo que falta para el medio parcial.** Lo más pesado del backend es de **Samuel** y **Christian**. Las tareas de Roberto, Gabriela y Marlo las está haciendo Marlo.

**Cada tarea se puede hacer sin esperar a otra persona.** Donde había una dependencia, el contrato se fijó por adelantado (ver «Contratos compartidos»).

| Persona | Documento | Qué le toca | Puntos | Estado |
|---|---|---|---|---|
| **Samuel** (líder técnico backend) | [TAREAS-SAMUEL.md](../../TAREAS-SAMUEL.md) | **S3-01 validaciones**, **S3-02 auditoría**, tests de login y seguridad, 4 fallos del backend, **S4-06 prueba E2E y UAT**, **S4-04 despliegue: puesta en marcha y migraciones en producción** | ~18 | **URGENTE · le toca a él** |
| **Christian** | [TAREAS-CHRISTIAN.md](../../TAREAS-CHRISTIAN.md) | **S3-06 cálculo del importe**, congelar tarifas al aprobar, **anular un reemplazo**, **S4-05 rendimiento con 500 máquinas**, endpoints 501 y limpieza, **S4-04 despliegue automático, respaldos fuera de la VM y monitoreo** | ~18 | **URGENTE · le toca a él** |
| **Roberto** | [ROBERTO.md](ROBERTO.md) | S3-04 lectura manual, S3-05 reprocesar y un fallo de áreas | ~7 | Lo hace Marlo (medio parcial) |
| **Gabriela** | [GABRIELA.md](GABRIELA.md) | S4-01 PDF, informes con el importe del backend y limpieza del frontend | ~7 | Lo hace Marlo (medio parcial) |
| **Kiara** | [KIARA.md](KIARA.md) | S3-03 aviso por correo (SMTP), S4-02 Excel y QA de los PR | ~6 | Le toca a ella |
| **Marlo** | [MARLO.md](MARLO.md) | Revisión e integración de los PR, decisiones con el PO (la base del despliegue ya la dejó lista) | ~3 | En curso |

## Contratos compartidos (lo que hace que cada uno sea independiente)

### 1. `validarLectura` (S3-01 ↔ S3-04 y S3-05)
Está en `src/services/validacionLecturas.js`, con su contrato documentado y `test/validacionLecturas.contrato.test.js`. **Hoy acepta todas las lecturas** (devuelve `null`).
- **Roberto** la llama desde la lectura manual y el reprocesar **desde ya**.
- **Samuel** reemplaza su contenido con las 3 reglas **sin cambiar la firma**.

Cuando se mergee lo de Samuel, la lectura manual y el reprocesar empiezan a rechazar sin tocar nada.

### 2. Importe del consolidado (S3-06 ↔ S4-01)
`GET /api/reportes/consolidado/:clienteId/:periodo` devolverá (Christian lo implementa; **Gabriela ya lo muestra**):

```jsonc
{
  "detalles": [ { "info": {...}, "consumo": { "total_bn": 4030, "total_color": 679, "gran_total": 4709 },
                  "financiero": { "monto_total": "0.00", "monto_referencial": "0.00" } } ],
  "resumen": { "...lo de hoy...": 0,
    "facturacion": [ {
      "contrato_id": 1, "modo": "DIFERENCIAR",            // o "TODO_COLOR"
      "bn":    { "consumo": 13960, "incluidas": 5000, "excedente": 8960, "cuota_fija": "100.00", "monto_excedente": "224.00" },
      "color": { "consumo": 679,   "incluidas": 500,  "excedente": 179,  "cuota_fija": "50.00",  "monto_excedente": "21.48" },
      "renta": "0.00",
      "total": "395.48"
    } ],
    "monto_total_general": "395.48"
  }
}
```

Hasta que Christian termine, `facturacion` puede venir vacío o con ceros: la pantalla y el PDF deben mostrarlo igual, sin romperse.

### 3. Migraciones: un rango de números por persona
Para que no choquen dos archivos con el mismo número:

| Persona | Rango | Ejemplo |
|---|---|---|
| Samuel | `010` a `019` | `010_lectura_unica.sql`, `011_registro_auditoria.sql` |
| Christian | `020` a `029` | `020_indices_consolidado.sql` |
| Roberto | `030` a `039` | `030_lectura_manual.sql`, `031_intentos_reproceso.sql` |
| Kiara | `040` a `049` | (solo si la necesita) |

Las migraciones se aplican en orden alfabético la primera vez que se crea el volumen: `docker compose down -v` y `docker compose up -d --build`.

## Reglas para todos

- **Una rama por tarea** desde `develop` actualizado (`feature/<sprint>-<tema>`) y un **PR a `develop`** con la plantilla. El CI (`test`, `docker` y `smoke`) debe quedar en verde. Revisa Kiara (QA) o Marlo.
- **Una mejora, un commit**, en español (`feat(...)`, `fix(...)`, `test(...)`).
- **Pruebas con datos del simulador** (`simulador/README.md`): `preparar-datos.js` y `demo.js`. Usuarios: `admin@`, `operador@` y `auditor@printflow.local` / `Printflow2026*`.
- **Permisos:** toda ruta nueva que modifica datos lleva `requireRole(...)` (`src/middlewares/role.middleware.js`). En el frontend, los botones se muestran según `usePermisos()`.
- **Frontend:** los servicios usan `apiFetch` (`src/services/api.ts`), nunca `fetch` directo.
- **Textos en español, en minúscula salvo al inicio** («Cerrar sesión», no «Cerrar Sesión»).
- **Nunca** se suben `.env`, credenciales ni datos reales de clientes.
- Si tienes que tocar un archivo de otra persona, avisa en el grupo y que sea un cambio pequeño.
