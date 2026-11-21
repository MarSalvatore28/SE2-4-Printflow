// Un error inesperado (de la base, de un bug) responde 500 con un mensaje genérico en español:
// el detalle interno (mensaje de PostgreSQL, nombres de tablas) solo va al log con console.error.
// Sin base de datos: la consulta se simula en el pool de @config/db y falla.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const pool = require('@config/db');
const reportes = require('../src/controllers/reportemes/reportemes.controller');

const DETALLE_INTERNO = 'relation "reportes_originales" does not exist';

// Ejecuta un controlador con req/res mínimos de Express
const ejecutar = async (controlador, req) => {
  const r = { status: 200, cuerpo: null };
  const res = {
    status(codigo) { r.status = codigo; return this; },
    json(cuerpo) { r.cuerpo = cuerpo; return this; },
  };
  await controlador({ params: {}, query: {}, body: {}, ...req }, res);
  return r;
};

// La base falla con un error interno y console.error se registra en `log`
const simularFalloDeLaBase = (t) => {
  const log = [];
  t.mock.method(pool, 'query', async () => { throw new Error(DETALLE_INTERNO); });
  t.mock.method(console, 'error', (...args) => { log.push(args); });
  return log;
};

const comprobarGenerico = (r, log, mensaje) => {
  assert.equal(r.status, 500);
  assert.deepEqual(r.cuerpo, { success: false, message: mensaje });
  assert.doesNotMatch(JSON.stringify(r.cuerpo), /relation|does not exist|reportes_originales/);
  // El detalle sí queda en el log
  assert.ok(log.some((args) => args.some((a) => String(a?.message ?? a).includes(DETALLE_INTERNO))), 'el error se registra con console.error');
};

const PARAMS = { clienteId: '1', periodo: '2026-10' };

test('reporte consolidado: el 500 no expone el error de la base', async (t) => {
  const log = simularFalloDeLaBase(t);
  const r = await ejecutar(reportes.getReporteConsolidadoController, { params: PARAMS });
  comprobarGenerico(r, log, 'Error interno al obtener el reporte');
});

test('reporte detallado: el 500 no expone el error de la base', async (t) => {
  const log = simularFalloDeLaBase(t);
  const r = await ejecutar(reportes.getReporteDetalladoController, { params: PARAMS });
  comprobarGenerico(r, log, 'Error interno al obtener el detalle');
});

test('periodos disponibles: un error inesperado responde 500 genérico y se registra', async (t) => {
  // El modelo ya atrapa los errores de la base: aquí falla el propio controlador (req.params nulo)
  const log = simularFalloDeLaBase(t);
  const r = await ejecutar(reportes.getPeriodosDisponiblesController, { params: null });
  assert.equal(r.status, 500);
  assert.deepEqual(r.cuerpo, { success: false, message: 'Error interno al obtener los periodos disponibles' });
  assert.ok(log.some((args) => args.some((a) => a instanceof TypeError)), 'el error se registra con console.error');
});
