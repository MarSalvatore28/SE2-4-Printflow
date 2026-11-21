// S3-02 · Auditoría en los controladores: el cambio y su registro van en la misma transacción,
// con el usuario de la sesión y la IP; si la auditoría falla, la operación falla.
// Sin base de datos: pools falsos y funciones del modelo reemplazadas.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/db');
const app = require('../src/app');
const validacionLecturas = require('../src/services/validacionLecturas');
const Staging = require('../src/models/reportemes_staging/reportemes_staging.model');
const Notificaciones = require('../src/models/notificaciones/notificaciones.model');
const notificacionesController = require('../src/controllers/notificaciones/notificaciones.controller');
const {
  crearContratoController, actualizarContratoController, eliminarClienteController, activarClienteController,
} = require('../src/controllers/cliente/cliente.controller');
const { registrarLecturaManualController } = require('../src/controllers/lectura/lectura.controller');
const { reprocesarReporteController } = require('../src/controllers/reproceso/reproceso.controller');
const { listarAuditoriaController } = require('../src/controllers/auditoria/auditoria.controller');

const USUARIO = { id: 9, rol: 'admin' };
const IP = '192.168.1.50';

const respuesta = () => ({
  statusCode: 200,
  body: undefined,
  status(codigo) { this.statusCode = codigo; return this; },
  json(cuerpo) { this.body = cuerpo; return this; },
});

// Client falso: `responder(sql, params)` devuelve { rows } o undefined (= consulta inesperada)
const clienteFalso = (responder, { fallarAuditoria = false } = {}) => {
  const consultas = [];
  let liberado = false;
  const client = {
    async query(sql, params = []) {
      consultas.push({ sql, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (/INSERT INTO registro_auditoria/.test(sql)) {
        if (fallarAuditoria) throw new Error('no se pudo escribir la auditoría');
        return { rows: [{ id: 1, fecha: new Date().toISOString() }] };
      }
      const r = responder(sql, params);
      if (!r) throw new Error(`consulta inesperada: ${sql}`);
      return r;
    },
    release() { liberado = true; },
  };
  return {
    client,
    pool: { connect: async () => client },
    consultas,
    transaccion: () => consultas.map((c) => c.sql.trim()).filter((s) => /^(BEGIN|COMMIT|ROLLBACK)/.test(s)),
    auditorias: () => consultas.filter((c) => /INSERT INTO registro_auditoria/.test(c.sql)).map((c) => ({
      tabla: c.params[0], id: c.params[1], accion: c.params[2], usuario: c.params[3],
      antes: c.params[4] && JSON.parse(c.params[4]), despues: c.params[5] && JSON.parse(c.params[5]), ip: c.params[6],
    })),
    liberado: () => liberado,
  };
};

// Reemplaza métodos de un objeto durante una prueba
const reemplazar = (t, objeto, cambios) => {
  const originales = {};
  for (const [nombre, fn] of Object.entries(cambios)) {
    originales[nombre] = objeto[nombre];
    objeto[nombre] = fn;
  }
  t.after(() => Object.assign(objeto, originales));
};

const silenciarErrores = (t) => {
  const original = console.error;
  console.error = () => undefined;
  t.after(() => { console.error = original; });
};

// ------------------------------ Contratos ------------------------------

const CONTRATO = {
  fecha_inicio: '2026-01-01', fecha_fin: null, costo_impresion_bn: 0.02, costo_impresion_color: 0.12,
};

test('crear contrato: el alta y su auditoría en la misma transacción, con usuario e IP', async (t) => {
  // La advertencia de superposición consulta con el pool global
  reemplazar(t, pool, { query: async () => ({ rows: [] }) });
  const bd = clienteFalso((sql) => {
    if (/INSERT INTO contratos/.test(sql)) return { rows: [{ id_contrato: 31 }] };
    if (/to_jsonb\(t\) AS fila FROM contratos/.test(sql)) return { rows: [{ fila: { id_contrato: 31, cliente_id: 4, activo: true } }] };
    return undefined;
  });
  const res = respuesta();
  await crearContratoController({ params: { id: 4 }, body: CONTRATO, pool: bd.pool, user: USUARIO, ip: IP }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.id_contrato, 31);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'COMMIT']);
  assert.deepEqual(bd.auditorias(), [{
    tabla: 'contratos', id: 31, accion: 'CREAR', usuario: 9, antes: null,
    despues: { id_contrato: 31, cliente_id: 4, activo: true }, ip: IP,
  }]);
  assert.ok(bd.liberado());
});

