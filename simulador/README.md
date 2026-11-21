# Simulador del flujo de correo (n8n)

En DOX, las impresoras envían sus reportes de contadores por correo a un buzón. Un flujo de **n8n** lee esos correos, saca los contadores de cada adjunto y los manda a PrintFlow. Ese flujo y el buzón son de la empresa y **no se pueden mostrar ni usar** (ver `PLAN.md`, sección 1.1).

Este simulador hace el mismo trabajo con **datos 100 % ficticios**, para que PrintFlow procese «todo el proceso» de punta a punta:

```text
 impresoras ──correo──▶ buzón ──▶ n8n (simulado) ──POST /api/ingesta/cargar──▶ PrintFlow
 generar-correos.js    buzon/    procesar-buzon.js   (token INGESTA_TOKEN)      staging → aprobación → consolidado
```

No usa dependencias: solo Node 22. Corre **dentro de Docker** porque nginx bloquea la ingesta desde fuera, igual que con el n8n real.

## Uso rápido (para la demo)

Desde la carpeta del backend, con el sistema arriba (`docker compose up -d --build`) y `INGESTA_TOKEN` con valor en el `.env`:

```powershell
# 1. Registrar los clientes, contratos, áreas, máquinas y asignaciones ficticias (una sola vez)
docker compose run --rm -T simulador preparar-datos.js | docker compose exec -T db psql -U postgres -d printflow

# 2. Demo completa: agosto a octubre de 2026, con casos de error en octubre
docker compose run --rm simulador demo.js
```

La demo muestra, mes a mes:

1. Las impresoras «envían» sus correos al buzón.
2. El n8n simulado los lee, detecta el formato de cada adjunto y llama a la ingesta.
3. El operador (`operador@printflow.local`) aprueba los lotes, y los que tienen errores no se pueden aprobar.
4. Al final, el consolidado por cliente: consumo B/N y color de cada máquina.

## Paso a paso (para mostrarlo por partes)

```powershell
# Las impresoras de un mes "envían" sus correos
docker compose run --rm simulador generar-correos.js --periodo 2026-11

# Con casos de error: equipo no registrado + correo reenviado
docker compose run --rm simulador generar-correos.js --periodo 2026-11 --errores

# Con un equipo que reporta una falla
docker compose run --rm simulador generar-correos.js --periodo 2026-11 --falla SIMB0002

# Con los reemplazos de escenario.json (ver «Reemplazo de una máquina a mitad de mes»)
docker compose run --rm simulador generar-correos.js --periodo 2026-11 --reemplazos

# El n8n simulado procesa el buzón (una vez, o vigilando cada 10 s)
docker compose run --rm simulador procesar-buzon.js
docker compose run --rm simulador procesar-buzon.js --vigilar
```

Los correos son archivos `.eml` normales: se pueden abrir con Outlook o Thunderbird desde `simulador/buzon/`.

| Carpeta | Qué hay |
|---|---|
| `buzon/entrada/` | Correos que llegaron y aún no se procesan |
| `buzon/procesados/` | Correos que la ingesta aceptó (o descartó por repetidos) |
| `buzon/con-error/` | Correos ilegibles o rechazados, con un `.motivo.txt` al lado |
| `buzon/alertas/` | Avisos al administrador (correos `.eml`) cuando algo no se pudo registrar |

## Si la API no responde: reintentos y alerta (S3-08)

Igual que el n8n de DOX, el simulador no pierde correos cuando PrintFlow está caído:

1. Cada envío se **reintenta** con espera creciente (1 s, 2 s, 4 s) si la API no responde, está saturada (429) o falla (5xx).
2. Si sigue caída, el correo **se queda en `buzon/entrada`** para el próximo ciclo y se cuentan los ciclos fallidos en `buzon/estado.json`.
3. Al llegar a 3 ciclos fallidos, se **avisa al administrador** con un correo en `buzon/alertas/` (lo que n8n enviaría por SMTP).
4. Un correo ilegible o **rechazado por la API** (por ejemplo, token de ingesta incorrecto → 401) va a `buzon/con-error` y también genera alerta. Un 4xx no se reintenta.

