// S3-05 · Reprocesar reportes con error: reglas, regla compartida con la ingesta y el contrato con
// validarLectura (S3-01). Sin base de datos: el pool es falso y validarLectura se simula.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const {
  MAX_INTENTOS,
  MENSAJE_MAXIMO,
  motivoNoReprocesable,
  textoIntentos,
} = require('../src/models/reproceso/reproceso.model');
const {
  normalizarSerie,
  buscarMaquinaPorSerie,
  estaAutorizada,
  motivoNoAutorizada,
} = require('../src/services/autorizacionMaquina');
const validacionLecturas = require('../src/services/validacionLecturas');
const { reprocesarReporteController } = require('../src/controllers/reproceso/reproceso.controller');

// ------------------------------ Reglas ------------------------------

test('máximo 3 intentos y el texto «n de 3»', () => {
  assert.equal(MAX_INTENTOS, 3);
  assert.equal(textoIntentos(2), '2 de 3');
});

test('solo se reprocesa un reporte en ERROR con menos de 3 intentos', () => {
  assert.equal(motivoNoReprocesable(null).status, 404);
  assert.equal(motivoNoReprocesable({ procesar_lectura: true, intentos_reproceso: 0 }).status, 409);
  assert.match(motivoNoReprocesable({ procesar_lectura: true, intentos_reproceso: 0 }).message, /no está en error/);
  assert.equal(motivoNoReprocesable({ procesar_lectura: false, intentos_reproceso: 0 }), null);
  assert.equal(motivoNoReprocesable({ procesar_lectura: false, intentos_reproceso: 2 }), null);
  const maximo = motivoNoReprocesable({ procesar_lectura: false, intentos_reproceso: 3 });
  assert.equal(maximo.status, 409);
  assert.equal(maximo.message, 'Máximo de intentos alcanzado: descarte o corrija manualmente');
  assert.equal(maximo.message, MENSAJE_MAXIMO);
});

// ------------------- Regla compartida con la ingesta (autorizacionMaquina) -------------------

test('la serie se compara sin espacios y en mayúsculas', () => {
  assert.equal(normalizarSerie('  simx9999 '), 'SIMX9999');
  assert.equal(normalizarSerie('   '), null);
  assert.equal(normalizarSerie(null), null);
  assert.equal(normalizarSerie(12345), '12345');
});

test('motivo de máquina no autorizada: no registrada o sin asignación vigente', () => {
  assert.equal(motivoNoAutorizada({ serie: 'SIMX9999', maquinaId: null, clienteId: null }),
    'Máquina no autorizada: la serie SIMX9999 no está registrada');
  assert.equal(motivoNoAutorizada({ serie: null, maquinaId: null, clienteId: null }),
    'Máquina no autorizada: la serie (vacía) no está registrada');
  assert.equal(motivoNoAutorizada({ serie: 'SIMX9999', maquinaId: 7, clienteId: null }),
    'Máquina no autorizada: la serie SIMX9999 no tiene una asignación vigente');
  assert.equal(motivoNoAutorizada({ serie: 'SIMA0001', maquinaId: 1, clienteId: 1 }), null);
  assert.equal(estaAutorizada({ maquinaId: 1, clienteId: 1 }), true);
});

test('buscarMaquinaPorSerie consulta por la serie normalizada y devuelve la asignación vigente', async () => {
  const llamadas = [];
  const db = (filas) => ({ query: async (sql, params) => { llamadas.push({ sql, params }); return { rows: filas }; } });

  assert.deepEqual(await buscarMaquinaPorSerie(db([]), ' simx9999 '),
    { serie: 'SIMX9999', maquinaId: null, clienteId: null, instalacionId: null });
  assert.deepEqual(llamadas[0].params, ['SIMX9999']);
  assert.match(llamadas[0].sql, /i\.activo = true\s+AND i\.fecha_retiro IS NULL/);

  assert.deepEqual(await buscarMaquinaPorSerie(db([{ id_maquina: 7, cliente_id: null, id_instalacion: null }]), 'SIMX9999'),
    { serie: 'SIMX9999', maquinaId: 7, clienteId: null, instalacionId: null });
  assert.deepEqual(await buscarMaquinaPorSerie(db([{ id_maquina: 7, cliente_id: 3, id_instalacion: 9 }]), 'SIMX9999'),
    { serie: 'SIMX9999', maquinaId: 7, clienteId: 3, instalacionId: 9 });

  // Sin serie no consulta
  const antes = llamadas.length;
  await buscarMaquinaPorSerie(db([]), '');
  assert.equal(llamadas.length, antes);
});

// ------------------------- Controlador con un pool falso -------------------------

