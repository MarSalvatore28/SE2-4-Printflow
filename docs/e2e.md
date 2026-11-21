# Prueba de punta a punta (E2E)

`npm run e2e` levanta una **copia aparte** de PrintFlow en Docker, le hace el recorrido completo de la demo (correos de las impresoras → ingesta → aprobación → consolidado → facturación), prueba los casos que deben fallar y al final la baja. Es la prueba de S4-06: si termina con **`0 fallos`**, el sistema funciona de punta a punta.

El script está en [`test/e2e/e2e.js`](../test/e2e/e2e.js). No usa dependencias nuevas: solo Node 22 y Docker.

## Cómo correrlo

Desde la carpeta del backend, con **Docker Desktop abierto**:

```powershell
npm run configurar   # solo si todavía no tienes .env
npm run e2e
```

Requisitos: los mismos de [`probar.md`](probar.md) (pasos 1 a 3): Docker, Node 22, el `.env` y el frontend al lado del backend (`..\SE2-4-Printflow-Frontend`, o `FRONTEND_PATH` en el `.env`), porque también construye la web.

**No toca tu base de desarrollo.** Usa su propio proyecto de Docker Compose (`printflow-e2e`, no `printflow`), sus propios puertos (web **8099** y base **5499**, no 8080 y 5433) y un buzón temporal propio para el simulador (no `simulador/buzon`). Puedes tener tu sistema de siempre arriba mientras corre. Solo levanta `db`, `api` y `web` (nunca n8n).

| Opción | Qué hace |
|---|---|
| `npm run e2e -- --dejar-arriba` | No baja el sistema al terminar: puedes entrar a http://localhost:8099 y mirar los datos de la prueba. Para bajarlo: `docker compose -p printflow-e2e down -v` |
| `E2E_WEB_PORT`, `E2E_DB_PORT` | Otros puertos, si 8099 o 5499 están ocupados (en PowerShell: `$env:E2E_WEB_PORT = "8098"; npm run e2e`) |
| `E2E_PROYECTO` | Otro nombre de proyecto de Docker (por defecto `printflow-e2e`) |

`npm test` **no** corre el E2E: solo ejecuta `test/*.test.js`, que no necesitan Docker.

## Cuánto tarda

- **Unos 40 segundos** cuando Docker ya tiene las imágenes construidas.
- **La primera vez**, entre 3 y 10 minutos más, porque construye la API y la web (igual que el primer `docker compose up --build`).

Empieza **siempre** con una base vacía (`down -v` del proyecto de la prueba) y, al terminar, la vuelve a borrar. Se puede correr las veces que quieras seguidas.

## Qué comprueba

Cada comprobación sale en pantalla con ✓ o ✗. Hoy son **154**.

1. **Base limpia y sistema arriba:** existe el `.env` con sus claves, Docker responde, `down -v` y `up -d --build db api web`, la API contesta, `preparar-datos.js` registra los clientes, contratos, áreas y las 5 máquinas, y los tres usuarios de prueba inician sesión.
2. **Agosto, septiembre y octubre de 2026:** el simulador genera los correos de cada mes, el «n8n» simulado los procesa (dentro de Docker, como en la demo), cada cliente tiene su lote en staging sin lecturas en ERROR y el **operador** lo aprueba por la API (`POST /api/staging/approve-batch`).
3. **Consolidado contra el cálculo a mano del escenario:** para cada cliente y mes, `GET /api/reportes/consolidado/:cliente/:periodo` se compara con `contadoresAlCierre` de `simulador/lib/escenario.js`:
   - agosto (el primer mes, sin lectura anterior): la lectura aprobada de cada máquina;
   - septiembre y octubre: la lectura y el **consumo B/N y color de cada máquina** (este mes − el anterior);
   - la **facturación por contrato** con la regla de S3-06, calculada aparte y sin usar el código de la API: por separado para B/N y color, cuota fija de las páginas incluidas + excedente por lo que pasa de ellas, más la renta. Se comparan consumo, incluidas, excedente, cuota fija, monto del excedente, renta y total.
   - **Colegio Horizonte de 2026-10 tiene que dar $395,48.**
4. **Seguridad:** 401 sin token y con un token falso, la cabecera `X-Nuevo-Token` en una respuesta válida, 403 al auditor que intenta aprobar un lote, 403 en `/api/ingesta/cargar` desde fuera (puerto de la web, aun con el token de ingesta), 404 al admin que intenta editar a mano un reporte del lote (`PUT /api/staging/consolidado/:id`, la ruta ya no existe), 403 al auditor en `/api/auditoria` y que `GET /api/auditoria` (admin) muestra la **aprobación** del lote de octubre de Colegio Horizonte hecha por `operador@printflow.local`.
   - **Sesión revocada** (migración 033): con un usuario de prueba, cambiarle la contraseña deja su token anterior en 401 «Tu sesión terminó: inicia sesión de nuevo» (en `/api/auth/perfil` y en `validate-token`), con la nueva inicia sesión, editar solo el apellido no la corta, cambiarle el rol sí, y desactivarlo y reactivarlo también. El admin que cambia su propia contraseña sigue con el token de esa respuesta y el anterior queda en 401; luego vuelve a la de siempre.
5. **Validaciones de lecturas (S3-01):**
   - **DUPLICADA** por la lectura manual: `POST /api/lecturas/manual` de SIMA0001 en octubre (ya aprobado) → 400 con `codigo: DUPLICADA`.
   - Se prepara el lote de noviembre de **Constructora Andina** para que traiga los tres errores: una lectura manual de noviembre de SIME0005 (201, como si el equipo no hubiera mandado su correo), y el historial aprobado alterado como en el PR #58: SIMC0003 con +100.000.000 en octubre (retroceso) y SIMD0004 con sus lecturas de agosto a octubre ÷10 (salto anómalo).
   - Solo se tocan máquinas de Andina, y **después** de comprobar el consolidado: el reemplazo de noviembre es de Colegio Horizonte y no se ve afectado.
