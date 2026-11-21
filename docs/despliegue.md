# Despliegue de demostración (S4-04)

PrintFlow se publica en internet con **HTTPS**, para que el PO y el sponsor lo usen sin instalar nada. Nunca se despliega en el servidor de DOX (ver `PLAN.md`).

**Responsables: Equipo C.** Samuel pone en marcha la VM y las migraciones en producción; Christian, el despliegue automático, los respaldos fuera de la VM y el monitoreo. Detalle en `TAREAS-SAMUEL.md` y `TAREAS-CHRISTIAN.md` (en la raíz), tarea S4-04.

La configuración de producción está en `deploy/`:

| Archivo | Qué hace |
|---|---|
| `deploy/docker-compose.prod.yml` | Se aplica **encima** del `docker-compose.yml`. Agrega Caddy (HTTPS) y el respaldo diario, deja la base y la web sin puertos públicos y no arranca n8n |
| `deploy/Caddyfile` | Proxy con certificado de Let's Encrypt automático, redirección HTTP → HTTPS y cabeceras de seguridad |
| `deploy/backup.sh` | `pg_dump` diario en `./backups`; borra los respaldos de más de 30 días |

```text
internet ──80/443──▶ caddy (HTTPS) ──▶ web (nginx: SPA, /api, /socket.io) ──▶ api ──▶ db
                                                                      backup ──▶ db (pg_dump diario)
```

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

**Copiarlos fuera de la VM** (si se pierde la VM, se pierden los respaldos):

```bash
scp -i clave.pem 'azureuser@DOMINIO:SE2-4-Printflow/backups/*.dump' ./respaldos-printflow/
```

### Restaurar un respaldo

```bash
$P exec backup pg_restore --clean --if-exists --no-owner -d printflow /backups/printflow_2026-12-20_0300.dump
$P restart api
```

`--clean --if-exists` borra y vuelve a crear las tablas con el contenido del respaldo. **Antes de restaurar, haz un respaldo del estado actual.**

## 6. Actualizar la versión

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
