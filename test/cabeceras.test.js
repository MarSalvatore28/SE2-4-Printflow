// Cabeceras de seguridad (helmet) en la API y en Swagger UI, sin base de datos.
process.env.SECRET_KEY = 'test';
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

// Lee la CSP como { directiva: 'valores' }
const csp = (res) => Object.fromEntries(
  (res.headers.get('content-security-policy') || '').split(';').map((d) => d.trim()).filter(Boolean)
    .map((d) => { const [nombre, ...valores] = d.split(/\s+/); return [nombre, valores.join(' ')]; }),
);

const pedir = async (ruta) => {
  const res = await fetch(`${base}${ruta}`);
  await res.body?.cancel();
  return res;
};

test('las respuestas de la API traen las cabeceras de seguridad', async () => {
  for (const ruta of ['/api/no-existe', '/no-existe', '/api/auth/validate-token']) {
    const res = await pedir(ruta);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', ruta);
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN', ruta);
    assert.match(res.headers.get('strict-transport-security') || '', /max-age=\d+/, ruta);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', ruta);
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin', ruta);
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-site', ruta);
    assert.equal(res.headers.get('x-powered-by'), null, ruta);
  }
});

test('la API (solo JSON) tiene la CSP más estricta: no carga nada ni se deja enmarcar', async () => {
  const directivas = csp(await pedir('/api/no-existe'));
  assert.deepEqual(directivas, { 'default-src': "'none'", 'frame-ancestors': "'none'" });
});

test('Swagger UI tiene su propia CSP: scripts del mismo origen, estilos inline e íconos data:', async () => {
  const res = await fetch(`${base}/api-docs/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  const directivas = csp(res);
  assert.equal(directivas['default-src'], "'self'");
  assert.equal(directivas['script-src'], "'self'");
  assert.equal(directivas['style-src'], "'self' 'unsafe-inline'");
  assert.equal(directivas['img-src'], "'self' data:");
  assert.equal(directivas['connect-src'], "'self'");
  assert.equal(directivas['frame-ancestors'], "'none'");
  assert.equal(directivas['object-src'], "'none'");
  assert.equal('upgrade-insecure-requests' in directivas, false, 'en local se abre por http');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');

  // La página no tiene scripts inline (la CSP no los permitiría): todos son archivos de /api-docs
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, atributos, cuerpo] of scripts) {
    assert.match(atributos, /src="\.\/[\w.-]+\.js"/);
    assert.equal(cuerpo.trim(), '');
  }
});

test('los archivos de Swagger UI cargan con la misma CSP de Swagger', async () => {
  for (const archivo of ['swagger-ui-bundle.js', 'swagger-ui-init.js', 'swagger-ui.css']) {
    const res = await pedir(`/api-docs/${archivo}`);
    assert.equal(res.status, 200, archivo);
    assert.equal(csp(res)['script-src'], "'self'", archivo);
  }
});

test('una ruta que solo empieza como /api-docs no recibe la CSP de Swagger', async () => {
  const directivas = csp(await pedir('/api-docsx'));
  assert.equal(directivas['default-src'], "'none'");
});
