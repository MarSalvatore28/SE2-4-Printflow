# Cómo probar PrintFlow

Todo lo que necesitas está en el repo. **No hay que pedirle claves ni credenciales a nadie**: cada uno genera las suyas con un comando y los usuarios de prueba son los mismos para todos.

## 1. Levantar el sistema (una sola vez)

Los dos repos deben estar **en la misma carpeta**:

```powershell
mkdir C:\printflow; cd C:\printflow
git clone https://github.com/MarSalvatore28/SE2-4-Printflow.git
git clone https://github.com/MarSalvatore28/SE2-4-Printflow-Frontend.git

cd SE2-4-Printflow
npm run configurar            # crea tu .env con claves nuevas al azar
docker compose up -d --build  # base, API y web en http://localhost:8080
```

`npm run configurar` crea el `.env` a partir de `.env.example` y llena solas las claves (`DB_PASSWORD`, `SECRET_KEY` e `INGESTA_TOKEN`). Si ya tenías un `.env`, solo completa lo que falta y agrega las variables nuevas: nunca cambia lo que ya tiene valor. Puedes correrlo cuantas veces quieras.

**Sin Node instalado**, el mismo comando con Docker:

```powershell
docker run --rm -v "${PWD}:/app" -w /app node:22-slim node scripts/configurar.js
```

**Datos de prueba** (clientes, máquinas y 3 meses de lecturas ficticias):

```powershell
docker compose run --rm -T simulador preparar-datos.js | docker compose exec -T db psql -U postgres -d printflow
docker compose run --rm simulador demo.js
```

## 2. Usuarios de prueba

Vienen en la base desde que se crea (`db/seeds/002_usuarios_prueba.sql`). Contraseña de los tres: **`Printflow2026*`**

| Usuario | Rol | Qué puede hacer |
|---|---|---|
| `admin@printflow.local` | admin | todo, incluidos usuarios y catálogos |
| `operador@printflow.local` | operador | aprobar lotes, lectura manual, reprocesar |
| `auditor@printflow.local` | auditor | solo ver (cualquier cambio responde 403) |

## 3. El token: cómo llamar a la API

Todas las rutas de `/api` piden un **token** (JWT), salvo el login. Funciona así:

1. `POST /api/auth/login` con correo y contraseña. La respuesta trae `token`.
2. En cada petición mandas la cabecera `Authorization: Bearer <token>`.
3. El token dura **30 minutos sin uso**. Cada respuesta trae uno renovado en la cabecera `X-Nuevo-Token`, así que mientras uses la API la sesión no vence.

Elige la forma que te sea más cómoda.

### a) Postman (recomendado)

1. En Postman: **Import** y elige [`docs/postman/PrintFlow.postman_collection.json`](postman/PrintFlow.postman_collection.json).
2. Ejecuta **0 · Sesión → Iniciar sesión · admin** (u operador o auditor).
3. Listo: el token queda guardado y **todas las demás peticiones lo usan solas**. También guarda el token renovado de cada respuesta.

La colección trae peticiones ya armadas para catálogos, lotes, aprobar, reprocesar, lectura manual e informes. Algunas guardan solas los ids que usan las siguientes: `clienteId`, `loteId` y `stagingId`, en la pestaña **Variables** de la colección. La carpeta **5 · Seguridad** comprueba sola lo que debe fallar (ver abajo). Con **Run collection** se corre todo de una.

La dirección es `http://localhost:8080`. Si cambiaste `WEB_PORT`, cambia la variable `baseUrl`.

### b) Swagger (en el navegador, sin instalar nada)

1. Abre http://localhost:8080/api-docs
2. **Auth → POST /api/auth/login → Try it out → Execute**. Ya trae el usuario admin escrito.
3. Copia el `token` de la respuesta, sin las comillas.
4. Botón **Authorize** (arriba a la derecha) → pega el token (**sin** la palabra `Bearer`) → **Authorize**.
5. Desde ahí, cualquier **Try it out** va con tu sesión. El token se mantiene aunque recargues la página.

### c) Terminal

```powershell
npm run token                    # token del admin
npm run token -- operador        # o auditor
```

Lo muestra junto con ejemplos para copiar. Para usarlo directo en PowerShell:

```powershell
$t = npm run -s token -- operador --solo
Invoke-RestMethod http://localhost:8080/api/reportes/consolidado/1/2026-10 -Headers @{ Authorization = "Bearer $t" }
```

Sin Node instalado: `docker compose run --rm simulador token.js operador`.

## 4. Probar la seguridad (lo que debe fallar)

La carpeta **5 · Seguridad** de Postman lo comprueba sola. A mano:

| Caso | Qué se hace | Respuesta esperada |
|---|---|---|
| Sin token | `GET /api/auth/perfil` sin cabecera `Authorization` | **401** «No hay token, autorización denegada» |
| Token falso o vencido | `Authorization: Bearer cualquier-cosa` | **401** «Token inválido» |
| Contraseña incorrecta | `POST /api/auth/login` con otra clave | **401** «Credenciales incorrectas o usuario inactivo» |
| Rol sin permiso | Como auditor: `POST /api/staging/approve-batch` | **403** |
| Ingesta desde fuera | `POST http://localhost:8080/api/ingesta/cargar` | **403** (nginx la bloquea; solo n8n o el simulador la usan por dentro de Docker) |
| Sesión deslizante | Cualquier petición válida | Trae la cabecera `X-Nuevo-Token` |

