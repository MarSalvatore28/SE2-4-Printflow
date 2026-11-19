// Fija el CONTRATO de validarLectura que comparten S3-01 (Samuel), S3-04 y S3-05 (lectura manual y reprocesar).
// Samuel agrega sus propios tests de las reglas en otro archivo; este no se toca.
const test = require('node:test');
const assert = require('node:assert');
const { validarLectura, CODIGOS } = require('../src/services/validacionLecturas');

test('validarLectura existe y es async', () => {
  assert.equal(typeof validarLectura, 'function');
  assert.ok(validarLectura({ query: async () => ({ rows: [] }) }, {}) instanceof Promise);
});

test('los códigos de rechazo son los acordados', () => {
  assert.deepEqual(Object.keys(CODIGOS).sort(), ['DUPLICADA', 'RETROCESO', 'SALTO_ANOMALO']);
});