test('actualizar contrato: guarda la fila antes (bloqueada) y después del cambio', async (t) => {
  reemplazar(t, pool, {
    query: async (sql) => (/FROM contratos c\s+INNER JOIN clientes/.test(sql)
      ? { rows: [{ id_contrato: 31, cliente_id: 4 }] }
      : { rows: [] }),
  });
  let lecturas = 0;
  const bd = clienteFalso((sql) => {
    if (/to_jsonb\(t\) AS fila FROM contratos/.test(sql)) {
      lecturas += 1;
      return { rows: [{ fila: { id_contrato: 31, costo_impresion_bn: lecturas === 1 ? '0.0200' : '0.0300' } }] };
    }
    if (/UPDATE contratos/.test(sql)) return { rows: [], rowCount: 1 };
    return undefined;
  });
  const res = respuesta();
  await actualizarContratoController({
    params: { id: '31' }, body: { ...CONTRATO, costo_impresion_bn: 0.03 }, pool: bd.pool, user: USUARIO, ip: IP,
  }, res);

  assert.equal(res.statusCode, 200);
  const lecturaAntes = bd.consultas.find((c) => /to_jsonb/.test(c.sql));
  assert.match(lecturaAntes.sql, /FOR UPDATE/);
  const [registro] = bd.auditorias();
  assert.equal(registro.accion, 'ACTUALIZAR');
  assert.equal(registro.antes.costo_impresion_bn, '0.0200');
  assert.equal(registro.despues.costo_impresion_bn, '0.0300');
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'COMMIT']);
});

test('si la auditoría falla, el contrato no se crea (ROLLBACK y 500)', async (t) => {
  silenciarErrores(t);
  reemplazar(t, pool, { query: async () => ({ rows: [] }) });
  const bd = clienteFalso((sql) => {
    if (/INSERT INTO contratos/.test(sql)) return { rows: [{ id_contrato: 32 }] };
    if (/to_jsonb/.test(sql)) return { rows: [] };
    return undefined;
  }, { fallarAuditoria: true });
  const res = respuesta();
  await crearContratoController({ params: { id: 4 }, body: CONTRATO, pool: bd.pool, user: USUARIO, ip: IP }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'ROLLBACK']);
  assert.ok(bd.liberado());
});

// ------------------------------ Cliente: desactivar y activar en cascada ------------------------------

// Base falsa de un cliente con una asignación vigente (#51) y un contrato (#31)
const bdCliente = (opciones) => {
  const estado = { instalacionActiva: true, contratoActivo: opciones.contratoActivo ?? true };
  return clienteFalso((sql) => {
    if (/SELECT id_instalacion AS id FROM instalaciones/.test(sql)) return { rows: estado.instalacionActiva ? [{ id: 51 }] : [] };
    if (/SELECT id_contrato AS id FROM contratos/.test(sql)) {
      const activos = /activo = TRUE/.test(sql);
      return { rows: estado.contratoActivo === activos ? [{ id: 31 }] : [] };
    }
    if (/to_jsonb\(t\) AS fila FROM instalaciones/.test(sql)) return { rows: [{ fila: { id_instalacion: 51, activo: estado.instalacionActiva } }] };
    if (/to_jsonb\(t\) AS fila FROM contratos/.test(sql)) return { rows: [{ fila: { id_contrato: 31, activo: estado.contratoActivo } }] };
    if (/UPDATE instalaciones/.test(sql)) { estado.instalacionActiva = false; return { rows: [], rowCount: 1 }; }
    if (/UPDATE contratos SET activo = FALSE/.test(sql)) { estado.contratoActivo = false; return { rows: [], rowCount: 1 }; }
    if (/UPDATE contratos SET activo = TRUE/.test(sql)) { estado.contratoActivo = true; return { rows: [], rowCount: 1 }; }
    if (/UPDATE (clientes|areas)/.test(sql)) return { rows: [], rowCount: 1 };
    return undefined;
  }, opciones);
};

