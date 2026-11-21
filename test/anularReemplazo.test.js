// Anular un reemplazo de máquina (POST /api/maquinas-cambio/:id/anular): reglas puras y el
// controlador con un pool falso (sin base de datos).
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const {
  validarDatosAnulacion,
  motivoNoAnulable,
  quitarNotaRetiro,
} = require('../src/utils/maquinasCambio.reglas');
const { anularReemplazoController } = require('../src/controllers/cambio/maquinasCambio.controller');

// El reemplazo de la demo: SIMB0002 (id 2) sale y SIMF0006 (id 6) entra en noviembre
const CAMBIO = {
  id_maquina_cambio: 1,
  activo: true,
  periodo_afectado: '2026-11',
  maquina_saliente_id: 2,
  maquina_entrante_id: 6,
  instalacion_saliente_id: 2,
  instalacion_entrante_id: 7,
  snap_maquina_saliente_serie: 'SIMB0002',
  snap_maquina_entrante_serie: 'SIMF0006',
};
const ENTRANTE_VIGENTE = { id_instalacion: 7, maquina_id: 6, vigente: true };

// ------------------------------ Reglas ------------------------------

test('el motivo de la anulación es opcional y se normaliza', () => {
  assert.deepEqual(validarDatosAnulacion(undefined).data, { motivo: null });
  assert.deepEqual(validarDatosAnulacion({}).data, { motivo: null });
  assert.deepEqual(validarDatosAnulacion({ motivo: '   ' }).data, { motivo: null });
  assert.deepEqual(validarDatosAnulacion({ motivo: '  Se eligió   la máquina equivocada ' }).data,
    { motivo: 'Se eligió la máquina equivocada' });
  assert.equal(validarDatosAnulacion({ motivo: 12 }).error.status, 400);
  assert.equal(validarDatosAnulacion({ motivo: 'x'.repeat(501) }).error.status, 400);
  assert.equal(validarDatosAnulacion({ motivo: 'x'.repeat(500) }).data.motivo.length, 500);
});

test('se puede anular cuando nada lo impide', () => {
  assert.equal(motivoNoAnulable({ cambio: CAMBIO, asignacionEntrante: ENTRANTE_VIGENTE }), null);
});

test('no existe: 404; ya anulado: 409', () => {
  assert.deepEqual(motivoNoAnulable({ cambio: null }), { status: 404, message: 'Reemplazo no encontrado' });
  assert.deepEqual(motivoNoAnulable({}), { status: 404, message: 'Reemplazo no encontrado' });
  const r = motivoNoAnulable({ cambio: { ...CAMBIO, activo: false }, asignacionEntrante: ENTRANTE_VIGENTE });
  assert.deepEqual(r, { status: 409, message: 'El reemplazo de SIMB0002 por SIMF0006 ya está anulado' });
});

test('con lecturas aprobadas: 409 con el período y la serie', () => {
  const r = motivoNoAnulable({
    cambio: CAMBIO,
    asignacionEntrante: ENTRANTE_VIGENTE,
    lecturaAprobada: { periodo: '2026-11', serie: 'SIMF0006' },
  });
  assert.equal(r.status, 409);
  assert.equal(r.message,
    'No se puede anular el reemplazo de SIMB0002 por SIMF0006: el período 2026-11 ya tiene lecturas aprobadas de SIMF0006. Un período aprobado no se recalcula');
});

test('con un lote pendiente de esas máquinas: 409 y que se rechace primero', () => {
  const r = motivoNoAnulable({
    cambio: CAMBIO,
    asignacionEntrante: ENTRANTE_VIGENTE,
    lotePendiente: { codigo: 'SIM-2026-11-horizonte', serie: 'SIMF0006' },
  });
  assert.equal(r.status, 409);
  assert.match(r.message, /lote pendiente SIM-2026-11-horizonte trae lecturas de SIMF0006\. Rechace ese lote/);
});

