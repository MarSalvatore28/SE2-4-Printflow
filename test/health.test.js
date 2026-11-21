require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/db');
const app = require('../src/app');

let server;
let base;
const queryOriginal = pool.query;

test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => {
    base = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

test.after(() => {
  pool.query = queryOriginal;
  return new Promise((resolve) => server.close(resolve));
});

test('/api/health responde sin token cuando la base contesta (monitoreo)', async () => {
  pool.query = async () => ({ rows: [{ now: '2026-11-20T10:00:00Z' }] });
  for (const ruta of ['/health', '/api/health']) {
    const res = await fetch(`${base}${ruta}`);
    assert.equal(res.status, 200, ruta);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  }
});

test('/api/health responde 500 si la base no contesta', async () => {
  pool.query = async () => { throw new Error('sin conexión'); };
  const original = console.error;
  console.error = () => {};
  try {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.status, 'error');
  } finally {
    console.error = original;
  }
});
