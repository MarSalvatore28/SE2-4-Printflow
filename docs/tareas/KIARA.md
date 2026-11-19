# Tareas de Kiara · Equipo A (QA)

Tus tareas de la Fase 0 ya están en `main`: CODEOWNERS en los dos repos, la API con 404 en JSON y validación del `.env`, los tests de la API y el job `smoke` del CI. Ahora te toca el **aviso por correo** (S3-03), el **Excel** (S4-02) y seguir como **QA de los PR de todos**. Nada depende de otra persona.

| # | Tarea | Puntos | Rama |
|---|---|---|---|
| 1 | **S3-03 · Aviso por correo (SMTP) al operador** | 3 | `feature/f3-smtp` |
| 2 | **S4-02 · Excel del consolidado** | 2 | `feature/f4-excel` |
| 3 | **QA de cada PR** de Samuel, Christian, Roberto y Gabriela | — | — |
| 4 | Guion de la demo para el sponsor | 1 | — |

Tus migraciones, si las necesitas, van de `040` a `049`.

---

## 1. S3-03 · Aviso por correo al operador

**Para qué:** cuando llega un lote nuevo, o uno queda en Error, los operadores reciben un **correo**, además de la campana de la aplicación.

**Servidor de correo de pruebas:** agrega **Mailpit** a `docker-compose.yml`. Es un servidor SMTP falso que muestra los correos en una página web:

```yaml
  mailpit:
    image: axllent/mailpit:v1.20
    restart: unless-stopped
    ports:
      - "127.0.0.1:8025:8025"   # bandeja web: http://localhost:8025
    expose:
      - "1025"                  # SMTP para la API
```

**Backend:**
- **Dependencia:** `npm install nodemailer`. **Variables** en `.env.example` (y en `environment:` de la API en Compose):
  - `SMTP_HOST=mailpit`, `SMTP_PORT=1025`;
  - `SMTP_USER`, `SMTP_PASS` y `SMTP_SECURE=false`;
  - `SMTP_REMITENTE="PrintFlow <no-responder@printflow.example>"`.

  Sin `SMTP_HOST`, el envío se omite con un aviso en el log y **no rompe nada**.
- **`src/services/correo.service.js`:** `enviarCorreo({ para, asunto, texto, html })` con nodemailer, en español.
- **Cuándo enviar:** al crearse una **notificación de lote nuevo**. `src/socket.js` ya recibe ese aviso de PostgreSQL (`NOTIFY`) para la campana; desde ahí, o desde un listener aparte del mismo canal, llama a un `avisarLoteNuevo(payload)`.
  - Destinatarios: los usuarios **activos** con rol `operador` o `admin`, desde la tabla `usuarios` con su rol.
  - Asunto: «Nuevo lote de contadores: SIM-2026-11-andina».
  - Cuerpo: cliente, período, número de reportes y, **si tiene reportes en Error**, el motivo de cada uno. Que se lea bien en texto plano y, opcionalmente, en HTML.
  - Un enlace a la aplicación: `APP_URL` en `.env`, por ejemplo `http://localhost:8080/notificaciones`.
- **Si el envío falla,** se registra en el log y la ingesta sigue. Un correo no puede tumbar la API.
- **Tests** (`test/correo.test.js`) con un transporte falso de nodemailer (`jsonTransport: true`): asunto, destinatarios y cuerpo.

**Cómo probarlo:** levanta todo, genera y procesa un correo con el simulador (`generar-correos.js --periodo 2026-12 --errores` y `procesar-buzon.js`) y abre **http://localhost:8025**. Tienen que estar los correos al operador y al admin, y el del lote con la máquina no autorizada debe mencionar el motivo. Deja la captura en el PR.

## 2. S4-02 · Excel del consolidado

La exportación está en `src/utils/exportUtils.ts` (repo **frontend**). **Gabriela trabaja el PDF en el mismo archivo:** tú tocas solo las funciones del Excel y ella solo las del PDF.
- **Columnas numéricas como número,** no como texto: contadores, páginas e importes. Así se pueden sumar en Excel. Los importes, con formato de 2 decimales.
- **Cabecera** con cliente, RUC, período y fecha de generación. Una hoja por consolidado y, si hay detalle por usuario, otra hoja.
- **Facturación:** cuando Christian termine S3-06, la tabla de facturación (`resumen.facturacion`). Antes, una fila «Importe pendiente de cálculo».
- **Valores idénticos a la pantalla:** 2 clientes, 2 períodos y el de noviembre con reemplazo. Compara y deja capturas en el PR.

## 3. QA de cada PR

Eres la revisora. En cada PR de tus compañeros:
1. Bájalo (`git fetch` y `git checkout <rama>`), levanta Docker con datos del simulador y prueba lo que dice en «Cómo probarlo».
2. Con los **3 usuarios** (admin, operador y auditor): que cada uno vea y pueda hacer lo que le toca, sin errores en la consola del navegador (F12).
3. Que el CI esté en verde (`test`, `docker` y `smoke`).
4. Deja un comentario con lo que probaste. **Aprueba solo lo que probaste.** Si algo falla, escribe los pasos para repetirlo.

## 4. Guion de la demo para el sponsor

Una hoja con el recorrido de 10 minutos, para el grupo y no para el repo:
1. Login con los 3 roles: cada uno ve un menú distinto.
2. Clientes, contratos y máquinas.
3. Simulación del correo (`demo.js`): llegan los lotes, la campana suena y se aprueba uno.
4. Lote con máquina no autorizada: el motivo y por qué no se puede aprobar.
5. Informes del mes, con el reemplazo de noviembre.
6. Con S3-03, el correo que recibe el operador (Mailpit).
