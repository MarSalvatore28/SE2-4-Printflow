const test = require('node:test');
const assert = require('node:assert');
const { validarLectura, CODIGOS } = require('../src/services/validacionLecturas');

// Base de datos falsa: responde según el SQL que reciba
const dbFalso = ({ duplicada = false, historial = [], inicial = null }) => ({
  query: async (sql) => {
    if (sql.includes('cabecera_contadores_cambio')) return { rows: inicial ? [inicial] : [] };
    if (sql.includes('SELECT 1 FROM reportes_oficiales')) return { rows: duplicada ? [{}] : [] };
    return { rows: historial };
  },
});

const base = { maquinaId: 1, periodo: '2026-11', contadorBn: 0, contadorColor: 0 };
const h = (periodo, bn, color) => ({ periodo, bn, color });

test('duplicada', async () => {
  const r = await validarLectura(dbFalso({ duplicada: true }), { ...base, contadorBn: 10 });
  assert.strictEqual(r.codigo, CODIGOS.DUPLICADA);
});

test('retroceso en B/N', async () => {
  const db = dbFalso({ historial: [h('2026-10', 12500, 100)] });
  const r = await validarLectura(db, { ...base, contadorBn: 12000, contadorColor: 100 });
  assert.strictEqual(r.codigo, CODIGOS.RETROCESO);
  assert.match(r.motivo, /Retroceso de contador/);
});

test('retroceso en color', async () => {
  const db = dbFalso({ historial: [h('2026-10', 1000, 500)] });
  const r = await validarLectura(db, { ...base, contadorBn: 1000, contadorColor: 400 });
  assert.strictEqual(r.codigo, CODIGOS.RETROCESO);
});

test('salto anómalo', async () => {
  const db = dbFalso({ historial: [h('2026-10', 3000, 0), h('2026-09', 2000, 0), h('2026-08', 1000, 0)] });
  const r = await validarLectura(db, { ...base, contadorBn: 13000, contadorColor: 0 });
  assert.strictEqual(r.codigo, CODIGOS.SALTO_ANOMALO);
});

test('lectura normal es válida', async () => {
  const db = dbFalso({ historial: [h('2026-10', 3000, 0), h('2026-09', 2000, 0), h('2026-08', 1000, 0)] });
  assert.strictEqual(await validarLectura(db, { ...base, contadorBn: 4100, contadorColor: 0 }), null);
});

test('primera lectura (sin historial) es válida', async () => {
  assert.strictEqual(await validarLectura(dbFalso({}), { ...base, contadorBn: 500 }), null);
});

test('con poco historial no aplica salto anómalo', async () => {
  const db = dbFalso({ historial: [h('2026-10', 1000, 0), h('2026-09', 900, 0)] });
  assert.strictEqual(await validarLectura(db, { ...base, contadorBn: 50000 }), null);
});

test('entrante de reemplazo: retroceso contra su contador inicial', async () => {
  const db = dbFalso({ inicial: { bn: 500, color: 0 } });
  const r = await validarLectura(db, { ...base, contadorBn: 400, contadorColor: 0 });
  assert.strictEqual(r.codigo, CODIGOS.RETROCESO);
  assert.match(r.motivo, /contador inicial del reemplazo/);
});

test('entrante de reemplazo: lectura mayor al inicial es válida', async () => {
  const db = dbFalso({ inicial: { bn: 500, color: 0 } });
  assert.strictEqual(await validarLectura(db, { ...base, contadorBn: 800, contadorColor: 0 }), null);
});