test('desactivar cliente: la asignación retirada y el contrato desactivado quedan en la auditoría, en la misma transacción', async () => {
  const bd = bdCliente({});
  const res = respuesta();
  await eliminarClienteController({ params: { id: '4' }, pool: bd.pool, user: USUARIO, ip: IP }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'COMMIT']);
  const bloqueos = bd.consultas.filter((c) => /SELECT id_(instalacion|contrato) AS id/.test(c.sql));
  assert.ok(bloqueos.length === 2 && bloqueos.every((c) => /FOR UPDATE/.test(c.sql)), 'las filas de la cascada se bloquean antes de leerlas');
  assert.deepEqual(bd.auditorias(), [
    { tabla: 'instalaciones', id: 51, accion: 'RETIRAR', usuario: USUARIO.id, antes: { id_instalacion: 51, activo: true }, despues: { id_instalacion: 51, activo: false }, ip: IP },
    { tabla: 'contratos', id: 31, accion: 'DESACTIVAR', usuario: USUARIO.id, antes: { id_contrato: 31, activo: true }, despues: { id_contrato: 31, activo: false }, ip: IP },
  ]);
  assert.ok(bd.liberado());
});

test('activar cliente: los contratos que vuelven a estar activos quedan en la auditoría', async () => {
  const bd = bdCliente({ contratoActivo: false });
  const res = respuesta();
  await activarClienteController({ params: { id: '4' }, pool: bd.pool, user: USUARIO, ip: IP }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'COMMIT']);
  assert.deepEqual(bd.auditorias(), [
    { tabla: 'contratos', id: 31, accion: 'ACTIVAR', usuario: USUARIO.id, antes: { id_contrato: 31, activo: false }, despues: { id_contrato: 31, activo: true }, ip: IP },
  ]);
});

test('si la auditoría de la cascada falla, el cliente no se desactiva (ROLLBACK y 500)', async (t) => {
  silenciarErrores(t);
  const bd = bdCliente({ fallarAuditoria: true });
  const res = respuesta();
  await eliminarClienteController({ params: { id: '4' }, pool: bd.pool, user: USUARIO, ip: IP }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'ROLLBACK']);
  assert.ok(bd.liberado());
});

// ------------------------------ Lectura manual ------------------------------

const ASIGNACION = {
  id_instalacion: 1, maquina_id: 1, ip_address: '10.20.1.11', activo: true,
  fecha_instalacion: '2026-01-01', fecha_retiro: null, serie: 'SIMA0001', maquina_activa: true,
  id_area: 1, area_nombre: 'Secretaría', cliente_id: 1, cliente_nombre: 'Colegio Horizonte (demo)',
};

const LECTURA = {
  instalacion_id: 1, fecha_lectura: '2026-11-10', contador_bn: 160500, contador_color: 21000,
  observacion: 'La impresora no envió el correo',
};

const bdLectura = (opciones) => clienteFalso((sql, params) => {
  if (/FROM instalaciones i/.test(sql)) return { rows: [ASIGNACION] };
  if (/INSERT INTO reportes_oficiales/.test(sql)) {
    return { rows: [{ id_reporte: 99, periodo: params[0], origen: 'MANUAL', lote_origen_id: null, usuario_validacion_id: params[11] }] };
  }
  if (/to_jsonb\(t\) AS fila FROM reportes_oficiales/.test(sql)) {
    return { rows: [{ fila: { id_reporte: 99, origen: 'MANUAL', usuario_registro_id: 5, usuario_validacion_id: 5 } }] };
  }
  return undefined;
}, opciones);