const REPORTE = {
  id_staging_consolidado: 40, lote_id: 6, serie_maquina: 'SIMX9999', ip_detectada: '10.99.9.99',
  impresion_bn: 45000, impresion_color: 0, estado_maquina: 'ERROR', procesar_lectura: false,
  mensaje_aviso: 'Máquina no autorizada: la serie SIMX9999 no está registrada', intentos_reproceso: 0,
  fecha: '2026-10-28', lote_periodo: '2026-10',
};

const poolFalso = ({ reporte = REPORTE, maquina = null, contabilidad = false } = {}) => {
  const consultas = [];
  let liberado = false;
  const client = {
    async query(sql, params = []) {
      consultas.push({ sql, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (/FROM reportes_consolidado_staging s/.test(sql)) return { rows: reporte ? [reporte] : [] };
      if (/FROM public\.maquinas m/.test(sql)) return { rows: maquina ? [maquina] : [] };
      if (/UPDATE reportes_consolidado_staging/.test(sql)) {
        const [id, intentos, maquinaId, clienteId, procesar, estado, mensaje] = params;
        return {
          rows: [{
            ...reporte, id_staging_consolidado: id, intentos_reproceso: intentos, maquina_id_tentativa: maquinaId,
            cliente_id_tentativo: clienteId, procesar_lectura: procesar, estado_maquina: estado, mensaje_aviso: mensaje,
          }],
        };
      }
      if (/FROM instalaciones i WHERE i\.id_instalacion/.test(sql)) {
        return { rows: [{ contabilidad_por_usuario: contabilidad, tiene_cuentas: false }] };
      }
      if (/FROM reportes_oficiales|cabecera_contadores_cambio/.test(sql)) return { rows: [] };
      // S3-02: la auditoría del intento (la fila antes del cambio y el registro)
      if (/SELECT to_jsonb\(t\)/.test(sql)) return { rows: reporte ? [{ fila: reporte }] : [] };
      if (/INSERT INTO registro_auditoria/.test(sql)) return { rows: [{ id: 1 }] };
      throw new Error(`consulta inesperada: ${sql}`);
    },
    release() { liberado = true; },
  };
  return {
    pool: { connect: async () => client },
    consultas,
    transaccion: () => consultas.map((c) => c.sql.trim()).filter((s) => /^(BEGIN|COMMIT|ROLLBACK)/.test(s)),
    update: () => consultas.find((c) => /UPDATE reportes_consolidado_staging/.test(c.sql)),
    liberado: () => liberado,
  };
};

const llamar = async (id, pool) => {
  const res = {
    statusCode: null,
    body: null,
    status(codigo) { this.statusCode = codigo; return this; },
    json(cuerpo) { this.body = cuerpo; return this; },
  };
  await reprocesarReporteController({ params: { id: String(id) }, pool, user: { id: 2, rol: 'operador' } }, res);
  return res;
};

const conValidarLectura = async (fn, cuerpo) => {
  const original = validacionLecturas.validarLectura;
  validacionLecturas.validarLectura = fn;
  try {
    return await cuerpo();
  } finally {
    validacionLecturas.validarLectura = original;
  }
};

const MAQUINA_ASIGNADA = { id_maquina: 7, cliente_id: 3, id_instalacion: 9 };

test('id inválido: 400 sin abrir una conexión', async () => {
  const pool = { connect: async () => { throw new Error('no debería conectarse'); } };
  for (const id of ['abc', '0', '-1', '1.5']) {
    const res = await llamar(id, pool);
    assert.equal(res.statusCode, 400);
  }
});

test('reporte que no existe: 404', async () => {
  const bd = poolFalso({ reporte: null });
  const res = await llamar(999, bd.pool);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'ROLLBACK']);
  assert.ok(bd.liberado());
});

test('reporte que no está en error: 409', async () => {
  const res = await llamar(40, poolFalso({ reporte: { ...REPORTE, procesar_lectura: true } }).pool);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /no está en error/);
});

test('con 3 intentos: 409 «Máximo de intentos alcanzado» y no cambia nada', async () => {
  const bd = poolFalso({ reporte: { ...REPORTE, intentos_reproceso: 3 } });
  const res = await llamar(40, bd.pool);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.message, 'Máximo de intentos alcanzado: descarte o corrija manualmente');
  assert.deepEqual(res.body.data, { intentos: 3, max_intentos: 3 });
  assert.equal(bd.update(), undefined);
});

test('la máquina sigue sin registrar: suma el intento y queda en ERROR con el motivo', async () => {
  const bd = poolFalso();
  const res = await conValidarLectura(async () => { throw new Error('no debe validarse'); }, () => llamar(40, bd.pool));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.corregido, false);
  assert.equal(res.body.data.intentos, 1);
  assert.equal(res.body.data.intentos_texto, '1 de 3');
  assert.equal(res.body.data.motivo, 'Máquina no autorizada: la serie SIMX9999 no está registrada');
  assert.equal(res.body.data.codigo, 'NO_AUTORIZADA');
  assert.deepEqual(bd.update().params, [40, 1, null, null, false, 'ERROR', 'Máquina no autorizada: la serie SIMX9999 no está registrada']);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'COMMIT']);
});

