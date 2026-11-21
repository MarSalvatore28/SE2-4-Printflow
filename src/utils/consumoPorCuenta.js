// Consumo del período de una cuenta de usuario (informe detallado por usuario).
// Función pura: la usa reportemes.model con las filas que ya trajo de la base.
//
// Las impresoras guardan por cuenta contadores ACUMULADOS: Secretaría marca 71.373 en agosto
// y 73.113 en septiembre. Lo que imprimió en septiembre es la diferencia (1.740), no 73.113.
// Misma regla que el consolidado (calcularConsumoNormal):
//   - contador acumulativo: actual − lectura de la misma cuenta y máquina en el período
//     anterior (0 si no hay), nunca negativo;
//   - contador no acumulativo: la lectura ya es el consumo del período.

const CAMPOS = ['print_bn', 'print_color', 'copia_bn', 'copia_color'];

const aEntero = (valor) => Number.parseInt(valor || 0, 10) || 0;

/**
 * @param {{print_bn, print_color, copia_bn, copia_color}} actual   lectura al corte del período
 * @param {{print_bn, print_color, copia_bn, copia_color}|null} anterior lectura del período anterior
 * @param {boolean} acumulativo instalaciones.contador_acumulativo
 * @returns {{print_bn, print_color, copia_bn, copia_color}}
 */
const consumoDeCuenta = (actual, anterior, acumulativo) => {
  const consumo = {};
  for (const campo of CAMPOS) {
    const valor = aEntero(actual?.[campo]);
    consumo[campo] = acumulativo ? Math.max(0, valor - aEntero(anterior?.[campo])) : valor;
  }
  return consumo;
};

module.exports = { consumoDeCuenta };