test('lectura manual: queda auditada y trae su trazabilidad (sin lote, validada por quien la registra)', async (t) => {
  reemplazar(t, validacionLecturas, { validarLectura: async () => null });
  const bd = bdLectura();
  const res = respuesta();
  await registrarLecturaManualController({ body: LECTURA, pool: bd.pool, user: { id: 5 }, ip: IP }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.lote_origen_id, null);
  assert.equal(res.body.data.usuario_validacion_id, 5);
  const insert = bd.consultas.find((c) => /INSERT INTO reportes_oficiales/.test(c.sql));
  assert.match(insert.sql, /usuario_registro_id, usuario_validacion_id/);
  assert.match(insert.sql, /'MANUAL', \$11, \$12, \$12/);

  assert.deepEqual(bd.auditorias(), [{
    tabla: 'reportes_oficiales', id: 99, accion: 'CREAR', usuario: 5, antes: null,
    despues: { id_reporte: 99, origen: 'MANUAL', usuario_registro_id: 5, usuario_validacion_id: 5 }, ip: IP,
  }]);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'COMMIT']);
});

test('lectura manual: si la auditoría falla, no se registra (ROLLBACK y 500)', async (t) => {
  silenciarErrores(t);
  reemplazar(t, validacionLecturas, { validarLectura: async () => null });
  const bd = bdLectura({ fallarAuditoria: true });
  const res = respuesta();
  await registrarLecturaManualController({ body: LECTURA, pool: bd.pool, user: { id: 5 }, ip: IP }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'ROLLBACK']);
  assert.ok(bd.liberado());
});

test('lectura manual rechazada por validarLectura: no hay nada que auditar', async (t) => {
  reemplazar(t, validacionLecturas, { validarLectura: async () => ({ codigo: 'DUPLICADA', motivo: 'Ya existe' }) });
  const bd = bdLectura();
  const res = respuesta();
  await registrarLecturaManualController({ body: LECTURA, pool: bd.pool, user: { id: 5 }, ip: IP }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(bd.auditorias(), []);
});

// ------------------------------ Reprocesar ------------------------------

const REPORTE = {
  id_staging_consolidado: 40, lote_id: 6, serie_maquina: 'SIMX9999', ip_detectada: '10.99.9.99',
  impresion_bn: 45000, impresion_color: 0, estado_maquina: 'ERROR', procesar_lectura: false,
  mensaje_aviso: 'Máquina no autorizada', intentos_reproceso: 0, fecha: '2026-10-28', lote_periodo: '2026-10',
};

test('reprocesar: cada intento queda auditado con la fila antes y después', async () => {
  const bd = clienteFalso((sql, params) => {
    if (/FROM reportes_consolidado_staging s/.test(sql)) return { rows: [REPORTE] };
    if (/to_jsonb\(t\) AS fila FROM reportes_consolidado_staging/.test(sql)) {
      return { rows: [{ fila: { id_staging_consolidado: 40, intentos_reproceso: 0, procesar_lectura: false } }] };
    }
    if (/FROM public\.maquinas m/.test(sql)) return { rows: [] };
    if (/UPDATE reportes_consolidado_staging/.test(sql)) {
      return { rows: [{ id_staging_consolidado: params[0], intentos_reproceso: params[1], procesar_lectura: params[4] }] };
    }
    return undefined;
  });
  const res = respuesta();
  await reprocesarReporteController({ params: { id: '40' }, pool: bd.pool, user: { id: 2 }, ip: IP }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(bd.auditorias(), [{
    tabla: 'reportes_consolidado_staging', id: 40, accion: 'REPROCESAR', usuario: 2,
    antes: { id_staging_consolidado: 40, intentos_reproceso: 0, procesar_lectura: false },
    despues: { id_staging_consolidado: 40, intentos_reproceso: 1, procesar_lectura: false },
    ip: IP,
  }]);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'COMMIT']);
});