Para mostrarlo:

```powershell
docker compose run --rm simulador generar-correos.js --periodo 2026-12
docker compose stop api
docker compose run --rm --no-deps simulador procesar-buzon.js   # 3 veces: al tercer ciclo aparece la alerta
docker compose start api
docker compose run --rm simulador procesar-buzon.js            # los correos se procesan; no se perdió ninguno
```

| Variable | Por defecto | Qué controla |
|---|---|---|
| `REINTENTOS` | 3 | Reintentos por envío |
| `ESPERA_BASE_MS` | 1000 | Espera del primer reintento (luego se duplica) |
| `FALLOS_PARA_ALERTA` | 3 | Ciclos fallidos antes de avisar |
| `ALERTA_PARA` | admin@printflow.local | Destinatario de la alerta |

## Qué simula

**Un correo por cliente y por mes**, con **un adjunto por impresora**. Cada correo se convierte en un lote (`SIM-<período>-<remitente>`).

Hay tres formatos de adjunto, porque cada marca reporta a su manera. El n8n simulado los reconoce **por el contenido**, no por el nombre del archivo:

| Formato | Archivo | Qué trae | Ejemplo en el escenario |
|---|---|---|---|
| `csv-cuentas` | `.csv` | Contabilidad por cuenta de usuario (CSV con `;`) | SIMA0001, SIMD0004 |
| `texto-contadores` | `.txt` | Página de contadores en texto, con fecha `DD/MM/YYYY` | SIMB0002, SIME0005 |
| `xml-estado` | `.xml` | Estado del equipo en XML | SIMC0003 (plotter) |

Los contadores son **acumulados**, como los de una impresora real, y **reproducibles**: el mismo mes siempre da los mismos números. Por eso el consolidado se puede comprobar a mano.

### Casos de error que muestra

| Caso | Cómo se genera | Qué hace PrintFlow |
|---|---|---|
| Correo repetido | `--errores` reenvía el correo del primer cliente (mismo `Message-ID`) | Lo **descarta**: no registra nada dos veces |
| Equipo no registrado | `--errores` agrega un correo de `SIMX9999` | La lectura queda en **ERROR** («Máquina no autorizada») y el lote **no se puede aprobar** |
| Equipo con falla | `--falla SERIE` | La lectura queda **bloqueada** con el motivo, y el lote de ese cliente no se aprueba hasta resolverlo |

## Reemplazo de una máquina a mitad de mes (caja 4)

`escenario.json` trae en `reemplazos` un ejemplo: **SIMB0002** (Colegio Horizonte) se daña el 12 de noviembre de 2026 y la reemplaza **SIMF0006**, instalada el 13. Solo se aplica si se pide con `--reemplazos`; sin esa opción los correos y la demo son los de siempre.

- `preparar-datos.js` registra SIMF0006 como máquina **libre** (sin asignación).
- Con `--reemplazos`, desde el período del reemplazo el correo del cliente trae a la **entrante** en lugar de la saliente, con la misma área e IP. Sus contadores parten de su `contador_inicial` (el primer mes suma un consumo mensual completo).
- La saliente **no** vuelve a reportar: su lectura hasta el daño es el contador final que se anota al registrar el reemplazo.

