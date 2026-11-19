# Despliegue de demostración (S4-04)

PrintFlow se publica en internet con **HTTPS**, para que el PO y el sponsor lo usen sin instalar nada. Nunca se despliega en el servidor de DOX (ver `PLAN.md`).

**Responsables: Equipo C.** Samuel pone en marcha la VM y las migraciones en producción; Christian, el despliegue automático, los respaldos fuera de la VM y el monitoreo. Detalle en `docs/tareas/SAMUEL.md` y `docs/tareas/CHRISTIAN.md`, tarea S4-04.

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
git clone https://github.com/MGabrielaVillon/SE2-4-Printflow.git
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
$P exec backup sh /backup.sh --una-vez        # 1. respaldo
git pull && (cd ../SE2-4-Printflow-Frontend && git pull)
$P up -d --build                               # 2. reconstruye solo lo que cambió
```

Las migraciones nuevas (`db/migrations/0NN_*.sql`) **no** se aplican solas sobre una base existente: solo se aplican al crear el volumen. Aplica cada una a mano:

```bash
$P exec -T db psql -U postgres -d printflow < db/migrations/0NN_nombre.sql
```

## 7. Comprobación

- [ ] `http://DOMINIO` redirige a `https://DOMINIO`, con certificado válido.
- [ ] Login con los 3 roles (con las contraseñas nuevas).
- [ ] `curl -X POST https://DOMINIO/api/ingesta/cargar` responde **403**: la ingesta no se expone.
- [ ] La base no responde desde fuera: `nc -zv DOMINIO 5432` falla.
- [ ] Hay al menos un archivo en `backups/` y una restauración de prueba funcionó.
