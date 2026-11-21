// Arranque seguro: en producción la API no arranca con una SECRET_KEY corta ni sin INGESTA_TOKEN.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { revisarEnv, MIN_SECRET_KEY } = require('../src/config/validarEnv');

const CLAVE_LARGA = 'a'.repeat(96); // como la que genera npm run configurar (48 bytes en hex)
const BASE = { DB_PASSWORD: 'x', SECRET_KEY: CLAVE_LARGA, INGESTA_TOKEN: 'b'.repeat(64) };

test('desarrollo: basta con DB_PASSWORD y SECRET_KEY, aunque la clave sea corta', () => {
  assert.deepEqual(revisarEnv({ NODE_ENV: 'development', DB_PASSWORD: 'x', SECRET_KEY: 'test' }), []);
  assert.deepEqual(revisarEnv({ DB_PASSWORD: 'x', SECRET_KEY: 'test' }), []);
});

test('desarrollo y producción: sin DB_PASSWORD o SECRET_KEY no arranca', () => {
  assert.deepEqual(revisarEnv({ NODE_ENV: 'development' }), ['Falta DB_PASSWORD y SECRET_KEY en el .env. Revisa el .env.example.']);
  assert.match(revisarEnv({ ...BASE, NODE_ENV: 'production', SECRET_KEY: '   ' })[0], /Falta SECRET_KEY/);
});

test('producción: con todo bien no hay problemas', () => {
  assert.deepEqual(revisarEnv({ ...BASE, NODE_ENV: 'production' }), []);
  assert.deepEqual(revisarEnv({ ...BASE, NODE_ENV: 'production', SECRET_KEY: 'k'.repeat(MIN_SECRET_KEY) }), []);
});

test('producción: una SECRET_KEY de menos de 32 caracteres no sirve', () => {
  assert.equal(MIN_SECRET_KEY, 32);
  const problemas = revisarEnv({ ...BASE, NODE_ENV: 'production', SECRET_KEY: 'k'.repeat(31) });
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /SECRET_KEY es demasiado corta para producción \(31 caracteres; mínimo 32\)/);
  assert.match(problemas[0], /npm run configurar/);
});

test('producción: sin INGESTA_TOKEN no arranca', () => {
  for (const vacio of [undefined, '', '  ']) {
    assert.deepEqual(revisarEnv({ ...BASE, NODE_ENV: 'production', INGESTA_TOKEN: vacio }),
      ['Falta INGESTA_TOKEN en el .env. Revisa el .env.example.']);
  }
  // En desarrollo no es obligatorio (la ingesta responde 503 «Ingesta no configurada»)
  assert.deepEqual(revisarEnv({ ...BASE, NODE_ENV: 'development', INGESTA_TOKEN: '' }), []);
});

test('producción: los dos problemas a la vez se informan juntos', () => {
  const problemas = revisarEnv({ NODE_ENV: 'production', DB_PASSWORD: 'x', SECRET_KEY: 'corta' });
  assert.equal(problemas.length, 2);
});

// node src/server.js de verdad: termina con código 1 y el mensaje, sin llegar a escuchar ni a la base.
// Las variables van explícitas (también vacías) para que el .env local no las complete.
const arrancar = (env) => spawnSync(process.execPath, [path.resolve(__dirname, '../src/server.js')], {
  env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, DB_HOST: '127.0.0.1', PORT: '0', ...env },
  encoding: 'utf8',
  timeout: 20000,
});

test('node src/server.js en producción con SECRET_KEY corta termina con código 1 y lo explica', () => {
  const r = arrancar({ ...BASE, NODE_ENV: 'production', SECRET_KEY: 'secreto' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /SECRET_KEY es demasiado corta para producción/);
  assert.match(r.stderr, /La API no arranca hasta corregirlo/);
  assert.doesNotMatch(r.stdout, /Servidor corriendo/);
});

test('node src/server.js en producción sin INGESTA_TOKEN termina con código 1 y lo explica', () => {
  const r = arrancar({ ...BASE, NODE_ENV: 'production', INGESTA_TOKEN: '' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Falta INGESTA_TOKEN en el \.env/);
});
