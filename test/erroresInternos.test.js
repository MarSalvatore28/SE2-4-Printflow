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

// --- Otros controladores que devolvían error.message en el 500 ---
const instalacion = require('../src/controllers/instalacion/instalacion.controller');

// pool.connect() entrega un client cuya consulta (salvo BEGIN y ROLLBACK) responde `responder()`
const simularTransaccion = (t, responder) => {
  const log = [];
  const client = {
    query: async (sql) => (/^(BEGIN|ROLLBACK|COMMIT)$/.test(String(sql).trim()) ? {} : responder()),
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => client);
  t.mock.method(console, 'error', (...args) => { log.push(args); });
  return log;
};

test('instalaciones: la renta con error de la base responde 500 genérico', async (t) => {
  const log = simularFalloDeLaBase(t);
  let r = await ejecutar(instalacion.getRentaByClienteController, { params: { cliente_id: '1' } });
  comprobarGenerico(r, log, 'Error al obtener la renta');
  r = await ejecutar(instalacion.updateRentaInstalacionController, { params: { id_instalacion: '1' }, body: { costo_renta_mensual: 20 } });
  comprobarGenerico(r, log, 'Error al actualizar la renta');
});

test('instalaciones: crear, retirar o editar con error de la base no expone el mensaje en producción', async (t) => {
  const log = simularTransaccion(t, () => { throw new Error(DETALLE_INTERNO); });
  t.mock.method(pool, 'query', async () => { throw new Error(DETALLE_INTERNO); });
  const casos = [
    [instalacion.createInstalacionController, { body: { maquina_id: 1, area_id: 1, contrato_id: 1, ip_address: '10.0.0.1' } }, 'Error al crear la instalación'], // NOSONAR: IP de ejemplo, sin red
    [instalacion.deleteInstalacionController, { params: { id_instalacion: '1' }, body: {} }, 'Error al retirar la instalación'],
    [instalacion.updateInstalacionController, { params: { id_instalacion: '1' }, body: { ip_address: '10.0.0.1' } }, 'Error al actualizar la instalación'], // NOSONAR: IP de ejemplo, sin red
  ];
  const entorno = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    for (const [controlador, req, mensaje] of casos) {
      const r = await ejecutar(controlador, { user: { id: 1 }, ip: '127.0.0.1', ...req });
      assert.equal(r.status, 500, mensaje);
      assert.equal(r.cuerpo.message, mensaje);
      assert.equal(r.cuerpo.error, undefined);
      assert.doesNotMatch(JSON.stringify(r.cuerpo), /relation|does not exist/);
    }
  } finally {
    process.env.NODE_ENV = entorno;
  }
  assert.ok(log.length >= 3, 'los errores se registran con console.error');
});

test('instalaciones: editar una instalación que no existe responde 404 con su mensaje', async (t) => {
  simularTransaccion(t, () => ({ rows: [], rowCount: 0 }));
  const r = await ejecutar(instalacion.updateInstalacionController, {
    params: { id_instalacion: '999' }, body: { ip_address: '10.0.0.1' }, user: { id: 1 }, ip: '127.0.0.1', // NOSONAR: IP de ejemplo, sin red
  });
  assert.equal(r.status, 404);
  assert.deepEqual(r.cuerpo, { success: false, message: 'Instalación no encontrada o ya está retirada.' });
});
