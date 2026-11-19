const test = require('node:test');
const assert = require('node:assert');
const { calcularFacturacion } = require('../src/utils/facturacion');

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
    assert.strictEqual(result.total_impresiones, '70.00');
    assert.strictEqual(result.excedente_bn, '0.00');
    assert.strictEqual(result.excedente_color, '0.00');
  });

  await t.test('Caso 2: Justo en las incluidas', () => {
    const consumos = { bn: 1000, color: 500 };
    const result = calcularFacturacion(contratoBase, consumos);
    assert.strictEqual(result.total_impresiones, '70.00');
    assert.strictEqual(result.excedente_bn, '0.00');
    assert.strictEqual(result.excedente_color, '0.00');
  });

  await t.test('Caso 3: Con excedente', () => {
    const consumos = { bn: 1200, color: 0 };
    const result = calcularFacturacion(contratoBase, consumos);
    assert.strictEqual(result.total_impresiones, '75.00');
    assert.strictEqual(result.excedente_bn, '5.00');
  });

  await t.test('Caso 4: Todo como color', () => {
    const contratoColor = { ...contratoBase, facturacion_de_impresora: 'Todo como color' };
    const consumos = { bn: 100, color: 600 }; 
    const result = calcularFacturacion(contratoColor, consumos);
    assert.strictEqual(result.total_impresiones, '74.00');
    assert.strictEqual(result.excedente_color, '24.00');
    assert.strictEqual(result.cuota_fija_bn, '0.00'); 
  });

  await t.test('Caso 5: Con renta', () => {
    const consumos = { bn: 1000, color: 500 };
    const renta = 150.50;
    const result = calcularFacturacion(contratoBase, consumos, renta);
    assert.strictEqual(result.total_impresiones, '70.00');
    assert.strictEqual(result.renta, '150.50');
    assert.strictEqual(result.total_contrato, '220.50');
  });

  await t.test('Caso 6: Dos máquinas del mismo contrato', () => {
    const consumosTotales = { bn: 1500, color: 600 };
    const result = calcularFacturacion(contratoBase, consumosTotales);
    assert.strictEqual(result.total_impresiones, '94.50');
    assert.strictEqual(result.excedente_bn, '12.50');
    assert.strictEqual(result.excedente_color, '12.00');
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
    
    assert.strictEqual(result.total_impresiones, '395.48');
    assert.strictEqual(result.cuota_fija_bn, '100.00');
    assert.strictEqual(result.excedente_bn, '224.00');
    assert.strictEqual(result.cuota_fija_color, '50.00');
    assert.strictEqual(result.excedente_color, '21.48');
  });
});