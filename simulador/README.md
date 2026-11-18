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

## Archivos

| Archivo | Qué hace |
|---|---|
| `escenario.json` | Clientes, contratos, áreas y máquinas ficticias, con su formato, IP, contadores iniciales y consumo promedio |
| `preparar-datos.js` | Escribe el SQL que registra el escenario en PrintFlow (se puede repetir sin duplicar) |
| `generar-correos.js` | Arma los correos de un mes y los deja en `buzon/entrada/` |
| `procesar-buzon.js` | El «n8n»: lee el buzón, convierte y llama a `POST /api/ingesta/cargar` con `Authorization: Bearer <INGESTA_TOKEN>` |
| `demo.js` | Todo junto: varios meses, aprobación y consolidado |
| `lib/formatos.js` | Generador y lector de cada formato |
| `lib/correo.js` | Crea y lee correos `.eml` con adjuntos |
| `lib/n8n.js` | Convierte un correo en el cuerpo de la ingesta |

Los tests están en `test/simulador.test.js` y corren con `npm test`.

## Límites (a la fecha de hoy)

- **Los formatos son inventados.** Representan los casos típicos, pero no son los de las impresoras de DOX. Cuando el PO entregue correos de muestra, se agrega su formato en `lib/formatos.js` (un objeto con `generar`, `reconocer` y `leer`) sin tocar lo demás.
- **El monto del consolidado sale en $0.** Cobrar según el contrato (incluidas, excedente, «Todo como color») es la historia **S3-06**, del Equipo C.
- **La aprobación se hace por la API** dentro de `demo.js`, mientras la pantalla de lotes (cajas 7 y 8) no esté en `develop`.
- **Las máquinas se registran por SQL** porque su pantalla y su API llegan con la caja 4.