6. **Reemplazo de noviembre (SIMB0002 → SIMF0006):** se registra por la API como admin (tipo «Daño», con los datos de `escenario.json`), se generan los correos con `--reemplazos` y se procesan. El lote de Horizonte trae a SIMF0006 en lugar de SIMB0002 (si SIMF0006 quedara en ERROR, se reprocesa) y se aprueba. En el consolidado de noviembre:
   - SIMA0001 con su consumo normal;
   - **una fila con el cambio**, cuyo consumo es el tramo de la saliente (contador final 376.850 − su lectura de octubre) más el de la entrante (su lectura de noviembre − su contador inicial 18.000), como explica [`simulador/README.md`](../simulador/README.md);
   - la facturación de noviembre con ese consumo;
   - octubre sigue en $395,48;
   - **anular el reemplazo** con noviembre aprobado → 409.
7. **Lote de noviembre de Andina:** SIMC0003 queda en ERROR con «Retroceso de contador…», SIMD0004 con «Salto anómalo…» y SIME0005 con «Lectura duplicada…» (`procesar_lectura = false`). Aprobar el lote responde **409** con los tres motivos, cada uno con su máquina («Máquina SIMC0003: Retroceso de contador…»), y el lote sigue pendiente. Borrar su notificación con el lote pendiente responde 409. Luego se **rechaza** con un motivo (`POST /api/notificaciones/lotes/:id/rechazar`): `lotes_carga` guarda el motivo, quién y cuándo, y el cliente (migración 034); su notificación ya se puede borrar (200) y el lote sigue mostrando el motivo, quién lo rechazó y su cliente, también en el filtro de la lista.
8. **Clientes, contratos y áreas:** RUC con provincia inválida (400), nombre de solo espacios (400), RUC repetido (409), el operador no crea clientes (403) y un id que no es número (400). Un cliente nuevo con un contrato «Todo como Color» (como lo mandaba la web) queda guardado como «Todo como color», el valor que entiende la facturación; un costo negativo responde 400; editar solo un costo conserva lo demás, y reenviar lo que devolvió el GET (con `costo_x_excedente_*`) conserva el excedente; un contrato superpuesto se guarda con un aviso que describe el otro por sus fechas, sin su id. Al desactivar el cliente caen sus contratos y al reactivarlo vuelve **solo** el que cayó con él (no el que se había desactivado aparte). En áreas: nombre repetido en el mismo cliente (409, sin distinguir mayúsculas), desactivar un área con máquinas asignadas (409, sigue activa), moverla a otro cliente (409) y editar sin mandar «activo» la deja activa. Con un área desactivada a mano, desactivar y reactivar el cliente devuelve **solo** el área que cayó con él, y la auditoría de las áreas muestra el alta, el cambio, la baja a mano, la baja con el cliente (con su marca) y la vuelta.

## Cómo leer el resultado

Al final siempre sale el resumen, y el código de salida es **1** si algo falló (sirve para el CI):

```text
======================================================================
154 comprobaciones, 0 fallos · 45 s
======================================================================
```

Si algo falla, la línea lleva ✗ y debajo el detalle: casi siempre `esperado … , obtenido …` o el código HTTP y el mensaje de la API. El resumen repite cada fallo con su sección entre corchetes:

```text
  ✗ 2026-10 · SIMB0002: consumo B/N 9.930 · color 0
      lectura esperado {"bn":373108,"color":0}, obtenido {"bn":373108,"color":0}; consumo esperado {"bn":9930,"color":0}, obtenido {"bn":373108,"color":0}
...
154 comprobaciones, 1 fallos · 46 s

Fallos:
  ✗ [3. Consolidado contra el cálculo a mano del escenario (contadoresAlCierre)] 2026-10 · SIMB0002: consumo B/N 9.930 · color 0 — ...
```

Cómo leerlo: el «esperado» sale del escenario (lo que tendría que dar a mano) y el «obtenido» es lo que respondió la API. En el ejemplo, el consumo es igual a la lectura completa: el consolidado no encontró la lectura del mes anterior.

- Si falla un paso del que dependen los demás (el `.env`, Docker, levantar el sistema, la carga de datos o el inicio de sesión), sale `La prueba se cortó aquí` y no sigue.
- Para investigar, vuelve a correrla con `npm run e2e -- --dejar-arriba` y mira el sistema de la prueba: la web en http://localhost:8099 (usuarios de siempre), los mensajes de la API con `docker compose -p printflow-e2e logs api` y la base con `docker compose -p printflow-e2e exec db psql -U postgres -d printflow`.

| Ves esto | Qué hacer |
|---|---|
| `✗ Existe el .env del backend` | `npm run configurar` |
| `✗ Docker está corriendo` | Abre Docker Desktop y espera «Engine running» |
| `✗ docker compose up -d --build ...` con `port is already allocated` | Otro programa usa 8099 o 5499: cambia `E2E_WEB_PORT` o `E2E_DB_PORT` |
| `✗ docker compose up -d --build ...` con `unable to prepare context` | El frontend no está al lado del backend (ver `probar.md`, paso 2) o falta `FRONTEND_PATH` |
| `✗ La API responde ...` | Mira `docker compose -p printflow-e2e logs api` con `--dejar-arriba` |
| `✗ ... el n8n simulado procesó 0 de 2 correos` | La ingesta rechazó los correos: el detalle dice cuáles quedaron en `con-error` |
