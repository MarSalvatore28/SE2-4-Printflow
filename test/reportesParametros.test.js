// /api/reportes/consolidado y /detallado: los parámetros mal escritos responden 400, no 500
// ni un informe vacío. Sin base de datos: se reemplazan las funciones del modelo.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const Modelo = require('../src/models/reportemes/reportemes.model');

const llamar = async (handler, params, query = {}) => {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(datos) { this.body = datos; return this; },
  };
  await handler({ params, query }, res);
  return res;
};

test('consolidado y detallado validan cliente, período, área y máquina', async (t) => {
  const llamadas = [];
  t.mock.method(Modelo, 'getReporteConsolidado', async (...args) => { llamadas.push(['consolidado', ...args]); return { detalles: [], resumen: {} }; });
  t.mock.method(Modelo, 'getReporteDetallado', async (...args) => { llamadas.push(['detallado', ...args]); return []; });
  // El controlador toma las funciones al cargarse: se carga después de reemplazarlas
  delete require.cache[require.resolve('../src/controllers/reportemes/reportemes.controller')];
  const { getReporteConsolidadoController, getReporteDetalladoController } = require('../src/controllers/reportemes/reportemes.controller');

  for (const handler of [getReporteConsolidadoController, getReporteDetalladoController]) {
    assert.equal((await llamar(handler, { clienteId: 'abc', periodo: '2026-10' })).statusCode, 400);
    assert.equal((await llamar(handler, { clienteId: '99999999999', periodo: '2026-10' })).statusCode, 400);
    assert.equal((await llamar(handler, { clienteId: '0', periodo: '2026-10' })).statusCode, 400);
    assert.equal((await llamar(handler, { clienteId: '1', periodo: '2026-13' })).statusCode, 400);
    assert.equal((await llamar(handler, { clienteId: '1', periodo: 'xx' })).statusCode, 400);
    assert.equal((await llamar(handler, { clienteId: '1', periodo: '2026-10' }, { area_id: 'abc' })).statusCode, 400);
    assert.equal((await llamar(handler, { clienteId: '1', periodo: '2026-10' }, { maquina_id: '-2' })).statusCode, 400);
  }
  assert.equal(llamadas.length, 0);

  assert.equal((await llamar(getReporteConsolidadoController, { clienteId: '1', periodo: '2026-10' }, { area_id: '4', maquina_id: '' })).statusCode, 200);
  assert.equal((await llamar(getReporteDetalladoController, { clienteId: '2', periodo: '2026-11' }, { maquina_id: '5' })).statusCode, 200);
  assert.deepEqual(llamadas, [['consolidado', 1, '2026-10', 4, null], ['detallado', 2, '2026-11', null, 5]]);
});
