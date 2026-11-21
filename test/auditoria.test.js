// S3-02 · Auditoría: el servicio registrarAuditoria y sus ayudas, con un db simulado (sin base de datos).
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const {
  ACCIONES,
  TABLAS,
  LIMITE_MAXIMO,
  sinSecretos,
  limpiarIp,
  registrarAuditoria,
  leerFila,
  auditarFila,
  contextoAuditoria,
  enTransaccion,
  validarFiltrosAuditoria,
  consultarAuditoria,
} = require('../src/services/auditoria');

// db que anota cada consulta y responde con `responder(sql, params)`
const dbFalso = (responder = () => ({ rows: [] })) => {
  const consultas = [];
  return {
    consultas,
    async query(sql, params = []) {
      consultas.push({ sql, params });
      return responder(sql, params);
    },
  };
};

const INSERT_OK = () => ({ rows: [{ id: 1, fecha: '2026-11-20T10:00:00Z' }] });

// ------------------------------ registrarAuditoria ------------------------------

test('registrarAuditoria inserta tabla, id, acción, usuario, antes, después e IP', async () => {
  const db = dbFalso(INSERT_OK);
  const r = await registrarAuditoria(db, {
    tabla: 'contratos',
    idRegistro: 7,
    accion: ACCIONES.ACTUALIZAR,
    usuarioId: 3,
    antes: { id_contrato: 7, costo_impresion_bn: '0.0200' },
    despues: { id_contrato: 7, costo_impresion_bn: '0.0300' },
    ip: '::ffff:192.168.1.20',
  });
  assert.deepEqual(r, { id: 1, fecha: '2026-11-20T10:00:00Z' });
  assert.equal(db.consultas.length, 1);
  const { sql, params } = db.consultas[0];
  assert.match(sql, /INSERT INTO registro_auditoria/);
  assert.match(sql, /\$5::jsonb, \$6::jsonb/);
  assert.deepEqual(params, [
    'contratos', 7, 'ACTUALIZAR', 3,
    '{"id_contrato":7,"costo_impresion_bn":"0.0200"}',
    '{"id_contrato":7,"costo_impresion_bn":"0.0300"}',
    '192.168.1.20',
  ]);
});

test('en un alta el valor anterior va null; sin usuario ni IP, también null', async () => {
  const db = dbFalso(INSERT_OK);
  await registrarAuditoria(db, { tabla: 'instalaciones', idRegistro: '12', accion: ACCIONES.CREAR, despues: { id_instalacion: 12 } });
  assert.deepEqual(db.consultas[0].params, ['instalaciones', 12, 'CREAR', null, null, '{"id_instalacion":12}', null]);
});

test('los arreglos se guardan como JSON (no como arreglo de PostgreSQL)', async () => {
  const db = dbFalso(INSERT_OK);
  await registrarAuditoria(db, {
    tabla: 'lotes_carga', idRegistro: 5, accion: ACCIONES.APROBAR, despues: { reportes_oficiales: [10, 11] },
  });
  assert.equal(db.consultas[0].params[5], '{"reportes_oficiales":[10,11]}');
});

test('nunca guarda contraseñas, ni siquiera anidadas', async () => {
  const db = dbFalso(INSERT_OK);
  await registrarAuditoria(db, {
    tabla: 'usuarios', idRegistro: 2, accion: ACCIONES.ACTUALIZAR,
    antes: { id_usuario: 2, email: 'a@b.c', password_hash: '$2b$10$xxx' },
    despues: { id_usuario: 2, datos: { password: 'Secreta123' }, lista: [{ password_hash: 'y', ok: 1 }] },
  });
  const [, , , , antes, despues] = db.consultas[0].params;
  assert.equal(antes, '{"id_usuario":2,"email":"a@b.c"}');
  assert.equal(despues, '{"id_usuario":2,"datos":{},"lista":[{"ok":1}]}');
  assert.doesNotMatch(antes + despues, /password|Secreta|\$2b\$/);
});

