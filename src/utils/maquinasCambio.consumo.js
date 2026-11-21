// Consumo de un reemplazo de máquina en el consolidado del período afectado (caja 4).
// Función pura: la usa reportemes.model con las filas que ya trajo de la base.

const aEntero = (valor) => Number.parseInt(valor || 0, 10) || 0;

// Lectura B/N y color de la fila: la suma de las cuentas de usuario si las tiene, si no los
// contadores del reporte (las mismas fuentes que usa calcularConsumoNormal).
const lecturaActualDe = (row) => {
  const tieneDetalle = row.det_cur_imp_bn !== null && row.det_cur_imp_bn !== undefined;
  return tieneDetalle
    ? { bn: aEntero(row.det_cur_imp_bn) + aEntero(row.det_cur_cop_bn), color: aEntero(row.det_cur_imp_col) + aEntero(row.det_cur_cop_col) }
    : { bn: aEntero(row.cur_imp_bn) + aEntero(row.cur_cop_bn), color: aEntero(row.cur_imp_col) + aEntero(row.cur_cop_col) };
};

/**
 * Consumo de un reemplazo de máquina en el período afectado (caja 4).
 * `filas` son los reportes del período enlazados al mismo cambio (normalmente solo el de la
 * entrante; el de la saliente aparece únicamente si también reportó).
 *   saliente = contador final al salir (cabecera SALIENTE) − su última lectura aprobada
 *   entrante = su lectura al corte − contador inicial al entrar (cabecera ENTRANTE)
 * Cada parte por B/N y por color, nunca negativa.
 */
const consumoDelCambio = (filas) => {
  const base = filas[0];
  const filaEntrante = filas.find((f) => f.maquina_id === f.maquina_entrante_id) || null;

  const finalSaliente = { bn: aEntero(base.saliente_imp_bn_final_snap), color: aEntero(base.saliente_imp_col_final_snap) };
  const inicioSaliente = { bn: aEntero(base.saliente_imp_bn_inicio_real), color: aEntero(base.saliente_imp_col_inicio_real) };
  const inicialEntrante = { bn: aEntero(base.entrante_imp_bn_inicial_snap), color: aEntero(base.entrante_imp_col_inicial_snap) };
  const lecturaEntrante = filaEntrante ? lecturaActualDe(filaEntrante) : inicialEntrante;

  const parte = (fin, inicio) => {
    const bn = Math.max(0, fin.bn - inicio.bn);
    const color = Math.max(0, fin.color - inicio.color);
    return { total_bn: bn, total_color: color, global: bn + color };
  };
  const saliente = parte(finalSaliente, inicioSaliente);
  const entrante = parte(lecturaEntrante, inicialEntrante);

  return {
    filaRepresentante: filaEntrante || base,
    filaEntrante,
    saliente: { anterior: inicioSaliente, actual: finalSaliente, consumo: saliente },
    entrante: { anterior: inicialEntrante, actual: lecturaEntrante, consumo: entrante },
    total: {
      total_bn: saliente.total_bn + entrante.total_bn,
      total_color: saliente.total_color + entrante.total_color,
      gran_total: saliente.global + entrante.global,
    },
  };
};

module.exports = { consumoDelCambio, lecturaActualDe };
