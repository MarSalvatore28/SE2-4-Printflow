require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const {
  normalizarSerie,
  normalizarNombreModelo,
  parseId,
} = require('../src/controllers/maquina/maquina.controller');

let server;
let base;

test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => {
    base = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

test.after(() => new Promise((resolve) => server.close(resolve)));

test('la serie se normaliza en mayúsculas y sin espacios', () => {
  assert.equal(normalizarSerie('  sima 0001 '), 'SIMA0001');
  assert.equal(normalizarSerie('ab\tc-12'), 'ABC-12');
  assert.equal(normalizarSerie(12345), '12345');
  assert.equal(normalizarSerie('   '), '');
  assert.equal(normalizarSerie(undefined), '');
  assert.equal(normalizarSerie({}), '');
});

test('el nombre del modelo se recorta y compacta', () => {
  assert.equal(normalizarNombreModelo('  Ricoh   IM  C3000 '), 'Ricoh IM C3000');
  assert.equal(normalizarNombreModelo(''), '');
  assert.equal(normalizarNombreModelo(null), '');
});

test('parseId solo acepta enteros positivos', () => {
  assert.equal(parseId('7'), 7);
  assert.equal(parseId(7), 7);
  assert.equal(parseId('0'), null);
  assert.equal(parseId('-1'), null);
  assert.equal(parseId('1.5'), null);
  assert.equal(parseId('abc'), null);
  assert.equal(parseId('99999999999'), null);
  assert.equal(parseId(null), null);
});

test('/api/maquinas exige token', async () => {
  for (const ruta of ['/api/maquinas', '/api/maquinas/modelos', '/api/maquinas/1']) {
    const res = await fetch(`${base}${ruta}`);
    assert.equal(res.status, 401, ruta);
    const body = await res.json();
    assert.equal(body.success, false);
  }
});
