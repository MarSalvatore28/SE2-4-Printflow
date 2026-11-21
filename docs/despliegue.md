# Despliegue de demostración (S4-04)

PrintFlow se publica en internet con **HTTPS**, para que el PO y el sponsor lo usen sin instalar nada. Nunca se despliega en el servidor de DOX (ver `PLAN.md`).

**Responsables: Equipo C.** Samuel pone en marcha la VM y las migraciones en producción; Christian, el despliegue automático, los respaldos fuera de la VM y el monitoreo. Detalle en `TAREAS-SAMUEL.md` y `TAREAS-CHRISTIAN.md` (en la raíz), tarea S4-04.

## Para subirlo al servidor

La lista corta, en orden. Cada paso remite a su sección, donde está el detalle y qué hacer si algo sale distinto. En total, **1 h 30 aprox.** la primera vez. Estos comandos se probaron de punta a punta en una VM Ubuntu simulada (sección 10).

1. **Crear la VM** en el portal de Azure: Ubuntu Server 22.04 o 24.04 LTS, tamaño **B2s**, usuario `azureuser` con clave SSH, puertos 22, 80 y 443, y la **etiqueta DNS** de la IP pública, que da el `DOMINIO` (sección 1). *15 min.*
2. **Instalar Docker** en la VM y salir, para que al volver a entrar tu usuario lo use sin `sudo` (sección 2). *5 min.*

   ```bash
   ssh -i clave.pem azureuser@DOMINIO
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER
   exit
   ```

3. **Volver a entrar y clonar los dos repos**, lado a lado (sección 2). *1 min.*

   ```bash
   ssh -i clave.pem azureuser@DOMINIO
   git clone https://github.com/MarSalvatore28/SE2-4-Printflow.git
   git clone https://github.com/MarSalvatore28/SE2-4-Printflow-Frontend.git
   cd ~/SE2-4-Printflow
   ```

4. **Crear el `.env` de producción** con claves nuevas (sección 3). Cambia solo la primera línea. *2 min.*

   ```bash
   DOMINIO=printflow-demo.eastus.cloudapp.azure.com        # el tuyo, de la sección 1
   cp .env.example .env
   sed -i \
     -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
     -e "s|^DB_PASSWORD=.*|DB_PASSWORD=$(openssl rand -hex 24)|" \
     -e "s|^SECRET_KEY=.*|SECRET_KEY=$(openssl rand -hex 48)|" \
     -e "s|^INGESTA_TOKEN=.*|INGESTA_TOKEN=$(openssl rand -hex 32)|" \
     -e "s|^DEMO_PASSWORD=.*|DEMO_PASSWORD=Demo$(openssl rand -hex 6)|" \
     -e "s|^APP_URL=.*|APP_URL=https://$DOMINIO|" \
     -e "s|^# DOMINIO=.*|DOMINIO=$DOMINIO|" .env
   chmod 600 .env
   grep -E '^(DOMINIO|NODE_ENV|APP_URL|DEMO_PASSWORD)=' .env   # revisa; DEMO_PASSWORD es la clave de los 3 usuarios
   ```

5. **Levantar** (sección 4). La primera vez compila todo: *5 a 10 min.* Termina con `Listo: producción en el commit ...`.

   ```bash
   sh deploy/actualizar.sh
   ```

6. **Cargar los datos de la demo** (sección 4). *2 min.*

   ```bash
   P="docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml"
   $P run --rm -T simulador preparar-datos.js | $P exec -T db psql -U postgres -d printflow
   $P run --rm simulador demo.js
   ```

7. **Entrar** en `https://DOMINIO` (con candado válido) como `admin@printflow.local` y la `DEMO_PASSWORD` del paso 4. Compártela solo con el equipo y el PO. *2 min.*
8. **Respaldos en Azure Blob Storage** (sección 5): cuenta de almacenamiento, contenedor `respaldos`, SAS → `AZURE_BLOB_SAS_URL` en el `.env`, `$P up -d --build backup` y `$P run --rm backup --una-vez`. *15 min.*
9. **Despliegue automático** (sección 6): clave SSH de despliegue en la VM y los secretos `DEPLOY_*` en GitHub; prueba con **Actions → Despliegue → Run workflow**. *15 min.*
10. **Monitoreo** (sección 8): variable de repo `MONITOREO_URL` = `https://DOMINIO/api/health` y **Actions → Monitoreo → Run workflow**. *5 min.*
11. **Comprobación** de la sección 7, con capturas en el PR. *15 min.*

