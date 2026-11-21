// approveStagingBatch: qué queda guardado en reportes_oficiales al aprobar un lote.
// Sin base de datos: pool.connect devuelve un cliente falso que responde según la consulta.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/db');
const {
  approveStagingBatch, rejectStagingBatch, periodoParaAprobar, verificarRechazable,
} = require('../src/models/reportemes_staging/reportemes_staging.model');

const fila = (cambios = {}) => ({
  id_staging_consolidado: 10,
  lote_id: 7,
  maquina_id_tentativa: 1,
  cliente_id_tentativo: 1,
  serie_maquina: 'SIMA0001',
  ip_detectada: '192.168.10.21',
  impresion_bn: 120000,
  impresion_color: 15000,
  copia_bn: 300,
  copia_color: 40,
  print_total: 135340,
  copy_total: 340,
  totalservicio: 135340,
  fecha_corte: new Date('2026-11-01T04:00:00Z'),
  ...cambios,
});

// Cliente falso: guarda cada consulta y responde según el texto
const LOTE = { id_lote: 7, periodo: '2026-10', fecha_aprobacion: null };
const usarClienteFalso = (t, { staging, asignacion = { area_nombre: 'Secretaría' }, lote = LOTE }) => {
  const consultas = [];
  const client = {
    async query(sql, params = []) {
      consultas.push({ sql, params });
      if (/to_jsonb\(t\) AS fila FROM lotes_carga/.test(sql)) return { rows: lote ? [{ fila: lote }] : [] };
      if (/FROM reportes_consolidado_staging WHERE lote_id/.test(sql)) return { rows: staging };
      if (/FROM instalaciones i\s+JOIN areas a/.test(sql)) return { rows: asignacion ? [asignacion] : [] };
      if (/INSERT INTO reportes_oficiales/.test(sql)) return { rows: [{ id_reporte: 99 }] };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  t.mock.method(pool, 'connect', async () => client);
  return consultas;
};

// Columna → valor del INSERT de reportes_oficiales (solo las que van como parámetro)
const insertado = (consultas) => {
  const { sql, params } = consultas.find((c) => /INSERT INTO reportes_oficiales/.test(c.sql));
  const columnas = sql.match(/reportes_oficiales \(([^)]*)\)/)[1].split(',').map((c) => c.trim());
  const valores = sql.match(/VALUES\s*\(([\s\S]*)\)\s*RETURNING/)[1].split(',').map((v) => v.trim());
  return Object.fromEntries(columnas
    .map((col, i) => [col, valores[i]])
    .filter(([, v]) => v.startsWith('$'))
    .map(([col, v]) => [col, params[Number(v.slice(1)) - 1]]));
};

test('la aprobación guarda el área de la asignación y los contadores de copias', async (t) => {
  const consultas = usarClienteFalso(t, { staging: [fila()] });
  const r = await approveStagingBatch(7, '2026-10', 3);
  assert.equal(r.success, true);

  const ro = insertado(consultas);
  assert.equal(ro.snap_area_nombre, 'Secretaría');
  assert.equal(ro.contador_copias_bn, 300);
  assert.equal(ro.contador_copias_color, 40);
  assert.equal(ro.contador_impresiones_bn, 120000);
  assert.equal(ro.periodo, '2026-10');
  assert.equal(ro.snap_maquina_serie, 'SIMA0001');

  // El área sale de la asignación de esa máquina, para ese cliente y ese período
  const asignacion = consultas.find((c) => /FROM instalaciones i\s+JOIN areas a/.test(c.sql));
  assert.deepEqual(asignacion.params, [1, 1, '2026-10']);
  assert.ok(consultas.some((c) => c.sql === 'COMMIT'));
});

test('sin copias en staging, los contadores de copias quedan en 0', async (t) => {
  const consultas = usarClienteFalso(t, { staging: [fila({ copia_bn: null, copia_color: undefined })] });
  await approveStagingBatch(7, '2026-10');
  const ro = insertado(consultas);
  assert.equal(ro.contador_copias_bn, 0);
  assert.equal(ro.contador_copias_color, 0);
});

test('una máquina sin asignación (o sin máquina) queda sin área, sin romper la aprobación', async (t) => {
  const consultas = usarClienteFalso(t, { staging: [fila({ maquina_id_tentativa: null })], asignacion: null });
  await approveStagingBatch(7, '2026-10');
  assert.equal(insertado(consultas).snap_area_nombre, null);
  // Sin máquina no hay asignación que buscar
  assert.ok(!consultas.some((c) => /FROM instalaciones i\s+JOIN areas a/.test(c.sql)));
});

test('la aprobación congela las tarifas del contrato de la asignación', async (t) => {
  const consultas = usarClienteFalso(t, {
    staging: [fila()],
    asignacion: {
      area_nombre: 'Secretaría',
      contrato_id: 1,
      impresiones_bn_incluidas: 5000,
      impresiones_color_incluidas: 500,
      costo_impresion_bn: '0.0200',
      costo_impresion_color: '0.1000',
      costo_x_excedente_impresion_bn: 0.025,
      costo_x_excedente_impresion_color: 0.12,
      facturacion_de_impresora: 'Diferenciar B/N de Color',
    },
  });
  await approveStagingBatch(7, '2026-10');
  const ro = insertado(consultas);
  assert.equal(ro.snap_contrato_id, 1);
  assert.equal(ro.snap_costo_impresion_bn, '0.0200');
  assert.equal(ro.snap_costo_impresion_color, '0.1000');
  assert.equal(ro.snap_costo_copia_bn, '0.0200');
  assert.equal(ro.snap_costo_copia_color, '0.1000');
  assert.equal(ro.snap_impresiones_bn_incluidas, 5000);
  assert.equal(ro.snap_impresiones_color_incluidas, 500);
  assert.equal(ro.snap_costo_excedente_bn, 0.025);
  assert.equal(ro.snap_costo_excedente_color, 0.12);
  assert.equal(ro.snap_facturacion_de_impresora, 'Diferenciar B/N de Color');

  // fecha_congelacion: la hora de la aprobación, solo si hay contrato
  const { sql } = consultas.find((c) => /INSERT INTO reportes_oficiales/.test(c.sql));
  assert.match(sql, /fecha_congelacion\s*\)/);
  assert.match(sql, /CASE WHEN \$16::int IS NULL THEN NULL ELSE NOW\(\) END\)/);

  // Las tarifas salen del contrato de la asignación
  const asignacion = consultas.find((c) => /FROM instalaciones i\s+JOIN areas a/.test(c.sql));
  assert.match(asignacion.sql, /LEFT JOIN contratos c ON c\.id_contrato = i\.contrato_id/);
});

