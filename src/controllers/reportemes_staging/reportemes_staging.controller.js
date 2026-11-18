const {
  getAllStaging,
  getStagingById,
  getStagingByLote,
  getStagingPendientes,
  getStagingByEstado,
  getStagingByCliente,
  getStagingByPeriodo,
  createStaging,
  updateStaging,
  deleteStaging,
  deleteOldAprobados,
  deleteOldRechazados,
  getEstadisticasStaging,
  getConsolidadoConDetallesByLote,
  updateConsolidadoStaging,
  updateDetalleStaging,
  updateMultiplesDetallesStaging,
  validarImportacionCSV,
  getAlertasPorLote
} = require('@models/reportemes_staging/reportemes_staging.model');

const fetchAllStaging = async (req, res) => {
  try {
    const reportes = await getAllStaging();
    res.status(200).json({ success: true, data: reportes });
  } catch (err) {
    console.error('Error fetching staging:', err);
    res.status(500).json({ success: false, message: 'Error al obtener reportes en staging' });
  }
};

const getStagingByIdController = async (req, res) => {
  try {
    const { id } = req.params;
    const reporte = await getStagingById(id);
    if (!reporte) {
      return res.status(404).json({ success: false, message: 'Reporte no encontrado en staging' });
    }
    res.status(200).json({ success: true, data: reporte });
  } catch (err) {
    console.error('Error getting staging by ID:', err);
    res.status(500).json({ success: false, message: 'Error al obtener reporte' });
  }
};

const getStagingByLoteController = async (req, res) => {
  try {
    const { lote } = req.params;
    const reportes = await getStagingByLote(lote);
    res.status(200).json({ success: true, data: reportes, total: reportes.length });
  } catch (err) {
    console.error('Error getting staging by lote:', err);
    res.status(500).json({ success: false, message: 'Error al obtener reportes del lote' });
  }
};

const getStagingPendientesController = async (req, res) => {
  try {
    const reportes = await getStagingPendientes();
    res.status(200).json({ success: true, data: reportes, total: reportes.length });
  } catch (err) {
    console.error('Error getting staging pendientes:', err);
    res.status(500).json({ success: false, message: 'Error al obtener reportes pendientes' });
  }
};

const getStagingByEstadoController = async (req, res) => {
  try {
    const { estado } = req.params;
    const reportes = await getStagingByEstado(estado.toUpperCase());
    res.status(200).json({ success: true, data: reportes, total: reportes.length });
  } catch (err) {
    console.error('Error getting staging by estado:', err);
    res.status(500).json({ success: false, message: 'Error al obtener reportes por estado' });
  }
};

const getStagingByClienteController = async (req, res) => {
  try {
    const { clienteId } = req.params;
    const reportes = await getStagingByCliente(clienteId);
    res.status(200).json({ success: true, data: reportes, total: reportes.length });
  } catch (err) {
    console.error('Error getting staging by cliente:', err);
    res.status(500).json({ success: false, message: 'Error al obtener reportes por cliente' });
  }
};

const getStagingByPeriodoController = async (req, res) => {
  try {
    const { periodo } = req.params;
    const reportes = await getStagingByPeriodo(periodo);
    res.status(200).json({ success: true, data: reportes, total: reportes.length });
  } catch (err) {
    console.error('Error getting staging by periodo:', err);
    res.status(500).json({ success: false, message: 'Error al obtener reportes por periodo' });
  }
};

const createStagingController = async (req, res) => {
  try {
    const { lote_carga } = req.body;

    if (!lote_carga) {
      return res.status(400).json({
        success: false,
        message: 'El campo lote_carga es requerido'
      });
    }

    const nuevoId = await createStaging(req.body);

    res.status(201).json({
      success: true,
      message: 'Reporte creado en staging',
      data: { id_staging: nuevoId }
    });
  } catch (err) {
    console.error('Error creating staging:', err);
    res.status(500).json({ success: false, message: 'Error al crear reporte en staging' });
  }
};