### Lo que falta configurar (no se puede hacer desde el repo)

| # | Qué | Dónde | Quién | Sección |
|---|---|---|---|---|
| 1 | VM B2s con Ubuntu y puertos 22, 80 y 443 | Portal de Azure | Samuel | 1 |
| 2 | Etiqueta DNS de la IP pública: da el `DOMINIO` | Portal de Azure | Samuel | 1 |
| 3 | Docker, repos, `.env` de producción, primer despliegue y datos de la demo (pasos 2 a 7) | VM | Samuel | 2 a 4 |
| 4 | Cuenta de almacenamiento, contenedor `respaldos` y SAS → `AZURE_BLOB_SAS_URL` en el `.env` de la VM | Azure + VM | Christian | 5 |
| 5 | Clave SSH de despliegue en la VM y secretos `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` | VM + GitHub (backend) | Christian, con Samuel; los secretos los carga un admin del repo | 6 |
| 6 | Variable de repo `MONITOREO_URL` (y opcional UptimeRobot); **Watch → All Activity** de cada integrante | GitHub (backend) | Christian (un admin del repo crea la variable) | 8 |
| 7 | (Opcional) SMTP de DOX, para que los avisos salgan por correo: `CORREO_MODO=smtp` y `SMTP_*` | `.env` de la VM | Samuel, con los datos que dé DOX | 3 |
| 8 | Prueba: un PR pequeño a `main` aparece en producción; comprobación de la sección 7 | GitHub + navegador | Samuel y Christian | 6 y 7 |

## Qué hay en `deploy/`

| Archivo | Qué hace |
|---|---|
| `deploy/docker-compose.prod.yml` | Se aplica **encima** del `docker-compose.yml`. Agrega Caddy (HTTPS) y el respaldo diario, deja la base y la web sin puertos públicos y no arranca n8n |
| `deploy/Caddyfile` | Proxy con certificado de Let's Encrypt automático, redirección HTTP → HTTPS y cabeceras de seguridad |
| `deploy/backup.sh` | `pg_dump` diario en `./backups` y copia en Azure Blob Storage; borra los respaldos de más de 30 días (en los dos lados) |
| `deploy/respaldo.Dockerfile` | Imagen del servicio `backup`: `postgres:17-alpine` con `curl` |
| `deploy/actualizar.sh` | Despliega o actualiza producción en un paso: respaldo, `git pull`, build, migraciones, `up -d`, comprobación |
| `db/migrar.sh` | Aplica las migraciones pendientes sobre una base que ya existe (sección 6) |
| `.github/workflows/deploy.yml` | Despliegue automático: al pasar el CI de `main`, entra a la VM por SSH y corre `deploy/actualizar.sh` |
| `.github/workflows/monitoreo.yml` | Cada 5 minutos, GET a `https://DOMINIO/api/health`; si no responde, rojo y un issue |

```text
internet ──80/443──▶ caddy (HTTPS) ──▶ web (nginx: SPA, /api, /socket.io) ──▶ api ──▶ db
                                                                      backup ──▶ db (pg_dump diario) ──▶ Azure Blob Storage
GitHub Actions ──SSH──▶ VM: deploy/actualizar.sh          GitHub Actions ──HTTPS──▶ /api/health (cada 5 min)
simulador (a mano, dentro de Docker) ──▶ api:9000/api/ingesta     (en la demo reemplaza a n8n, sección 9)
```

## 1. Crear la máquina virtual (Azure for Students)

1. En https://portal.azure.com, entra con la cuenta de ESPOL (Azure for Students, sin tarjeta).
2. **Crear → Máquina virtual:**
   - Imagen: **Ubuntu Server 22.04 LTS** (o 24.04 LTS: los comandos son los mismos).
   - Tamaño: **B2s** (2 vCPU, 4 GB). Con B1s (1 GB) la compilación del frontend se queda sin memoria.
   - Usuario `azureuser` (el de los ejemplos) y autenticación con **clave SSH**. Guarda la clave privada.
   - Puertos de entrada: **22 (SSH), 80 (HTTP) y 443 (HTTPS)**. El 80 hace falta aunque todo vaya por HTTPS: Let's Encrypt lo usa para emitir el certificado.
3. En la IP pública de la VM → **Configuración** → **Etiqueta de nombre DNS**, por ejemplo `printflow-demo`. Queda un dominio como `printflow-demo.eastus.cloudapp.azure.com`; ese es tu `DOMINIO`. Comprueba desde tu PC que ya resuelve: `nslookup printflow-demo.eastus.cloudapp.azure.com`.

