// S3-02 · Máquinas: crear, editar, activar y desactivar quedan en registro_auditoria, en la misma
// transacción que el cambio y con el usuario y la IP de la petición. Sin base de datos: pool falso.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/db');
const Maquinas = require('../src/models/maquina/maquina.model');
const { validarFiltrosAuditoria } = require('../src/services/auditoria');

const AUDITORIA = { usuarioId: 9, ip: '192.168.1.50' };
const FILA = { id_maquina: 7, serie: 'SIMA0001', modelo_id: 1, tipo_impresion_id: 2, formato_impresion_id: null, activo: true };

// Client falso: responde según la consulta y guarda todo lo que se ejecutó
const usarClienteFalso = (t, { fila = FILA, filasCambiadas = 1, fallarAuditoria = false } = {}) => {
  const consultas = [];
  const client = {
    async query(sql, params = []) {
      consultas.push({ sql: sql.trim(), params });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return { rows: [] };
      if (/INSERT INTO registro_auditoria/.test(sql)) {
        if (fallarAuditoria) throw new Error('no se pudo escribir la auditoría');
        return { rows: [{ id: 1, fecha: '2026-11-21T12:00:00Z' }] };
      }
      if (/to_jsonb\(t\) AS fila FROM maquinas/.test(sql)) return { rows: fila ? [{ fila }] : [] };
      if (/INSERT INTO maquinas/.test(sql)) return { rows: [{ id_maquina: 7 }] };
      if (/UPDATE maquinas/.test(sql)) return { rows: [], rowCount: filasCambiadas };
      throw new Error(`consulta inesperada: ${sql}`);
    },
    release() {},
  };
  t.mock.method(pool, 'connect', async () => client);
  return {
    transaccion: () => consultas.map((c) => c.sql).filter((s) => /^(BEGIN|COMMIT|ROLLBACK)/.test(s)),
    auditorias: () => consultas.filter((c) => /INSERT INTO registro_auditoria/.test(c.sql)).map((c) => ({
      tabla: c.params[0], id: c.params[1], accion: c.params[2], usuario: c.params[3],
      antes: c.params[4] && JSON.parse(c.params[4]), despues: c.params[5] && JSON.parse(c.params[5]), ip: c.params[6],
    })),
  };
};

const DATOS = { serie: 'SIMA0001', modelo_id: 1, tipo_impresion_id: 2, formato_impresion_id: null };

test('crear una máquina la audita con CREAR, el usuario y la IP', async (t) => {
  const bd = usarClienteFalso(t);
  assert.equal(await Maquinas.createMaquina(DATOS, AUDITORIA), 7);
  const [registro] = bd.auditorias();
  assert.deepEqual([registro.tabla, registro.id, registro.accion, registro.usuario, registro.ip], ['maquinas', 7, 'CREAR', 9, AUDITORIA.ip]);
  assert.equal(registro.antes, null);
  assert.equal(registro.despues.serie, 'SIMA0001');
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'COMMIT']);
});

test('editar una máquina guarda la fila antes y después', async (t) => {
  const bd = usarClienteFalso(t);
  assert.equal(await Maquinas.updateMaquina(7, { ...DATOS, serie: 'SIMA0001-B' }, AUDITORIA), 1);
  const [registro] = bd.auditorias();
  assert.equal(registro.accion, 'ACTUALIZAR');
  assert.equal(registro.antes.serie, 'SIMA0001');
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'COMMIT']);
});

test('editar una máquina que no existe: 0 filas y sin auditoría', async (t) => {
  const bd = usarClienteFalso(t, { fila: null });
  assert.equal(await Maquinas.updateMaquina(99, DATOS, AUDITORIA), 0);
  assert.equal(bd.auditorias().length, 0);
});

test('activar y desactivar quedan auditados; si está asignada no cambia ni se audita', async (t) => {
  let bd = usarClienteFalso(t);
  assert.equal(await Maquinas.setActivoMaquina(7, false, AUDITORIA), 'ok');
  assert.equal(bd.auditorias()[0].accion, 'DESACTIVAR');
  t.mock.restoreAll();

  bd = usarClienteFalso(t, { fila: { ...FILA, activo: false } });
  assert.equal(await Maquinas.setActivoMaquina(7, true, AUDITORIA), 'ok');
  assert.equal(bd.auditorias()[0].accion, 'ACTIVAR');
  t.mock.restoreAll();

  bd = usarClienteFalso(t, { filasCambiadas: 0 });
  assert.equal(await Maquinas.setActivoMaquina(7, false, AUDITORIA), 'asignada');
  assert.equal(bd.auditorias().length, 0);
  t.mock.restoreAll();

  bd = usarClienteFalso(t, { fila: null });
  assert.equal(await Maquinas.setActivoMaquina(99, false, AUDITORIA), 'no_existe');
  assert.equal(bd.auditorias().length, 0);
});

test('si la auditoría falla, el cambio de la máquina se deshace', async (t) => {
  const bd = usarClienteFalso(t, { fallarAuditoria: true });
  await assert.rejects(Maquinas.updateMaquina(7, DATOS, AUDITORIA), /auditoría/);
  assert.deepEqual(bd.transaccion(), ['BEGIN', 'ROLLBACK']);
});

test('GET /api/auditoria acepta tabla=maquinas', () => {
  assert.deepEqual(validarFiltrosAuditoria({ tabla: 'maquinas', id_registro: '7' }).data, { tabla: 'maquinas', idRegistro: 7, limite: 100 });
});