const updateStagingController = async (req, res) => {
  try {
    const { id } = req.params;
    const affected = await updateStaging(id, req.body);

    if (affected === 0) {
      return res.status(404).json({ success: false, message: 'Reporte no encontrado' });
    }

    res.status(200).json({ success: true, message: 'Reporte actualizado en staging' });
  } catch (err) {
    console.error('Error updating staging:', err);
    res.status(500).json({ success: false, message: 'Error al actualizar reporte' });
  }
};

const deleteStagingController = async (req, res) => {
  try {
    const { id } = req.params;
    const affected = await deleteStaging(id);

    if (affected === 0) {
      return res.status(404).json({ success: false, message: 'Reporte no encontrado' });
    }

    res.status(200).json({ success: true, message: 'Reporte eliminado de staging' });
  } catch (err) {
    console.error('Error deleting staging:', err);
    res.status(500).json({ success: false, message: 'Error al eliminar reporte' });
  }
};

const limpiarAprobadosController = async (req, res) => {
  try {
    const { dias } = req.query;
    const diasInt = parseInt(dias) || 90;

    const affected = await deleteOldAprobados(diasInt);

    res.status(200).json({
      success: true,
      message: `Limpieza completada: ${affected} registros aprobados eliminados`,
      registros_eliminados: affected
    });
  } catch (err) {
    console.error('Error limpiando aprobados:', err);
    res.status(500).json({ success: false, message: 'Error al limpiar registros aprobados' });
  }
};

const limpiarRechazadosController = async (req, res) => {
  try {
    const { dias } = req.query;
    const diasInt = parseInt(dias) || 30;

    const affected = await deleteOldRechazados(diasInt);

    res.status(200).json({
      success: true,
      message: `Limpieza completada: ${affected} registros rechazados eliminados`,
      registros_eliminados: affected
    });
  } catch (err) {
    console.error('Error limpiando rechazados:', err);
    res.status(500).json({ success: false, message: 'Error al limpiar registros rechazados' });
  }
};

const getEstadisticasStagingController = async (req, res) => {
  try {
    const stats = await getEstadisticasStaging();
    res.status(200).json({ success: true, data: stats });
  } catch (err) {
    console.error('Error getting estadísticas staging:', err);
    res.status(500).json({ success: false, message: 'Error al obtener estadísticas' });
  }
};

const approveStagingBatchController = async (req, res) => {
  try {
    const { loteId, periodo } = req.body;
    if (!loteId) return res.status(400).json({ success: false, message: 'Falta loteId' });

    const { approveStagingBatch, validarLoteStaging } = require('@models/reportemes_staging/reportemes_staging.model');

    const validacion = await validarLoteStaging(loteId);

    if (!validacion.esValido) {
      return res.status(409).json({
        success: false,
        message: 'No se puede aprobar el lote porque la información está incompleta o inconsistente.',
        errores: validacion.errores
      });
    }
    // Queda registrado quién aprobó el lote
    const result = await approveStagingBatch(loteId, periodo, req.user?.id ?? null);
    res.status(200).json({ success: true, message: result.message || 'Lote aprobado correctamente' });
  } catch (err) {
    console.error('Error aprobando lote:', err);
    res.status(500).json({ success: false, message: 'Error al aprobar lote' });
  }
};
const rejectStagingBatchController = async (req, res) => {
  try {
    const { loteId } = req.body;
    if (!loteId) return res.status(400).json({ success: false, message: 'Falta loteId' });

    await require('@models/reportemes_staging/reportemes_staging.model').rejectStagingBatch(loteId);
    res.status(200).json({ success: true, message: 'Lote rechazado correctamente' });
  } catch (err) {
    console.error('Error rechazando lote:', err);
    res.status(500).json({ success: false, message: 'Error al rechazar lote' });
  }
};

const getConsolidadoConDetallesByLoteController = async (req, res) => {
  try {
    const { lote } = req.params;

    if (!lote) {
      return res.status(400).json({
        success: false,
        message: 'El parámetro lote es requerido'
      });
    }

    const consolidados = await getConsolidadoConDetallesByLote(lote);

    res.status(200).json({
      success: true,
      data: consolidados,
      total: consolidados.length
    });
  } catch (err) {
    console.error('Error getting consolidado con detalles by lote:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener consolidados con detalles del lote'
    });
  }
};