## 2. Preparar la VM

```bash
ssh -i clave.pem azureuser@printflow-demo.eastus.cloudapp.azure.com

# Docker (trae docker compose)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit          # sal y vuelve a entrar: así tu usuario queda en el grupo docker
```

```bash
ssh -i clave.pem azureuser@printflow-demo.eastus.cloudapp.azure.com
docker run --rm hello-world        # sin sudo; si dice «permission denied», sal y vuelve a entrar

# Los dos repos, lado a lado (como en desarrollo)
git clone https://github.com/MarSalvatore28/SE2-4-Printflow.git
git clone https://github.com/MarSalvatore28/SE2-4-Printflow-Frontend.git
cd ~/SE2-4-Printflow
```

`git clone` deja los dos en `main`, que es lo que se despliega. Tienen que quedar en `~/SE2-4-Printflow` y `~/SE2-4-Printflow-Frontend`: ahí los busca el despliegue automático (sección 6).

## 3. `.env` de producción: claves nuevas, nunca las de desarrollo

Lo más corto es el bloque del paso 4 de «Para subirlo al servidor»: copia `.env.example` y llena las claves con valores al azar de `openssl`. A mano (`cp .env.example .env` y `nano .env`) queda igual si pones esto:

| Variable | Valor |
|---|---|
| `DOMINIO` | `printflow-demo.eastus.cloudapp.azure.com`. En `.env.example` está comentada: quítale el `# ` |
| `NODE_ENV` | `production` |
| `DB_PASSWORD` | clave nueva y larga: `openssl rand -hex 24` |
| `SECRET_KEY` | `openssl rand -hex 48` (firma las sesiones) |
| `INGESTA_TOKEN` | `openssl rand -hex 32` (con él, el simulador o n8n envían las lecturas a la ingesta) |
| `DEMO_PASSWORD` | la contraseña con la que nacen los 3 usuarios: mínimo 8 caracteres, con letras y números (ver sección 4) |
| `APP_URL` | `https://DOMINIO` (el enlace que va en los avisos) |
| `CORREO_MODO` y `SMTP_*` | Si DOX da un SMTP: `CORREO_MODO=smtp` y sus datos (ver `docs/avisos-por-correo.md`). Si no, se deja `archivo`: los avisos quedan como `.eml` en `~/SE2-4-Printflow/buzon-salida/` de la VM y no le llegan a nadie |
| `AZURE_BLOB_SAS_URL` | (opcional, recomendado) URL del contenedor de Azure con SAS, para copiar los respaldos fuera de la VM (sección 5) |
| `RETENCION_DIAS` | (opcional) días que se guardan los respaldos; vacío = 30 |
| `LOGIN_MAX_INTENTOS` | (opcional) intentos fallidos de inicio de sesión por IP cada 15 minutos; vacío = 10 |

Lo demás (`DB_HOST`, `PORT`, `CORS_ORIGINS`, `DB_HOST_PORT`, `WEB_PORT`) se deja como está: el compose de producción pone lo que corresponde.

Con `NODE_ENV=production` la API **no arranca** si falta `INGESTA_TOKEN` o si `SECRET_KEY` tiene menos de 32 caracteres: queda reiniciándose y `$P logs api` dice qué falta (por ejemplo `SECRET_KEY es demasiado corta para producción (5 caracteres; mínimo 32)`). Se corrige el `.env` y se vuelve a correr `sh deploy/actualizar.sh` (o `$P up -d`). Con los comandos `openssl` se cumple.

**El `.env` es un secreto:** no se sube al repo ni se pega en el chat del grupo, y queda solo en la VM (`chmod 600 .env`). Si se pierde la VM, se crea otro con claves nuevas y se restaura un respaldo (sección 5).

## 4. Levantar

```bash
cd ~/SE2-4-Printflow && sh deploy/actualizar.sh
```

Es el mismo script del despliegue automático (sección 6). La primera vez no hay base que respaldar ni código nuevo que bajar: crea las carpetas `backups/` y `buzon-salida/`, compila las imágenes (5 a 10 minutos en una B2s), crea la base con todas las migraciones y los usuarios, levanta todo y comprueba que la API responde. Termina con `Listo: producción en el commit ...`.

Sin el script es lo mismo con:

```bash
mkdir -p backups buzon-salida      # ANTES del primer up: si las crea Docker, quedan de root
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml ps
```

