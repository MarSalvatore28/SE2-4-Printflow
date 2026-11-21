// Reglas de los contratos (revisión del módulo de clientes y contratos), sin base de datos
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const {
  FACTURACION,
  normalizarFacturacion,
  esTodoColor,
  fechaIso,
  fechaDeColumna,
  contratoComoCuerpo,
  validarContrato,
  avisoSuperposicion,
} = require('../src/utils/contratos.validacion');
const { calcularFacturacion } = require('../src/utils/facturacion');

const valido = {
  fecha_inicio: '2026-11-01',
  impresiones_bn_incluidas: '1500',
  impresiones_color_incluidas: 250,
  costo_impresion_bn: '0.0125',
  costo_impresion_color: 0.0875,
  costo_excedente_impresion_bn: '0.0175',
  costo_excedente_impresion_color: 0.1125,
  tiene_renta: true,
  tiene_software_control: false,
  printer_bill: 'Todo como Color',
};

test('el modo de facturación se reconoce sin distinguir mayúsculas ni espacios', () => {
  assert.equal(normalizarFacturacion('Todo como Color'), FACTURACION.TODO_COLOR);
  assert.equal(normalizarFacturacion('  TODO   COMO color '), FACTURACION.TODO_COLOR);
  assert.equal(normalizarFacturacion('diferenciar b/n de color'), FACTURACION.DIFERENCIAR);
  assert.equal(normalizarFacturacion('Otro'), null);
  assert.equal(normalizarFacturacion(undefined), null);
  assert.equal(esTodoColor('Todo como Color'), true);
  assert.equal(esTodoColor('Diferenciar B/N de Color'), false);
});

test('un contrato «Todo como Color» (como lo guardaba la web) se factura todo como color', () => {
  const contrato = {
    impresiones_bn_incluidas: 1000, impresiones_color_incluidas: 500,
    costo_impresion_bn: 0.02, costo_impresion_color: 0.1,
    costo_x_excedente_impresion_bn: 0.03, costo_x_excedente_impresion_color: 0.12,
    facturacion_de_impresora: 'Todo como Color',
  };
  const f = calcularFacturacion(contrato, { bn: 800, color: 300 });
  assert.equal(f.modo, 'TODO_COLOR');
  assert.equal(f.color.consumo, 1100);
  // 500 incluidas × 0,10 + 600 de excedente × 0,12 = 50 + 72
  assert.equal(f.total, '122.00');
});

test('validarContrato normaliza los números, los booleanos y la facturación', () => {
  const { error, datos } = validarContrato(valido);
  assert.equal(error, undefined);
  assert.deepEqual(datos, {
    fecha_inicio: '2026-11-01',
    fecha_fin: null,
    impresiones_bn_incluidas: 1500,
    impresiones_color_incluidas: 250,
    costo_impresion_bn: 0.0125,
    costo_impresion_color: 0.0875,
    costo_excedente_impresion_bn: 0.0175,
    costo_excedente_impresion_color: 0.1125,
    renta_equipo: true,
    software_control: false,
    facturacion_de_impresora: 'Todo como color',
  });
  assert.equal(validarContrato({ ...valido, printer_bill: undefined }).datos.facturacion_de_impresora, FACTURACION.DIFERENCIAR);
});

test('validarContrato rechaza datos que antes daban error 500 o quedaban mal guardados', () => {
  const casos = [
    [{ fecha_inicio: '' }, /obligatoria/],
    [{ fecha_inicio: 'hola' }, /inicio no es válida/],
    [{ fecha_inicio: '2026-02-30' }, /inicio no es válida/],
    [{ fecha_fin: '2026-10-01' }, /anterior/],
    [{ fecha_fin: 'mañana' }, /fin no es válida/],
    [{ costo_impresion_bn: -1 }, /no puede ser negativo/],
    [{ costo_impresion_bn: 'abc' }, /debe ser un número/],
    [{ costo_impresion_bn: 99999999 }, /no puede ser mayor/],
    [{ impresiones_bn_incluidas: -50 }, /no puede ser negativo/],
    [{ impresiones_bn_incluidas: 1.5 }, /entero/],
    [{ costo_excedente_impresion_color: '-0.1' }, /no puede ser negativo/],
    [{ costo_impresion_bn: 0, costo_impresion_color: 0 }, /mayor que 0/],
    [{ printer_bill: 'Gratis' }, /La facturación debe ser/],
  ];
  for (const [cambio, mensaje] of casos) {
    assert.match(validarContrato({ ...valido, ...cambio }).error, mensaje, JSON.stringify(cambio));
  }
  assert.match(validarContrato(null).error, /Faltan/);
});

