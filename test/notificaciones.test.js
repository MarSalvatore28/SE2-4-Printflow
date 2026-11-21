// Notificaciones y lotes: validaciones y reglas de aprobación/rechazo.
// No necesitan base de datos: se reemplazan las funciones del modelo.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const Notificaciones = require('../src/models/notificaciones/notificaciones.model');
const Staging = require('../src/models/reportemes_staging/reportemes_staging.model');
const controller = require('../src/controllers/notificaciones/notificaciones.controller');

// req/res mínimos de Express
const llamar = async (handler, { params = {}, query = {}, body = {}, user = { id: 7 } } = {}) => {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(datos) { this.body = datos; return this; },
  };
  await handler({ params, query, body, user }, res);
  return res;
};

// Reemplaza funciones de un módulo durante una prueba y las restaura al final
const reemplazar = (t, modulo, cambios) => {
  const originales = {};
  for (const [nombre, fn] of Object.entries(cambios)) {
    originales[nombre] = modulo[nombre];
    modulo[nombre] = fn;
  }
  t.after(() => Object.assign(modulo, originales));
};

const lote = (estado, extra = {}) => ({ id_lote: 5, periodo: '2026-10', estado, ...extra });

test('GET /api/notificaciones sin token responde 401', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://localhost:${port}/api/notificaciones/contar-no-leidas`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).success, false);
  } finally {
    server.close();
  }
});

test('contar-no-leidas devuelve el número en data', async (t) => {
  reemplazar(t, Notificaciones, { contarNoLeidas: async () => 4 });
  const res = await llamar(controller.contarNoLeidasController);
  assert.deepEqual(res.body, { success: true, data: 4 });
});

test('listar rechaza leida y limite inválidos', async () => {
  assert.equal((await llamar(controller.listarController, { query: { leida: 'quizas' } })).statusCode, 400);
  assert.equal((await llamar(controller.listarController, { query: { limite: '0' } })).statusCode, 400);
  assert.equal((await llamar(controller.listarController, { query: { limite: 'abc' } })).statusCode, 400);
});

test('marcar varias exige un arreglo de enteros positivos', async () => {
  assert.equal((await llamar(controller.marcarVariasLeidasController, { body: {} })).statusCode, 400);
  assert.equal((await llamar(controller.marcarVariasLeidasController, { body: { ids: [] } })).statusCode, 400);
  assert.equal((await llamar(controller.marcarVariasLeidasController, { body: { ids: [1, 'x'] } })).statusCode, 400);
});

test('un ID que no es número responde 400 sin consultar la base', async (t) => {
  reemplazar(t, Notificaciones, {
    obtenerNotificacion: async () => assert.fail('no debe consultar'),
    marcarLeida: async () => assert.fail('no debe consultar'),
  });
  assert.equal((await llamar(controller.obtenerController, { params: { id: 'abc' } })).statusCode, 400);
  assert.equal((await llamar(controller.marcarLeidaController, { params: { id: '-3' } })).statusCode, 400);
  assert.equal((await llamar(controller.aprobarLoteController, { params: { loteId: '1.5' } })).statusCode, 400);
});

test('solo se eliminan notificaciones leídas', async (t) => {
  let eliminada = false;
  reemplazar(t, Notificaciones, {
    obtenerNotificacion: async () => ({ id_notificacion: 3, leida: false }),
    eliminarNotificacion: async () => { eliminada = true; return 1; },
  });
  const res = await llamar(controller.eliminarController, { params: { id: '3' } });
  assert.equal(res.statusCode, 409);
  assert.equal(eliminada, false);
});