test('si las asignaciones cambiaron después del reemplazo: 409', () => {
  const base = { cambio: CAMBIO, asignacionEntrante: ENTRANTE_VIGENTE };
  // La asignación de la entrante ya no existe o se retiró
  assert.match(motivoNoAnulable({ ...base, asignacionEntrante: null }).message, /la asignación de SIMF0006 que creó el reemplazo ya no está vigente/);
  assert.equal(motivoNoAnulable({ ...base, asignacionEntrante: { ...ENTRANTE_VIGENTE, vigente: false } }).status, 409);
  // La saliente se volvió a asignar
  const r = motivoNoAnulable({ ...base, asignacionSaliente: { cliente_nombre: 'Clínica Norte', area_nombre: 'Recepción' } });
  assert.equal(r.status, 409);
  assert.match(r.message, /SIMB0002 ya está asignada de nuevo a Clínica Norte · Recepción/);
  // Su IP la usa otra máquina
  assert.match(motivoNoAnulable({ ...base, ipEnUso: 'SIMX0009' }).message, /la IP de SIMB0002 ya la usa la máquina SIMX0009/);
  // Un cambio sin la asignación de la saliente guardada no se puede deshacer
  assert.equal(motivoNoAnulable({ ...base, cambio: { ...CAMBIO, instalacion_saliente_id: null } }).status, 409);
});

test('las lecturas aprobadas pesan más que las demás causas', () => {
  const r = motivoNoAnulable({
    cambio: CAMBIO,
    lecturaAprobada: { periodo: '2026-12', serie: 'SIMF0006' },
    asignacionEntrante: null,
    asignacionSaliente: { cliente_nombre: 'X', area_nombre: 'Y' },
  });
  assert.match(r.message, /lecturas aprobadas/);
});

test('quitarNotaRetiro deja las observaciones como estaban antes del reemplazo', () => {
  const nota = 'RETIRO: reemplazo #1 por SIMF0006 (Daño)';
  assert.equal(quitarNotaRetiro(nota, 1), null);
  assert.equal(quitarNotaRetiro(`Planta baja | ${nota}`, 1), 'Planta baja');
  assert.equal(quitarNotaRetiro('Planta baja', 1), 'Planta baja');
  assert.equal(quitarNotaRetiro(null, 1), null);
  // La nota de otro reemplazo no se toca (#1 no es el prefijo de #12)
  assert.equal(quitarNotaRetiro('RETIRO: reemplazo #12 por SIMF0006 (Daño)', 1), 'RETIRO: reemplazo #12 por SIMF0006 (Daño)');
});

// ------------------------- Controlador con un pool falso -------------------------

const REEMPLAZO_ANULADO = {
  id_maquina_cambio: 1, activo: false, saliente_serie: 'SIMB0002', entrante_serie: 'SIMF0006',
  area_nombre: 'Secretaría', instalacion_entrante_id: null, fecha_anulacion: '2026-11-20T15:00:00Z',
};

