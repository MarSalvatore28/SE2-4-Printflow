// S3-04 · Lectura manual: validaciones de entrada, vigencia de la asignación y el contrato con
// validarLectura (S3-01). Sin base de datos: el pool es falso y validarLectura se simula.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const {
  OBSERVACION_MAX,
  validarDatosLecturaManual,
  motivoAsignacionNoVigente,
} = require('../src/utils/lecturaManual.reglas');
const validacionLecturas = require('../src/services/validacionLecturas');
const { registrarLecturaManualController } = require('../src/controllers/lectura/lectura.controller');

const HOY = '2026-11-18';

const valido = (cambios = {}) => ({
  instalacion_id: 1,
  fecha_lectura: '2026-11-18',
  contador_bn: 160500,
  contador_color: 21000,
  observacion: 'La impresora no envió el correo de noviembre',
  ...cambios,
});

const mensajeDe = (body) => {
  const r = validarDatosLecturaManual(body, HOY);
  assert.ok(r.error, `se esperaba un error para ${JSON.stringify(body)}`);
  assert.equal(r.error.status, 400);
  return r.error.message;
};

// ------------------------------ Validaciones de entrada ------------------------------

test('una lectura válida se normaliza (ids y contadores como texto, observación sin espacios)', () => {
  const { error, data } = validarDatosLecturaManual(valido({
    instalacion_id: '7',
    contador_bn: '160500',
    contador_color: 0,
    observacion: '   Correo no llegó  ',
  }), HOY);
  assert.equal(error, undefined);
  assert.deepEqual(data, {
    instalacionId: 7,
    fecha: '2026-11-18',
    periodo: '2026-11',
    contadorBn: 160500,
    contadorColor: 0,
    observacion: 'Correo no llegó',
  });
});

test('el período es el mes de la fecha de lectura', () => {
  assert.equal(validarDatosLecturaManual(valido({ fecha_lectura: '2026-10-31' }), HOY).data.periodo, '2026-10');
});

test('sin cuerpo, o con un arreglo, pide la asignación', () => {
  for (const body of [undefined, null, 'texto', [], {}]) {
    assert.match(mensajeDe(body), /asignación/);
  }
});

test('la asignación debe ser un id positivo', () => {
  for (const instalacion_id of [undefined, null, '', 0, -3, 1.5, 'abc', '12a']) {
    assert.match(mensajeDe(valido({ instalacion_id })), /asignación/);
  }
});

test('la fecha debe existir y tener el formato AAAA-MM-DD', () => {
  for (const fecha_lectura of [undefined, '', '18/11/2026', '2026-02-30', '2026-13-01', 20261118]) {
    assert.match(mensajeDe(valido({ fecha_lectura })), /fecha de lectura debe ser una fecha válida/);
  }
});

test('la fecha no puede ser futura', () => {
  assert.match(mensajeDe(valido({ fecha_lectura: '2026-11-19' })), /posterior a hoy/);
  assert.equal(validarDatosLecturaManual(valido({ fecha_lectura: HOY }), HOY).error, undefined);
});

test('los contadores son enteros mayores o iguales a 0 y obligatorios', () => {
  for (const contador_bn of [undefined, null, '', -1, 1.5, 'mil', '1e3', 2147483648]) {
    assert.match(mensajeDe(valido({ contador_bn })), /contador B\/N/);
  }
  for (const contador_color of [undefined, null, '', -1, 2.2, 'x']) {
    assert.match(mensajeDe(valido({ contador_color })), /contador de color/);
  }
  assert.equal(validarDatosLecturaManual(valido({ contador_bn: 0, contador_color: 0 }), HOY).error, undefined);
});

test('la observación es obligatoria', () => {
  for (const observacion of [undefined, null, '', '    ', 123]) {
    assert.match(mensajeDe(valido({ observacion })), /observación es obligatoria/);
  }
});

test('la observación tiene un máximo de caracteres', () => {
  assert.match(mensajeDe(valido({ observacion: 'x'.repeat(OBSERVACION_MAX + 1) })), /no puede superar/);
  assert.equal(validarDatosLecturaManual(valido({ observacion: 'x'.repeat(OBSERVACION_MAX) }), HOY).error, undefined);
});

// ------------------------------ Vigencia de la asignación ------------------------------

const asignacion = (cambios = {}) => ({
  activo: true,
  fecha_instalacion: '2026-01-15',
  fecha_retiro: null,
  maquina_activa: true,
  serie: 'SIMA0001',
  ...cambios,
});