test('sin contrato, el reporte queda sin tarifas congeladas', async (t) => {
  const consultas = usarClienteFalso(t, { staging: [fila()], asignacion: { area_nombre: 'Bodega', contrato_id: null } });
  await approveStagingBatch(7, '2026-10');
  const ro = insertado(consultas);
  assert.equal(ro.snap_contrato_id, null);
  assert.equal(ro.snap_costo_impresion_bn, null);
  assert.equal(ro.snap_impresiones_bn_incluidas, null);
});

test('un lote vacío no se aprueba y se deshace la transacción', async (t) => {
  const consultas = usarClienteFalso(t, { staging: [] });
  await assert.rejects(approveStagingBatch(7, '2026-10'), { status: 409, message: 'El lote fue rechazado y no se puede aprobar' });
  assert.ok(consultas.some((c) => c.sql === 'ROLLBACK'));
});

// Doble clic, aprobar y rechazar a la vez u otro período: se revisa con el lote bloqueado (FOR UPDATE)
test('periodoParaAprobar: estados del lote y período pedido', () => {
  assert.equal(periodoParaAprobar(LOTE, 2), '2026-10');
  assert.equal(periodoParaAprobar(LOTE, 2, '2026-10'), '2026-10');
  assert.equal(periodoParaAprobar({ ...LOTE, periodo: null }, 2, '2026-09'), '2026-09');
  assert.match(periodoParaAprobar({ ...LOTE, periodo: null }, 2), /^\d{4}-\d{2}$/);
  assert.throws(() => periodoParaAprobar(null, 2), { status: 404 });
  assert.throws(() => periodoParaAprobar({ ...LOTE, fecha_aprobacion: '2026-11-01' }, 0), { status: 409, message: 'El lote ya fue aprobado' });
  assert.throws(() => periodoParaAprobar(LOTE, 0), { status: 409, message: 'El lote fue rechazado y no se puede aprobar' });
  assert.throws(() => periodoParaAprobar(LOTE, 2, '2026-05'), { status: 409, message: 'El lote es del período 2026-10: no se puede aprobar como 2026-05' });
});

test('verificarRechazable: no rechaza un lote aprobado ni uno ya rechazado', () => {
  assert.doesNotThrow(() => verificarRechazable(LOTE, 2));
  assert.throws(() => verificarRechazable(null, 2), { status: 404 });
  assert.throws(() => verificarRechazable({ ...LOTE, fecha_aprobacion: '2026-11-01' }, 0), { status: 409, message: 'El lote ya fue aprobado y no se puede rechazar' });
  assert.throws(() => verificarRechazable(LOTE, 0), { status: 409, message: 'El lote ya fue rechazado' });
});

test('aprobar un lote en otro período: 409 y no guarda nada', async (t) => {
  const consultas = usarClienteFalso(t, { staging: [fila()] });
  await assert.rejects(approveStagingBatch(7, '2026-05'), { status: 409 });
  assert.ok(!consultas.some((c) => /INSERT INTO reportes_oficiales/.test(c.sql)));
  assert.ok(consultas.some((c) => c.sql === 'ROLLBACK'));
  // El lote se lee bloqueado: la segunda petición espera a que termine la primera
  assert.ok(consultas.some((c) => /FROM lotes_carga t WHERE t\.id_lote = \$1 FOR UPDATE/.test(c.sql)));
});

test('sin período en la petición, se aprueba con el del lote', async (t) => {
  const consultas = usarClienteFalso(t, { staging: [fila()] });
  await approveStagingBatch(7, null);
  assert.equal(insertado(consultas).periodo, '2026-10');
});

test('rechazar un lote ya aprobado: 409 y no borra ni audita', async (t) => {
  const consultas = usarClienteFalso(t, { staging: [], lote: { ...LOTE, fecha_aprobacion: '2026-11-01' } });
  await assert.rejects(rejectStagingBatch(7, { motivo: 'tarde' }), { status: 409 });
  assert.ok(!consultas.some((c) => /DELETE FROM|UPDATE notificaciones|registro_auditoria/.test(c.sql)));
  assert.ok(consultas.some((c) => c.sql === 'ROLLBACK'));
});
