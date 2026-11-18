# Tareas de Kiara · Equipo A (QA)

| | |
|---|---|
| **Quién** | Kiara Morán (`@Kcmoranj`) · QA del Equipo A |
| **Repos** | Backend `SE2-4-Printflow` (este) y frontend `SE2-4-Printflow-Frontend` |
| **Estado del proyecto** | Fases 0, 1 (sin máquinas) y 2 del backend en `main` · simulador del flujo de correo listo (`simulador/README.md`) |
| **Dudas** | Escríbele a Marlo |

Son 6 tareas. El código de las tareas 2, 3 y 4 ya está escrito y probado, así que solo tienes que copiarlo, probarlo y abrir el PR. Haz **cada tarea en su rama** y **cada mejora en un commit aparte**, para que se vea tu trabajo.

| # | Tarea | Repo | Tiempo aprox. | Estado |
|---|---|---|---|---|
| 1 | Mergear el PR #2 (CODEOWNERS) | backend | 5 min | Aprobado por ti el 18/11 · **falta el merge** |
| 2 | CODEOWNERS del frontend | frontend | 15 min | Pendiente |
| 3 | API más robusta: 404 en JSON, validar el `.env` y tests de la API | backend | 45 min | Pendiente |
| 4 | CI: prueba de humo y simulación completa | backend | 40 min | Pendiente |
| 5 | QA de lo que está en `main` | ambos | 1 h | Pendiente |
| 6 | Guion de la demo | — | 20 min | Pendiente |

> **Importante:** hasta hoy no hay ningún commit tuyo en GitHub. Si hiciste cambios en tu PC, súbelos: `git status`, `git log --oneline -5` y `git push -u origin <tu-rama>`.

---

## 0. Antes de empezar

```powershell
cd C:\printflow\SE2-4-Printflow
git checkout develop
git pull
npm install
npm run verificar
```

Resultado esperado: `OK: la app carga sin errores`.

En tu `.env` deben tener valor `DB_PASSWORD`, `SECRET_KEY` e `INGESTA_TOKEN`. Si el puerto 8080 está ocupado, pon `WEB_PORT=8081`.

---

## Tarea 1 · Mergear el PR #2

Ya lo aprobaste. Falta el merge:

1. Abre https://github.com/MGabrielaVillon/SE2-4-Printflow/pull/2
2. Comprueba que el CI esté en verde
3. **Merge pull request** → **Confirm merge**

---

## Tarea 2 · CODEOWNERS del frontend

El frontend no tiene `CODEOWNERS`. Con este archivo, GitHub te pide la revisión automáticamente cuando alguien toca Docker, nginx o el CI.

```powershell
cd C:\printflow\SE2-4-Printflow-Frontend
git checkout develop
git pull
git checkout -b feature/f0-codeowners-front
```

Crea `.github/CODEOWNERS` (sin extensión):

```text
# Dueños por módulo: GitHub pide su revisión automáticamente en cada PR.
# Ver PLAN.md del backend, sección 3.

# Equipo A · Kiara + Marlo
/.github/                    @Kcmoranj @MarSalvatore28
/Dockerfile                  @Kcmoranj @MarSalvatore28
/nginx.conf                  @Kcmoranj @MarSalvatore28

# Equipo B · Gabriela + Roberto (estructura de la web y componentes compartidos)
/src/components/             @MGabrielaVillon @RoberB1
/src/context/                @MGabrielaVillon @RoberB1
/src/services/Auth/          @MGabrielaVillon @RoberB1
/src/app/Auth/               @MGabrielaVillon @RoberB1
```

```powershell
git add .github/CODEOWNERS
git commit -m "chore(github): CODEOWNERS del frontend"
git push -u origin feature/f0-codeowners-front
```

PR a **`develop`** · título `F0 · A · CODEOWNERS del frontend` · revisor: Marlo.

---

## Tarea 3 · API más robusta (backend, 3 commits)

Arregla tres cosas que hoy confunden a los demás equipos:

- Si una ruta no existe, la API responde una página HTML y el frontend falla al leerla como JSON.
- Si `SECRET_KEY` está vacío, el login da **error 500** sin decir por qué.
- Hay tests del simulador, pero **ninguno de la API**.

```powershell
cd C:\printflow\SE2-4-Printflow
git checkout develop
git pull
git checkout -b feature/f0-robustez-api
```

### 3.1 Commit 1 · Ruta no encontrada en JSON

En `src/app.js`, **al final**, justo **antes** de `module.exports = app;`:

```js
// Ruta que no existe: responde JSON (el frontend siempre espera JSON)
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
});

```

> **Ojo:** no toques las líneas con etiquetas (`// [B-F1]`, `// [C-F2]`…). Son de los otros equipos. Tu bloque va **después** de todas ellas.

```powershell
npm run verificar      # OK: la app carga sin errores
git add src/app.js
git commit -m "feat(api): responde 404 en JSON cuando la ruta no existe"
```