```powershell
# 0. Datos y meses anteriores (si no se hicieron ya)
docker compose run --rm -T simulador preparar-datos.js | docker compose exec -T db psql -U postgres -d printflow
docker compose run --rm simulador demo.js --desde 2026-08 --hasta 2026-10 --sin-errores

# 1. Registrar el reemplazo en PrintFlow como admin: Máquinas → Reemplazos (o POST /api/maquinas-cambio)
#    Saliente SIMB0002 · entrante SIMF0006 · daño 2026-11-12 · instalación 2026-11-13 · período 2026-11
#    Tipo «Daño» · contador final de SIMB0002: B/N 376850, color 0 · contador inicial de SIMF0006: B/N 18000, color 0

# 2. Correos de noviembre con el reemplazo (al final imprime los datos del paso 1)
docker compose run --rm simulador generar-correos.js --periodo 2026-11 --reemplazos
docker compose run --rm simulador procesar-buzon.js

# 3. Aprobar el lote SIM-2026-11-horizonte (Notificaciones → Lotes) y ver Informes → Colegio Horizonte → 2026-11
```

En el consolidado de noviembre la fila del cambio (con el botón **Cambio**) suma, por B/N y por color:

```text
consumo = (contador final de SIMB0002 − su lectura de octubre) + (lectura de noviembre de SIMF0006 − su contador inicial)
```

Los meses anteriores no cambian. Si el reemplazo no se registra antes de aprobar, el lote de noviembre no pasa la validación (SIMF0006 no está asignada y falta SIMB0002). Un período ya aprobado no admite reemplazos.

**Si se registró por error**, el administrador lo anula en **Máquinas → Reemplazos → Anular** (o `POST /api/maquinas-cambio/:id/anular`): SIMB0002 vuelve a su asignación, SIMF0006 queda libre y el cambio deja de contar. Solo se puede **antes de aprobar** el lote del período; si el lote ya llegó pero sigue pendiente, primero se rechaza. Con noviembre aprobado, la API responde 409.

Para otro caso, agregar un objeto a `reemplazos` con `periodo`, `saliente` (serie del escenario), `entrante` (como una máquina del escenario; `ip` es opcional) y `registro` (los datos que se anotan en PrintFlow).

## Archivos

| Archivo | Qué hace |
|---|---|
| `escenario.json` | Clientes, contratos, áreas y máquinas ficticias, con su formato, IP, contadores iniciales y consumo promedio; y los reemplazos opcionales |
| `preparar-datos.js` | Escribe el SQL que registra el escenario en PrintFlow (se puede repetir sin duplicar) |
| `generar-correos.js` | Arma los correos de un mes y los deja en `buzon/entrada/` (con `--reemplazos`, aplica los de `escenario.json`) |
| `procesar-buzon.js` | El «n8n»: lee el buzón, convierte y llama a `POST /api/ingesta/cargar` con `Authorization: Bearer <INGESTA_TOKEN>`; si falla, reintenta y avisa al administrador (S3-08) |
| `demo.js` | Todo junto: varios meses, aprobación y consolidado |
| `lib/formatos.js` | Generador y lector de cada formato |
| `lib/correo.js` | Crea y lee correos `.eml` con adjuntos |
| `lib/n8n.js` | Convierte un correo en el cuerpo de la ingesta |
| `lib/entrega.js` | Reintentos con espera creciente, estado entre ciclos y alertas al administrador |

Los tests están en `test/simulador.test.js` y corren con `npm test`.

## Límites (a la fecha de hoy)

- **Los formatos son inventados.** Representan los casos típicos, pero no son los de las impresoras de DOX. Cuando el PO entregue correos de muestra, se agrega su formato en `lib/formatos.js` (un objeto con `generar`, `reconocer` y `leer`) sin tocar lo demás.
- **El importe se calcula por contrato (S3-06):** cuota fija de las páginas incluidas, más el excedente, más la renta. Con la demo, Colegio Horizonte de octubre de 2026 da **$395,48**. El monto por máquina es solo referencial (consumo × tarifa por página).
- **`demo.js` aprueba los lotes por la API** para que la demo corra sola. En la aplicación, el operador también puede aprobarlos o rechazarlos desde **Notificaciones → Lotes → Ver detalle**.
- **Los datos del escenario se cargan por SQL** (`preparar-datos.js`) para que siempre coincidan con los correos. Las máquinas también se pueden crear desde la pantalla **Máquinas**.