`mkdir` va primero porque el respaldo y la API corren sin root (con el UID 1000, el de `azureuser`) y escriben en esas carpetas. Si Docker las creó antes, `$P logs backup` dice `no se puede escribir en /backups` (y los avisos por correo no se guardan); se arregla con `sudo chown -R $USER: backups buzon-salida` y `$P restart backup api`.

Caddy pide el certificado a Let's Encrypt al arrancar; tarda unos segundos (`$P logs caddy` dice `certificate obtained successfully`). Después:

- `http://DOMINIO` redirige a `https://DOMINIO` (308);
- `https://DOMINIO` muestra el login, con candado válido.

Si el certificado no sale, casi siempre es el DNS (la etiqueta de la sección 1 todavía no resuelve) o el puerto 80 cerrado en la VM: se corrige y `$P restart caddy`.

### Datos de la demo y contraseñas

```bash
P="docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml"   # en cada sesión SSH
$P run --rm -T simulador preparar-datos.js | $P exec -T db psql -U postgres -d printflow
$P run --rm simulador demo.js
```

`preparar-datos.js` registra los clientes, contratos, máquinas y asignaciones ficticias (una sola vez) y `demo.js` pasa por la ingesta los correos simulados de agosto a octubre de 2026 y aprueba los lotes como operador. Para más meses o escenarios (errores, fallas, reemplazos), ver `simulador/README.md`: los comandos son los mismos, con `$P` en vez de `docker compose`.

**Contraseñas de los usuarios de prueba** (`admin@`, `operador@` y `auditor@printflow.local`):

- **Lo recomendado:** `DEMO_PASSWORD` en el `.env` **antes del primer despliegue**, como en el paso 4 de la lista. La base calcula el hash al crearse y los tres usuarios nacen con esa contraseña, nunca con `Printflow2026*`. `demo.js` también la usa. Para verla: `grep DEMO_PASSWORD .env`.
- **Con la base ya creada**, cambiar `DEMO_PASSWORD` no hace nada (y no se borra la base para eso). Las contraseñas se cambian entrando como admin a **Usuarios** → lápiz de cada uno → **Contraseña** y **Confirmación** → **Actualizar Usuario**. Si alguien levantó la base sin `DEMO_PASSWORD`, los usuarios tienen `Printflow2026*`: cámbialas así antes de mostrarlo.
- Si la contraseña del **operador** ya no es la `DEMO_PASSWORD` del `.env`, el simulador no puede entrar (`HTTP 401: Credenciales incorrectas`). Pásale la actual: `$P run --rm -e DEMO_PASSWORD='la-del-operador' simulador demo.js`.

Compártelas solo con el equipo y el PO, nunca en el repo ni en el chat del grupo.

## 5. Respaldos

El servicio `backup` hace un respaldo al arrancar y luego uno cada 24 h, en `./backups/printflow_AAAA-MM-DD_HHMM.dump`. Conserva **30 días** (`RETENCION_DIAS` en el `.env`).

```bash
ls -lh backups/                                         # ver los respaldos
$P exec backup sh /backup.sh --una-vez                  # respaldo ahora (antes de actualizar)
$P logs backup --tail 20                                # historial
```

### Copia fuera de la VM: Azure Blob Storage

Si se pierde la VM, se pierden los respaldos de `./backups`. Con `AZURE_BLOB_SAS_URL` en el `.env`, después de cada respaldo `backup.sh` **sube los que falten** al contenedor de Azure y **borra allá los de más de `RETENCION_DIAS`** (30). Sin la variable, se salta. Si Azure falla (red, SAS vencido), lo dice en `$P logs backup` y el respaldo local queda igual; los que faltaron se suben con el siguiente.

Usa la API REST de Azure con un **SAS de contenedor**, no la clave de la cuenta: si se filtra, solo da acceso a ese contenedor y vence sola. No hace falta instalar la CLI de Azure en la VM.

**Configurarlo (una vez):**

1. En el portal de Azure: **Crear → Cuenta de almacenamiento**, en el mismo grupo de recursos de la VM. Rendimiento **Estándar**, redundancia **LRS** (la más barata), nombre p. ej. `printflowrespaldos`.
2. En la cuenta → **Contenedores** → **+ Contenedor**: `respaldos`, nivel de acceso **Privado**.
3. En el contenedor → **Tokens de acceso compartido** (Shared access tokens):
   - Clave de firma: Key 1. Permisos: **Read, Add, Create, Write, Delete, List**.
   - Expiración: el final del semestre (anótala: al vencer, los respaldos dejan de copiarse).
   - Protocolos permitidos: solo HTTPS. **Generar token y URL**.
