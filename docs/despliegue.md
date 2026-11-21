# Despliegue de demostración (S4-04)

PrintFlow se publica en internet con **HTTPS**, para que el PO y el sponsor lo usen sin instalar nada. Nunca se despliega en el servidor de DOX (ver `PLAN.md`).

**Responsables: Equipo C.** Samuel pone en marcha la VM y las migraciones en producción; Christian, el despliegue automático, los respaldos fuera de la VM y el monitoreo. Detalle en `TAREAS-SAMUEL.md` y `TAREAS-CHRISTIAN.md` (en la raíz), tarea S4-04.

La configuración de producción está en `deploy/`:

| Archivo | Qué hace |
|---|---|
| `deploy/docker-compose.prod.yml` | Se aplica **encima** del `docker-compose.yml`. Agrega Caddy (HTTPS) y el respaldo diario, deja la base y la web sin puertos públicos y no arranca n8n |
| `deploy/Caddyfile` | Proxy con certificado de Let's Encrypt automático, redirección HTTP → HTTPS y cabeceras de seguridad |
| `deploy/backup.sh` | `pg_dump` diario en `./backups` y copia en Azure Blob Storage; borra los respaldos de más de 30 días (en los dos lados) |
| `deploy/respaldo.Dockerfile` | Imagen del servicio `backup`: `postgres:17-alpine` con `curl` |
| `deploy/actualizar.sh` | Actualiza producción en un paso: respaldo, `git pull`, build, migraciones, `up -d`, comprobación |
| `db/migrar.sh` | Aplica las migraciones pendientes sobre una base que ya existe (sección 6) |
| `.github/workflows/deploy.yml` | Despliegue automático: al pasar el CI de `main`, entra a la VM por SSH y corre `deploy/actualizar.sh` |
| `.github/workflows/monitoreo.yml` | Cada 5 minutos, GET a `https://DOMINIO/api/health`; si no responde, rojo y un issue |

```text
internet ──80/443──▶ caddy (HTTPS) ──▶ web (nginx: SPA, /api, /socket.io) ──▶ api ──▶ db
                                                                      backup ──▶ db (pg_dump diario) ──▶ Azure Blob Storage
GitHub Actions ──SSH──▶ VM: deploy/actualizar.sh          GitHub Actions ──HTTPS──▶ /api/health (cada 5 min)
```

### Lo que falta configurar (no se puede hacer desde el repo)

| # | Qué | Dónde | Quién | Sección |
|---|---|---|---|---|
| 1 | VM, etiqueta DNS, `.env` de producción y primer `up` | Azure + VM | Samuel | 1 a 4 |
| 2 | Cuenta de almacenamiento, contenedor `respaldos` y SAS → `AZURE_BLOB_SAS_URL` en el `.env` de la VM | Azure + VM | Christian | 5 |
| 3 | Clave SSH de despliegue en la VM y secretos `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` | VM + GitHub (backend) | Christian, con Samuel; los secretos los carga un admin del repo | 6 |
| 4 | Variable de repo `MONITOREO_URL` (y opcional UptimeRobot) | GitHub (backend) | Christian (un admin del repo crea la variable) | 8 |
| 5 | Prueba: un PR pequeño a `main` aparece en producción; comprobación de la sección 7 | GitHub + navegador | Samuel y Christian | 6 y 7 |

## 1. Crear la máquina virtual (Azure for Students)

1. En https://portal.azure.com, entra con la cuenta de ESPOL (Azure for Students, sin tarjeta).
2. **Crear → Máquina virtual:**
   - Imagen: **Ubuntu Server 22.04 LTS**.
   - Tamaño: **B2s** (2 vCPU, 4 GB). Con B1s (1 GB) la compilación del frontend se queda sin memoria.
   - Autenticación: **clave SSH**. Guarda la clave privada.
   - Puertos de entrada: **22 (SSH), 80 (HTTP) y 443 (HTTPS)**.
3. En la IP pública de la VM → **Configuración** → **Etiqueta de nombre DNS**, por ejemplo `printflow-demo`. Queda un dominio como `printflow-demo.eastus.cloudapp.azure.com`; ese es tu `DOMINIO`.

## 2. Preparar la VM

```bash
ssh -i clave.pem azureuser@printflow-demo.eastus.cloudapp.azure.com

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# Los dos repos, lado a lado (como en desarrollo)
git clone https://github.com/MarSalvatore28/SE2-4-Printflow.git
git clone https://github.com/MarSalvatore28/SE2-4-Printflow-Frontend.git
cd SE2-4-Printflow && git checkout main && (cd ../SE2-4-Printflow-Frontend && git checkout main)
```

## 3. `.env` de producción: claves nuevas, nunca las de desarrollo

```bash
cp .env.example .env
nano .env
```

| Variable | Valor |
|---|---|
| `DOMINIO` | `printflow-demo.eastus.cloudapp.azure.com` |
| `DB_PASSWORD` | clave nueva y larga: `openssl rand -hex 24` |
| `SECRET_KEY` | `openssl rand -hex 48` |
| `INGESTA_TOKEN` | `openssl rand -hex 32` |
| `NODE_ENV` | `production` |
| `CORREO_MODO` y `SMTP_*` | Los datos del SMTP que pone DOX (ver `docs/avisos-por-correo.md`) |
| `APP_URL` | `https://DOMINIO` (el enlace que va en los avisos) |
| `AZURE_BLOB_SAS_URL` | (opcional, recomendado) URL del contenedor de Azure con SAS, para copiar los respaldos fuera de la VM (sección 5) |

## 4. Levantar

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml ps
```

Caddy pide el certificado a Let's Encrypt al arrancar; tarda unos segundos. Después:

- `http://DOMINIO` redirige a `https://DOMINIO` (308);
- `https://DOMINIO` muestra el login, con candado válido.

### Datos de la demo y contraseñas

```bash
P="docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml"
$P run --rm -T simulador preparar-datos.js | $P exec -T db psql -U postgres -d printflow
$P run --rm simulador demo.js
```

**Cambia las contraseñas de los usuarios de prueba** (vienen con `Printflow2026*`). Entra como admin y, en **Usuarios**, edita a cada uno (admin, operador y auditor) con una contraseña nueva. Compártelas solo con el equipo y el PO.

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
$P exec backup sh /backup.sh --una-vez                    # 1. respaldo
git pull && (cd ../SE2-4-Printflow-Frontend && git pull)  # 2. código nuevo
$P exec -T db sh /printflow-db/migrar.sh                  # 3. migraciones pendientes
$P up -d --build                                          # 4. reconstruye solo lo que cambió
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

- [ ] `http://DOMINIO` redirige a `https://DOMINIO`, con certificado válido.
- [ ] Login con los 3 roles (con las contraseñas nuevas).
- [ ] `curl -X POST https://DOMINIO/api/ingesta/cargar` responde **403**: la ingesta no se expone.
- [ ] La base no responde desde fuera: `nc -zv DOMINIO 5432` falla.
- [ ] Hay al menos un archivo en `backups/` y una restauración de prueba funcionó.
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