### 3.2 Commit 2 · Validar el `.env` al arrancar

Crea `src/config/validarEnv.js`:

```js
// Revisa que el .env tenga las variables obligatorias antes de arrancar la API.
const OBLIGATORIAS = ['DB_PASSWORD', 'SECRET_KEY'];

function validarEnv() {
  const faltan = OBLIGATORIAS.filter((nombre) => !process.env[nombre]);
  if (faltan.length > 0) {
    console.error(`Falta ${faltan.join(' y ')} en el .env. Revisa el .env.example.`);
    process.exit(1);
  }
}

module.exports = { validarEnv };
```

En `src/server.js`, agrega **una línea** entre el `dotenv` y el `require('./app')`:

```js
require('module-alias/register');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
require('./config/validarEnv').validarEnv();
const app = require('./app');
```

> No va en `app.js`: `npm run verificar` y los tests cargan `app.js` sin `.env`.

Pruébalo sin `SECRET_KEY`:

```powershell
$env:DB_PASSWORD = "x"; $env:SECRET_KEY = ""
node src/server.js        # Falta SECRET_KEY en el .env. Revisa el .env.example.  (y se detiene)
Remove-Item Env:DB_PASSWORD, Env:SECRET_KEY
npm run verificar
git add src/config/validarEnv.js src/server.js
git commit -m "feat(api): valida DB_PASSWORD y SECRET_KEY al arrancar"
```

### 3.3 Commit 3 · Tests de la API

Crea `test/app.test.js`:

```js
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');

let server;
let base;

test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => {
    base = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

test.after(() => new Promise((resolve) => server.close(resolve)));

// Fuera de /api: dentro de /api toda ruta exige token y respondería 401
test('una ruta que no existe responde 404 en JSON', async () => {
  const res = await fetch(`${base}/no-existe`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.success, false);
});

test('la API exige token', async () => {
  const res = await fetch(`${base}/api/clientes`);
  assert.equal(res.status, 401);
});

test('la ingesta exige su propio token', async () => {
  const res = await fetch(`${base}/api/ingesta/cargar`, { method: 'POST' });
  assert.ok([401, 503].includes(res.status), `respondió ${res.status}`);
});

test('la documentación de Swagger carga', async () => {
  const res = await fetch(`${base}/api-docs/`);
  assert.equal(res.status, 200);
});
```

```powershell
npm test       # termina con "# fail 0" (son 10 tests: 4 tuyos + 6 del simulador)
git add test/app.test.js
git commit -m "test(api): 404 en JSON, token obligatorio y Swagger"
git push -u origin feature/f0-robustez-api
```

Que salga `Error al conectar a PostgreSQL` es normal: estos tests no usan la base.

PR a **`develop`** · título `F0 · A · API: 404 en JSON, validar .env y tests` · revisor: Marlo. En la descripción avisa al **Equipo C**: «desde ahora, si falta `SECRET_KEY` la API lo dice al arrancar».

---

## Tarea 4 · CI: prueba de humo y simulación completa

Hoy el CI **construye** la imagen de la API, pero nunca la **arranca**. Este job levanta la base y la API, comprueba `/health` y además **corre la simulación del correo de punta a punta**. Si una caja rompe el arranque o el flujo, se nota antes del merge.

Se comprobó en local: con solo `db` y `api` arriba, la simulación aprueba los 6 lotes.

```powershell
cd C:\printflow\SE2-4-Printflow
git checkout develop
git pull
git checkout -b feature/f0-smoke-ci
```

En `.github/workflows/ci.yml`, al **final**, después del job `docker`, con la **misma sangría** que `docker:` (2 espacios):

```yaml
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Crea un .env de prueba
        run: |
          cp .env.example .env
          sed -i 's/^DB_PASSWORD=$/DB_PASSWORD=ci-clave/; s/^SECRET_KEY=$/SECRET_KEY=ci-secreto/; s/^INGESTA_TOKEN=$/INGESTA_TOKEN=ci-ingesta/' .env
          echo "FRONTEND_PATH=." >> .env

      - name: Levanta la base y la API
        run: docker compose up -d --build db api

      - name: La API responde /health
        run: |
          for i in $(seq 1 30); do
            if docker compose exec -T api node -e "fetch('http://localhost:9000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
              echo "OK: la API responde"; exit 0
            fi
            sleep 2
          done
          docker compose logs api db
          exit 1

      - name: Simulación del correo de punta a punta
        run: |
          docker compose run --rm -T simulador preparar-datos.js | docker compose exec -T db psql -U postgres -d printflow -v ON_ERROR_STOP=1
          docker compose run --rm -T simulador demo.js --sin-errores | tee demo.log
          if grep -q "NO se puede aprobar" demo.log; then echo "Hay lotes que no se pudieron aprobar"; exit 1; fi
          grep -q "aprobado" demo.log

      - name: Apaga todo
        if: always()
        run: docker compose down -v
```