4. Copia la **URL de SAS del blob** (`https://printflowrespaldos.blob.core.windows.net/respaldos?sp=racwdl&...&sig=...`) y pégala en el `.env` de la VM como `AZURE_BLOB_SAS_URL=...`. **Es un secreto**: no va en el repo ni en el chat del grupo.
5. Aplica y prueba:

   ```bash
   $P up -d --build backup                         # el servicio toma la variable nueva
   $P run --rm backup --una-vez                    # «copiado a Azure: printflow_...dump»
   $P run --rm backup --listar-azure               # lo que hay en Azure
   ```

### Restaurar un respaldo bajado de Azure

En la misma VM (o en una nueva, ya preparada con las secciones 1 a 4 y el mismo `AZURE_BLOB_SAS_URL`):

```bash
$P run --rm backup --listar-azure                                   # elige uno
$P run --rm backup --bajar-azure printflow_2026-12-20_0300.dump     # queda en ./backups/
```

y sigue con «Restaurar un respaldo» (abajo). Sin VM, se baja desde el portal (contenedor `respaldos` → el archivo → **Descargar**) o con `curl -o printflow_....dump "https://CUENTA.blob.core.windows.net/respaldos/printflow_....dump?<SAS>"`, y se copia a `./backups/` de la VM nueva.

### Restaurar un respaldo

```bash
$P exec backup pg_restore --clean --if-exists --no-owner -d printflow /backups/printflow_2026-12-20_0300.dump
$P restart api
```

`--clean --if-exists` borra y vuelve a crear las tablas con el contenido del respaldo. **Antes de restaurar, haz un respaldo del estado actual.**

El respaldo incluye la tabla `schema_migrations`. Si es anterior a alguna migración, después de restaurar corre `$P exec -T db sh /printflow-db/migrar.sh` para aplicarlas.

## 6. Actualizar la versión

**Normalmente no hay que hacer nada:** al mergear un PR en `main` del backend, cuando el CI pasa, el workflow **Despliegue** (`.github/workflows/deploy.yml`) entra a la VM y corre `deploy/actualizar.sh`. A mano, en la VM, es lo mismo:

```bash
cd ~/SE2-4-Printflow && sh deploy/actualizar.sh
```

`deploy/actualizar.sh` hace, en orden, y **se detiene en el primer paso que falle** (con el estado y los últimos logs de `api` y `db`):

1. respaldo de la base (`backup.sh --una-vez`), si la base está corriendo;
2. `git pull --ff-only` del backend y del frontend (si alguien editó archivos en la VM, falla aquí: no se pisan);
3. construye las imágenes: si no compilan, producción sigue con la versión anterior;
4. migraciones pendientes (`db/migrar.sh`, abajo): si una falla, se deshace y producción sigue con la versión anterior;
5. `up -d`: reemplaza solo los contenedores que cambiaron;
6. comprueba que la API responde `/health`.

Desde el workflow se le pasa el commit que pasó el CI (`sh deploy/actualizar.sh <commit>`), así no se despliega un commit más nuevo que todavía no pasó. El frontend se actualiza a lo último de su `main` en cada despliegue: **un cambio solo del frontend** se publica con el siguiente despliegue del backend o lanzando el workflow a mano.

### Despliegue automático (GitHub Actions)

| Cuándo | Qué pasa |
|---|---|
| Push a `main` (PR mergeado) y **CI backend** en verde | Despliega ese commit |
| CI en rojo, PR abierto o push a otra rama | No corre |
| **Actions → Despliegue → Run workflow** (rama `main`) | Despliega lo último de `main` y del frontend |
| Faltan los secretos | Termina en **verde** con el aviso «Despliegue no configurado» y no hace nada |
| Falla un paso de `deploy/actualizar.sh` | Termina en **rojo**; el log está en el paso «Actualiza producción» |

GitHub solo usa la versión del workflow que está en `main`: empujar otra rama nunca despliega. Si llegan dos merges seguidos, el segundo espera a que termine el primero.

**Configurarlo (una vez):**

1. **Clave de despliegue**, en tu PC (no uses la clave con la que creaste la VM):

   ```bash
   ssh-keygen -t ed25519 -N "" -C "despliegue-github" -f printflow-deploy
   ```

2. **Autorízala en la VM** (con tu acceso de siempre):

   ```bash
   ssh -i clave.pem azureuser@DOMINIO 'cat >> ~/.ssh/authorized_keys' < printflow-deploy.pub
   ```

   El usuario tiene que poder usar Docker sin `sudo` (sección 2) y los repos tienen que estar en `~/SE2-4-Printflow` y `~/SE2-4-Printflow-Frontend`, en `main`. Son públicos, así que `git pull` no necesita credenciales.