const updateConsolidadoStagingController = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'El ID del consolidado es requerido'
      });
    }

    const updated = await updateConsolidadoStaging(parseInt(id), data);

    res.status(200).json({
      success: true,
      message: 'Consolidado actualizado correctamente',
      data: updated
    });
  } catch (err) {
    console.error('Error updating consolidado staging:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Error al actualizar el consolidado'
    });
  }
};

const updateDetalleStagingController = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'El ID del detalle es requerido'
      });
    }

    const updated = await updateDetalleStaging(parseInt(id), data);

    res.status(200).json({
      success: true,
      message: 'Detalle actualizado correctamente',
      data: updated
    });
  } catch (err) {
    console.error('Error updating detalle staging:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Error al actualizar el detalle'
    });
  }
};

const updateMultiplesDetallesStagingController = async (req, res) => {
  try {
    const { detalles } = req.body;

    if (!detalles || !Array.isArray(detalles) || detalles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere un array de detalles para actualizar'
      });
    }

    const updated = await updateMultiplesDetallesStaging(detalles);

    res.status(200).json({
      success: true,
      message: `${updated.length} detalles actualizados correctamente`,
      data: updated
    });
  } catch (err) {
    console.error('Error updating múltiples detalles staging:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Error al actualizar los detalles'
    });
  }
};

const validarCSVController = async (req, res) => {
  try {
    const { cliente_id, csvConsolidado, csvDetalle } = req.body;

    if (!cliente_id || !csvConsolidado || !Array.isArray(csvConsolidado)) {
      return res.status(400).json({
        success: false,
        message: 'Faltan datos obligatorios: cliente_id y el arreglo csvConsolidado.'
      });
    }

    const resultado = await validarImportacionCSV(cliente_id, csvConsolidado, csvDetalle);

    if (!resultado.esValido) {
      return res.status(409).json({
        success: false,
        message: 'La validación del CSV falló. Se encontraron discrepancias con la base de datos.',
        errores: resultado.errores
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Validación exitosa. Los datos del CSV son consistentes con la Base de Datos.'
    });

  } catch (error) {
    console.error('Error validando CSV:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno en el servidor al intentar validar el CSV.'
    });
  }
};

const getValidacionLoteController = async (req, res) => {
  try {
    const { lote } = req.params;

    if (!lote) {
      return res.status(400).json({ success: false, message: 'El ID del lote es requerido' });
    }

    const validacion = await require('@models/reportemes_staging/reportemes_staging.model').validarLoteStaging(lote);

    res.status(200).json({
      success: true,
      data: validacion
    });

  } catch (err) {
    console.error('Error consultando validación del lote:', err);
    res.status(500).json({ success: false, message: 'Error al validar el lote' });
  }
};

const obtenerAlertasLoteController = async (req, res) => {
  try {
    const { loteId } = req.params;
    const alertas = await getAlertasPorLote(loteId);
    res.status(200).json({
      success: true,
      data: alertas
    });
  } catch (error) {
    console.error('Error al obtener alertas del lote:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener las alertas del lote'
    });
  }
};

module.exports = {
  fetchAllStaging,
  getStagingByIdController,
  getStagingByLoteController,
  getStagingPendientesController,
  getStagingByEstadoController,
  getStagingByClienteController,
  getStagingByPeriodoController,
  createStagingController,
  updateStagingController,
  deleteStagingController,
  limpiarAprobadosController,
  limpiarRechazadosController,
  getEstadisticasStagingController,
  approveStagingBatchController,
  rejectStagingBatchController,
  getConsolidadoConDetallesByLoteController,
  updateConsolidadoStagingController,
  updateDetalleStagingController,
  updateMultiplesDetallesStagingController,
  validarCSVController,
  getValidacionLoteController,
  obtenerAlertasLoteController
};