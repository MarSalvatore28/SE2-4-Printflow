// Reglas de las áreas (revisión del módulo de áreas), sin base de datos
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const { validarArea } = require('../src/utils/areas.validacion');

test('al crear, el cliente y el nombre son obligatorios; el nombre no puede ser solo espacios', () => {
  assert.match(validarArea({ nombre: 'Secretaría' }, { esCreacion: true }).error, /cliente válido/);
  assert.match(validarArea({ cliente_id: 'abc', nombre: 'Secretaría' }, { esCreacion: true }).error, /cliente válido/);
  assert.match(validarArea({ cliente_id: 1, nombre: '   ' }, { esCreacion: true }).error, /nombre del área es obligatorio/);
  assert.match(validarArea({ cliente_id: 1, nombre: 'x'.repeat(101) }, { esCreacion: true }).error, /más de 100/);
  assert.match(validarArea({ cliente_id: 1, nombre: 'A', descripcion: 5 }, { esCreacion: true }).error, /descripción debe ser texto/);
  assert.match(validarArea([], { esCreacion: true }).error, /Faltan/);
});

test('al crear, se recortan los espacios y se aceptan tildes y comillas', () => {
  const { datos } = validarArea({ cliente_id: '1', nombre: '  Sala  de «profesores» "B" ', descripcion: '  Piso 2 ' }, { esCreacion: true });
  assert.deepEqual(datos, { cliente_id: 1, nombre: 'Sala de «profesores» "B"', descripcion: 'Piso 2' });
  assert.equal(validarArea({ cliente_id: 1, nombre: 'A', descripcion: '  ' }, { esCreacion: true }).datos.descripcion, null);
});

test('al editar, solo cambia lo que viene y el estado (activo) no se toca', () => {
  assert.deepEqual(validarArea({ nombre: 'Rectorado' }, { esCreacion: false }).datos, { nombre: 'Rectorado' });
  // La web manda «activo»: antes quedaba en NULL si no venía; ahora se ignora
  assert.deepEqual(validarArea({ cliente_id: 1, nombre: 'Rectorado', activo: 0 }, { esCreacion: false }).datos, { cliente_id: 1, nombre: 'Rectorado' });
  assert.match(validarArea({ activo: true }, { esCreacion: false }).error, /No hay datos/);
  assert.match(validarArea({ nombre: '' }, { esCreacion: false }).error, /obligatorio/);
});