3. **Huella de la VM**, para que el workflow compruebe que se conecta a ella: `ssh-keyscan -H DOMINIO`.
4. En GitHub, repo del **backend** → **Settings → Secrets and variables → Actions → New repository secret**:

   | Secreto | Valor |
   |---|---|
   | `DEPLOY_HOST` | `DOMINIO` (p. ej. `printflow-demo.eastus.cloudapp.azure.com`) |
   | `DEPLOY_USER` | `azureuser` (el usuario de la VM) |
   | `DEPLOY_SSH_KEY` | el contenido completo de `printflow-deploy` (la privada, con `-----BEGIN` y `-----END`) |
   | `DEPLOY_KNOWN_HOSTS` | la salida del paso 3 (recomendado; sin él se acepta la huella que muestre la VM en ese momento) |

   Opcional, en la pestaña **Variables**: `DEPLOY_DIR` si el backend no está en `~/SE2-4-Printflow`.
5. **Borra** `printflow-deploy` de tu PC (queda solo en GitHub) y guarda `printflow-deploy.pub`.
6. **Prueba:** Actions → **Despliegue** → **Run workflow** en `main`. Tiene que terminar en verde con `Listo: producción en el commit ...`. Luego, un PR pequeño mergeado a `main` tiene que aparecer en producción sin entrar a la VM (deja el enlace a la ejecución en el PR).

Si un despliegue falla: abre el log del paso «Actualiza producción», corrige con un PR nuevo (o arregla la VM) y vuelve a lanzarlo. Para volver atrás, lo más limpio es un `git revert` en `main` (se despliega solo); si una migración ya se aplicó, la base se restaura con la sección 5.

### Paso a paso a mano (sin el script)

```bash
mkdir -p backups buzon-salida                             # 0. carpetas de los contenedores (sección 4)
$P exec backup sh /backup.sh --una-vez                    # 1. respaldo
git pull && (cd ../SE2-4-Printflow-Frontend && git pull)  # 2. código nuevo
$P build                                                  # 3. imágenes nuevas (si falla, no se cambió nada)
$P exec -T db sh /printflow-db/migrar.sh                  # 4. migraciones pendientes
$P up -d                                                  # 5. reemplaza solo lo que cambió
```

### Migraciones sobre una base que ya existe (`db/migrar.sh`)

Al **crear** el volumen, `docker/postgres/init.sh` aplica todas las migraciones de `db/migrations` y los seeds. Sobre una base que **ya existe**, las migraciones nuevas las aplica `db/migrar.sh`, que corre dentro del contenedor `db` (`db/` está montado en `/printflow-db`):

| Comando | Qué hace |
|---|---|
| `$P exec -T db sh /printflow-db/migrar.sh` | Aplica las pendientes, en orden alfabético |
| `$P exec -T db sh /printflow-db/migrar.sh --estado` | Lista aplicadas (`ok`) y pendientes (`--`), sin cambiar nada |
| `$P exec -T db sh /printflow-db/migrar.sh --marcar 0NN_nombre.sql` | Registra una migración como aplicada **sin ejecutarla** (solo para resolver una adopción dudosa) |

En la PC, lo mismo es `npm run migrar` (y `npm run migrar -- --estado`).

- Lleva la cuenta en la tabla **`schema_migrations`** (`nombre`, `aplicada_en`, `origen`: `init`, `migrar`, `adopcion` o `marcada`). `init.sh` usa el mismo script, así que una base nueva y una migrada quedan iguales.
- Cada migración va en **su transacción**, junto con su registro: o queda entera y registrada, o no queda nada.
- Si una falla, **se detiene** y no aplica las siguientes. Se corrige el archivo y se vuelve a correr.
- Si no hay nada pendiente, dice `la base 'printflow' está al día` y no cambia nada.

**Reglas para escribir una migración**

- Nombre `0NN_descripcion.sql` (letras, números, `_`, `-`, `.`). Nunca renombrar ni editar una que ya está en `main`: se agrega otra.
- Sin `BEGIN`/`COMMIT` propios ni `CREATE INDEX CONCURRENTLY` (el script ya la envuelve en una transacción y las rechaza).
- Si cambia datos, que se pueda repetir sin daño (`WHERE`, `ON CONFLICT DO NOTHING`).
- Una base nueva las aplica en orden alfabético y una vieja, en el orden en que llegaron. Si se mergea una con número menor que otra ya aplicada (p. ej. la `022` después de la `030`), las dos bases terminan con las mismas tablas, columnas y restricciones, pero las columnas que ambas agregan a una misma tabla pueden quedar en otro **orden**. La app no depende de ese orden: lee las columnas por nombre.

