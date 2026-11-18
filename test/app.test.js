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

test('una ruta que no existe responde 404 en JSON', async () => {
  const res = await fetch(`${base}/no-existe`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.match(body.message, /Ruta no encontrada: GET \/no-existe/);
});

test('una ruta de /api sin token responde 401 en JSON', async () => {
  const res = await fetch(`${base}/api/no-existe`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.success, false);
});

test('la documentación de Swagger carga', async () => {
  const res = await fetch(`${base}/api-docs/`);
  assert.equal(res.status, 200);
});