test('la notificación de un lote pendiente o rechazado no se elimina (guarda el motivo del rechazo)', async (t) => {
  let notificacion = { id_notificacion: 3, leida: true, lote_id: 9, fecha_aprobacion: null };
  const eliminadas = [];
  reemplazar(t, Notificaciones, {
    obtenerNotificacion: async () => notificacion,
    eliminarNotificacion: async (id) => { eliminadas.push(id); return 1; },
  });
  const rechazada = await llamar(controller.eliminarController, { params: { id: '3' } });
  assert.equal(rechazada.statusCode, 409);
  assert.match(rechazada.body.message, /motivo del rechazo/);
  // Lote aprobado (la aprobación queda en lotes_carga) o notificación sin lote: sí
  notificacion = { ...notificacion, fecha_aprobacion: '2026-11-21T16:00:00Z' };
  assert.equal((await llamar(controller.eliminarController, { params: { id: '3' } })).statusCode, 200);
  notificacion = { id_notificacion: 4, leida: true, lote_id: null };
  assert.equal((await llamar(controller.eliminarController, { params: { id: '4' } })).statusCode, 200);
  assert.deepEqual(eliminadas, [3, 4]);
});

test('limpiar antiguas conserva las notificaciones de lotes no aprobados', async (t) => {
  const pool = require('../src/config/db');
  let sql = '';
  t.mock.method(pool, 'query', async (texto) => { sql = texto; return { rowCount: 0, rows: [] }; });
  await Notificaciones.eliminarLeidasAntiguas(30);
  assert.match(sql, /n\.lote_id IS NULL OR EXISTS \(\s*SELECT 1 FROM lotes_carga l WHERE l\.id_lote = n\.lote_id AND l\.fecha_aprobacion IS NOT NULL\)/);
});