**Bases creadas antes de `schema_migrations` («adopción»)**

La primera vez que el script corre sobre una base que tiene tablas pero no `schema_migrations`, averigua solo qué migraciones ya tiene, **sin tocar la base**: copia su esquema (`pg_dump --schema-only`) a una base temporal (`printflow_adopcion_tmp`) y prueba ahí cada migración, en orden:

| Resultado de la prueba | Decisión |
|---|---|
| Falla con «ya existe» (SQLSTATE `42P07`, `42701`, `42710`, `42723`, `42P06`) | **Ya estaba**: se registra como `adopcion` |
| Se aplica y cambia el esquema | **Pendiente**: se aplica después, como cualquier otra |
| Se aplica y no cambia nada (p. ej. `CREATE INDEX IF NOT EXISTS`) | **Ya estaba**, salvo que también cambie datos (`INSERT`, `UPDATE`, `DELETE`…) |
| Cambia solo datos, o falla con otro error | **Dudosa**: se detiene **sin cambiar nada** |

Con una dudosa, el script muestra el comando para terminar a mano: revisa en la base si esa migración ya está, y registra todas las que ya están con `--marcar` (el script imprime la lista de las seguras). Luego vuelve a correr el script y aplica el resto.

El criterio supone que cada migración se aplicó **entera o nada**, que es lo que hacía el `init.sh` anterior. Si alguien aplicó una a mano y falló a la mitad, revisa esa tabla antes de adoptar. Funciona igual con las migraciones que vengan (011, 020 a 022…): una base vieja que ya las tenga las marca como «ya estaba», y una que no, las aplica.

## 7. Comprobación

- [ ] `$P ps`: `api`, `web`, `caddy` y `backup` en `Up` y `db` en `Up (healthy)`; nada en `Restarting`.
- [ ] `http://DOMINIO` redirige a `https://DOMINIO`, con certificado válido.
- [ ] Login con los 3 roles, con las contraseñas nuevas; `Printflow2026*` ya no entra.
- [ ] Datos de la demo: **Informes** → Colegio Horizonte (demo), octubre de 2026 → **$395,48**.
- [ ] `curl -X POST https://DOMINIO/api/ingesta/cargar` responde **403**: la ingesta no se expone.
- [ ] La base no responde desde fuera: `nc -zv DOMINIO 5432` falla.
- [ ] `ls -l backups/` muestra al menos un respaldo, del usuario `azureuser`, y una restauración de prueba funcionó.
- [ ] `$P exec -T db sh /printflow-db/migrar.sh --estado` no muestra migraciones pendientes.
- [ ] `$P run --rm backup --listar-azure` muestra los respaldos, y uno bajado de Azure se restauró.
- [ ] Un PR mergeado a `main` apareció en producción con el workflow **Despliegue** en verde.
- [ ] `https://DOMINIO/api/health` responde 200 y el workflow **Monitoreo** corre en verde.

## 8. Monitoreo

`GET https://DOMINIO/api/health` responde **200** (`{"status":"ok",...}`) solo si la API y la base contestan; no pide token y no muestra datos.

### Con GitHub Actions (`.github/workflows/monitoreo.yml`)

Cada 5 minutos hace ese GET (3 intentos, 20 s entre uno y otro). Si no responde 200:

- el job queda en **rojo**: GitHub le manda un correo a quien activó el workflow (por defecto, quien hizo el último cambio al `cron`);
- abre el issue **«[monitoreo] Producción no responde»**, que les llega a **todos los que siguen el repo** (Watch → All Activity). Mientras siga caído no abre otro; cuando vuelve a responder, lo **cierra solo** con un comentario.

**Configurarlo:** en el repo del backend → **Settings → Secrets and variables → Actions → Variables → New repository variable**: `MONITOREO_URL` = `https://DOMINIO/api/health`. Sin esa variable el workflow termina en verde sin revisar nada. `MONITOREO_ISSUES` = `false` desactiva los issues. Pruébalo con **Actions → Monitoreo → Run workflow**. Que cada integrante ponga **Watch → All Activity** en el repo para recibir los avisos.