### Cómo está armada (para quien la toca o la prueba)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Login | `src/controllers/usuario/usuario.controller.js` (`loginUsuario`) | Compara la contraseña con `bcrypt` y firma el token con `SECRET_KEY` |
| Firmar y verificar | `src/utils/jwt.util.js` | `generateToken(payload)` (30 min) y `verifyToken(token)` |
| Exigir token | `src/middlewares/auth.middleware.js` (`protect`) | 401 si falta o es inválido; deja el usuario en `req.user` y agrega `X-Nuevo-Token` |
| Rutas públicas | `src/app.js` (`RUTAS_PUBLICAS`) | Solo `/api/auth/login` y `/api/auth/validate-token`; la ingesta usa su propio token |
| Permisos por rol | `src/middlewares/role.middleware.js` (`requireRole`) | 403 si el rol del usuario (leído de la base) no está en la lista |
| Token de ingesta | `src/middlewares/ingesta.middleware.js` | `Authorization: Bearer <INGESTA_TOKEN>`; 503 si no está configurado |

Para **pruebas automáticas** de esto no hace falta base de datos ni Docker: en el test pon `process.env.SECRET_KEY = 'test'` antes de hacer `require('module-alias/register')` y usa `generateToken` o `verifyToken`. Para probar `protect` y `requireRole`, simula `req`, `res` y `next`; `test/roles.test.js` sirve de ejemplo.

**Cada uno tiene su propia `SECRET_KEY`**: un token sacado en la compu de otra persona no sirve en la tuya (da 401 «Token inválido»). Es lo esperado.

## 5. Pruebas automáticas

No necesitan `.env` ni base de datos:

```powershell
npm install
npm test
```

Sin Node instalado:

```powershell
docker run --rm -v "${PWD}:/app" -v printflow_test_modules:/app/node_modules -w /app node:22-slim sh -c "npm ci && npm test"
```

La imagen de la API **no trae** la carpeta `test/`, así que `docker compose exec api node --test …` no funciona: usa uno de los dos comandos de arriba.

## 6. SonarCloud

Los dos proyectos son públicos: **no necesitas cuenta** para ver los resultados.

- Backend: https://sonarcloud.io/project/overview?id=MarSalvatore28_SE2-4-Printflow
- Frontend: https://sonarcloud.io/project/overview?id=MarSalvatore28_SE2-4-Printflow-Frontend

En cada PR, el bot de SonarCloud deja un comentario con el enlace a los problemas de **ese PR** («New issues»). El análisis corre solo al abrir o actualizar el PR: no hay que configurar ni tokens ni nada.

## 7. Si algo falla

| Ves esto | Qué pasa | Qué hacer |
|---|---|---|
| `Falta DB_PASSWORD en el .env` al hacer `docker compose up` | No tienes `.env`, o le faltan claves | `npm run configurar` |
| 401 «No hay token» | La petición no lleva `Authorization: Bearer …` | En Postman, ejecuta «Iniciar sesión»; en Swagger, **Authorize** |
| 401 «Token inválido» | Venció (30 min sin uso), es de otra compu o cambiaste `SECRET_KEY` | Vuelve a iniciar sesión |
| 401 «Credenciales incorrectas» con `Printflow2026*` | La base se creó antes de los usuarios de prueba, o alguien les cambió la clave | `docker compose down -v` y `docker compose up -d --build` (borra los datos locales) |
| 403 en un POST, PUT o DELETE | Tu rol no tiene permiso (por ejemplo, el auditor) | Inicia sesión como admin u operador |
| 403 en `/api/ingesta` desde el navegador o Postman | Es a propósito: la ingesta solo se acepta desde dentro de Docker | Usa el simulador: `docker compose run --rm simulador procesar-buzon.js` |
| 503 «Ingesta no configurada» | `INGESTA_TOKEN` vacío en tu `.env` | `npm run configurar` y `docker compose up -d` |
| `password authentication failed for user "postgres"` | La base se creó con otra `DB_PASSWORD` | `docker compose down -v` y vuelve a levantar |
| El puerto 8080 o 5433 está ocupado | Otro programa lo usa | Cambia `WEB_PORT` o `DB_HOST_PORT` en tu `.env` |
| Una migración nueva no se aplicó | Las migraciones solo corren al crear la base | `docker compose down -v` y `docker compose up -d --build` |

## 8. Reglas

- **Nunca** subas tu `.env` ni lo pegues en el grupo. Ya está en `.gitignore`.
- Los usuarios y la contraseña de arriba son **solo para tu compu**. En producción se cambian (ver `docs/despliegue.md`).
- En las capturas de un PR no hace falta tapar el token local: dura 30 minutos y solo sirve en tu compu. Las claves de producción, nunca.