test('una asignación activa e instalada antes de la fecha está vigente', () => {
  assert.equal(motivoAsignacionNoVigente(asignacion(), '2026-11-18'), null);
  assert.equal(motivoAsignacionNoVigente(asignacion({ fecha_instalacion: '2026-11-18' }), '2026-11-18'), null);
});

test('asignación que no existe, retirada, de una máquina inactiva o posterior a la fecha: no vigente', () => {
  assert.match(motivoAsignacionNoVigente(null, '2026-11-18'), /no existe/);
  assert.match(motivoAsignacionNoVigente(asignacion({ activo: false }), '2026-11-18'), /ya no está vigente/);
  assert.match(
    motivoAsignacionNoVigente(asignacion({ activo: false, fecha_retiro: '2026-11-12' }), '2026-11-18'),
    /se retiró el 2026-11-12/
  );
  assert.match(motivoAsignacionNoVigente(asignacion({ maquina_activa: false }), '2026-11-18'), /inactiva/);
  assert.match(
    motivoAsignacionNoVigente(asignacion({ fecha_instalacion: '2026-11-20' }), '2026-11-18'),
    /no estaba vigente el 2026-11-18/
  );
});

// ------------------------- Controlador con un pool falso -------------------------

const ASIGNACION_BD = {
  id_instalacion: 1, maquina_id: 1, ip_address: '10.20.1.11', activo: true,
  fecha_instalacion: '2026-01-01', fecha_retiro: null, serie: 'SIMA0001', maquina_activa: true,
  id_area: 1, area_nombre: 'Secretaría', cliente_id: 1, cliente_nombre: 'Colegio Horizonte (demo)',
};