const poolFalso = ({
  cambio = CAMBIO, lectura = null, lote = null, entrante = ENTRANTE_VIGENTE, saliente = null, ip = null,
  observaciones = 'RETIRO: reemplazo #1 por SIMF0006 (Daño)', falla = null,
} = {}) => {
  const consultas = [];
  let liberado = false;
  const client = {
    async query(sql, params = []) {
      consultas.push({ sql, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      // Auditoría: la fila antes y después, y el registro en la bitácora
      if (/SELECT to_jsonb\(t\) AS fila/.test(sql)) return { rows: [{ fila: { id: params[0] } }] };
      if (/INSERT INTO registro_auditoria/.test(sql)) return { rows: [{ id: 1, fecha: '2026-11-21T00:00:00Z' }] };
      if (/FROM maquinas_cambio WHERE id_maquina_cambio = \$1\s+FOR UPDATE/.test(sql)) return { rows: cambio ? [cambio] : [] };
      if (/FROM reportes_oficiales ro/.test(sql)) return { rows: lectura ? [lectura] : [] };
      if (/FROM reportes_consolidado_staging s/.test(sql)) return { rows: lote ? [lote] : [] };
      if (/SELECT id_instalacion, maquina_id/.test(sql)) return { rows: entrante ? [entrante] : [] };
      if (/WHERE i\.maquina_id = \$1 AND i\.activo = TRUE/.test(sql)) return { rows: saliente ? [saliente] : [] };
      if (/FROM instalaciones sal/.test(sql)) return { rows: ip ? [{ serie: ip }] : [] };
      if (/^\s*UPDATE maquinas_cambio/.test(sql)) return { rows: [], rowCount: 1 };
      if (/^\s*DELETE FROM cabecera_contadores_cambio/.test(sql)) return { rows: [], rowCount: 2 };
      if (/^\s*DELETE FROM instalaciones/.test(sql)) return { rows: [], rowCount: 1 };
      if (/SELECT observaciones FROM instalaciones/.test(sql)) return { rows: [{ observaciones }] };
      if (/^\s*UPDATE instalaciones SET activo = TRUE/.test(sql)) {
        if (falla) throw falla;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`consulta inesperada: ${sql}`);
    },
    release() { liberado = true; },
  };
  return {
    pool: {
      connect: async () => client,
      // getReemplazoById, después del COMMIT
      query: async (sql) => {
        consultas.push({ sql, params: [] });
        if (/WHERE mc\.id_maquina_cambio = \$1/.test(sql)) return { rows: [REEMPLAZO_ANULADO] };
        throw new Error(`consulta inesperada: ${sql}`);
      },
    },
    consultas,
    transaccion: () => consultas.map((c) => c.sql.trim()).filter((s) => /^(BEGIN|COMMIT|ROLLBACK)/.test(s)),
    escrituras: () => consultas.filter((c) => /^\s*(UPDATE|DELETE)/.test(c.sql)),
    liberado: () => liberado,
  };
};

const llamar = async (id, pool, body = {}) => {
  const res = {
    statusCode: null,
    body: null,
    status(codigo) { this.statusCode = codigo; return this; },
    json(cuerpo) { this.body = cuerpo; return this; },
  };
  await anularReemplazoController({ params: { id: String(id) }, body, pool, user: { id: 1, rol: 'admin' } }, res);
  return res;
};

test('id o motivo inválido: 400 sin abrir una conexión', async () => {
  const pool = { connect: async () => { throw new Error('no debería conectarse'); } };
  for (const id of ['abc', '0', '-1', '1.5']) {
    assert.equal((await llamar(id, pool)).statusCode, 400);
  }
  assert.equal((await llamar(1, pool, { motivo: 'x'.repeat(501) })).statusCode, 400);
});

test('anula en una transacción: reactiva la saliente, borra la entrante y los contadores', async () => {
  const bd = poolFalso();
  const res = await llamar(1, bd.pool, { motivo: 'Se eligió la máquina equivocada' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, 'Reemplazo anulado: SIMB0002 vuelve a quedar asignada en Secretaría y SIMF0006 queda libre');
  assert.equal(res.body.data.activo, false);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'COMMIT']);
  assert.ok(bd.liberado());

  const [cambio, cabeceras, entrante, saliente] = bd.escrituras();
  // 1. el cambio queda anulado, sin la asignación de la entrante, con quién y por qué
  assert.match(cambio.sql, /SET activo = FALSE, instalacion_entrante_id = NULL/);
  assert.deepEqual(cambio.params, [1, 1, 'Se eligió la máquina equivocada']);
  // 2. sus contadores se borran
  assert.match(cabeceras.sql, /DELETE FROM cabecera_contadores_cambio WHERE maquina_cambio_id = \$1/);
  assert.deepEqual(cabeceras.params, [1]);
  // 3. la asignación que creó el registro para la entrante se borra (queda libre)
  assert.match(entrante.sql, /DELETE FROM instalaciones WHERE id_instalacion = \$1/);
  assert.deepEqual(entrante.params, [7]);
  // 4. la saliente vuelve a estar vigente y sin la nota del retiro
  assert.match(saliente.sql, /SET activo = TRUE, fecha_retiro = NULL/);
  assert.deepEqual(saliente.params, [2, null]);
});

test('sin motivo se guarda null', async () => {
  const bd = poolFalso();
  const res = await llamar(1, bd.pool);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(bd.escrituras()[0].params, [1, 1, null]);
});

test('el período ya tiene lecturas aprobadas: 409 y no cambia nada', async () => {
  const bd = poolFalso({ lectura: { periodo: '2026-11', serie: 'SIMB0002' } });
  const res = await llamar(1, bd.pool);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /el período 2026-11 ya tiene lecturas aprobadas de SIMB0002/);
  assert.deepEqual(bd.escrituras(), []);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'ROLLBACK']);
  assert.ok(bd.liberado());
  // La consulta busca reportes enlazados al cambio o de las dos máquinas desde el período afectado
  const consulta = bd.consultas.find((c) => /FROM reportes_oficiales ro/.test(c.sql));
  assert.deepEqual(consulta.params, [1, [2, 6], '2026-11']);
});

