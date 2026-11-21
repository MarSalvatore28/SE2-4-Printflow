// Fecha de corte en hora de Ecuador (fallo 1 de TAREAS-SAMUEL.md, sección 4): un reporte de
// octubre no puede quedar como del 1 de noviembre por guardarse o mostrarse en UTC.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const {
  extraerFecha,
  normalizarHora,
  diaEcuador,
  fechaCorteDelReporte,
  fechaLecturaDelDetalle,
  sqlFechaEcuador,
  sqlDiaEcuador,
} = require('../src/utils/fechaCorte');

test('extraerFecha entiende AAAA-MM-DD, DD/MM/AAAA y DD-MM-AAAA', () => {
  assert.equal(extraerFecha('2026-10-31'), '2026-10-31');
  assert.equal(extraerFecha(' 2026-10-31 '), '2026-10-31');
  assert.equal(extraerFecha('31/10/2026'), '2026-10-31');
  assert.equal(extraerFecha('1-9-2026'), '2026-09-01');
});

test('extraerFecha rechaza lo vacío y las fechas imposibles', () => {
  for (const valor of [undefined, null, '', 'mañana', '2026-02-30', '31/02/2026']) {
    assert.equal(extraerFecha(valor), null, String(valor));
  }
});

test('extraerFecha con hora y zona toma el día de Ecuador, no el de UTC', () => {
  // 1 de noviembre 03:00 UTC = 31 de octubre 22:00 en Ecuador
  assert.equal(extraerFecha('2026-11-01T03:00:00Z'), '2026-10-31');
  assert.equal(extraerFecha('2026-10-31T23:00:00-05:00'), '2026-10-31');
  // Sin zona, el día escrito
  assert.equal(extraerFecha('2026-10-31T23:00:00'), '2026-10-31');
});

test('diaEcuador: medianoche UTC es todavía el día anterior en Ecuador', () => {
  assert.equal(diaEcuador(new Date('2026-11-01T00:00:00Z')), '2026-10-31');
  assert.equal(diaEcuador(new Date('2026-11-01T05:00:00Z')), '2026-11-01');
});

test('normalizarHora completa los segundos y rechaza horas imposibles', () => {
  assert.equal(normalizarHora('23:00'), '23:00:00');
  assert.equal(normalizarHora('7:05'), '07:05:00');
  assert.equal(normalizarHora('23:59:59'), '23:59:59');
  for (const valor of [undefined, null, '', '24:00', '12:60', 'tarde']) {
    assert.equal(normalizarHora(valor), null, String(valor));
  }
});

test('el corte es la transacción más reciente, en hora de Ecuador con su desfase', () => {
  const r = fechaCorteDelReporte([
    { fecha_transaccion: '2026-10-30', hora_transaccion: '23:59:00' },
    { fecha_transaccion: '2026-10-31', hora_transaccion: '08:00:00' },
    { fecha_transaccion: '2026-10-31', hora_transaccion: '23:00:00' },
  ], '2026-10-31');
  assert.deepEqual(r, { fechaCorte: '2026-10-31', fechaLectura: '2026-10-31T23:00:00-05:00' });
  // Ese instante, leído en UTC, es el 1 de noviembre; en Ecuador sigue siendo el 31 de octubre
  assert.equal(new Date(r.fechaLectura).toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(diaEcuador(new Date(r.fechaLectura)), '2026-10-31');
});

test('sin hora, el corte es el mediodía de Ecuador (ya no la medianoche UTC)', () => {
  const r = fechaCorteDelReporte([{ fecha_transaccion: '31/10/2026' }], null);
  assert.deepEqual(r, { fechaCorte: '2026-10-31', fechaLectura: '2026-10-31T12:00:00-05:00' });
});

test('sin detalles con fecha, se usa la fecha de carga del lote al mediodía de Ecuador', () => {
  for (const detalles of [undefined, [], [{ fecha_transaccion: '' }]]) {
    assert.deepEqual(fechaCorteDelReporte(detalles, '2026-10-31'), {
      fechaCorte: '2026-10-31',
      fechaLectura: '2026-10-31T12:00:00-05:00',
    });
  }
});

test('sin detalles ni fecha de carga, el día de hoy en Ecuador', () => {
  const ahora = new Date('2026-11-01T02:00:00Z'); // 31 de octubre 21:00 en Ecuador
  assert.equal(fechaCorteDelReporte([], undefined, ahora).fechaCorte, '2026-10-31');
});

test('la fecha de lectura de cada cuenta lleva la hora de Ecuador', () => {
  assert.equal(fechaLecturaDelDetalle({ fecha_transaccion: '2026-10-31', hora_transaccion: '23:00:00' }), '2026-10-31T23:00:00-05:00');
  assert.equal(fechaLecturaDelDetalle({ fecha_transaccion: '2026-10-31' }), '2026-10-31T00:00:00-05:00');
  assert.equal(fechaLecturaDelDetalle({ fecha_transaccion: '' }), null);
});

test('el SQL devuelve la fecha en hora de Ecuador', () => {
  assert.equal(
    sqlFechaEcuador('ro.fecha_corte'),
    `(TO_CHAR(ro.fecha_corte AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD"T"HH24:MI:SS') || '-05:00')`
  );
  assert.equal(sqlDiaEcuador('fecha_corte'), `TO_CHAR(fecha_corte AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD')`);
});
