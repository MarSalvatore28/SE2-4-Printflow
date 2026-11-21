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

    const areaId = area_id ? Number.parseInt(area_id, 10) : null;
    const maquinaId = maquina_id ? Number.parseInt(maquina_id, 10) : null;

    const resultado = await getReporteConsolidado(
      Number.parseInt(clienteId, 10),
      periodo,
      areaId,
      maquinaId
    );

    res.status(200).json({
      success: true,
      data: resultado, 
      filtros_aplicados: {
        cliente_id: Number.parseInt(clienteId, 10),
        periodo,
        area_id: areaId,
        maquina_id: maquinaId
      }
    });

  } catch (error) {
    // El detalle (mensaje de PostgreSQL, consulta) queda en el log, no en la respuesta
    console.error('Error al obtener el reporte consolidado:', error);
    res.status(500).json({ success: false, message: 'Error interno al obtener el reporte' });
  }
};

const getPeriodosDisponiblesController = async (req, res) => {
  try {
    const { clienteId } = req.params;
    const periodos = await getPeriodosDisponibles(Number.parseInt(clienteId, 10));
    res.status(200).json({ success: true, data: periodos });
  } catch (error) {
    console.error('Error al obtener los periodos disponibles:', error);
    res.status(500).json({ success: false, message: 'Error interno al obtener los periodos disponibles' });
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

    const areaId = area_id ? Number.parseInt(area_id, 10) : null;
    const maquinaId = maquina_id ? Number.parseInt(maquina_id, 10) : null;

    const resultado = await getReporteDetallado(
      Number.parseInt(clienteId, 10),
      periodo,
      areaId,
      maquinaId
    );

    res.status(200).json({
      success: true,
      data: resultado
    });

  } catch (error) {
    console.error('Error al obtener el reporte detallado:', error);
    res.status(500).json({ success: false, message: 'Error interno al obtener el detalle' });
  }
};

module.exports = {
  getReporteConsolidadoController,
  getReporteDetalladoController,
  getPeriodosDisponiblesController,
};