test('reprocesar un reporte que no se puede (409): sin auditoría', async () => {
  const bd = clienteFalso((sql) => (/FROM reportes_consolidado_staging s/.test(sql)
    ? { rows: [{ ...REPORTE, intentos_reproceso: 3 }] }
    : undefined));
  const res = respuesta();
  await reprocesarReporteController({ params: { id: '40' }, pool: bd.pool, user: { id: 2 }, ip: IP }, res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(bd.auditorias(), []);
});

// ------------------------------ Lotes ------------------------------

const STAGING = [
  { id_staging_consolidado: 1, lote_id: 5, serie_maquina: 'SIMA0001', maquina_id_tentativa: 1, cliente_id_tentativo: 1,
    impresion_bn: 1000, impresion_color: 50, estado_maquina: 'OK', procesar_lectura: true },
  { id_staging_consolidado: 2, lote_id: 5, serie_maquina: 'SIMA0002', maquina_id_tentativa: 2, cliente_id_tentativo: 1,
    impresion_bn: 2000, impresion_color: 0, estado_maquina: 'OK', procesar_lectura: true },
];

const bdLote = () => {
  let id = 100;
  let aprobado = false;
  return clienteFalso((sql) => {
    if (/to_jsonb\(t\) AS fila FROM lotes_carga/.test(sql)) {
      return { rows: [{ fila: { id_lote: 5, periodo: '2026-10', fecha_aprobacion: aprobado ? '2026-11-20' : null, usuario_aprobacion_id: aprobado ? 9 : null } }] };
    }
    if (/SELECT \* FROM reportes_consolidado_staging WHERE lote_id/.test(sql)) return { rows: STAGING };
    if (/INSERT INTO reportes_oficiales/.test(sql)) { id += 1; return { rows: [{ id_reporte: id }] }; }
    if (/UPDATE lotes_carga/.test(sql)) { aprobado = true; return { rows: [] }; }
    // Asignación del período (área y tarifas congeladas): sin asignación en esta prueba
    if (/FROM instalaciones i\s+JOIN areas a/.test(sql)) return { rows: [] };
    if (/INSERT INTO reportes_detalle_oficial|UPDATE reportes_oficiales|DELETE FROM|UPDATE notificaciones/.test(sql)) return { rows: [] };
    return undefined;
  });
};

test('aprobar un lote: guarda quién aprobó en cada lectura y audita el lote antes y después', async (t) => {
  const bd = bdLote();
  reemplazar(t, pool, { connect: async () => bd.client });
  await Staging.approveStagingBatch(5, '2026-10', 9, IP);

  const inserts = bd.consultas.filter((c) => /INSERT INTO reportes_oficiales/.test(c.sql));
  assert.equal(inserts.length, 2);
  for (const insert of inserts) {
    assert.equal(insert.params[0], 5, 'lote_origen_id');
    // usuario_validacion_id va después de fecha_corte, con el último parámetro
    assert.match(insert.sql, /fecha_corte,\s+usuario_validacion_id,/);
    assert.match(insert.sql, new RegExp(`NOW\\(\\), \\$15,\\s+\\$${insert.params.length},`));
    assert.equal(insert.params.at(-1), 9, 'usuario_validacion_id');
  }

  const [registro] = bd.auditorias();
  assert.equal(registro.tabla, 'lotes_carga');
  assert.equal(registro.id, 5);
  assert.equal(registro.accion, 'APROBAR');
  assert.equal(registro.usuario, 9);
  assert.equal(registro.ip, IP);
  assert.equal(registro.antes.fecha_aprobacion, null);
  assert.deepEqual(registro.antes.reportes_staging.map((r) => r.serie_maquina), ['SIMA0001', 'SIMA0002']);
  assert.equal(registro.despues.usuario_aprobacion_id, 9);
  assert.equal(registro.despues.estado, 'PROCESADO');
  assert.deepEqual(registro.despues.reportes_oficiales, [101, 102]);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'COMMIT']);
});

test('rechazar un lote: la auditoría guarda los reportes descartados y el motivo', async (t) => {
  const bd = bdLote();
  reemplazar(t, pool, { connect: async () => bd.client });
  await Staging.rejectStagingBatch(5, { usuarioId: 9, ip: IP, motivo: 'Correo de prueba' });

  const [registro] = bd.auditorias();
  assert.equal(registro.accion, 'RECHAZAR');
  assert.equal(registro.antes.reportes_staging.length, 2);
  assert.equal(registro.despues.estado, 'DESCARTADO');
  assert.equal(registro.despues.motivo, 'Correo de prueba');
  assert.equal(registro.despues.reportes_descartados, 2);
  assert.equal(registro.usuario, 9);
  // Lee el staging antes de borrarlo
  const indice = (re) => bd.consultas.findIndex((c) => re.test(c.sql));
  assert.ok(indice(/SELECT \* FROM reportes_consolidado_staging/) < indice(/DELETE FROM reportes_consolidado_staging/));
});

