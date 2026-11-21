// Tarifas congeladas al aprobar (TAREAS-CHRISTIAN.md, sección 2): un mes ya aprobado se factura
// con el contrato del momento de aprobar, aunque después cambie.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const {
  tarifasParaCongelar,
  COLUMNAS_CONGELADAS,
  tarifasDelReporte,
  preferirTarifas,
} = require('../src/utils/tarifasCongeladas');
const { calcularFacturacion } = require('../src/utils/facturacion');

// Contrato de Colegio Horizonte en la demo (simulador/escenario.json)
const CONTRATO_HORIZONTE = {
  contrato_id: 1,
  impresiones_bn_incluidas: 5000,
  impresiones_color_incluidas: 500,
  costo_impresion_bn: '0.0200',
  costo_impresion_color: '0.1000',
  costo_x_excedente_impresion_bn: 0.025,
  costo_x_excedente_impresion_color: 0.12,
  facturacion_de_impresora: 'Diferenciar B/N de Color',
};

// Fila del consolidado: snap_* del reporte + c.* del contrato ACTUAL
const filaConsolidado = (congeladas, actual) => ({
  contrato_id: actual.contrato_id,
  impresiones_bn_incluidas: actual.impresiones_bn_incluidas,
  impresiones_color_incluidas: actual.impresiones_color_incluidas,
  costo_contrato_bn: actual.costo_impresion_bn,
  costo_contrato_color: actual.costo_impresion_color,
  costo_x_excedente_impresion_bn: actual.costo_x_excedente_impresion_bn,
  costo_x_excedente_impresion_color: actual.costo_x_excedente_impresion_color,
  facturacion_de_impresora: actual.facturacion_de_impresora,
  fecha_congelacion: congeladas ? new Date('2026-11-05T10:00:00-05:00') : null,
  ...(congeladas || {}),
});

test('tarifasParaCongelar copia incluidas, costos, excedentes y modo del contrato', () => {
  assert.deepEqual(tarifasParaCongelar(CONTRATO_HORIZONTE), {
    snap_contrato_id: 1,
    snap_costo_impresion_bn: '0.0200',
    snap_costo_impresion_color: '0.1000',
    snap_costo_copia_bn: '0.0200',
    snap_costo_copia_color: '0.1000',
    snap_impresiones_bn_incluidas: 5000,
    snap_impresiones_color_incluidas: 500,
    snap_costo_excedente_bn: 0.025,
    snap_costo_excedente_color: 0.12,
    snap_facturacion_de_impresora: 'Diferenciar B/N de Color',
  });
});

test('sin asignación o sin contrato no se congela nada', () => {
  assert.equal(tarifasParaCongelar(null), null);
  assert.equal(tarifasParaCongelar({ area_nombre: 'Bodega', contrato_id: null }), null);
});

test('las columnas congeladas empiezan por snap_contrato_id (la aprobación lo usa para fecha_congelacion)', () => {
  assert.equal(COLUMNAS_CONGELADAS[0], 'snap_contrato_id');
  assert.equal(COLUMNAS_CONGELADAS.length, 10);
});

test('un reporte con tarifas congeladas se factura con ellas, no con el contrato actual', () => {
  const congeladas = tarifasParaCongelar(CONTRATO_HORIZONTE);
  // Después de aprobar octubre, el contrato sube las tarifas y las páginas incluidas
  const cambiado = { ...CONTRATO_HORIZONTE, impresiones_bn_incluidas: 9000, costo_impresion_bn: '0.0500', costo_x_excedente_impresion_bn: 0.08, costo_x_excedente_impresion_color: 0.5 };
  const t = tarifasDelReporte(filaConsolidado(congeladas, cambiado));
  assert.equal(t.congelada, true);
  assert.equal(t.contratoId, 1);

  const f = calcularFacturacion(t.contrato, { bn: 13960, color: 679 });
  assert.equal(f.total, '395.48');
  assert.equal(f.bn.cuota_fija, '100.00');
  assert.equal(f.bn.monto_excedente, '224.00');
  assert.equal(f.color.monto_excedente, '21.48');
});

test('un reporte sin tarifas congeladas usa el contrato actual, como antes', () => {
  const t = tarifasDelReporte(filaConsolidado(null, CONTRATO_HORIZONTE));
  assert.equal(t.congelada, false);
  assert.equal(t.contratoId, 1);
  assert.equal(calcularFacturacion(t.contrato, { bn: 13960, color: 679 }).total, '395.48');
});

test('«Todo como color» también queda congelado', () => {
  const congeladas = tarifasParaCongelar({ ...CONTRATO_HORIZONTE, facturacion_de_impresora: 'Todo como color' });
  const t = tarifasDelReporte(filaConsolidado(congeladas, CONTRATO_HORIZONTE));
  assert.equal(calcularFacturacion(t.contrato, { bn: 100, color: 50 }).modo, 'TODO_COLOR');
});

test('preferirTarifas: las congeladas ganan a las del contrato actual', () => {
  const viva = { congelada: false, fechaCongelacion: null, contrato: { costo_impresion_bn: 1 } };
  const congelada = { congelada: true, fechaCongelacion: new Date('2026-11-05'), contrato: { costo_impresion_bn: 2 } };
  assert.equal(preferirTarifas(null, viva), viva);
  assert.equal(preferirTarifas(viva, congelada), congelada);
  assert.equal(preferirTarifas(congelada, viva), congelada);
});

test('preferirTarifas: entre congeladas, la primera aprobación del mes', () => {
  const primera = { congelada: true, fechaCongelacion: new Date('2026-11-05'), contrato: {} };
  const segunda = { congelada: true, fechaCongelacion: new Date('2026-11-10'), contrato: {} };
  assert.equal(preferirTarifas(primera, segunda), primera);
  assert.equal(preferirTarifas(segunda, primera), primera);
});
