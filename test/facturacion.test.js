const test = require('node:test');
const assert = require('node:assert');
const { calcularFacturacion, vigenciaDelContrato } = require('../src/utils/facturacion');

test('Cálculo de Facturación (S3-06)', async (t) => {
  
  const contratoBase = {
    impresiones_bn_incluidas: 1000,
    impresiones_color_incluidas: 500,
    costo_impresion_bn: 0.02,
    costo_impresion_color: 0.10,
    costo_x_excedente_impresion_bn: 0.025,
    costo_x_excedente_impresion_color: 0.12,
    facturacion_de_impresora: 'Diferenciar B/N de Color'
  };

  await t.test('Caso 1: Por debajo de las incluidas', () => {
    const consumos = { bn: 500, color: 200 };
    const result = calcularFacturacion(contratoBase, consumos);
    assert.strictEqual(result.total, '70.00');
    assert.strictEqual(result.bn.excedente, 0);
    assert.strictEqual(result.color.excedente, 0);
    assert.strictEqual(result.bn.monto_excedente, '0.00');
  });

  await t.test('Caso 2: Justo en las incluidas', () => {
    const consumos = { bn: 1000, color: 500 };
    const result = calcularFacturacion(contratoBase, consumos);
    assert.strictEqual(result.total, '70.00');
    assert.strictEqual(result.bn.excedente, 0);
    assert.strictEqual(result.color.excedente, 0);
    assert.strictEqual(result.bn.monto_excedente, '0.00');
  });

  await t.test('Caso 3: Con excedente', () => {
    const consumos = { bn: 1200, color: 0 };
    const result = calcularFacturacion(contratoBase, consumos);
    assert.strictEqual(result.total, '75.00');
    assert.strictEqual(result.bn.excedente, 200);
    assert.strictEqual(result.bn.monto_excedente, '5.00');
  });

  await t.test('Caso 4: Todo como color', () => {
    const contratoColor = { ...contratoBase, facturacion_de_impresora: 'Todo como color' };
    const consumos = { bn: 100, color: 600 }; 
    const result = calcularFacturacion(contratoColor, consumos);
    assert.strictEqual(result.modo, 'TODO_COLOR');
    assert.strictEqual(result.total, '74.00');
    assert.strictEqual(result.color.consumo, 700);
    assert.strictEqual(result.color.monto_excedente, '24.00');
    assert.strictEqual(result.bn.cuota_fija, '0.00');
  });

  await t.test('Caso 5: Con renta', () => {
    const consumos = { bn: 1000, color: 500 };
    const renta = 150.50;
    const result = calcularFacturacion(contratoBase, consumos, renta);
    assert.strictEqual(result.renta, '150.50');
    assert.strictEqual(result.total, '220.50');
  });

  await t.test('Caso 6: Dos máquinas del mismo contrato', () => {
    const consumosTotales = { bn: 1500, color: 600 };
    const result = calcularFacturacion(contratoBase, consumosTotales);
    assert.strictEqual(result.total, '94.50');
    assert.strictEqual(result.bn.monto_excedente, '12.50');
    assert.strictEqual(result.color.monto_excedente, '12.00');
  });

    await t.test('Caso Demo: Colegio Horizonte Octubre 2026 da $395.48', () => {
    const contratoDemo = {
      impresiones_bn_incluidas: 5000,
      impresiones_color_incluidas: 500,
      costo_impresion_bn: 0.02,
      costo_impresion_color: 0.10,
      costo_x_excedente_impresion_bn: 0.025,
      costo_x_excedente_impresion_color: 0.12,
      facturacion_de_impresora: 'Diferenciar B/N de Color'
    };
    
    // El documento dice que el excedente BN es 8960 y el color 179.
    // Para que eso sea el excedente, el consumo total debe ser (incluidas + excedente).
    const consumosDemo = { bn: 13960, color: 679 }; 
    
    const result = calcularFacturacion(contratoDemo, consumosDemo);
    
    assert.strictEqual(result.modo, 'DIFERENCIAR');
    assert.strictEqual(result.total, '395.48');
    assert.strictEqual(result.bn.cuota_fija, '100.00');
    assert.strictEqual(result.bn.excedente, 8960);
    assert.strictEqual(result.bn.monto_excedente, '224.00');
    assert.strictEqual(result.color.cuota_fija, '50.00');
    assert.strictEqual(result.color.excedente, 179);
    assert.strictEqual(result.color.monto_excedente, '21.48');
    assert.strictEqual(result.filtrado, false);
  });
});

test('vigenciaDelContrato: fechas del contrato para nombrarlo sin su id', () => {
  assert.deepStrictEqual(vigenciaDelContrato({ id_contrato: 1, fecha_inicio: '2026-01-01', fecha_fin: null }),
    { contrato_fecha_inicio: '2026-01-01', contrato_fecha_fin: null });
  assert.deepStrictEqual(vigenciaDelContrato({ fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31' }),
    { contrato_fecha_inicio: '2026-01-01', contrato_fecha_fin: '2026-12-31' });
  // Un contrato que no se encontró no rompe la facturación: van en null
  assert.deepStrictEqual(vigenciaDelContrato(undefined), { contrato_fecha_inicio: null, contrato_fecha_fin: null });
});