test('datos incompletos: lanza el error sin escribir nada', async () => {
  const db = dbFalso(INSERT_OK);
  const base = { tabla: 'contratos', idRegistro: 1, accion: ACCIONES.CREAR };
  await assert.rejects(registrarAuditoria(null, base), /falta la conexión/);
  await assert.rejects(registrarAuditoria(db, { ...base, tabla: ' ' }), /falta la tabla/);
  for (const idRegistro of [undefined, null, 0, -1, 1.5, 'abc', true]) {
    await assert.rejects(registrarAuditoria(db, { ...base, idRegistro }), /id de registro inválido/);
  }
  await assert.rejects(registrarAuditoria(db, { ...base, accion: 'BORRAR' }), /acción desconocida/);
  assert.equal(db.consultas.length, 0);
});

test('si la base no guarda la auditoría, el error llega al que llama (la operación falla)', async () => {
  const db = dbFalso(() => { throw new Error('relation "registro_auditoria" does not exist'); });
  await assert.rejects(
    registrarAuditoria(db, { tabla: 'contratos', idRegistro: 1, accion: ACCIONES.CREAR }),
    /registro_auditoria/
  );
});

// ------------------------------ Ayudas ------------------------------

test('limpiarIp quita el prefijo IPv6 de una IPv4 y deja null si no hay IP', () => {
  assert.equal(limpiarIp('::ffff:10.0.0.5'), '10.0.0.5');
  assert.equal(limpiarIp('::1'), '::1');
  assert.equal(limpiarIp('203.0.113.9'), '203.0.113.9');
  assert.equal(limpiarIp(''), null);
  assert.equal(limpiarIp(undefined), null);
});

test('sinSecretos no toca fechas ni valores simples', () => {
  const fecha = new Date('2026-11-20T00:00:00Z');
  assert.equal(sinSecretos(fecha), fecha);
  assert.equal(sinSecretos(5), 5);
  assert.equal(sinSecretos(null), null);
});

test('contextoAuditoria toma el usuario de la sesión y la IP de la petición', () => {
  assert.deepEqual(contextoAuditoria({ user: { id: 4 }, ip: '10.1.1.1' }), { usuarioId: 4, ip: '10.1.1.1' });
  assert.deepEqual(contextoAuditoria({}), { usuarioId: null, ip: null });
});

test('leerFila trae la fila completa sin la contraseña y puede bloquearla', async () => {
  const db = dbFalso(() => ({ rows: [{ fila: { id_usuario: 2, email: 'a@b.c', password_hash: 'x' } }] }));
  assert.deepEqual(await leerFila(db, 'usuarios', 2, { bloquear: true }), { id_usuario: 2, email: 'a@b.c' });
  assert.match(db.consultas[0].sql, /SELECT to_jsonb\(t\) AS fila FROM usuarios t WHERE t\.id_usuario = \$1 FOR UPDATE/);
  assert.deepEqual(db.consultas[0].params, [2]);

  await leerFila(db, 'contratos', 9);
  assert.doesNotMatch(db.consultas[1].sql, /FOR UPDATE/);
  assert.match(db.consultas[1].sql, /FROM contratos t WHERE t\.id_contrato = \$1/);
});

test('leerFila devuelve null si no existe y no acepta tablas fuera de la lista', async () => {
  assert.equal(await leerFila(dbFalso(), 'contratos', 404), null);
  await assert.rejects(leerFila(dbFalso(), 'usuarios; DROP TABLE usuarios', 1), /no se audita/);
});

test('cada tabla auditada tiene su clave primaria', () => {
  assert.deepEqual(Object.keys(TABLAS).sort(), [
    'areas', 'contratos', 'instalaciones', 'lotes_carga', 'maquinas', 'maquinas_cambio',
    'reportes_consolidado_staging', 'reportes_oficiales', 'usuarios',
  ]);
});