test('listar lotes valida estado, cliente y fechas, y pasa los filtros al modelo', async (t) => {
  let filtros;
  reemplazar(t, Notificaciones, { listarLotes: async (f) => { filtros = f; return []; } });

  assert.equal((await llamar(controller.listarLotesController, { query: { estado: 'APROBADO' } })).statusCode, 400);
  assert.equal((await llamar(controller.listarLotesController, { query: { cliente_id: 'x' } })).statusCode, 400);
  assert.equal((await llamar(controller.listarLotesController, { query: { desde: '2026-13-45' } })).statusCode, 400);
  assert.equal((await llamar(controller.listarLotesController, {
    query: { desde: '2026-11-10', hasta: '2026-11-01' },
  })).statusCode, 400);

  const res = await llamar(controller.listarLotesController, {
    query: { estado: 'pendiente', cliente_id: '2', desde: '2026-11-01', hasta: '2026-11-30' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(filtros, { estado: 'PENDIENTE', clienteId: 2, desde: '2026-11-01', hasta: '2026-11-30' });
});

test('aprobar un lote con errores de validación responde 409 con la lista de errores', async (t) => {
  let aprobado = false;
  reemplazar(t, Notificaciones, { obtenerLote: async () => lote('ERROR') });
  reemplazar(t, Staging, {
    validarLoteStaging: async () => ({ esValido: false, errores: ['Máquina no autorizada'] }),
    approveStagingBatch: async () => { aprobado = true; },
  });
  const res = await llamar(controller.aprobarLoteController, { params: { loteId: '5' } });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body.errores, ['Máquina no autorizada']);
  assert.equal(aprobado, false);
});

test('aprobar usa el período del lote y guarda al usuario del token como aprobador', async (t) => {
  const llamadas = [];
  let consultas = 0;
  reemplazar(t, Notificaciones, {
    obtenerLote: async () => (consultas++ === 0 ? lote('PENDIENTE') : lote('PROCESADO')),
    registrarAprobador: async (id, usuario) => llamadas.push(['aprobador', id, usuario]),
  });
  reemplazar(t, Staging, {
    validarLoteStaging: async () => ({ esValido: true, errores: [] }),
    approveStagingBatch: async (id, periodo) => llamadas.push(['aprobar', id, periodo]),
  });
  const res = await llamar(controller.aprobarLoteController, { params: { loteId: '5' }, user: { id: 9 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.estado, 'PROCESADO');
  assert.deepEqual(llamadas, [['aprobar', 5, '2026-10'], ['aprobador', 5, 9]]);
});

test('aprobar rechaza un período mal escrito', async () => {
  const res = await llamar(controller.aprobarLoteController, { params: { loteId: '5' }, body: { periodo: '10-2026' } });
  assert.equal(res.statusCode, 400);
});

test('no se aprueba ni se rechaza un lote ya procesado o descartado', async (t) => {
  let estado = 'PROCESADO';
  reemplazar(t, Notificaciones, { obtenerLote: async () => lote(estado) });
  reemplazar(t, Staging, {
    validarLoteStaging: async () => assert.fail('no debe validar'),
    rejectStagingBatch: async () => assert.fail('no debe rechazar'),
  });
  assert.equal((await llamar(controller.aprobarLoteController, { params: { loteId: '5' } })).statusCode, 409);
  assert.equal((await llamar(controller.rechazarLoteController, { params: { loteId: '5' } })).statusCode, 409);
  estado = 'DESCARTADO';
  assert.equal((await llamar(controller.aprobarLoteController, { params: { loteId: '5' } })).statusCode, 409);
  assert.equal((await llamar(controller.rechazarLoteController, { params: { loteId: '5' } })).statusCode, 409);
});

// Dos clics seguidos (o aprobar y rechazar a la vez): el segundo encuentra el lote ya resuelto
// dentro de la transacción y staging lanza 409. No es un 500.
test('aprobar o rechazar un lote que otro resolvió al mismo tiempo responde 409, no 500', async (t) => {
  const yaAprobado = Object.assign(new Error('El lote ya fue aprobado'), { status: 409 });
  reemplazar(t, Notificaciones, { obtenerLote: async () => lote('PENDIENTE') });
  reemplazar(t, Staging, {
    validarLoteStaging: async () => ({ esValido: true, errores: [] }),
    approveStagingBatch: async () => { throw yaAprobado; },
    rejectStagingBatch: async () => { throw Object.assign(new Error('El lote ya fue aprobado y no se puede rechazar'), { status: 409 }); },
  });
  const aprobar = await llamar(controller.aprobarLoteController, { params: { loteId: '5' } });
  assert.equal(aprobar.statusCode, 409);
  assert.deepEqual(aprobar.body.errores, ['El lote ya fue aprobado']);
  const rechazar = await llamar(controller.rechazarLoteController, { params: { loteId: '5' } });
  assert.equal(rechazar.statusCode, 409);
  assert.equal(rechazar.body.message, 'El lote ya fue aprobado y no se puede rechazar');
});

test('rechazar guarda el motivo, el usuario y los clientes del lote', async (t) => {
  const llamadas = [];
  let consultas = 0;
  reemplazar(t, Notificaciones, {
    obtenerLote: async () => (consultas++ === 0
      ? lote('PENDIENTE', { clientes: [{ id_cliente: 4, nombre: 'Demo' }] })
      : lote('DESCARTADO')),
    registrarRechazo: async (...args) => llamadas.push(['registrar', ...args]),
  });
  reemplazar(t, Staging, { rejectStagingBatch: async (id) => llamadas.push(['rechazar', id]) });
  const res = await llamar(controller.rechazarLoteController, {
    params: { loteId: '5' }, body: { motivo: '  Correo de prueba  ' }, user: { id: 2 },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(llamadas, [['rechazar', 5], ['registrar', 5, 2, 'Correo de prueba', [4]]]);
});

test('aprobar por notificación exige que la notificación tenga lote', async (t) => {
  reemplazar(t, Notificaciones, { obtenerNotificacion: async () => ({ id_notificacion: 1, lote_id: null }) });
  const res = await llamar(controller.aprobarPorNotificacionController, { params: { id: '1' } });
  assert.equal(res.statusCode, 400);
});
