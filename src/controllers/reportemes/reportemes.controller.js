const {
  getReporteConsolidado,
  getReporteDetallado,
  getPeriodosDisponibles,
} = require('@models/reportemes/reportemes.model');

const getReporteConsolidadoController = async (req, res) => {
  try {
    const { clienteId, periodo } = req.params;
    const { area_id, maquina_id } = req.query;

    if (!clienteId || !periodo) {
      return res.status(400).json({ success: false, message: 'Cliente ID y Periodo son requeridos' });
    }
    if (!/^\d{4}-\d{2}$/.test(periodo)) {
      return res.status(400).json({ success: false, message: 'Formato inválido. Use YYYY-MM' });
    }

    const areaId = area_id ? parseInt(area_id) : null;
    const maquinaId = maquina_id ? parseInt(maquina_id) : null;

    const resultado = await getReporteConsolidado(
      parseInt(clienteId),
      periodo,
      areaId,
      maquinaId
    );

    res.status(200).json({
      success: true,
      data: resultado, 
      filtros_aplicados: {
        cliente_id: parseInt(clienteId),
        periodo,
        area_id: areaId,
        maquina_id: maquinaId
      }
    });

  } catch (error) {
    console.error('❌ Error Controller Consolidado:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno al obtener reporte',
      error: error.message
    });
  }
};

const getPeriodosDisponiblesController = async (req, res) => {
  try {
    const { clienteId } = req.params;
    const periodos = await getPeriodosDisponibles(parseInt(clienteId));
    res.status(200).json({ success: true, data: periodos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const getReporteDetalladoController = async (req, res) => {
  try {
    const { clienteId, periodo } = req.params;
    const { area_id, maquina_id } = req.query;

    if (!clienteId || !periodo) {
      return res.status(400).json({ 
        success: false, 
        message: 'Faltan parámetros requeridos (clienteId, periodo)' 
      });
    }

    const areaId = area_id ? parseInt(area_id) : null;
    const maquinaId = maquina_id ? parseInt(maquina_id) : null;

    const resultado = await getReporteDetallado(
      parseInt(clienteId),
      periodo,
      areaId,
      maquinaId
    );

    res.status(200).json({
      success: true,
      data: resultado
    });

  } catch (error) {
    console.error('❌ Error en getReporteDetalladoController:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno al obtener el detalle', 
      error: error.message 
    });
  }
};

module.exports = {
  getReporteConsolidadoController,
  getReporteDetalladoController,
  getPeriodosDisponiblesController,
};