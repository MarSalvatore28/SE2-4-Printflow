// Informe por usuario: el consumo de cada cuenta es la diferencia con su lectura anterior.
// Función pura: no necesita la base de datos.
const test = require('node:test');
const assert = require('node:assert');
const { consumoDeCuenta } = require('../src/utils/consumoPorCuenta');

// Lecturas reales de SIMA0001 (Colegio Horizonte, demo del simulador), septiembre → octubre 2026
const cuentas = {
  secretaria: { sep: { print_bn: 73113, copia_bn: 18362, print_color: 9914, copia_color: 1325 },
    oct: { print_bn: 74637, copia_bn: 18854, print_color: 10210, copia_color: 1369 } },
  rectorado: { sep: { print_bn: 43868, copia_bn: 11017, print_color: 5948, copia_color: 795 },
    oct: { print_bn: 44782, copia_bn: 11312, print_color: 6126, copia_color: 821 } },
  inspeccion: { sep: { print_bn: 29246, copia_bn: 7346, print_color: 3967, copia_color: 531 },
    oct: { print_bn: 29855, copia_bn: 7542, print_color: 4085, copia_color: 548 } },
};

test('contador acumulativo: consumo = lectura actual − lectura del período anterior', () => {
  assert.deepEqual(consumoDeCuenta(cuentas.secretaria.oct, cuentas.secretaria.sep, true),
    { print_bn: 1524, print_color: 296, copia_bn: 492, copia_color: 44 });
});

test('la suma de las cuentas da el consumo de la máquina en el consolidado (B/N 4.030, color 679)', () => {
  const total = { bn: 0, color: 0 };
  for (const { sep, oct } of Object.values(cuentas)) {
    const c = consumoDeCuenta(oct, sep, true);
    total.bn += c.print_bn + c.copia_bn;
    total.color += c.print_color + c.copia_color;
  }
  assert.deepEqual(total, { bn: 4030, color: 679 });
});

test('sin lectura anterior, como el consolidado, se parte de 0', () => {
  assert.deepEqual(consumoDeCuenta({ print_bn: 120, print_color: 5, copia_bn: 30, copia_color: 0 }, null, true),
    { print_bn: 120, print_color: 5, copia_bn: 30, copia_color: 0 });
});

test('contador no acumulativo: la lectura ya es el consumo del período', () => {
  assert.deepEqual(consumoDeCuenta(cuentas.secretaria.oct, cuentas.secretaria.sep, false), cuentas.secretaria.oct);
});

test('un contador que retrocede (reinicio de la cuenta) no da consumo negativo', () => {
  const c = consumoDeCuenta({ print_bn: 10, print_color: 0, copia_bn: 0, copia_color: 0 },
    { print_bn: 500, print_color: 0, copia_bn: 0, copia_color: 0 }, true);
  assert.equal(c.print_bn, 0);
});

test('valores nulos o en texto (como los devuelve pg) se tratan como números', () => {
  assert.deepEqual(consumoDeCuenta({ print_bn: '200', print_color: null, copia_bn: undefined, copia_color: '7' },
    { print_bn: '150', print_color: null, copia_bn: null, copia_color: null }, true),
  { print_bn: 50, print_color: 0, copia_bn: 0, copia_color: 7 });
});