// Pool que responde según la consulta y anota todo lo que se ejecutó
const poolFalso = ({ asignacion: fila = ASIGNACION_BD } = {}) => {
  const consultas = [];
  let liberado = false;
  const client = {
    async query(sql, params = []) {
      consultas.push({ sql, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (/FROM instalaciones i/.test(sql)) return { rows: fila ? [fila] : [] };
      if (/INSERT INTO reportes_oficiales/.test(sql)) {
        return {
          rows: [{
            id_reporte: 99, periodo: params[0], maquina_id: params[1], cliente_id: params[2],
            contador_bn: params[3], contador_color: params[4], origen: 'MANUAL',
            observacion: params[10], usuario_registro_id: params[11],
          }],
        };
      }
      if (/FROM reportes_oficiales|cabecera_contadores_cambio/.test(sql)) return { rows: [] };

      throw new Error(`consulta inesperada: ${sql}`);
    },
    release() { liberado = true; },
  };
  return {
    pool: { connect: async () => client },
    consultas,
    sqls: () => consultas.map((c) => c.sql.trim().split(/\s+/).slice(0, 3).join(' ')),
    liberado: () => liberado,
  };
};

const llamar = async (body, pool) => {
  const res = {
    statusCode: null,
    body: null,
    status(codigo) { this.statusCode = codigo; return this; },
    json(cuerpo) { this.body = cuerpo; return this; },
  };
  await registrarLecturaManualController({ body, pool, user: { id: 5, rol: 'operador' } }, res);
  return res;
};

// Simula una versión de validarLectura durante un test (el contrato es el mismo)
const conValidarLectura = async (fn, cuerpo) => {
  const original = validacionLecturas.validarLectura;
  validacionLecturas.validarLectura = fn;
  try {
    return await cuerpo();
  } finally {
    validacionLecturas.validarLectura = original;
  }
};

test('lectura válida: 201, origen MANUAL, usuario de la sesión y el período de la fecha', async () => {
  const bd = poolFalso();
  const res = await llamar(valido({ fecha_lectura: '2026-11-10' }), bd.pool);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.origen, 'MANUAL');
  assert.equal(res.body.data.usuario_registro_id, 5);
  assert.equal(res.body.data.periodo, '2026-11');
  assert.equal(res.body.data.contador_bn, 160500);
  assert.equal(res.body.data.cliente_nombre, 'Colegio Horizonte (demo)');
  assert.deepEqual(bd.sqls().filter((s) => /BEGIN|COMMIT|ROLLBACK/.test(s)), ['BEGIN', 'COMMIT']);
  assert.ok(bd.liberado());

  const insert = bd.consultas.find((c) => /INSERT INTO reportes_oficiales/.test(c.sql));
  // periodo, máquina, cliente, B/N, color, total, serie, IP, área, fecha, observación, usuario
  assert.deepEqual(insert.params, [
    '2026-11', 1, 1, 160500, 21000, 181500, 'SIMA0001', '10.20.1.11', 'Secretaría', '2026-11-10',
    'La impresora no envió el correo de noviembre', 5,
  ]);
  assert.match(insert.sql, /'MANUAL'/);
});

test('validarLectura recibe el client de la transacción y la lectura con el contrato acordado', async () => {
  const bd = poolFalso();
  let recibido;
  await conValidarLectura(async (db, lectura) => {
    recibido = { db, lectura };
    return null;
  }, () => llamar(valido(), bd.pool));
  assert.equal(typeof recibido.db.query, 'function');
  assert.notEqual(recibido.db, bd.pool, 'debe recibir el client, no el pool');
  assert.deepEqual(recibido.lectura, {
    maquinaId: 1, instalacionId: 1, periodo: '2026-11', fecha: '2026-11-18', contadorBn: 160500, contadorColor: 21000,
  });
});

test('si validarLectura devuelve un motivo, responde 400 con ese motivo tal cual y no inserta', async () => {
  const bd = poolFalso();
  const motivo = 'Retroceso de contador: el B/N (160500) es menor que la última lectura aprobada (170000, 2026-10)';
  const res = await conValidarLectura(
    async () => ({ codigo: 'RETROCESO', motivo }),
    () => llamar(valido(), bd.pool)
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, motivo);
  assert.equal(res.body.codigo, 'RETROCESO');
  assert.ok(!bd.consultas.some((c) => /INSERT/.test(c.sql)));
  assert.ok(bd.sqls().includes('ROLLBACK'));
  assert.ok(bd.liberado());
});

test('los demás códigos de validarLectura también llegan tal cual', async () => {
  for (const codigo of Object.keys(validacionLecturas.CODIGOS)) {
    const res = await conValidarLectura(
      async () => ({ codigo, motivo: `Motivo de ${codigo}` }),
      () => llamar(valido(), poolFalso().pool)
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, `Motivo de ${codigo}`);
    assert.equal(res.body.codigo, codigo);
  }
});

test('asignación que no existe o no vigente: 400 y no llama a validarLectura', async () => {
  let llamadas = 0;
  const contar = async () => { llamadas++; return null; };

  const sinFila = poolFalso({ asignacion: null });
  const r1 = await conValidarLectura(contar, () => llamar(valido(), sinFila.pool));
  assert.equal(r1.statusCode, 400);
  assert.match(r1.body.message, /no existe/);

  const retirada = poolFalso({ asignacion: { ...ASIGNACION_BD, activo: false, fecha_retiro: '2026-11-12' } });
  const r2 = await conValidarLectura(contar, () => llamar(valido(), retirada.pool));
  assert.equal(r2.statusCode, 400);
  assert.match(r2.body.message, /ya no está vigente/);
  assert.ok(!retirada.consultas.some((c) => /INSERT/.test(c.sql)));

  assert.equal(llamadas, 0);
});

test('datos inválidos: 400 sin abrir una conexión', async () => {
  const pool = { connect: async () => { throw new Error('no debería conectarse'); } };
  const res = await llamar(valido({ observacion: '  ' }), pool);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /observación es obligatoria/);
});

test('un error de la base responde 500 sin el detalle y libera la conexión', async () => {
  let liberado = false;
  const pool = {
    connect: async () => ({
      async query(sql) {
        if (/FROM instalaciones/.test(sql)) throw new Error('conexión perdida');
        return { rows: [] };
      },
      release() { liberado = true; },
    }),
  };
  const errorOriginal = console.error;
  console.error = () => undefined;
  try {
    const res = await llamar(valido(), pool);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, 'Error al registrar la lectura manual');
  } finally {
    console.error = errorOriginal;
  }
  assert.ok(liberado);
});

// ------------------------------ Ruta y permisos ------------------------------

test('POST /manual exige admin u operador: el auditor recibe 403', async () => {
  const router = require('../src/routes/lectura/lectura.routes');
  const capa = router.stack.find((c) => c.route?.path === '/manual' && c.route.methods.post);
  assert.ok(capa, 'falta la ruta POST /manual');
  const [permiso] = capa.route.stack.map((s) => s.handle);

  const ejecutar = async (rol) => {
    const r = { status: null, siguio: false };
    const res = { status(c) { r.status = c; return this; }, json() { return this; } };
    await permiso({ user: { rol } }, res, () => { r.siguio = true; });
    return r;
  };
  assert.equal((await ejecutar('admin')).siguio, true);
  assert.equal((await ejecutar('operador')).siguio, true);
  assert.equal((await ejecutar('auditor')).status, 403);
});
