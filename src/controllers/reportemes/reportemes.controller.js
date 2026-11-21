const {
  getReporteConsolidado,
  getReporteDetallado,
  getPeriodosDisponibles,
} = require('@models/reportemes/reportemes.model');

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;
// Entero positivo que cabe en integer: un texto o un número enorme daban 500 en PostgreSQL
const ENTERO = /^[1-9]\d{0,8}$/;
const opcional = (valor) => (valor === undefined || valor === '' ? null : valor);

// Cliente, período (AAAA-MM, mes 01 a 12) y filtros opcionales de área y máquina.
// Devuelve { error } (mensaje para el 400) o { datos }.
const leerParametros = ({ clienteId, periodo }, { area_id, maquina_id } = {}) => {
  if (!ENTERO.test(String(clienteId))) return { error: 'ID de cliente inválido' };
  if (!PERIODO.test(String(periodo))) return { error: 'Formato inválido. Use YYYY-MM' };
  for (const [nombre, valor] of [['area_id', opcional(area_id)], ['maquina_id', opcional(maquina_id)]]) {
    if (valor !== null && !ENTERO.test(String(valor))) return { error: `${nombre} inválido` };
  }
  const entero = (valor) => (opcional(valor) === null ? null : Number(valor));
  return {
    datos: { clienteId: Number(clienteId), periodo, areaId: entero(area_id), maquinaId: entero(maquina_id) },
  };
};

const getReporteConsolidadoController = async (req, res) => {
  try {
    const { error, datos } = leerParametros(req.params, req.query);
    if (error) return res.status(400).json({ success: false, message: error });
    const { clienteId, periodo, areaId, maquinaId } = datos;

    const resultado = await getReporteConsolidado(clienteId, periodo, areaId, maquinaId);

    res.status(200).json({
      success: true,
      data: resultado, 
      filtros_aplicados: {
        cliente_id: clienteId,
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
    const { error, datos } = leerParametros(req.params, req.query);
    if (error) return res.status(400).json({ success: false, message: error });
    const { clienteId, periodo, areaId, maquinaId } = datos;

    const resultado = await getReporteDetallado(clienteId, periodo, areaId, maquinaId);

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