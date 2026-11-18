// Consolidado del período de un reemplazo: una fila con el consumo de las dos máquinas.
// Función pura: no necesita la base de datos.
const test = require('node:test');
const assert = require('node:assert');
const { consumoDelCambio } = require('../src/utils/maquinasCambio.consumo');

// Fila del consolidado tal como sale de la consulta (solo los campos que usa el cálculo)
const filaCambio = (cambios) => ({
  maquina_cambio_id: 1,
  maquina_saliente_id: 2,
  maquina_entrante_id: 6,
  saliente_imp_bn_final_snap: 376850,
  saliente_imp_col_final_snap: 0,
  saliente_imp_bn_inicio_real: 373108,
  saliente_imp_col_inicio_real: 0,
  entrante_imp_bn_inicial_snap: 18000,
  entrante_imp_col_inicial_snap: 0,
  det_cur_imp_bn: null,
  det_cur_cop_bn: null,
  ...cambios,
});

test('consumo del cambio = saliente hasta el daño + entrante desde su instalación', () => {
  const entrante = filaCambio({ maquina_id: 6, cur_imp_bn: 22950, cur_cop_bn: 0, cur_imp_col: 0, cur_cop_col: 0 });
  const r = consumoDelCambio([entrante]);
  assert.equal(r.filaRepresentante, entrante);
  assert.deepEqual(r.saliente.consumo, { total_bn: 3742, total_color: 0, global: 3742 });
  assert.deepEqual(r.entrante.consumo, { total_bn: 4950, total_color: 0, global: 4950 });
  assert.deepEqual(r.total, { total_bn: 8692, total_color: 0, gran_total: 8692 });
});

test('consumo del cambio por color y con cuentas de usuario en la entrante', () => {
  const entrante = filaCambio({
    maquina_id: 6,
    saliente_imp_bn_final_snap: 1500, saliente_imp_col_final_snap: 700,
    saliente_imp_bn_inicio_real: 1000, saliente_imp_col_inicio_real: 600,
    entrante_imp_bn_inicial_snap: 50, entrante_imp_col_inicial_snap: 10,
    // Suma de las cuentas: impresiones + copias
    det_cur_imp_bn: '300', det_cur_cop_bn: '50', det_cur_imp_col: '40', det_cur_cop_col: '5',
  });
  const r = consumoDelCambio([entrante]);
  assert.deepEqual(r.saliente.consumo, { total_bn: 500, total_color: 100, global: 600 });
  assert.deepEqual(r.entrante.consumo, { total_bn: 300, total_color: 35, global: 335 });
  assert.deepEqual(r.total, { total_bn: 800, total_color: 135, gran_total: 935 });
});

test('si la saliente también reportó, la fila que se muestra es la de la entrante (una sola)', () => {
  const saliente = filaCambio({ maquina_id: 2, cur_imp_bn: 999999, cur_cop_bn: 0, cur_imp_col: 0, cur_cop_col: 0 });
  const entrante = filaCambio({ maquina_id: 6, cur_imp_bn: 20000, cur_cop_bn: 0, cur_imp_col: 0, cur_cop_col: 0 });
  const r = consumoDelCambio([saliente, entrante]);
  assert.equal(r.filaRepresentante, entrante);
  // La lectura de la saliente al corte no cuenta: su tramo termina en el contador final del daño
  assert.equal(r.total.gran_total, 3742 + 2000);
});

test('sin reporte de la entrante cuenta solo el tramo de la saliente', () => {
  const saliente = filaCambio({ maquina_id: 2, cur_imp_bn: 380000, cur_cop_bn: 0, cur_imp_col: 0, cur_cop_col: 0 });
  const r = consumoDelCambio([saliente]);
  assert.equal(r.filaRepresentante, saliente);
  assert.equal(r.filaEntrante, null);
  assert.deepEqual(r.entrante.consumo, { total_bn: 0, total_color: 0, global: 0 });
  assert.equal(r.total.gran_total, 3742);
});

test('un tramo nunca resta: contador por debajo del inicial cuenta 0', () => {
  const entrante = filaCambio({ maquina_id: 6, cur_imp_bn: 17000, cur_cop_bn: 0, cur_imp_col: 0, cur_cop_col: 0 });
  assert.equal(consumoDelCambio([entrante]).entrante.consumo.total_bn, 0);
});
