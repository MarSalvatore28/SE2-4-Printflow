// Despliegue (docs/despliegue.md): que lo que dicen la guía y .env.example coincida con los compose y
// los scripts de deploy/. Son errores que solo aparecen al subirlo a la VM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const leer = (archivo) => fs.readFileSync(path.join(raiz, archivo), 'utf8').replaceAll('\r\n', '\n');

const COMPOSE = ['docker-compose.yml', 'deploy/docker-compose.prod.yml'];
const ejemplo = leer('.env.example');
const actualizar = leer('deploy/actualizar.sh');
const guia = leer('docs/despliegue.md');

// ${VAR}, ${VAR:-x} y ${VAR:?x}; «$${VAR}» es un $ literal para el contenedor, no del .env
const variablesDe = (texto) =>
  new Set([...texto.matchAll(/(?<!\$)\$\{([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]));

// Montajes ./origen:/destino que no son de solo lectura
const montajesEscribibles = (texto) =>
  [...texto.matchAll(/^\s*-\s*"?\.\/([^:"\s]+):\/[^:"\s]*"?\s*$/gm)].map((m) => m[1]);

const servicios = new Set(
  COMPOSE.flatMap((archivo) => {
    const bloque = /^services:\n([\s\S]*?)(?=^\S)/m.exec(`${leer(archivo)}\nfin:`)[1];
    return [...bloque.matchAll(/^ {2}([a-z0-9_-]+):/gm)].map((m) => m[1]);
  }),
);

test('.env.example nombra todas las variables que usan los compose de desarrollo y producción', () => {
  const faltan = COMPOSE.flatMap((archivo) =>
    [...variablesDe(leer(archivo))]
      .filter((nombre) => !new RegExp(`^(# )?${nombre}=`, 'm').test(ejemplo))
      .map((nombre) => `${nombre} (${archivo})`));
  assert.deepEqual(faltan, []);
});

test('las variables de producción de .env.example no traen texto pegado al valor', () => {
  // Quien quita el «# » de una línea tiene que quedarse con un valor limpio
  for (const nombre of ['DOMINIO', 'AZURE_BLOB_SAS_URL', 'RETENCION_DIAS', 'HTTP_PORT', 'HTTPS_PORT']) {
    assert.match(ejemplo, new RegExp(`^# ${nombre}=\\S*$`, 'm'), nombre);
  }
});

test('actualizar.sh crea las carpetas que montan los contenedores antes de usarlos', () => {
  // Si las crea Docker quedan de root, y el respaldo y la API (sin root) no pueden escribir en ellas
  const ignoradas = leer('.gitignore').split('\n').map((l) => l.trim().replace(/\/$/, ''));
  const carpetas = COMPOSE.flatMap((archivo) => montajesEscribibles(leer(archivo)))
    .filter((origen) => ignoradas.includes(origen))
    .sort();
  assert.deepEqual(carpetas, ['backups', 'buzon-salida']);

  const mkdir = actualizar.indexOf(`mkdir -p ${carpetas.join(' ')}`);
  assert.notEqual(mkdir, -1, `actualizar.sh no crea ${carpetas.join(' ')}`);
  assert.ok(mkdir < actualizar.indexOf('dc run'), 'las crea después del primer respaldo');
  assert.ok(mkdir < actualizar.indexOf('dc up'), 'las crea después de levantar');
  // La guía las crea igual en el primer despliegue a mano
  assert.match(guia, /mkdir -p backups buzon-salida/);
});

test('los comandos $P de la guía usan servicios que existen', () => {
  const usados = [...guia.matchAll(/\$P (?:exec|run --rm|logs|restart|stop|start|up -d --build)(?: -T| --no-deps)* ([a-z][a-z0-9_-]*)/g)]
    .map((m) => m[1]);
  assert.ok(usados.length > 10);
  assert.deepEqual(usados.filter((s) => !servicios.has(s)), []);
});

test('la guía empieza con la lista para subirlo al servidor', () => {
  const lista = guia.indexOf('## Para subirlo al servidor');
  assert.ok(lista !== -1 && lista < guia.indexOf('## 1.'));
});