test('si la auditoría del lote falla, la aprobación se deshace', async (t) => {
  const base = bdLote();
  const bd = clienteFalso((sql, params) => base.client.query(sql, params), { fallarAuditoria: true });
  reemplazar(t, pool, { connect: async () => bd.client });
  await assert.rejects(Staging.approveStagingBatch(5, '2026-10', 9, IP), /auditoría/);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'ROLLBACK']);
});

test('notificaciones: aprobar y rechazar pasan el usuario, la IP y el motivo a staging', async (t) => {
  const llamadas = [];
  let consultas = 0;
  reemplazar(t, Notificaciones, {
    obtenerLote: async () => (consultas++ % 2 === 0
      ? { id_lote: 5, periodo: '2026-10', estado: 'PENDIENTE', clientes: [] }
      : { id_lote: 5, estado: 'PROCESADO' }),
    registrarAprobador: async () => undefined,
    registrarRechazo: async () => undefined,
  });
  reemplazar(t, Staging, {
    validarLoteStaging: async () => ({ esValido: true, errores: [] }),
    approveStagingBatch: async (...args) => llamadas.push(['aprobar', ...args]),
    rejectStagingBatch: async (...args) => llamadas.push(['rechazar', ...args]),
  });
  const req = (body = {}) => ({ params: { loteId: '5' }, query: {}, body, user: { id: 9 }, ip: IP });

  await notificacionesController.aprobarLoteController(req(), respuesta());
  await notificacionesController.rechazarLoteController(req({ motivo: '  Duplicado  ' }), respuesta());
  assert.deepEqual(llamadas, [
    ['aprobar', 5, '2026-10', 9, IP],
    ['rechazar', 5, { usuarioId: 9, ip: IP, motivo: 'Duplicado' }],
  ]);
});

// ------------------------------ GET /api/auditoria ------------------------------

test('GET /api/auditoria: filtros inválidos responden 400 sin consultar', async () => {
  const pool = { query: async () => assert.fail('no debe consultar') };
  for (const query of [{ tabla: 'clientes' }, { id_registro: '3' }, { tabla: 'contratos', id_registro: 'x' }]) {
    const res = respuesta();
    await listarAuditoriaController({ query, pool }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('GET /api/auditoria: devuelve los registros con los filtros aplicados', async () => {
  let params;
  const pool = { query: async (_sql, p) => { params = p; return { rows: [{ id: 3, accion: 'APROBAR' }] }; } };
  const res = respuesta();
  await listarAuditoriaController({ query: { tabla: 'lotes_carga', id_registro: '5' }, pool }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, [{ id: 3, accion: 'APROBAR' }]);
  assert.equal(res.body.count, 1);
  assert.deepEqual(params, ['lotes_carga', 5, 100]);
});

test('GET /api/auditoria es solo para admin: operador y auditor reciben 403', async () => {
  const router = require('../src/routes/auditoria/auditoria.routes');
  const capa = router.stack.find((c) => c.route?.path === '/' && c.route.methods.get);
  assert.ok(capa, 'falta la ruta GET /');
  const [permiso] = capa.route.stack.map((s) => s.handle);
  const ejecutar = async (rol) => {
    const r = { status: null, siguio: false };
    const res = { status(c) { r.status = c; return this; }, json() { return this; } };
    await permiso({ user: { rol } }, res, () => { r.siguio = true; });
    return r;
  };
  assert.equal((await ejecutar('admin')).siguio, true);
  assert.equal((await ejecutar('operador')).status, 403);
  assert.equal((await ejecutar('auditor')).status, 403);
});

test('/api/auditoria está montado, exige token y figura en Swagger', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://localhost:${port}/api/auditoria`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
  const docs = require('../src/config/swagger');
  assert.ok(docs.paths['/api/auditoria']?.get, 'falta /api/auditoria en Swagger');
});

test('detrás de nginx, req.ip es la IP del cliente (X-Forwarded-For desde la red privada)', async () => {
  assert.equal(app.get('trust proxy fn')('172.18.0.3', 0), true);
  assert.equal(app.get('trust proxy fn')('203.0.113.9', 0), false);
});
