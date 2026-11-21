/**
 * Calcula la facturación de un contrato para un período según la regla:
 * Cuota fija + Excedente (por separado para B/N y color).
 *
 * La respuesta tiene la forma acordada con el frontend (docs/tareas/README.md, «Contratos compartidos», punto 2):
 *   { modo, bn: { consumo, incluidas, excedente, cuota_fija, monto_excedente }, color: {...}, renta, total, filtrado }
 * Los montos van como texto con 2 decimales.
 *
 * @param {Object} contrato - Datos del contrato (tarifas, cuotas, tipo de facturación).
 * @param {Object} consumos - Consumo total del contrato en el período { bn: number, color: number }.
 * @param {number} renta - Suma de rentas mensuales de las máquinas del contrato (opcional, por defecto 0).
 * @param {boolean} filtrado - Indica si el consolidado se pidió filtrado por área o máquina.
 * @returns {Object} Desglose de la facturación.
 */
// El modo de color único se reconoce sin distinguir mayúsculas (la web lo guardaba con la «C» mayúscula)
const { esTodoColor } = require('./contratos.validacion');

const aNumero = (valor) => Number(valor) || 0;
const redondear = (valor) => Math.round(valor * 100) / 100;
const dinero = (valor) => redondear(valor).toFixed(2);

// Un tipo de página (B/N o color): cuota fija por las incluidas + excedente por lo que pasa de ellas
const tramo = (consumo, incluidas, costo, costoExcedente) => {
  const excedente = Math.max(0, consumo - incluidas);
  const cuotaFija = incluidas * costo;
  const montoExcedente = excedente * costoExcedente;
  return {
    consumo,
    incluidas,
    excedente,
    cuota_fija: dinero(cuotaFija),
    monto_excedente: dinero(montoExcedente),
    subtotal: redondear(cuotaFija) + redondear(montoExcedente),
  };
};

const sinSubtotal = ({ subtotal, ...resto }) => resto;

function calcularFacturacion(contrato, consumos, renta = 0, filtrado = false) {
  // 1. Extraer y asegurar que los valores sean numéricos
  const incluidasBn = aNumero(contrato.impresiones_bn_incluidas);
  const incluidasColor = aNumero(contrato.impresiones_color_incluidas);
  const costoBn = aNumero(contrato.costo_impresion_bn);
  const costoColor = aNumero(contrato.costo_impresion_color);
  const costoExcBn = aNumero(contrato.costo_x_excedente_impresion_bn);
  const costoExcColor = aNumero(contrato.costo_x_excedente_impresion_color);

  const consumoBn = aNumero(consumos.bn);
  const consumoColor = aNumero(consumos.color);

  // 2. Aplicar la regla según el tipo de facturación del contrato
  const todoColor = esTodoColor(contrato.facturacion_de_impresora);
  const bn = todoColor
    ? tramo(0, 0, 0, 0) // Todas las páginas (B/N + color) cuentan como color
    : tramo(consumoBn, incluidasBn, costoBn, costoExcBn);
  const color = todoColor
    ? tramo(consumoBn + consumoColor, incluidasColor, costoColor, costoExcColor)
    : tramo(consumoColor, incluidasColor, costoColor, costoExcColor);

  // 3. Calcular totales: cuotas fijas + excedentes + renta
  const rentaContrato = redondear(aNumero(renta));
  const total = bn.subtotal + color.subtotal + rentaContrato;

  return {
    modo: todoColor ? 'TODO_COLOR' : 'DIFERENCIAR',
    bn: sinSubtotal(bn),
    color: sinSubtotal(color),
    renta: dinero(rentaContrato),
    total: dinero(total),
    filtrado,
  };
}

module.exports = { calcularFacturacion };