Límites: GitHub corre los `schedule` solo desde `main` y a veces con varios minutos de retraso; en un repo público, **desactiva los programados tras 60 días sin actividad** en el repo (se reactivan con un clic en Actions). Para un aviso más puntual, usa además UptimeRobot.

### Alternativa: UptimeRobot (gratis)

1. Crea una cuenta en https://uptimerobot.com (plan gratuito: chequeos cada 5 minutos).
2. **Add New Monitor** → tipo **HTTP(s)**, URL `https://DOMINIO/api/health`, intervalo 5 minutos.
3. En **Alert Contacts**, agrega el correo de cada integrante (o un correo del grupo).
4. Prueba: `$P stop api`, espera el correo de caída, `$P start api` y espera el de recuperación.

### Si el monitoreo avisa

```bash
ssh -i clave.pem azureuser@DOMINIO
cd SE2-4-Printflow && P="docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml"
$P ps                          # ¿algún servicio caído o reiniciándose?
$P logs --tail 100 api db      # el error
$P up -d                       # vuelve a levantar lo que esté caído
df -h /                        # ¿disco lleno? (docker image prune -f libera imágenes viejas)
```

## 9. n8n en producción

**En la demo, n8n no corre** (en `deploy/docker-compose.prod.yml` está en el perfil `n8n`). El buzón y el flujo reales son de DOX y el PO no autoriza usarlos (`PLAN.md`, sección 1.1). Su trabajo lo hace el **simulador**: genera los correos ficticios de las impresoras, los lee como lo haría n8n y los manda a `http://api:9000/api/ingesta/cargar` con el `INGESTA_TOKEN`, por la red interna de Docker. Por eso la ingesta responde 403 desde internet y aun así la demo tiene datos (sección 4, `demo.js`; escenarios en `simulador/README.md`).

Si algún día DOX autoriza conectar su buzón (fuera del alcance de la demo):

1. Arrancarlo en la VM: `$P --profile n8n up -d n8n`. Escucha solo en `127.0.0.1:5678` de la VM: se abre desde tu PC con un túnel, `ssh -i clave.pem -L 5678:localhost:5678 azureuser@DOMINIO`, y luego http://localhost:5678.
2. En n8n, una credencial **IMAP** con la cuenta del buzón que dé DOX (nunca en el repo), y el flujo: leer correo → extraer los contadores de cada adjunto → **HTTP Request** `POST http://api:9000/api/ingesta/cargar` con la cabecera `Authorization: Bearer <INGESTA_TOKEN del .env>`. El cuerpo que espera la API está en Swagger (`https://DOMINIO/api-docs`, «Ingesta») y armado paso a paso en `simulador/lib/n8n.js`, que hace lo mismo que el flujo de DOX.
3. Para que arranque en cada despliegue, agregar `COMPOSE_PROFILES=n8n` al `.env`.

## 10. Probarlo en tu PC antes de la VM (opcional)

Se puede ensayar todo el despliegue en local con Docker Desktop, sin Azure. Así se probó esta guía: en un contenedor Ubuntu 22.04 con Docker adentro (como la VM, con el usuario `azureuser` de UID 1000), repos `origin` locales y los pasos 2 a 6 de la lista tal cual; luego, `actualizar.sh` con un commit nuevo en los dos repos y una migración nueva, y la restauración de un respaldo copiado a un emulador de Azure Blob Storage (Azurite).

En una PC, con un clon aparte de los dos repos (para no pisar tu entorno de desarrollo):

1. En su `.env`, lo de la sección 3 con `DOMINIO=localhost` y `APP_URL=https://localhost:8443`, y, si 80 y 443 están ocupados, `HTTP_PORT=8480` y `HTTPS_PORT=8443`.
2. `COMPOSE_PROJECT_NAME=pf-prueba sh deploy/actualizar.sh` (en Git Bash), o `docker compose -p pf-prueba -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build`.
3. Entra en `https://localhost:8443` **en una ventana privada**: Caddy usa un certificado local (el navegador avisa; acéptalo) y la cabecera HSTS haría que tu navegador normal pida siempre HTTPS a `localhost`, también en desarrollo. Con otros puertos, la redirección de `http://localhost:8480` lleva a `https://localhost/` (sin puerto): es lo esperado.
4. Al terminar: `docker compose -p pf-prueba -f docker-compose.yml -f deploy/docker-compose.prod.yml down -v`.

En Windows, Docker Desktop no aplica los dueños de las carpetas como Linux: lo de `mkdir -p backups buzon-salida` (sección 4) solo se nota en la VM.
