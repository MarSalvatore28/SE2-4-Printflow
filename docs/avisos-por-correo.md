# Avisos por correo (S3-03)

Cuando llega un lote nuevo, PrintFlow avisa por correo a los usuarios **activos** con rol **operador** o **admin**, además de la campana de la aplicación. Si el lote trae reportes en error, el asunto lleva ⚠ y el cuerpo, el motivo de cada uno («Máquina no autorizada…»).

**No depende de ningún servicio externo ni de pago.** El modo se elige en el `.env`:

| `CORREO_MODO` | Qué hace | Para qué |
|---|---|---|
| `archivo` (por defecto) | Guarda cada correo como `.eml` en `buzon-salida/` | Desarrollo y demo sin ningún servidor: los `.eml` se abren con Outlook o Thunderbird |
| `smtp` | Lo envía por el servidor SMTP de `SMTP_HOST` | **Producción, con el SMTP que pone DOX**, o la demo con Mailpit |
| `desactivado` | No envía nada | Si no se quieren correos |

## Ver los correos en la demo

**Opción 1, sin nada extra:** procesa correos con el simulador y abre los `.eml` de `buzon-salida/`.

**Opción 2, Mailpit:** un servidor de correo de **pruebas** que corre en nuestro Docker, gratis y sin cuenta. No envía nada a internet.

```powershell
# en el .env: CORREO_MODO=smtp, SMTP_HOST=mailpit, SMTP_PORT=1025
docker compose --profile correo up -d
docker compose --profile correo run --rm simulador generar-correos.js --periodo 2026-12 --errores
docker compose --profile correo run --rm simulador procesar-buzon.js
# bandeja: http://localhost:8025
```

Usa `--profile correo` también al lanzar el simulador. Si no, Docker Compose recrea la API sin la configuración de Mailpit.

## En producción, con el SMTP de DOX

En el `.env` del servidor:

```ini
CORREO_MODO=smtp
SMTP_HOST=smtp.dox.example        # el que indique DOX
SMTP_PORT=587
SMTP_SECURE=false                 # true si el puerto es 465
SMTP_USER=printflow@dox.example
SMTP_PASS=********
CORREO_REMITENTE=PrintFlow <printflow@dox.example>
APP_URL=https://printflow-demo.eastus.cloudapp.azure.com
```

No hay que tocar código. Si el servidor no responde, el aviso queda en el log de la API y **la ingesta sigue normal**: un correo nunca la detiene.

## Código

| Archivo | Qué hace |
|---|---|
| `src/services/correo.service.js` | Envía según el modo (nodemailer) |
| `src/services/avisos.service.js` | Arma el aviso del lote (cliente, período, reportes y errores) y elige los destinatarios |
| `src/socket.js` | Al llegar la notificación `NUEVO_LOTE` de PostgreSQL, además de la campana, llama al aviso |
| `test/avisos.test.js` | Texto del aviso, modos, solo para lotes nuevos y que nunca lance error |
