// Asignaciones (instalaciones): validación del alta, la edición y el retiro, sin base de datos.
// Antes una IP como 999.1.1.1 se guardaba, y un id o una renta con texto respondían 500.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const {
  normalizarIp,
  validarDatosInstalacion,
  validarDatosEdicionInstalacion,
  validarDatosRetiro,
} = require('../src/utils/instalacion.reglas');
const instalacion = require('../src/controllers/instalacion/instalacion.controller');

const HOY = '2026-11-21';
const IP = '10.20.1.12'; // NOSONAR: IP de ejemplo, sin red

const alta = (cambios = {}) => ({ maquina_id: 8, area_id: 1, contrato_id: 1, ip_address: IP, ...cambios });

const mensajeDe = (validar, body) => {
  const r = validar(body, HOY);
  assert.ok(r.error, `se esperaba un error para ${JSON.stringify(body)}`);
  assert.equal(r.error.status, 400);
  return r.error.message;
};

test('normalizarIp: IPv4 en su forma normal, o null', () => {
  assert.equal(normalizarIp(' 10.20.1.12 '), IP);
  assert.equal(normalizarIp('010.020.001.012'), IP);
  for (const mala of ['999.1.1.1', '10.20.1', '10.20.1.1.5', 'abc', '10.20.1.-1', '1234567890123456789', '', null, 12]) {
    assert.equal(normalizarIp(mala), null, String(mala));
  }
});

test('alta válida: ids enteros, IP normal y valores por defecto', () => {
  const { data } = validarDatosInstalacion(alta({ maquina_id: '8', ip_address: '010.20.1.12' }), HOY);
  assert.deepEqual(data, {
    maquina_id: 8, area_id: 1, contrato_id: 1, ip_address: IP, fecha_instalacion: null,
    costo_renta_mensual: 0, contador_acumulativo: true, contabilidad_por_usuario: false, observaciones: null,
  });
});

test('alta: rechaza ids, IP, fecha, renta y booleanos inválidos con 400 y su motivo', () => {
  assert.match(mensajeDe(validarDatosInstalacion, alta({ maquina_id: 'abc' })), /máquina/);
  assert.match(mensajeDe(validarDatosInstalacion, alta({ area_id: 0 })), /área/);
  assert.match(mensajeDe(validarDatosInstalacion, alta({ contrato_id: -1 })), /contrato/);
  assert.match(mensajeDe(validarDatosInstalacion, alta({ ip_address: '' })), /IP es obligatoria/);
  assert.match(mensajeDe(validarDatosInstalacion, alta({ ip_address: '999.1.1.1' })), /IPv4/);
  assert.match(mensajeDe(validarDatosInstalacion, alta({ fecha_instalacion: '2026-02-30' })), /fecha válida/);
  assert.match(mensajeDe(validarDatosInstalacion, alta({ fecha_instalacion: '2026-11-22' })), /futura/);
  assert.match(mensajeDe(validarDatosInstalacion, alta({ costo_renta_mensual: -5 })), /renta/);
  assert.match(mensajeDe(validarDatosInstalacion, alta({ costo_renta_mensual: 'abc' })), /renta/);
  assert.match(mensajeDe(validarDatosInstalacion, alta({ contador_acumulativo: 'si' })), /true o false/);
  assert.match(mensajeDe(validarDatosInstalacion, alta({ observaciones: 'x'.repeat(501) })), /500/);
  assert.match(mensajeDe(validarDatosInstalacion, [1, 2]), /máquina/);
});

test('alta: la fecha de hoy y la renta con decimales se aceptan', () => {
  const { data } = validarDatosInstalacion(alta({ fecha_instalacion: HOY, costo_renta_mensual: '25.505' }), HOY);
  assert.equal(data.fecha_instalacion, HOY);
  assert.equal(data.costo_renta_mensual, 25.51);
});

test('edición: misma regla de IP, fecha y forma de contar', () => {
  assert.match(mensajeDe(validarDatosEdicionInstalacion, { ip_address: 'abc' }), /IPv4/);
  assert.match(mensajeDe(validarDatosEdicionInstalacion, { ip_address: IP, fecha_instalacion: '2027-01-01' }), /futura/);
  const { data } = validarDatosEdicionInstalacion({ ip_address: IP, contabilidad_por_usuario: true }, HOY);
  assert.equal(data.contabilidad_por_usuario, true);
  assert.equal(data.fecha_instalacion, null, 'sin fecha no se cambia');
});

test('retiro: fecha válida y no futura; observaciones opcionales', () => {
  assert.match(mensajeDe(validarDatosRetiro, { fecha_retiro: '2027-01-01' }), /futura/);
  assert.match(mensajeDe(validarDatosRetiro, { fecha_retiro: 'ayer' }), /fecha válida/);
  assert.deepEqual(validarDatosRetiro({}, HOY).data, { fecha_retiro: null, observaciones_retiro: null });
  assert.deepEqual(validarDatosRetiro({ fecha_retiro: '2026-11-20', observaciones_retiro: ' Dañada ' }, HOY).data,
    { fecha_retiro: '2026-11-20', observaciones_retiro: 'Dañada' });
});

// El controlador responde el 400 sin llegar a la base
const ejecutar = async (controlador, req) => {
  const r = { status: 200, cuerpo: null };
  const res = {
    status(codigo) { r.status = codigo; return this; },
    json(cuerpo) { r.cuerpo = cuerpo; return this; },
  };
  await controlador({ params: {}, query: {}, body: {}, user: { id: 1 }, ip: '127.0.0.1', ...req }, res);
  return r;
};

test('controladores: un id de la ruta o un cuerpo inválido responden 400 (antes, 500 de la base)', async () => {
  let r = await ejecutar(instalacion.createInstalacionController, { body: alta({ ip_address: '999.1.1.1' }) });
  assert.equal(r.status, 400);
  r = await ejecutar(instalacion.updateInstalacionController, { params: { id_instalacion: 'abc' }, body: { ip_address: IP } });
  assert.deepEqual([r.status, r.cuerpo.message], [400, 'ID de instalación inválido']);
  r = await ejecutar(instalacion.deleteInstalacionController, { params: { id_instalacion: '0' } });
  assert.deepEqual([r.status, r.cuerpo.message], [400, 'ID de instalación inválido']);
});
