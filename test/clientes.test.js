// Reglas de los clientes (revisión del módulo de clientes), sin base de datos
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const { validarRuc, validarCliente } = require('../src/utils/clientes.validacion');

test('el RUC tiene 13 dígitos, provincia 01 a 24 (o 30) y termina en 001', () => {
  for (const bueno of ['0900000001001', '1700000002001', '2490000000001', '3090000000001', ' 0992000000001 ']) {
    assert.equal(validarRuc(bueno).error, undefined, bueno);
  }
  assert.equal(validarRuc(' 0992000000001 ').ruc, '0992000000001');
  const casos = [
    ['', /obligatorio/],
    [undefined, /obligatorio/],
    ['123', /13 dígitos/],
    ['abcdefghijklm', /13 dígitos/],
    ['09000000010011', /13 dígitos/],
    ['0000000000001', /01 y 24/],
    ['2500000000001', /01 y 24/],
    ['0900000001002', /terminar en 001/],
  ];
  for (const [ruc, mensaje] of casos) assert.match(validarRuc(ruc).error, mensaje, String(ruc));
});

test('al crear, el nombre es obligatorio aunque venga con espacios', () => {
  assert.match(validarCliente({ nombre: '   ', ruc: '0992000000001' }, { esCreacion: true }).error, /nombre del cliente es obligatorio/);
  assert.match(validarCliente({ ruc: '0992000000001' }, { esCreacion: true }).error, /nombre/);
  assert.match(validarCliente({ nombre: 'X' }, { esCreacion: true }).error, /RUC es obligatorio/);
  assert.match(validarCliente({ nombre: 'x'.repeat(101), ruc: '0992000000001' }, { esCreacion: true }).error, /más de 100/);
});

test('al crear, se recortan los espacios y la razón social vacía toma el nombre', () => {
  const { datos } = validarCliente({ nombre: '  Imprenta  Ñandú "Sur" (Guayaquil) ', ruc: '0992000000001', razon_social: '  ' }, { esCreacion: true });
  assert.deepEqual(datos, { nombre: 'Imprenta Ñandú "Sur" (Guayaquil)', ruc: '0992000000001', razon_social: 'Imprenta Ñandú "Sur" (Guayaquil)' });
  assert.equal(validarCliente({ nombre: 'A', ruc: '0992000000001', razon_social: " O'Brien & Hijos S.A. " }, { esCreacion: true }).datos.razon_social, "O'Brien & Hijos S.A.");
});

test('al editar, solo cambia lo que viene, el nombre no puede quedar vacío y el estado no se toca', () => {
  assert.deepEqual(validarCliente({ razon_social: 'Nueva S.A.' }, { esCreacion: false }).datos, { razon_social: 'Nueva S.A.' });
  assert.match(validarCliente({ nombre: '' }, { esCreacion: false }).error, /obligatorio/);
  assert.match(validarCliente({ ruc: '123' }, { esCreacion: false }).error, /13 dígitos/);
  assert.match(validarCliente({ activo: false }, { esCreacion: false }).error, /No hay datos/);
  assert.equal(validarCliente({ nombre: 'A', activo: false }, { esCreacion: false }).datos.activo, undefined);
  assert.match(validarCliente(null, { esCreacion: false }).error, /Faltan/);
});
