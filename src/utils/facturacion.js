/**
 * Calcula la facturación de un contrato para un período según la regla:
 * Cuota fija + Excedente (por separado para B/N y color).
 * 
 * @param {Object} contrato - Datos del contrato (tarifas, cuotas, tipo de facturación).
 * @param {Object} consumos - Consumo total del contrato en el período { bn: number, color: number }.
 * @param {number} renta - Suma de rentas mensuales de las máquinas del contrato (opcional, por defecto 0).
 * @param {boolean} filtrado - Indica si el cálculo se hizo sobre un subconjunto de máquinas/áreas.
 * @returns {Object} Desglose de la facturación con montos en formato de texto (2 decimales).
 */
function calcularFacturacion(contrato, consumos, renta = 0, filtrado = false) {
  // 1. Extraer y asegurar que los valores sean numéricos
  const incluidasBn = Number(contrato.impresiones_bn_incluidas) || 0;
  const incluidasColor = Number(contrato.impresiones_color_incluidas) || 0;
  const costoBn = Number(contrato.costo_impresion_bn) || 0;
  const costoColor = Number(contrato.costo_impresion_color) || 0;
  const costoExcBn = Number(contrato.costo_x_excedente_impresion_bn) || 0;
  const costoExcColor = Number(contrato.costo_x_excedente_impresion_color) || 0;
  
  const consumoBn = Number(consumos.bn) || 0;
  const consumoColor = Number(consumos.color) || 0;

  let cuotaFijaBn = 0;
  let excedenteBn = 0;
  let cuotaFijaColor = 0;
  let excedenteColor = 0;

  // 2. Aplicar la regla según el tipo de facturación del contrato
  if (contrato.facturacion_de_impresora === 'Todo como color') {
    // Todas las páginas (B/N + color) cuentan como color
    const totalPaginas = consumoBn + consumoColor;
    cuotaFijaColor = incluidasColor * costoColor;
    excedenteColor = Math.max(0, totalPaginas - incluidasColor) * costoExcColor;
  } else {
    // Caso por defecto: 'Diferenciar B/N de Color'
    cuotaFijaBn = incluidasBn * costoBn;
    excedenteBn = Math.max(0, consumoBn - incluidasBn) * costoExcBn;

    cuotaFijaColor = incluidasColor * costoColor;
    excedenteColor = Math.max(0, consumoColor - incluidasColor) * costoExcColor;
  }

  // 3. Calcular totales
  const totalImpresiones = cuotaFijaBn + excedenteBn + cuotaFijaColor + excedenteColor;
  const totalContrato = totalImpresiones + renta;

  // 4. Retornar el objeto con los montos formateados como texto (2 decimales)
  return {
    cuota_fija_bn: cuotaFijaBn.toFixed(2),
    excedente_bn: excedenteBn.toFixed(2),
    cuota_fija_color: cuotaFijaColor.toFixed(2),
    excedente_color: excedenteColor.toFixed(2),
    total_impresiones: totalImpresiones.toFixed(2),
    renta: renta.toFixed(2),
    total_contrato: totalContrato.toFixed(2),
    filtrado: filtrado
  };
}

module.exports = { calcularFacturacion };