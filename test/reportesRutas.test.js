// /api/reportes solo expone lo que funciona: el consolidado y el informe por usuario.
// Las rutas que respondían 501 (periodo, cliente, máquina, IP, cuenta, CRUD) se quitaron.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const router = require('../src/routes/reportemes/reportemes.routes');
const controller = require('../src/controllers/reportemes/reportemes.controller');

const rutas = router.stack
  .filter((capa) => capa.route)
  .flatMap((capa) => Object.keys(capa.route.methods).map((metodo) => `${metodo.toUpperCase()} ${capa.route.path}`));

test('el router de reportes tiene solo el consolidado y el detallado', () => {
  assert.deepEqual(rutas.sort(), [
    'GET /consolidado/:clienteId/:periodo',
    'GET /detallado/:clienteId/:periodo',
  ]);
});

test('ya no existen las rutas que respondían 501', () => {
  for (const ruta of ['GET /periodo/:periodo', 'GET /cliente/:id', 'GET /:id', 'POST /', 'DELETE /:id']) {
    assert.ok(!rutas.includes(ruta), `${ruta} no debe existir`);
  }
  const pendientes = Object.keys(controller).filter((nombre) => /ByCliente|ByPeriodo|ConteoInicial|crearReporteme|eliminarReporteme/.test(nombre));
  assert.deepEqual(pendientes, []);
});
