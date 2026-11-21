const { parseId } = require('@utils/maquinasCambio.reglas');
const { reprocesarReporte } = require('@models/reproceso/reproceso.model');
const { contextoAuditoria } = require('@services/auditoria');

// POST /api/staging/:id/reprocesar (S3-05)
const reprocesarReporteController = async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID de reporte inválido' });

  try {
    const resultado = await reprocesarReporte(req.pool, id, contextoAuditoria(req));
    res.status(200).json({
      success: true,
      message: resultado.corregido
        ? `Reporte corregido (intento ${resultado.intentos_texto}): ya no bloquea el lote`
        : `El reporte sigue en error (intento ${resultado.intentos_texto}): ${resultado.motivo}`,
      data: resultado,
    });
  } catch (err) {
    if (err.esNegocio) {
      return res.status(err.status).json({
        success: false,
        message: err.message,
        ...(err.intentos !== undefined ? { data: { intentos: err.intentos, max_intentos: err.max_intentos } } : {}),
      });
    }
    console.error('Error al reprocesar el reporte:', err);
    res.status(500).json({ success: false, message: 'Error al reprocesar el reporte' });
  }
};

module.exports = { reprocesarReporteController };