test('un lote pendiente con esas máquinas: 409', async () => {
  const bd = poolFalso({ lote: { codigo: 'SIM-2026-11-horizonte', serie: 'SIMF0006' } });
  const res = await llamar(1, bd.pool);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /SIM-2026-11-horizonte/);
  assert.deepEqual(bd.escrituras(), []);
});

test('no existe: 404; ya anulado: 409 sin más consultas', async () => {
  const noExiste = poolFalso({ cambio: null });
  assert.equal((await llamar(99, noExiste.pool)).statusCode, 404);
  assert.deepEqual(noExiste.transaccion(), ['BEGIN', 'ROLLBACK']);

  const anulado = poolFalso({ cambio: { ...CAMBIO, activo: false } });
  const res = await llamar(1, anulado.pool);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.message, 'El reemplazo de SIMB0002 por SIMF0006 ya está anulado');
  assert.equal(anulado.consultas.filter((c) => /reportes_oficiales|instalaciones/.test(c.sql)).length, 0);
});

test('la saliente ya se volvió a asignar: 409', async () => {
  const bd = poolFalso({ saliente: { id_instalacion: 20, cliente_nombre: 'Clínica Norte', area_nombre: 'Recepción' } });
  const res = await llamar(1, bd.pool);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /ya está asignada de nuevo/);
  assert.deepEqual(bd.escrituras(), []);
});

test('la asignación de la entrante ya no es la del reemplazo: 409', async () => {
  // Retirada después
  assert.equal((await llamar(1, poolFalso({ entrante: { ...ENTRANTE_VIGENTE, vigente: false } }).pool)).statusCode, 409);
  // Borrada
  assert.equal((await llamar(1, poolFalso({ entrante: null }).pool)).statusCode, 409);
  // De otra máquina (no debería pasar, pero no se borra una asignación ajena)
  assert.equal((await llamar(1, poolFalso({ entrante: { ...ENTRANTE_VIGENTE, maquina_id: 9 } }).pool)).statusCode, 409);
});

test('otra operación asignó la saliente a la vez: 409 por el índice único', async () => {
  const falla = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'instalaciones_una_activa_por_maquina' });
  const bd = poolFalso({ falla });
  const res = await llamar(1, bd.pool);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /acaba de ser asignada/);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'ROLLBACK']);
});

test('un error inesperado: 500 y ROLLBACK', async () => {
  const bd = poolFalso({ falla: new Error('se cayó la base') });
  const original = console.error;
  console.error = () => undefined;
  try {
    const res = await llamar(1, bd.pool);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, 'Error al anular el reemplazo');
  } finally {
    console.error = original;
  }
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'ROLLBACK']);
  assert.ok(bd.liberado());
});