test('al editar, lo que no viene en la petición conserva el valor guardado', () => {
  const fila = {
    fecha_inicio: new Date(2026, 0, 1), fecha_fin: null,
    impresiones_bn_incluidas: 5000, impresiones_color_incluidas: 500,
    costo_impresion_bn: '0.0200', costo_impresion_color: '0.1000',
    costo_x_excedente_impresion_bn: 0.025, costo_x_excedente_impresion_color: 0.12,
    renta_equipo: true, software_control: false, facturacion_de_impresora: 'Diferenciar B/N de Color',
  };
  const { datos } = validarContrato({ costo_impresion_bn: '0.03' }, contratoComoCuerpo(fila));
  assert.equal(datos.fecha_inicio, '2026-01-01');
  assert.equal(datos.costo_impresion_bn, 0.03);
  assert.equal(datos.impresiones_bn_incluidas, 5000);
  assert.equal(datos.costo_impresion_color, 0.1);
  assert.equal(datos.costo_excedente_impresion_color, 0.12);
  assert.equal(datos.renta_equipo, true);
  assert.equal(datos.facturacion_de_impresora, FACTURACION.DIFERENCIAR);
  // Lo que sí viene, aunque sea falso o vacío, gana
  assert.equal(validarContrato({ tiene_renta: false, fecha_fin: null }, contratoComoCuerpo(fila)).datos.renta_equipo, false);
});

test('fechas: solo días reales y columnas date leídas con pg', () => {
  assert.equal(fechaIso('2026-11-01'), '2026-11-01');
  assert.equal(fechaIso('2026-11-01T00:00:00.000Z'), '2026-11-01');
  assert.equal(fechaIso('2026-13-01'), null);
  assert.equal(fechaDeColumna(new Date(2026, 10, 1)), '2026-11-01');
  assert.equal(fechaDeColumna(null), null);
});

test('el aviso de superposición describe el otro contrato por sus fechas, sin su id', () => {
  assert.equal(avisoSuperposicion(null), undefined);
  const aviso = avisoSuperposicion({ id_contrato: 7, fecha_inicio: new Date(2026, 0, 1), fecha_fin: null });
  assert.equal(aviso, 'Se superpone con el contrato vigente del 01/01/2026 sin fecha de fin');
  assert.doesNotMatch(aviso, /#|7/);
  assert.equal(
    avisoSuperposicion({ fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31' }),
    'Se superpone con el contrato vigente del 01/01/2026 al 31/12/2026'
  );
});

test('el excedente se acepta con el nombre del GET (costo_x_excedente_*) o el de la web, y sin ninguno se conserva', () => {
  // Fila como la devuelve GET /api/contratos/:id (Andina)
  const fila = {
    id_contrato: 2, cliente_id: 2, fecha_inicio: new Date(2026, 0, 1), fecha_fin: new Date(2026, 11, 31),
    impresiones_bn_incluidas: 8000, impresiones_color_incluidas: 1000, costo_impresion_bn: '0.0180', costo_impresion_color: '0.0900',
    costo_x_excedente_impresion_bn: 0.022, costo_x_excedente_impresion_color: 0.11,
    renta_equipo: false, software_control: false, facturacion_de_impresora: 'Diferenciar B/N de Color',
  };
  const base = contratoComoCuerpo(fila);
  // Reenviar lo que dio el GET (antes el excedente se guardaba en 0)
  let { datos } = validarContrato({ ...fila, fecha_inicio: '2026-01-01T00:00:00.000Z', fecha_fin: '2026-12-31T00:00:00.000Z' }, base);
  assert.equal(datos.costo_excedente_impresion_bn, 0.022);
  assert.equal(datos.costo_excedente_impresion_color, 0.11);
  // Uno de los dos nombres llega vacío: gana el que trae valor
  ({ datos } = validarContrato({ costo_excedente_impresion_color: null, costo_x_excedente_impresion_color: 0.15 }, base));
  assert.equal(datos.costo_excedente_impresion_color, 0.15);
  ({ datos } = validarContrato({ costo_excedente_impresion_bn: 0.03, costo_x_excedente_impresion_bn: 0.022 }, base));
  assert.equal(datos.costo_excedente_impresion_bn, 0.03);
  // Ninguno llega (o llega vacío): conserva el guardado, no 0
  ({ datos } = validarContrato({ costo_excedente_impresion_bn: '', costo_impresion_color: 0.1 }, base));
  assert.equal(datos.costo_excedente_impresion_bn, 0.022);
  assert.equal(datos.costo_excedente_impresion_color, 0.11);
  // Al crear, sin excedente es 0
  ({ datos } = validarContrato({ fecha_inicio: '2026-11-01', costo_impresion_bn: 0.02, costo_x_excedente_impresion_color: null }));
  assert.equal(datos.costo_excedente_impresion_color, 0);
  // Un 0 que llega sí cuenta como valor
  ({ datos } = validarContrato({ costo_x_excedente_impresion_bn: 0 }, base));
  assert.equal(datos.costo_excedente_impresion_bn, 0);
});
