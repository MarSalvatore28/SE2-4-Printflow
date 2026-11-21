// npm run configurar: crea o completa el .env sin pedirle claves a nadie (scripts/configurar.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { completarEnv } = require('../scripts/configurar');
const { leerOpciones } = require('../simulador/token');

const EJEMPLO = [
  '# comentario',
  'DB_USER=postgres',
  'DB_PASSWORD=',
  'SECRET_KEY=',
  'INGESTA_TOKEN=',
  'CORREO_MODO=archivo',
  '',
].join('\n');

const generarFijo = (bytes) => `x${bytes}`;
const valor = (texto, nombre) => new RegExp(`^${nombre}=(.*)$`, 'm').exec(texto)?.[1];

test('sin .env: copia .env.example y genera las 3 claves vacías', () => {
  const { texto, generadas, agregadas } = completarEnv(EJEMPLO, null, generarFijo);
  assert.equal(valor(texto, 'DB_PASSWORD'), 'x24');
  assert.equal(valor(texto, 'SECRET_KEY'), 'x48');
  assert.equal(valor(texto, 'INGESTA_TOKEN'), 'x32');
  assert.equal(valor(texto, 'DB_USER'), 'postgres');
  assert.match(texto, /^# comentario$/m);
  assert.deepEqual(generadas, ['DB_PASSWORD', 'SECRET_KEY', 'INGESTA_TOKEN']);
  assert.deepEqual(agregadas, []);
});

test('con .env: nunca cambia un valor que ya tiene contenido', () => {
  const actual = 'DB_USER=yo\nDB_PASSWORD=mia\nSECRET_KEY=mia-tambien\nINGESTA_TOKEN=\nCORREO_MODO=smtp\n';
  const { texto, generadas } = completarEnv(EJEMPLO, actual, generarFijo);
  assert.equal(valor(texto, 'DB_USER'), 'yo');
  assert.equal(valor(texto, 'DB_PASSWORD'), 'mia');
  assert.equal(valor(texto, 'SECRET_KEY'), 'mia-tambien');
  assert.equal(valor(texto, 'CORREO_MODO'), 'smtp');
  assert.equal(valor(texto, 'INGESTA_TOKEN'), 'x32');
  assert.deepEqual(generadas, ['INGESTA_TOKEN']);
});

test('con .env viejo: agrega al final las variables nuevas de .env.example', () => {
  const actual = 'DB_USER=yo\nDB_PASSWORD=mia\n';
  const { texto, agregadas, generadas } = completarEnv(EJEMPLO, actual, generarFijo);
  assert.deepEqual(agregadas, ['SECRET_KEY', 'INGESTA_TOKEN', 'CORREO_MODO']);
  assert.deepEqual(generadas, ['SECRET_KEY', 'INGESTA_TOKEN']);
  assert.equal(valor(texto, 'SECRET_KEY'), 'x48');
  assert.equal(valor(texto, 'CORREO_MODO'), 'archivo');
  assert.ok(texto.startsWith('DB_USER=yo\nDB_PASSWORD=mia\n'));
});

test('un .env completo no cambia', () => {
  const actual = 'DB_USER=yo\nDB_PASSWORD=a\nSECRET_KEY=b\nINGESTA_TOKEN=c\nCORREO_MODO=archivo\n';
  assert.equal(completarEnv(EJEMPLO, actual, generarFijo).texto, actual);
});

test('las claves generadas de verdad son aleatorias y largas', () => {
  const uno = valor(completarEnv(EJEMPLO, null).texto, 'SECRET_KEY');
  const otro = valor(completarEnv(EJEMPLO, null).texto, 'SECRET_KEY');
  assert.match(uno, /^[0-9a-f]{96}$/);
  assert.notEqual(uno, otro);
});

test('el .env.example real tiene vacías las claves que se generan', () => {
  const ejemplo = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  const { generadas } = completarEnv(ejemplo, null);
  assert.deepEqual(generadas.sort(), ['DB_PASSWORD', 'INGESTA_TOKEN', 'SECRET_KEY']);
});

test('npm run token: el rol elige el usuario de prueba y --url cambia la dirección', () => {
  assert.equal(leerOpciones([]).email, 'admin@printflow.local');
  assert.equal(leerOpciones(['operador']).email, 'operador@printflow.local');
  const opciones = leerOpciones(['auditor', '--solo', '--url', 'http://api:9000/']);
  assert.equal(opciones.email, 'auditor@printflow.local');
  assert.equal(opciones.url, 'http://api:9000');
  assert.equal(opciones.solo, true);
  assert.throws(() => leerOpciones(['jefe']), /admin, operador o auditor/);
});
