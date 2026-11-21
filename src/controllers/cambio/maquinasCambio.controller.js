const {
  registrarReemplazo,
  anularReemplazo,
  listarReemplazos,
  getReemplazoById,
  ultimaLecturaAntesDe,
  existeMaquina,
} = require('@models/cambio/maquinasCambio.model');
const {
  TIPOS_CAMBIO,
  parseId,
  validarDatosReemplazo,
  validarFiltrosListado,
  validarDatosAnulacion,
} = require('@utils/maquinasCambio.reglas');
const { contextoAuditoria } = require('@services/auditoria');

const PERIODO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

const errorServidor = (res, mensaje, err) => {
  console.error(`${mensaje}:`, err);
  return res.status(500).json({
    success: false,
    message: mensaje,
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
};

const registrarReemplazoController = async (req, res) => {
  try {
    const { error, data } = validarDatosReemplazo(req.body);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const id = await registrarReemplazo(data, contextoAuditoria(req));
    const reemplazo = await getReemplazoById(id);
    res.status(201).json({
      success: true,
      message: `Reemplazo registrado: ${reemplazo.saliente_serie} sale y ${reemplazo.entrante_serie} queda asignada en ${reemplazo.area_nombre}`,
      data: reemplazo,
    });
  } catch (err) {
    if (err.esNegocio) return res.status(err.status).json({ success: false, message: err.message });
    errorServidor(res, 'Error al registrar el reemplazo', err);
  }
};

// POST /api/maquinas-cambio/:id/anular (solo admin)
const anularReemplazoController = async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID de reemplazo inválido' });
  const { error, data } = validarDatosAnulacion(req.body);
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  try {
    await anularReemplazo(req.pool, id, { motivo: data.motivo, ...contextoAuditoria(req) });
    const reemplazo = await getReemplazoById(id, req.pool);
    res.status(200).json({
      success: true,
      message: `Reemplazo anulado: ${reemplazo.saliente_serie} vuelve a quedar asignada en ${reemplazo.area_nombre} y ${reemplazo.entrante_serie} queda libre`,
      data: reemplazo,
    });
  } catch (err) {
    if (err.esNegocio) return res.status(err.status).json({ success: false, message: err.message });
    errorServidor(res, 'Error al anular el reemplazo', err);
  }
};

const listarReemplazosController = async (req, res) => {
  try {
    const { error, data } = validarFiltrosListado(req.query);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const reemplazos = await listarReemplazos(data);
    res.status(200).json({ success: true, data: reemplazos, count: reemplazos.length });
  } catch (err) {
    errorServidor(res, 'Error al obtener los reemplazos', err);
  }
};

const getReemplazoController = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID de reemplazo inválido' });

    const reemplazo = await getReemplazoById(id);
    if (!reemplazo) return res.status(404).json({ success: false, message: 'Reemplazo no encontrado' });

    res.status(200).json({ success: true, data: reemplazo });
  } catch (err) {
    errorServidor(res, 'Error al obtener el reemplazo', err);
  }
};

// Última lectura aprobada de una máquina antes de un período: ayuda a llenar los contadores
const ultimaLecturaController = async (req, res) => {
  try {
    const maquinaId = parseId(req.params.maquinaId);
    if (!maquinaId) return res.status(400).json({ success: false, message: 'ID de máquina inválido' });
    const periodo = typeof req.query.periodo === 'string' ? req.query.periodo.trim() : '';
    if (!PERIODO_REGEX.test(periodo)) {
      return res.status(400).json({ success: false, message: 'El período debe tener el formato AAAA-MM' });
    }
    if (!(await existeMaquina(maquinaId))) {
      return res.status(404).json({ success: false, message: 'Máquina no encontrada' });
    }

    const lectura = await ultimaLecturaAntesDe(maquinaId, periodo);
    res.status(200).json({ success: true, data: lectura });
  } catch (err) {
    errorServidor(res, 'Error al obtener la última lectura', err);
  }
};

const tiposCambioController = (_req, res) => {
  res.status(200).json({ success: true, data: TIPOS_CAMBIO });
};

module.exports = {
  registrarReemplazoController,
  anularReemplazoController,
  listarReemplazosController,
  getReemplazoController,
  ultimaLecturaController,
  tiposCambioController,
};
