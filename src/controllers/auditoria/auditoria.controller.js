const { validarFiltrosAuditoria, consultarAuditoria } = require('@services/auditoria');

// GET /api/auditoria?tabla=&id_registro=&limite= (S3-02). Solo admin: se exige en auditoria.routes.js.
const listarAuditoriaController = async (req, res) => {
  const { error, data } = validarFiltrosAuditoria(req.query);
  if (error) return res.status(400).json({ success: false, message: error });

  try {
    const registros = await consultarAuditoria(req.pool, data);
    res.status(200).json({ success: true, data: registros, count: registros.length, filtros: data });
  } catch (err) {
    console.error('Error al consultar la auditoría:', err);
    res.status(500).json({ success: false, message: 'Error al consultar la auditoría' });
  }
};

module.exports = { listarAuditoriaController };