> `FRONTEND_PATH=.` está porque el CI no descarga el repo del frontend; el job no levanta la web.

```powershell
git add .github/workflows/ci.yml
git commit -m "ci: prueba de humo y simulación del correo de punta a punta"
git push -u origin feature/f0-smoke-ci
```

PR a **`develop`** · título `F0 · A · CI: prueba de humo y simulación` · revisor: Marlo. Deben salir **tres** checks: `test`, `docker` y `smoke`. Si `smoke` falla, abre el paso en rojo, copia las últimas líneas y pásaselas a Marlo.

---

## Tarea 5 · QA de lo que está en `main`

Prueba en tu PC sobre `main` y deja **un comentario con la lista marcada** en el PR de cada caja. Si algo falla, escribe los pasos para reproducirlo y avísale a Marlo.

```powershell
cd C:\printflow\SE2-4-Printflow;           git checkout main; git pull
cd ..\SE2-4-Printflow-Frontend;            git checkout main; git pull
cd ..\SE2-4-Printflow
docker compose down -v
docker compose up -d --build
docker compose logs db | Select-String "PrintFlow: aplicando"
```

**Base de datos y login** (comentario en el backend #3):

- [ ] Se aplican `001_esquema_inicial`, `002_restricciones`, `004_ingesta_message_id` y los 2 seeds, **sin** `ERROR`
- [ ] Login en http://localhost:8080 con `admin@printflow.local` / `Printflow2026*`. Repítelo con `operador@…` y `auditor@…`
- [ ] Una contraseña incorrecta muestra un error en español y **no** entras
- [ ] Al cerrar sesión vuelves a `/login`

**Estructura web** (comentario en el frontend #2):

- [ ] Sin sesión, `/`, `/clientes` y una ruta inventada te mandan a `/login`
- [ ] Todo en español: «Iniciar sesión» y «Cerrar sesión» con la **s** minúscula

**Clientes, contratos y áreas** (comentario en el backend #4):

- [ ] Crear un cliente con RUC `0999999999001`. Si lo repites, sale «Ya existe un cliente con ese RUC»
- [ ] Un contrato con fecha fin anterior a la de inicio no se guarda
- [ ] Un contrato que se cruza con otro activo se guarda, pero muestra la advertencia «Contrato superpuesto»
- [ ] Dos áreas para el cliente · desactivarlo y verlo con «Mostrar inactivos»

**Simulación del correo, ingesta y consolidado** (comentario en el backend #9):

```powershell
docker compose run --rm -T simulador preparar-datos.js | docker compose exec -T db psql -U postgres -d printflow
docker compose run --rm simulador demo.js
```

- [ ] Agosto, septiembre y octubre: los correos se procesan y los lotes de los 2 clientes se aprueban
- [ ] Octubre: el correo reenviado sale `DESCARTADO`
- [ ] Octubre: el lote de `SIMX9999` **no** se puede aprobar y muestra «Máquina no autorizada»
- [ ] El consolidado muestra el consumo B/N y color de las 5 máquinas (el monto en $0 es esperado: falta S3-06)
- [ ] Abre un `.eml` de `simulador/buzon/procesados` con Outlook: se ven el asunto y los adjuntos

---

## Tarea 6 · Guion de la demo

Escribe un guion corto, para el grupo y no para el repo:

1. Los repos: ramas, PR y CI en verde (pestaña **Actions**).
2. `docker compose up` desde cero y login con los 3 roles.
3. Clientes, contratos y áreas, con una regla que falle a propósito (RUC repetido).
4. **Simulación del correo** (`demo.js`): por qué existe (el n8n de DOX no se puede mostrar), los 3 formatos de adjunto, los casos de error y el consolidado.
5. Mejoras de calidad del Equipo A: CODEOWNERS, 404 en JSON, validación del `.env` y CI con prueba de humo.

---

## Al terminar

Escribe en el grupo:

> «Tareas de Kiara listas: CODEOWNERS en los dos repos, API con 404 en JSON y validación del `.env`, tests de la API y CI con prueba de humo y simulación. QA de `main` hecho ✅.»

## Si algo falla

| Síntoma | Solución |
|---|---|
| `npm test` se queda colgado | Ciérralo con `Ctrl+C` y revisa que pegaste el `test.after(...)` |
| `node src/server.js` no dice «Falta SECRET_KEY» | La línea de `validarEnv` debe ir **antes** de `require('./app')` |
| El CI dice `yaml` inválido | La sangría de `smoke:` debe ser de 2 espacios, igual que `docker:` |
| `Falta INGESTA_TOKEN` al correr el simulador | Ponle un valor en el `.env` y repite `docker compose up -d` |
| El puerto 8080 está ocupado | `WEB_PORT=8081` en el `.env` y entra por http://localhost:8081 |
| `git push` pide usuario o contraseña | `gh auth login` o GitHub Desktop |
| Conflicto al hacer `git pull` | No borres nada: avisa a Marlo |