test('auditarFila lee la fila como quedó y la registra con su antes (y el extra)', async () => {
  const db = dbFalso((sql) => (/to_jsonb/.test(sql)
    ? { rows: [{ fila: { id_usuario: 2, activo: false } }] }
    : INSERT_OK()));
  await auditarFila(db, {
    tabla: 'usuarios', idRegistro: 2, accion: ACCIONES.DESACTIVAR,
    antes: { id_usuario: 2, activo: true }, usuarioId: 1, ip: '10.0.0.1', extra: { password_cambiada: false },
  });
  assert.equal(db.consultas.length, 2);
  assert.deepEqual(db.consultas[1].params, [
    'usuarios', 2, 'DESACTIVAR', 1, '{"id_usuario":2,"activo":true}',
    '{"id_usuario":2,"activo":false,"password_cambiada":false}', '10.0.0.1',
  ]);
});

// ------------------------------ enTransaccion ------------------------------

const poolFalso = ({ fallarEn = null } = {}) => {
  const sqls = [];
  let liberado = false;
  const client = {
    async query(sql) {
      sqls.push(sql.trim().split(/\s+/)[0]);
      if (fallarEn && new RegExp(fallarEn).test(sql)) throw new Error(`falló ${fallarEn}`);
      return { rows: [] };
    },
    release() { liberado = true; },
  };
  return { pool: { connect: async () => client }, client, sqls, liberado: () => liberado };
};

test('enTransaccion confirma el cambio y su auditoría juntos', async () => {
  const bd = poolFalso();
  const r = await enTransaccion(bd.pool, async (db) => {
    assert.equal(db, bd.client);
    await db.query('UPDATE contratos SET activo = false');
    await db.query('INSERT INTO registro_auditoria ...');
    return 'listo';
  });
  assert.equal(r, 'listo');
  assert.deepEqual(bd.sqls, ['BEGIN', 'UPDATE', 'INSERT', 'COMMIT']);
  assert.ok(bd.liberado());
});

test('enTransaccion: si falla la auditoría, deshace el cambio y lanza', async () => {
  const bd = poolFalso({ fallarEn: 'registro_auditoria' });
  await assert.rejects(enTransaccion(bd.pool, async (db) => {
    await db.query('UPDATE contratos SET activo = false');
    await db.query('INSERT INTO registro_auditoria ...');
  }), /falló registro_auditoria/);
  assert.deepEqual(bd.sqls, ['BEGIN', 'UPDATE', 'INSERT', 'ROLLBACK']);
  assert.ok(bd.liberado());
});

// ------------------------------ Consulta ------------------------------

test('validarFiltrosAuditoria: tabla de la lista, id positivo con su tabla y límite acotado', () => {
  assert.deepEqual(validarFiltrosAuditoria({}), { data: { tabla: null, idRegistro: null, limite: 100 } });
  assert.deepEqual(validarFiltrosAuditoria({ tabla: 'contratos', id_registro: '3', limite: '10' }),
    { data: { tabla: 'contratos', idRegistro: 3, limite: 10 } });
  assert.equal(validarFiltrosAuditoria({ limite: '9999' }).data.limite, LIMITE_MAXIMO);
  assert.match(validarFiltrosAuditoria({ tabla: 'clientes' }).error, /Tabla inválida/);
  assert.match(validarFiltrosAuditoria({ tabla: 'contratos', id_registro: 'x' }).error, /entero positivo/);
  assert.match(validarFiltrosAuditoria({ tabla: 'contratos', id_registro: '0' }).error, /entero positivo/);
  assert.match(validarFiltrosAuditoria({ id_registro: '3' }).error, /indique también la tabla/);
  assert.match(validarFiltrosAuditoria({ limite: '0' }).error, /limite/);
});

test('consultarAuditoria filtra por tabla e id y ordena del más nuevo al más viejo', async () => {
  const db = dbFalso(() => ({ rows: [{ id: 2 }, { id: 1 }] }));
  const filas = await consultarAuditoria(db, { tabla: 'lotes_carga', idRegistro: 5, limite: 20 });
  assert.deepEqual(filas, [{ id: 2 }, { id: 1 }]);
  assert.deepEqual(db.consultas[0].params, ['lotes_carga', 5, 20]);
  assert.match(db.consultas[0].sql, /ORDER BY ra\.fecha DESC/);
  assert.match(db.consultas[0].sql, /LEFT JOIN usuarios u/);
});
