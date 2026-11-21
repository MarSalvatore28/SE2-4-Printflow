# Guion de la demo para el sponsor (10 minutos)

Recorrido para mostrar PrintFlow de punta a punta con datos ficticios. Cada paso dice **qué hacer**, **qué decir** y **qué se tiene que ver**. Antes de empezar, prepara el sistema (abajo) y ensaya una vez.

## Antes de la demo (15 minutos antes)

Desde la carpeta del backend (ver [`docs/probar.md`](probar.md) si es la primera vez):

```powershell
docker compose down -v                # base limpia
docker compose up -d --build
docker compose run --rm -T simulador preparar-datos.js | docker compose exec -T db psql -U postgres -d printflow
docker compose run --rm simulador demo.js --desde 2026-08 --hasta 2026-09 --sin-errores
```

Así quedan **agosto y septiembre aprobados**. Octubre llega en vivo durante la demo.

Deja abiertas tres ventanas del navegador, una por rol, en http://localhost:8080. Usa ventanas privadas para que las sesiones no se mezclen:

| Ventana | Usuario | Contraseña |
|---|---|---|
| 1 | `admin@printflow.local` | `Printflow2026*` |
| 2 | `operador@printflow.local` | `Printflow2026*` |
| 3 | `auditor@printflow.local` | `Printflow2026*` |

Ten una terminal abierta en la carpeta del backend y otra pestaña con `buzon-salida/` (los avisos por correo; ver [`docs/avisos-por-correo.md`](avisos-por-correo.md)).

## El recorrido

### 1. Tres roles, tres menús (1 min)
- **Haz:** muestra las tres ventanas.
- **Di:** «Cada persona ve solo lo que le toca. El administrador gestiona clientes, contratos, máquinas y usuarios; el operador aprueba las lecturas; el auditor solo consulta.»
- **Se ve:** el admin tiene **Usuarios**; el auditor no tiene botones de editar ni aprobar.

### 2. Clientes, contratos y máquinas (1 min)
- **Haz:** como admin, **Clientes** → Colegio Horizonte → ver su contrato. Después **Máquinas** y **Asignaciones**.
- **Di:** «El contrato define cuántas páginas incluye y cuánto cuesta cada página adicional: 5 000 en B/N y 500 en color.»

### 3. Llegan los correos de las impresoras (2 min)
- **Haz:** en la terminal:
  ```powershell
  docker compose run --rm simulador generar-correos.js --periodo 2026-10 --errores
  docker compose run --rm simulador procesar-buzon.js
  ```
- **Di:** «Las impresoras mandan sus contadores por correo. Un flujo los lee y los envía a PrintFlow: nadie copia números a mano.»
- **Se ve:** en la ventana del **operador**, la campana suena y en **Notificaciones → Lotes** aparecen los lotes de octubre.

### 4. Un lote con problemas no se puede aprobar (2 min)
- **Haz:** como operador, abre el lote **SIM-2026-10-desconocido** → **Ver detalle** → **Aprobar**.
- **Di:** «PrintFlow valida cada lectura: máquinas no registradas, contadores que retroceden o saltos fuera de lo normal. Si algo está mal, el lote no se puede aprobar y se ve el motivo.»
- **Se ve:** el recuadro rojo con los motivos: la serie SIMX9999 no está registrada ni asignada a ningún cliente. Recházalo con un motivo.
- **Luego:** aprueba **SIM-2026-10-horizonte** y **SIM-2026-10-andina**. El aviso por correo llega a `buzon-salida/`.
- **Extra:** como **auditor**, intenta aprobar uno: «No tiene permiso para esta acción».

### 5. El informe del mes y lo que se factura (2 min)
- **Haz:** como admin, **Informes** → Colegio Horizonte → 2026 → octubre.
- **Di:** «El consumo es lo que imprimió cada máquina en el mes. La factura sale del contrato: cuota fija por las páginas incluidas más el excedente.»
- **Se ve:** la tarjeta **Facturación del período**, que tiene que decir:
  - B/N: 13 960 páginas, $100 de cuota y $224 de excedente;
  - color: 679 páginas, $50 de cuota y $21,48 de excedente;
  - **total del contrato: $395,48**.
- **Haz:** **Exportar en PDF** y **Exportar en XLSX**. Abre los dos archivos: tienen los mismos números.

### 6. Reemplazo de una máquina a mitad de mes (1,5 min)
- **Haz:** como admin, **Máquinas → Reemplazos** → registra SIMB0002 → SIMF0006 (los datos están en [`simulador/README.md`](../simulador/README.md), «Reemplazo de una máquina»). Después, en la terminal:
  ```powershell
  docker compose run --rm simulador generar-correos.js --periodo 2026-11 --reemplazos
  docker compose run --rm simulador procesar-buzon.js
  ```
  y aprueba noviembre como operador.
- **Di:** «Si una impresora se daña, se registra el cambio y el informe suma lo que imprimió cada una en su parte del mes.»
- **Se ve:** en **Informes**, noviembre, la fila con el botón **Cambio** y el total del contrato: **$388,87**.

### 7. Todo queda registrado (0,5 min)
- **Haz:** como admin, en otra pestaña: http://localhost:8080/api-docs → **Authorize** → `GET /api/auditoria` con `tabla=lotes_carga`.
- **Di:** «Cada cambio queda en una bitácora: quién lo hizo, cuándo, desde qué equipo y qué cambió.»

## Si algo sale mal en vivo

| Pasa esto | Haz esto |
|---|---|
| La campana no suena | Recarga la página del operador: los lotes igual están en Notificaciones → Lotes |
| `procesar-buzon.js` dice que no hay correos | Ya los habías procesado: sigue con el paso 4 |
| Un número no coincide | Probablemente la base tiene datos de otro ensayo: muestra igual el flujo y explica la regla con la tarjeta de facturación |
| Algo no responde | `docker compose ps` y `docker compose logs --tail 50 api` (ver la tabla de [`docs/probar.md`](probar.md), sección 12) |

**Plan B:** el día antes, graba la pantalla con el recorrido completo, por si falla la red o el equipo.
