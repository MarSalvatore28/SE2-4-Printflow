// Historial de cambios y estadísticas de un área: el id se valida antes de consultar la base
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const {
  getHistorialCambiosAreaController,
  getEstadisticasAreaController,
} = require('../src/controllers/area/area.controller');

const llamar = async (controlador, id) => {
  const res = {
    statusCode: 200,
    body: null,
    status(codigo) { this.statusCode = codigo; return this; },
    json(cuerpo) { this.body = cuerpo; return this; },
  };
  await controlador({ params: { id } }, res);
  return res;
};

test('historial y estadísticas con un id que no es un entero positivo: 400 sin consultar', async () => {
  for (const controlador of [getHistorialCambiosAreaController, getEstadisticasAreaController]) {
    for (const id of ['abc', '0', '-1', '1.5', '1 OR 1=1']) {
      const res = await llamar(controlador, id);
      assert.equal(res.statusCode, 400, `id ${id}`);
      assert.equal(res.body.message, 'ID de área inválido');
    }
  }
});

test('el historial ya no usa las tablas sin relación (cambio_id no existe en el esquema)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const modelo = fs.readFileSync(path.join(__dirname, '../src/models/area/area.model.js'), 'utf8');
  const esquema = fs.readFileSync(path.join(__dirname, '../db/migrations/001_esquema_inicial.sql'), 'utf8');
  assert.ok(!/cambio_id\s+integer/.test(esquema.match(/CREATE TABLE public\.historial_ubicaciones \([^;]*\);/)[0]));
  assert.ok(!/\.cambio_id\b/.test(modelo), 'el modelo no debe unir por cambio_id');
  assert.ok(!/historial_fechas/.test(modelo), 'historial_fechas no existe en el esquema');
  assert.match(modelo, /FROM maquinas_cambio mc/);
});
