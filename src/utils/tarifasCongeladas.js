// Tarifas congeladas al aprobar (TAREAS-CHRISTIAN.md, sección 2).
//
// Al aprobar un lote, cada reporte oficial guarda las tarifas del contrato de la asignación de su
// máquina (instalaciones.contrato_id). El importe de un mes ya aprobado se calcula con esas
// tarifas: si mañana cambia el contrato, octubre no cambia.
//
// Un reporte sin tarifas congeladas (snap_contrato_id en NULL: aprobado antes de la migración 022
// o registrado a mano) se factura con el contrato actual, como antes.

/**
 * Valores snap_* que se guardan en reportes_oficiales a partir del contrato vigente.
 * Las copias se cobran como las impresiones (el consolidado suma impresiones + copias por
 * B/N y color), por eso snap_costo_copia_* es el costo por página del contrato.
 * @param {Object|null} contrato fila con contrato_id y las columnas de contratos
 * @returns {Object|null} null si la máquina no tiene contrato: el reporte queda sin congelar
 */
const tarifasParaCongelar = (contrato) => {
  if (!contrato || contrato.contrato_id === null || contrato.contrato_id === undefined) return null;
  return {
    snap_contrato_id: contrato.contrato_id,
    snap_costo_impresion_bn: contrato.costo_impresion_bn ?? 0,
    snap_costo_impresion_color: contrato.costo_impresion_color ?? 0,
    snap_costo_copia_bn: contrato.costo_impresion_bn ?? 0,
    snap_costo_copia_color: contrato.costo_impresion_color ?? 0,
    snap_impresiones_bn_incluidas: contrato.impresiones_bn_incluidas ?? 0,
    snap_impresiones_color_incluidas: contrato.impresiones_color_incluidas ?? 0,
    snap_costo_excedente_bn: contrato.costo_x_excedente_impresion_bn ?? 0,
    snap_costo_excedente_color: contrato.costo_x_excedente_impresion_color ?? 0,
    snap_facturacion_de_impresora: contrato.facturacion_de_impresora ?? null,
  };
};

const COLUMNAS_CONGELADAS = Object.keys(tarifasParaCongelar({ contrato_id: 0 }));

/**
 * Tarifas con las que se factura un reporte del consolidado.
 * @param {Object} row fila de getReporteConsolidado (snap_* del reporte y c.* del contrato actual)
 * @returns {{ contratoId: number|null, congelada: boolean, fechaCongelacion: Date|null, contrato: Object }}
 *          `contrato` tiene la forma que espera calcularFacturacion
 */
const tarifasDelReporte = (row) => {
  const congelada = row.snap_contrato_id !== null && row.snap_contrato_id !== undefined;
  if (congelada) {
    return {
      contratoId: row.snap_contrato_id,
      congelada: true,
      fechaCongelacion: row.fecha_congelacion || null,
      contrato: {
        impresiones_bn_incluidas: row.snap_impresiones_bn_incluidas,
        impresiones_color_incluidas: row.snap_impresiones_color_incluidas,
        costo_impresion_bn: row.snap_costo_impresion_bn,
        costo_impresion_color: row.snap_costo_impresion_color,
        costo_x_excedente_impresion_bn: row.snap_costo_excedente_bn,
        costo_x_excedente_impresion_color: row.snap_costo_excedente_color,
        facturacion_de_impresora: row.snap_facturacion_de_impresora,
      },
    };
  }
  return {
    contratoId: row.contrato_id ?? null,
    congelada: false,
    fechaCongelacion: null,
    contrato: {
      impresiones_bn_incluidas: row.impresiones_bn_incluidas,
      impresiones_color_incluidas: row.impresiones_color_incluidas,
      costo_impresion_bn: row.costo_contrato_bn,
      costo_impresion_color: row.costo_contrato_color,
      costo_x_excedente_impresion_bn: row.costo_x_excedente_impresion_bn,
      costo_x_excedente_impresion_color: row.costo_x_excedente_impresion_color,
      facturacion_de_impresora: row.facturacion_de_impresora,
    },
  };
};

const momento = (fecha) => (fecha ? new Date(fecha).getTime() : Infinity);

/**
 * Las tarifas de un contrato en el mes, cuando sus máquinas traen distintas: las congeladas
 * ganan a las del contrato actual y, entre congeladas, la primera aprobación del mes.
 */
const preferirTarifas = (actual, candidata) => {
  if (!actual) return candidata;
  if (candidata.congelada !== actual.congelada) return candidata.congelada ? candidata : actual;
  if (candidata.congelada && momento(candidata.fechaCongelacion) < momento(actual.fechaCongelacion)) return candidata;
  return actual;
};

module.exports = { tarifasParaCongelar, COLUMNAS_CONGELADAS, tarifasDelReporte, preferirTarifas };
