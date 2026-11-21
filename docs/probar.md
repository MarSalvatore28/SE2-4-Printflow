# Cómo probar PrintFlow, paso a paso

Esta guía está pensada para que **cualquiera** del equipo levante el sistema en su compu y lo pruebe, aunque nunca haya usado Docker ni Postman. Sigue los pasos **en orden**. Después de cada paso dice **qué deberías ver**: si ves eso, sigue; si no, ve a la sección [12. Si algo falla](#12-si-algo-falla).

**No hay que pedirle claves ni credenciales a nadie.** Cada uno genera las suyas con un comando (paso 3) y los usuarios de prueba son los mismos para todos (paso 6).

## Índice

1. [Instalar lo necesario (una sola vez)](#1-instalar-lo-necesario-una-sola-vez)
2. [Descargar los dos repos (una sola vez)](#2-descargar-los-dos-repos-una-sola-vez)
3. [Crear tu `.env` con tus claves (una sola vez)](#3-crear-tu-env-con-tus-claves-una-sola-vez)
4. [Levantar el sistema](#4-levantar-el-sistema)
5. [Cargar los datos de prueba](#5-cargar-los-datos-de-prueba)
6. [Entrar a la web](#6-entrar-a-la-web)
7. [El token: qué es y cómo sacarlo](#7-el-token-qué-es-y-cómo-sacarlo)
8. [Probar la seguridad](#8-probar-la-seguridad)
9. [Correr las pruebas automáticas](#9-correr-las-pruebas-automáticas)
10. [Probar el PR de un compañero](#10-probar-el-pr-de-un-compañero)
11. [Apagar, actualizar o empezar de cero](#11-apagar-actualizar-o-empezar-de-cero)
12. [Si algo falla](#12-si-algo-falla)
13. [SonarCloud](#13-sonarcloud)
14. [Reglas](#14-reglas)

> **Dónde se escriben los comandos:** en **PowerShell**. Para abrirlo, aprieta la tecla de Windows, escribe `PowerShell` y presiona Enter. Copia cada comando, pégalo con clic derecho y presiona Enter. Escribe **un comando a la vez** y espera a que termine (vuelve a aparecer `PS C:\...>`) antes de pegar el siguiente.

---

## 1. Instalar lo necesario (una sola vez)

| Programa | Para qué | Dónde se baja |
|---|---|---|
| **Git** | Descargar los repos y subir tus cambios | https://git-scm.com/download/win (instalar con las opciones por defecto) |
| **Docker Desktop** | Levantar la base, la API y la web con un comando | https://www.docker.com/products/docker-desktop/ |
| **Node.js 22** (recomendado) | `npm run configurar`, `npm run token` y `npm test` | https://nodejs.org/ (versión 22 LTS) |
| **Postman** (opcional) | Probar la API con clics | https://www.postman.com/downloads/ |

Si no puedes instalar Node, igual puedes hacer todo: cada paso trae su versión **«sin Node»** con Docker.

**Comprueba que quedaron instalados.** Cierra y vuelve a abrir PowerShell, y escribe:

```powershell
git --version
docker --version
node -v
```

**Deberías ver** algo así (los números pueden ser otros):

```text
git version 2.47.1.windows.1
Docker version 28.5.1, build e180ab8
v22.14.0
```

**Docker Desktop tiene que estar abierto** cada vez que uses PrintFlow: ábrelo desde el menú de inicio y espera a que abajo a la izquierda diga **«Engine running»** (en verde). Para comprobarlo:

```powershell
docker info --format "{{.ServerVersion}}"
```

**Deberías ver** un número, por ejemplo `28.5.1`. Si dice `error during connect` o `cannot find the file specified`, Docker Desktop no está abierto o todavía está arrancando: espera un minuto y repite.

## 2. Descargar los dos repos (una sola vez)

Los dos repos tienen que quedar **uno al lado del otro** en la misma carpeta, porque Docker arma la web desde `..\SE2-4-Printflow-Frontend`.

```powershell
mkdir C:\printflow
cd C:\printflow
git clone https://github.com/MarSalvatore28/SE2-4-Printflow.git
git clone https://github.com/MarSalvatore28/SE2-4-Printflow-Frontend.git
```

**Deberías ver**, por cada repo, unas líneas que terminan en `Resolving deltas: 100% ... done.`. Después comprueba:

```powershell
dir C:\printflow
```

Tienen que aparecer **las dos carpetas**: `SE2-4-Printflow` y `SE2-4-Printflow-Frontend`.

> ¿Ya los tenías descargados de antes? Entonces no los clones otra vez. Actualízalos (con `git checkout develop` y `git pull` en cada uno, ver [paso 11](#11-apagar-actualizar-o-empezar-de-cero)).
> Si al hacer `git push` te dice `Permission denied` o `403`, acepta la invitación al repo que te llegó por correo (o entra a https://github.com/MarSalvatore28/SE2-4-Printflow/invitations).

## 3. Crear tu `.env` con tus claves (una sola vez)

El sistema necesita un archivo `.env` con tres claves: la contraseña de la base (`DB_PASSWORD`), la clave que firma los tokens (`SECRET_KEY`) y el token de la ingesta (`INGESTA_TOKEN`). **No se las pidas a nadie:** este comando las genera al azar, solo para tu compu.

```powershell
cd C:\printflow\SE2-4-Printflow
npm run configurar
```

**Deberías ver:**

```text
Creé el .env a partir de .env.example.
  Claves nuevas generadas al azar: DB_PASSWORD, SECRET_KEY, INGESTA_TOKEN
Siguiente paso: docker compose up -d --build
```

Si lo corres otra vez, dice `Tu .env ya estaba completo: no cambié nada.`. Es normal: **nunca** cambia lo que ya tiene valor. Si un día se agregan variables nuevas a `.env.example`, vuelve a correrlo y las agrega solas.

**Sin Node instalado**, el mismo paso con Docker (desde la misma carpeta):

```powershell
docker run --rm -v "${PWD}:/app" -w /app node:22-slim node scripts/configurar.js
```

> El `.env` es **tuyo**: no lo subas, no lo mandes por el grupo y no copies el de otra persona. Ya está en `.gitignore`, así que Git no lo sube aunque hagas `git add .`.

## 4. Levantar el sistema

Desde la carpeta del backend:

```powershell
cd C:\printflow\SE2-4-Printflow
docker compose up -d --build
```

La **primera vez** tarda entre 3 y 10 minutos, porque baja las imágenes y arma la web. Las siguientes, menos de un minuto. **Al final deberías ver:**

```text
 Container printflow-db-1  Healthy
 Container printflow-api-1  Started
 Container printflow-web-1  Started
```

Comprueba que los servicios están arriba:

```powershell
docker compose ps
```

**Deberías ver** `api`, `db`, `web` y `n8n` con estado `Up`, y `db` con `(healthy)`:

```text
SERVICE   STATUS                    PORTS
api       Up 4 seconds              9000/tcp
db        Up 10 seconds (healthy)   127.0.0.1:5433->5432/tcp
n8n       Up 10 seconds             127.0.0.1:5678->5678/tcp
web       Up 3 seconds              0.0.0.0:8080->80/tcp
```

| Qué | Dirección |
|---|---|
| La web (PrintFlow) | http://localhost:8080 |
| Swagger (la API documentada) | http://localhost:8080/api-docs |
| La base de datos (para pgAdmin o psql) | `127.0.0.1:5433`, usuario `postgres`, la contraseña es `DB_PASSWORD` de tu `.env` |

## 5. Cargar los datos de prueba

La base arranca solo con los 3 usuarios de prueba. Para tener clientes, contratos, máquinas y **3 meses de lecturas ficticias** (agosto a octubre de 2026), corre estos dos comandos (desde `C:\printflow\SE2-4-Printflow`):

**5.1 · Clientes, contratos, áreas y máquinas** (una sola vez por base):

```powershell
docker compose run --rm -T simulador preparar-datos.js | docker compose exec -T db psql -U postgres -d printflow
```

**Deberías ver**, al final:

```text
 Simulación lista: 5 máquinas asignadas
(1 row)
```

**5.2 · Tres meses de correos de las impresoras, procesados y aprobados:**

```powershell
docker compose run --rm simulador demo.js
```

Tarda unos segundos. **Deberías ver** que los lotes de cada mes se aprueban (`✓ Lote SIM-2026-08-horizonte (#2) aprobado`) y que el de octubre con errores **no** se puede aprobar (`✗ Lote SIM-2026-10-desconocido ... NO se puede aprobar (HTTP 409)`). Ese rechazo es a propósito: muestra cómo se ve un error. Al final aparece el consolidado con lo que se factura. El número clave es:

```text
Colegio Horizonte (demo) · 2026-10
  ...
  Contrato desde el 2026-01-01: B/N 13.960 págs. (incluidas 5.000): cuota $100.00 + excedente $224.00 · color 679 págs. (incluidas 500): cuota $50.00 + excedente $21.48 · renta $0.00 = $395.48
  Total del cliente: 14.639 páginas · a facturar $395.48
```

Si ves **$395.48**, el sistema funciona completo. Para más escenarios (noviembre, el reemplazo de una máquina o fallas), ve a [`simulador/README.md`](../simulador/README.md).

> Si `demo.js` dice `No hay lotes pendientes de este mes (ya estaban aprobados)`, ya lo habías corrido: los datos ya están. Para empezar de cero, ve al [paso 11](#11-apagar-actualizar-o-empezar-de-cero).

## 6. Entrar a la web

Abre http://localhost:8080 en el navegador y entra con uno de estos usuarios. La contraseña de los tres es **`Printflow2026*`**, con el asterisco al final.

> La contraseña no está escrita en el repo: la base calcula su hash al crearse, con la de `DEMO_PASSWORD` del `.env` (vacía = `Printflow2026*`). Si pones otra, recrea la base (`docker compose down -v` y `docker compose up -d --build`) y pásala a `npm run token` con `--clave` o en la variable `DEMO_PASSWORD`.

| Correo | Rol | Qué puede hacer |
|---|---|---|
| `admin@printflow.local` | admin | Todo, incluidos usuarios, clientes, contratos y máquinas |
| `operador@printflow.local` | operador | Aprobar y rechazar lotes, lectura manual, reprocesar |
| `auditor@printflow.local` | auditor | Solo mirar: cualquier cambio le responde «No tiene permiso» |

**Para ver el importe:** entra como admin → **Informes** → busca «Colegio Horizonte» → año **2026**, mes **10**. La tarjeta **«Facturación del período»** tiene que decir **TOTAL DEL CONTRATO $ 395.48**. Con el botón **Exportar en PDF** se baja el mismo informe en PDF.

## 7. El token: qué es y cómo sacarlo

**Qué es:** la API no deja usar nada sin haber iniciado sesión. Cuando inicias sesión (`POST /api/auth/login` con correo y contraseña), la API te da un **token**: un texto largo que empieza con `eyJ...`. Funciona como una pulsera de entrada: en cada petición lo mandas en la cabecera `Authorization: Bearer <token>` y la API sabe quién eres y qué rol tienes.

- El token **dura 30 minutos sin uso**. Cada respuesta trae uno renovado en la cabecera `X-Nuevo-Token`, así que mientras uses la API no vence.
- El token **solo sirve en tu compu**, porque lo firma tu `SECRET_KEY`. Uno sacado en la compu de otra persona te da `401 Token inválido`.
- La web hace todo esto sola. Solo necesitas el token para probar la API **directamente**: con Postman, con Swagger o desde la terminal.

Elige **una** de estas tres formas.

### 7.a · Postman (recomendado: el token se guarda solo)

1. Abre Postman. Si te pide cuenta, puedes crear una gratis o elegir **«Continue without an account»** si aparece.
2. Arriba a la izquierda: **Import** → **files** (o arrastra el archivo) → elige:
   `C:\printflow\SE2-4-Printflow\docs\postman\PrintFlow.postman_collection.json`
3. A la izquierda, en **Collections**, aparece **PrintFlow API**. Ábrela: tiene las carpetas `0 · Sesión`, `1 · Catálogos`, `2 · Lotes`, `3 · Lectura manual`, `4 · Informes` y `5 · Seguridad`.
4. Abre **0 · Sesión → Iniciar sesión · admin** y aprieta el botón azul **Send**.
5. **Deberías ver** abajo `Status: 200 OK`, una respuesta con `"success": true` y `"token": "eyJ..."`, y en la pestaña **Test Results** `PASS Sesión iniciada`. **Listo:** el token quedó guardado.
6. Ahora abre cualquier otra petición (por ejemplo **4 · Informes → Consolidado del cliente y mes**) y aprieta **Send**. Usa el token solo: **no tienes que copiar ni pegar nada**.

Cosas que conviene saber:

- **Cambiar de rol:** ejecuta otro «Iniciar sesión» (operador o auditor). El último que ejecutes es el que queda.
- **Variables:** haz clic en **PrintFlow API** → pestaña **Variables**:
  - `baseUrl` es la dirección de la API (`http://localhost:8080`; cámbiala si usas otro `WEB_PORT`).
  - `clienteId`, `periodo`, `loteId`, `stagingId` e `instalacionId` son los datos que usan las peticiones. Algunas peticiones los llenan solas: por ejemplo, **Buscar Colegio Horizonte por RUC** guarda `clienteId`, y **Lotes pendientes** guarda `loteId` y `stagingId`.
  - Para la lectura manual, copia el `id_instalacion` que devuelve **Instalaciones del cliente** en `instalacionId`.
- **Correr todo de una:** clic derecho en **PrintFlow API** → **Run collection** → **Run PrintFlow API**. **Deberías ver** todas las comprobaciones en verde (22 peticiones y 12 comprobaciones, 0 fallos).
  - Algunas respuestas son 400, 403 o 409 a propósito: por ejemplo, aprobar un lote con errores da 409 y la carpeta de seguridad espera 401 y 403. Lo que importa es que **Failed** diga **0**.

### 7.b · Swagger (en el navegador, sin instalar nada)

1. Abre http://localhost:8080/api-docs
2. Busca la sección **Auth** → **POST /api/auth/login** → clic para abrirla → botón **Try it out**.
3. El cuerpo ya viene con el usuario admin escrito. Aprieta **Execute**.
4. Más abajo, en **Response body**, copia el texto del `"token"`, **sin las comillas**.
5. Sube al inicio de la página → botón verde **Authorize** (con un candado).
6. Pega el token en el campo **Value**. **Sin** la palabra `Bearer`: Swagger la agrega sola. Después: **Authorize** → **Close**.
7. Listo: cualquier **Try it out** → **Execute** va con tu sesión. El candado se ve cerrado. El token se mantiene aunque recargues la página.

**Si ves 401:** el token no se pegó bien o venció. Repite los pasos 2 a 6.

### 7.c · Terminal

Desde `C:\printflow\SE2-4-Printflow`:

```powershell
npm run token                    # token del admin
npm run token -- operador        # token del operador (o: auditor)
```

**Deberías ver:**

```text
Sesión iniciada como operador@printflow.local (rol: operador). El token dura 30 min sin uso.

eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6Mi...

Cómo usarlo:
  Postman  · ...
```

Para usarlo directo en PowerShell, guárdalo en una variable y llama a la API:

```powershell
$t = npm run -s token -- operador --solo
Invoke-RestMethod http://localhost:8080/api/auth/perfil -Headers @{ Authorization = "Bearer $t" }
```

**Deberías ver** tus datos (`success: True`, `usuario: @{id=2; nombre=...}`).

**Sin Node instalado:** `docker compose run --rm simulador token.js operador`

## 8. Probar la seguridad

La forma rápida es **Postman → carpeta `5 · Seguridad` → clic derecho → Run folder**. Cada petición comprueba sola el código esperado. **Deberías ver** todo en verde.

A mano, esto es lo que **tiene** que pasar:

| # | Caso | Qué haces | Respuesta esperada |
|---|---|---|---|
| 1 | Sin token | `GET http://localhost:8080/api/auth/perfil` sin la cabecera `Authorization` | **401** «No hay token, autorización denegada» |
| 2 | Token falso | La misma petición con `Authorization: Bearer cualquier-cosa` | **401** «Token inválido» |
| 3 | Token vencido | Un token de hace más de 30 minutos sin uso | **401** «Token inválido» |
| 4 | Contraseña incorrecta | `POST /api/auth/login` con otra contraseña | **401** «Credenciales incorrectas o usuario inactivo» |
| 5 | Rol sin permiso | Inicia sesión como **auditor** y haz `POST /api/staging/approve-batch` | **403** |
| 6 | Ingesta desde fuera | `POST http://localhost:8080/api/ingesta/cargar` | **403**: nginx la bloquea, porque solo n8n o el simulador la usan por dentro de Docker |
| 7 | Sesión deslizante | Cualquier petición válida | La respuesta trae la cabecera `X-Nuevo-Token` (en Postman, pestaña **Headers** de la respuesta) |
| 8 | Sesión revocada | Como admin, cámbiale la contraseña (o el rol) a un usuario y usa el token que ese usuario tenía | **401** «Tu sesión terminó: inicia sesión de nuevo». En la web, al usuario lo manda al login con el aviso de sesión terminada |

En la web:
- Como **auditor**, intenta aprobar un lote en **Notificaciones → Lotes → Ver detalle → Aprobar**: tiene que decir «No tiene permiso para esta acción».
- Sin iniciar sesión, entra a http://localhost:8080/informes: te tiene que mandar al login.

### Cómo está armada (para quien la programa o la prueba)

| Pieza | Archivo | Qué hace |
|---|---|---|
| Login | `src/controllers/usuario/usuario.controller.js` (`loginUsuario`) | Compara la contraseña con `bcrypt` y firma el token con `SECRET_KEY` |
| Firmar y verificar | `src/utils/jwt.util.js` | `generateToken(payload)` (vence a los 30 min) y `verifyToken(token)` (lanza un error si es falso o venció) |
| Exigir token | `src/middlewares/auth.middleware.js` (`protect`) | 401 si falta, es inválido o es de una versión de sesión anterior (`sesionVigente`); deja al usuario en `req.user` y agrega `X-Nuevo-Token` |
| Rutas públicas | `src/app.js` (`RUTAS_PUBLICAS`) | Solo `/api/auth/login` y `/api/auth/validate-token`. La ingesta usa su propio token |
| Permisos por rol | `src/middlewares/role.middleware.js` (`requireRole`) | 403 si el rol del usuario no está en la lista. Ejemplo: `requireRole('admin', 'operador')` |
| Token de la ingesta | `src/middlewares/ingesta.middleware.js` | Exige `Authorization: Bearer <INGESTA_TOKEN>`; responde 503 si no está configurado |

**Para escribir pruebas automáticas de esto** no hace falta base de datos ni Docker:

```js
process.env.SECRET_KEY = 'test';          // antes de usar jwt.util
require('module-alias/register');
const { generateToken, verifyToken } = require('@utils/jwt.util');
```

Para probar `protect` y `requireRole`, simula `req`, `res` y `next` como hace [`test/roles.test.js`](../test/roles.test.js).

## 9. Correr las pruebas automáticas

No necesitan `.env`, base de datos ni Docker. Desde `C:\printflow\SE2-4-Printflow`:

```powershell
npm install      # solo la primera vez, o cuando cambie package.json
npm test
```

**Deberías ver**, al final (el número de pruebas crece con el tiempo):

```text
# tests 153
# pass 153
# fail 0
```

Lo que importa es **`# fail 0`**. Si algo falla, arriba aparece `not ok` con el nombre de la prueba y el error.

Para correr **un solo archivo**: `node --test test/facturacion.test.js`

**Sin Node instalado:**

```powershell
docker run --rm -v "${PWD}:/app" -v printflow_test_modules:/app/node_modules -w /app node:22-slim sh -c "npm ci && npm test"
```

> **Ojo:** `docker compose exec api node --test ...` **no funciona**, porque la imagen de la API no trae la carpeta `test/`. Usa uno de los dos comandos de arriba.

**Prueba de punta a punta (E2E):** `npm run e2e` (con Docker abierto) levanta una copia aparte del sistema en los puertos 8099 y 5499, sin tocar tu base, recorre la demo completa (agosto a noviembre, validaciones, reemplazo y seguridad) y la baja. Tarda unos 40 segundos y tiene que terminar en `0 fallos`. `npm test` no la ejecuta. Qué comprueba y cómo leer un fallo: [`e2e.md`](e2e.md).

**Frontend:** en `C:\printflow\SE2-4-Printflow-Frontend`, `npm install` y `npm run build` (tiene que terminar en `✓ built in ...`). Para las pruebas, `npm test`, que necesita Node 22.22 o más nuevo.

## 10. Probar el PR de un compañero

1. **Baja su rama** (el nombre está en el PR, arriba: `quiere fusionar ... desde feature/...`):

   ```powershell
   cd C:\printflow\SE2-4-Printflow
   git fetch
   git checkout feature/nombre-de-la-rama
   ```

2. **¿El PR agrega un archivo en `db/migrations/`?** Aplícalo a tu base, sin borrar tus datos (la base tiene que estar prendida):

   ```powershell
   npm run migrar
   ```

   Sin Node: `docker compose exec -T db sh /printflow-db/migrar.sh`. Tiene que terminar en `migración(es) aplicada(s)` o `está al día`. Si prefieres empezar de cero, `docker compose down -v` (**borra tus datos locales**).

3. **Levanta con su código**, carga los datos si recreaste la base (paso 5) y sigue lo que dice su «Cómo probarlo»:

   ```powershell
   npm run configurar               # por si el PR agregó variables al .env.example
   docker compose up -d --build
   ```

4. **Corre las pruebas:** `npm test` tiene que dar `# fail 0`.
5. **Deja tu revisión en el PR:** pestaña **Files changed** → **Review changes**. Elige **Approve** si funciona o **Request changes** si no, con lo que probaste.
6. **Vuelve a `develop`:** `git checkout develop`

Si el PR es del **frontend**, haz lo mismo en `C:\printflow\SE2-4-Printflow-Frontend` y luego `docker compose up -d --build` **desde la carpeta del backend** (Docker arma la web desde la carpeta del frontend).

## 11. Apagar, actualizar o empezar de cero

Todo desde `C:\printflow\SE2-4-Printflow`:

| Quiero… | Comando | ¿Borra los datos? |
|---|---|---|
| Apagar el sistema | `docker compose down` | No |
| Volver a prenderlo | `docker compose up -d` | No |
| Traer lo último de `develop` | `git checkout develop`, `git pull`, `docker compose up -d --build` y `npm run migrar` (y lo mismo con `git pull` en el frontend) | No |
| Empezar de cero (base nueva y migraciones nuevas) | `docker compose down -v`, `docker compose up -d --build` y luego el paso 5 | **Sí** |
| Ver los mensajes de la API (para un error) | `docker compose logs -f api` (sales con Ctrl+C) | No |

## 12. Si algo falla

| Ves esto | Por qué pasa | Qué hacer |
|---|---|---|
| `error during connect` o `cannot find the file specified` al usar `docker` | Docker Desktop no está abierto o está arrancando | Ábrelo, espera «Engine running» y repite |
| `Falta DB_PASSWORD en el .env` | No tienes `.env` o le faltan claves | `npm run configurar` |
| `npm` no se reconoce como comando | Node no está instalado, o PowerShell se abrió antes de instalarlo | Instala Node 22 y abre otra PowerShell, o usa la versión «sin Node» de cada paso |
| `no configuration file provided` o `no such file` | Estás en otra carpeta | `cd C:\printflow\SE2-4-Printflow` |
| La web no construye: `unable to prepare context` o `path ... not found` | El frontend no está al lado del backend | Revisa el paso 2: deben estar `C:\printflow\SE2-4-Printflow` y `C:\printflow\SE2-4-Printflow-Frontend` |
| `port is already allocated` (8080 o 5433) | Otro programa usa ese puerto | En tu `.env` cambia `WEB_PORT=8081` o `DB_HOST_PORT=5434`, y usa esa dirección (en Postman, cambia `baseUrl`) |
| 401 «No hay token» | La petición no lleva `Authorization: Bearer ...` | En Postman, ejecuta «Iniciar sesión»; en Swagger, **Authorize** |
| 401 «Token inválido» | Venció (30 min sin uso), es de otra compu o cambiaste `SECRET_KEY` | Vuelve a iniciar sesión |
| 401 «Credenciales incorrectas» con `Printflow2026*` | La base es vieja, alguien cambió la contraseña o tu `.env` tiene otra `DEMO_PASSWORD` | `docker compose down -v`, `docker compose up -d --build` y el paso 5 |
| 403 en un POST, PUT o DELETE | Tu rol no tiene permiso (por ejemplo, el auditor) | Inicia sesión como admin u operador |
| 403 en `/api/ingesta` desde Postman o el navegador | Es a propósito: la ingesta solo se acepta desde dentro de Docker | Usa el simulador: `docker compose run --rm simulador procesar-buzon.js` |
| 503 «Ingesta no configurada» | `INGESTA_TOKEN` vacío en tu `.env` | `npm run configurar` y luego `docker compose up -d` |
| `password authentication failed for user "postgres"` | La base se creó con otra `DB_PASSWORD` | `docker compose down -v` y vuelve a levantar |
| Una tabla o columna nueva «does not exist» | Una migración nueva no se aplicó a tu base | `npm run migrar` (sin Node: `docker compose exec -T db sh /printflow-db/migrar.sh`) |
| 404 «Ruta no encontrada» | La dirección está mal escrita o tu código es viejo | Revísala en Swagger; haz `git pull` y `docker compose up -d --build` |
| Los cambios que hiciste no se ven | La imagen se armó con el código anterior | `docker compose up -d --build` (el `--build` es lo que la rehace) |

¿Sigue sin funcionar? Escribe en el grupo **qué comando corriste** y **el mensaje completo** que salió, y agrega el resultado de `docker compose ps` y de `docker compose logs --tail 50 api`. **No pegues tu `.env`.**

## 13. SonarCloud

Los dos proyectos son públicos: **no necesitas cuenta** para ver los resultados.

- Backend: https://sonarcloud.io/project/overview?id=MarSalvatore28_SE2-4-Printflow
- Frontend: https://sonarcloud.io/project/overview?id=MarSalvatore28_SE2-4-Printflow-Frontend

El análisis corre solo cada vez que abres o actualizas un PR. No hay que configurar nada ni usar tokens. En el PR, el bot **sonarqubecloud** deja un comentario:

- **Quality Gate passed** (verde): listo.
- **Quality Gate failed** (rojo): haz clic en **«New issues»** del comentario. Cada problema dice el archivo, la línea y cómo arreglarlo. Corrígelo en tu rama, haz `git push` y el análisis vuelve a correr solo.

## 14. Reglas

- **Nunca** subas tu `.env` ni lo pegues en el grupo, en un PR o en una captura.
- Los usuarios y la contraseña `Printflow2026*` son **solo para tu compu**. En producción se cambian (ver [`docs/despliegue.md`](despliegue.md)).
- En las capturas de un PR no hace falta tapar el token local: dura 30 minutos y solo sirve en tu compu. Las claves de producción, **nunca**.
- Datos reales de clientes de DOX: **nunca** en el repo. Para probar, usa siempre los datos del simulador.