test('registrada pero sin asignación: el motivo nuevo y la máquina tentativa', async () => {
  const bd = poolFalso({ reporte: { ...REPORTE, intentos_reproceso: 2 }, maquina: { id_maquina: 7, cliente_id: null, id_instalacion: null } });
  const res = await llamar(40, bd.pool);
  assert.equal(res.body.data.intentos_texto, '3 de 3');
  assert.equal(res.body.data.reporte.mensaje_aviso, 'Máquina no autorizada: la serie SIMX9999 no tiene una asignación vigente');
  assert.equal(res.body.data.reporte.maquina_id_tentativa, 7);
  assert.equal(res.body.data.reporte.procesar_lectura, false);
});

test('ya autorizada y validarLectura la acepta: corregido, estado recuperado y sin aviso', async () => {
  const bd = poolFalso({ maquina: MAQUINA_ASIGNADA });
  let recibido;
  const res = await conValidarLectura(async (db, lectura) => { recibido = { db, lectura }; return null; }, () => llamar(40, bd.pool));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.corregido, true);
  assert.equal(res.body.data.motivo, null);
  assert.equal(res.body.data.aviso, null);
  assert.deepEqual(bd.update().params, [40, 1, 7, 3, true, 'Desconocido', null]);
  // Contrato de validarLectura: client de la transacción y la lectura del reporte
  assert.notEqual(recibido.db, bd.pool);
  assert.deepEqual(recibido.lectura, {
    maquinaId: 7, instalacionId: 9, periodo: '2026-10', fecha: '2026-10-28', contadorBn: 45000, contadorColor: 0,
  });
});

test('un reporte bloqueado por el equipo conserva el estado que reportó al corregirse', async () => {
  const bd = poolFalso({ reporte: { ...REPORTE, estado_maquina: 'Atasco de papel' }, maquina: MAQUINA_ASIGNADA });
  await llamar(40, bd.pool);
  assert.equal(bd.update().params[5], 'Atasco de papel');
});

test('sin el período del lote, usa el mes de la fecha de corte', async () => {
  let periodo;
  await conValidarLectura(async (_db, l) => { periodo = l.periodo; return null; },
    () => llamar(40, poolFalso({ reporte: { ...REPORTE, lote_periodo: null }, maquina: MAQUINA_ASIGNADA }).pool));
  assert.equal(periodo, '2026-10');
});

test('si validarLectura devuelve un motivo, sigue en ERROR con ese motivo tal cual', async () => {
  const bd = poolFalso({ maquina: MAQUINA_ASIGNADA });
  const motivo = 'Retroceso de contador: el B/N (45000) es menor que la última lectura aprobada (46000, 2026-09)';
  const res = await conValidarLectura(async () => ({ codigo: 'RETROCESO', motivo }), () => llamar(40, bd.pool));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.corregido, false);
  assert.equal(res.body.data.motivo, motivo);
  assert.equal(res.body.data.codigo, 'RETROCESO');
  assert.ok(res.body.message.endsWith(motivo));
  assert.deepEqual(bd.update().params, [40, 1, 7, 3, false, 'ERROR', motivo]);
});

test('corregido pero la asignación exige cuentas de usuario que no llegaron: avisa', async () => {
  const res = await llamar(40, poolFalso({ maquina: MAQUINA_ASIGNADA, contabilidad: true }).pool);
  assert.equal(res.body.data.corregido, true);
  assert.match(res.body.data.aviso, /contabilidad por usuario/);
});

test('un error de la base responde 500 y libera la conexión', async () => {
  let liberado = false;
  const pool = {
    connect: async () => ({
      async query(sql) {
        if (/FROM reportes_consolidado_staging/.test(sql)) throw new Error('conexión perdida');
        return { rows: [] };
      },
      release() { liberado = true; },
    }),
  };
  const errorOriginal = console.error;
  console.error = () => undefined;
  try {
    const res = await llamar(40, pool);
    assert.equal(res.statusCode, 500);
  } finally {
    console.error = errorOriginal;
  }
  assert.ok(liberado);
});

// ------------------------------ Ruta y permisos ------------------------------

test('POST /:id/reprocesar exige admin u operador: el auditor recibe 403', async () => {
  const router = require('../src/routes/reproceso/reproceso.routes');
  const capa = router.stack.find((c) => c.route?.path === '/:id/reprocesar' && c.route.methods.post);
  assert.ok(capa, 'falta la ruta POST /:id/reprocesar');
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
