// /api/staging ya no deja editar a mano los contadores de un lote antes de aprobarlo (PLAN.md §9,
// decisión 17): POST /, PUT /:id, PUT /consolidado/:id, PUT /detalle/:id, PUT /detalles/batch y
// DELETE /:id no las usaban ni la web, ni el simulador, ni la prueba E2E, ni Postman, y cambiaban
// los contadores sin dejar rastro. Sin base de datos: la sesión se simula con pool.query.
require('module-alias/register');
process.env.SECRET_KEY = process.env.SECRET_KEY || 'clave-de-prueba';
const test = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/db');
const app = require('../src/app');
const { generateToken } = require('../src/utils/jwt.util');
const router = require('../src/routes/reportemes_staging/reportemes_staging.routes');
const controller = require('../src/controllers/reportemes_staging/reportemes_staging.controller');
const modelo = require('../src/models/reportemes_staging/reportemes_staging.model');

const rutas = router.stack
  .filter((capa) => capa.route)
  .flatMap((capa) => Object.keys(capa.route.methods).map((metodo) => `${metodo.toUpperCase()} ${capa.route.path}`));

const QUITADAS = [
  ['POST', '/api/staging/', { lote_carga: 'L-1', printTotal: 10 }],
  ['PUT', '/api/staging/5', { printTotal: 10 }],
  ['PUT', '/api/staging/consolidado/5', { consolidado_print_total: 10 }],
  ['PUT', '/api/staging/detalle/5', { print_total: 10 }],
  ['PUT', '/api/staging/detalles/batch', { detalles: [{ id_staging_detalle: 5, print_total: 1 }] }],
  ['DELETE', '/api/staging/5'],
];

test('el router de staging solo tiene lectura, aprobar, rechazar, limpiar y validar-csv', () => {
  assert.deepEqual(rutas.sort(), [
    'DELETE /limpiar/aprobados',
    'DELETE /limpiar/rechazados',
    'GET /',
    'GET /:id',
    'GET /cliente/:clienteId',
    'GET /estadisticas',
    'GET /estado/:estado',
    'GET /lote/:lote',
    'GET /lote/:lote/completo',
    'GET /lote/:lote/validar',
    'GET /lotes/:loteId/alertas',
    'GET /pendientes',
    'GET /periodo/:periodo',
    'POST /approve-batch',
    'POST /reject-batch',
    'POST /validar-csv',
  ]);
});

test('no quedan los controladores ni los modelos de la edición a mano', () => {
  const editar = /^(create|update|delete)(Staging|ConsolidadoStaging|DetalleStaging|MultiplesDetallesStaging)(Controller)?$/;
  assert.deepEqual(Object.keys(controller).filter((n) => editar.test(n)), []);
  assert.deepEqual(Object.keys(modelo).filter((n) => editar.test(n)), []);
});

test('con sesión de admin, las rutas quitadas responden 404 y no tocan staging', async (t) => {
  const consultas = [];
  // protect lee el usuario de la base: admin activo
  t.mock.method(pool, 'query', async (sql) => {
    consultas.push(sql);
    return { rows: [{ id_usuario: 1, email: 'admin@printflow.local', nombre: 'Ana', apellido: 'Admin', rol_id: 1, activo: true, rol_nombre: 'admin' }] };
  });
  t.mock.method(pool, 'connect', async () => { throw new Error('no debe abrir una transacción'); });
  const token = generateToken({ id: 1 });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    for (const [metodo, ruta, cuerpo] of QUITADAS) {
      const res = await fetch(`http://localhost:${port}${ruta}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
      assert.equal(res.status, 404, `${metodo} ${ruta}`);
      assert.match((await res.json()).message, /Ruta no encontrada/, `${metodo} ${ruta}`);
    }
  } finally {
    server.close();
  }
  assert.ok(consultas.every((sql) => !/staging/i.test(sql)), 'solo se consultó la sesión');
});

test('las rutas quitadas tampoco figuran en Swagger', () => {
  const docs = require('../src/config/swagger');
  const deStaging = Object.entries(docs.paths || {}).filter(([ruta]) => ruta.startsWith('/api/staging'));
  for (const [ruta, metodos] of deStaging) {
    assert.ok(/reprocesar$/.test(ruta) || !['put', 'delete'].some((m) => metodos[m]), `${ruta} no debe documentar PUT ni DELETE`);
  }
  assert.equal(docs.paths?.['/api/staging']?.post, undefined);
});
