// DELETE /api/staging/limpiar/aprobados y /rechazados: los días van como parámetro de la consulta
// (nunca interpolados en el SQL) y deben ser positivos. Sin base de datos: se simula pool.query.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const pool = require('@config/db');
const { deleteOldAprobados, deleteOldRechazados } = require('@models/reportemes_staging/reportemes_staging.model');
const { limpiarAprobadosController, limpiarRechazadosController } = require('../src/controllers/reportemes_staging/reportemes_staging.controller');

const capturarConsultas = (t) => {
  const consultas = [];
  t.mock.method(pool, 'query', async (sql, params) => { consultas.push({ sql, params }); return { rowCount: 2, rows: [] }; });
  return consultas;
};

const ejecutar = async (controlador, query) => {
  const r = { status: 200, cuerpo: null };
  const res = {
    status(codigo) { r.status = codigo; return this; },
    json(cuerpo) { r.cuerpo = cuerpo; return this; },
  };
  await controlador({ query, params: {}, body: {} }, res);
  return r;
};

test('deleteOldAprobados y deleteOldRechazados pasan los días como $1', async (t) => {
  const consultas = capturarConsultas(t);
  assert.equal(await deleteOldAprobados(45), 2);
  assert.equal(await deleteOldRechazados(7), 2);
  assert.deepEqual(consultas.map((c) => c.params), [[45], [7]]);
  for (const { sql } of consultas) {
    assert.match(sql, /make_interval\(days => \$1::int\)/);
    assert.doesNotMatch(sql, /45|7 days|INTERVAL '/);
  }
});

test('un valor malicioso en ?dias= no llega al texto de la consulta', async (t) => {
  const consultas = capturarConsultas(t);
  const r = await ejecutar(limpiarAprobadosController, { dias: "1 days'); DROP TABLE usuarios; --" });
  assert.equal(r.status, 200);
  assert.deepEqual(consultas[0].params, [1]);
  assert.doesNotMatch(consultas[0].sql, /DROP/);
});

test('sin ?dias= se usan 90 (aprobados) y 30 (rechazados)', async (t) => {
  const consultas = capturarConsultas(t);
  await ejecutar(limpiarAprobadosController, {});
  await ejecutar(limpiarRechazadosController, {});
  assert.deepEqual(consultas.map((c) => c.params), [[90], [30]]);
});

test('días negativos responden 400 y no borran nada (0 o vacío = el valor por defecto)', async (t) => {
  const consultas = capturarConsultas(t);
  for (const dias of ['-5', '-1']) {
    for (const controlador of [limpiarAprobadosController, limpiarRechazadosController]) {
      const r = await ejecutar(controlador, { dias });
      assert.equal(r.status, 400);
      assert.equal(r.cuerpo.message, 'dias debe ser un entero positivo');
    }
  }
  assert.equal(consultas.length, 0);
});
