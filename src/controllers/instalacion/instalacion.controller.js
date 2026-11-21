const {
  getInstalacionCompletaByMaquina,
  getInstalacionCompletaByIP,
  getInstalacionCompletaBySerie,
  getInstalacionesActivasByCliente,
  getTodasInstalacionesActivas,
  getMaquinasSinInstalacion,
  createInstalacion,
  deleteInstalacion,
  getHistorialInstalacionesByMaquina,
  getResumenInstalacionesByCliente,
  getInstalacionById,
  updateInstalacionCompleta,
  getAllAreas,
  getAreasByCliente,
  getContratosByCliente,
  updateRentaInstalacion,
  getRentaByCliente
} = require('@models/instalacion/instalacion.model');
const { contextoAuditoria } = require('@services/auditoria');

const getInstalacionCompletaByMaquinaController = async (req, res) => {
  try {
    const { maquina_id } = req.params;
    const instalacion = await getInstalacionCompletaByMaquina(maquina_id);

    if (!instalacion) {
      return res.status(404).json({
        success: false,
        message: 'Máquina no encontrada o sin instalación activa'
      });
    }

    res.status(200).json({
      success: true,
      data: instalacion
    });
  } catch (err) {
    console.error('Error fetching instalación by maquina:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener información de la instalación'
    });
  }
};

const getInstalacionCompletaByIPController = async (req, res) => {
  try {
    const { ip } = req.params;
    const instalacion = await getInstalacionCompletaByIP(ip);

    if (!instalacion) {
      return res.status(404).json({
        success: false,
        message: `No se encontró instalación activa con IP "${ip}"`
      });
    }

    res.status(200).json({
      success: true,
      data: instalacion
    });
  } catch (err) {
    console.error('Error fetching instalación by IP:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener información de la instalación'
    });
  }
};


const getInstalacionCompletaBySerieController = async (req, res) => {
  try {
    const { serie } = req.params;
    const instalacion = await getInstalacionCompletaBySerie(serie);

    if (!instalacion) {
      return res.status(404).json({
        success: false,
        message: `Máquina con serie "${serie}" no encontrada o sin instalación activa`
      });
    }

    res.status(200).json({
      success: true,
      data: instalacion
    });
  } catch (err) {
    console.error('Error fetching instalación by serie:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener información de la instalación'
    });
  }
};

const getInstalacionesActivasByClienteController = async (req, res) => {
  try {
    const { cliente_id } = req.params;
    const instalaciones = await getInstalacionesActivasByCliente(cliente_id);

    res.status(200).json({
      success: true,
      total: instalaciones.length,
      data: instalaciones
    });
  } catch (err) {
    console.error('Error fetching instalaciones by cliente:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener instalaciones del cliente'
    });
  }
};

const getTodasInstalacionesActivasController = async (req, res) => {
  try {
    const instalaciones = await getTodasInstalacionesActivas();

    res.status(200).json({
      success: true,
      total: instalaciones.length,
      data: instalaciones
    });
  } catch (err) {
    console.error('Error fetching todas las instalaciones activas:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener todas las instalaciones activas'
    });
  }
};

const getMaquinasSinInstalacionController = async (req, res) => {
  try {
    const maquinas = await getMaquinasSinInstalacion();

    res.status(200).json({
      success: true,
      total: maquinas.length,
      data: maquinas
    });
  } catch (err) {
    console.error('Error fetching máquinas sin instalación:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener máquinas disponibles'
    });
  }
};

const createInstalacionController = async (req, res) => {
  try {
    const {
      maquina_id,
      area_id,
      contrato_id,
      ip_address,
      observaciones,
      fecha_instalacion,
      costo_renta_mensual,
      contador_acumulativo,
      contabilidad_por_usuario
    } = req.body;

    if (!maquina_id || !area_id || !contrato_id || !ip_address) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos obligatorios: maquina_id, area_id, contrato_id, ip_address'
      });
    }

    const resultado = await createInstalacion(
      maquina_id,
      area_id,
      contrato_id,
      ip_address,
      observaciones,
      fecha_instalacion,
      costo_renta_mensual,
      contador_acumulativo !== undefined ? contador_acumulativo : true,
      contabilidad_por_usuario !== undefined ? contabilidad_por_usuario : false,
      contextoAuditoria(req)
    );

    res.status(201).json({
      success: true,
      message: 'Instalación creada exitosamente',
      data: resultado
    });
  } catch (error) {
    // Caja 6, mejora 3.1: el índice instalaciones_una_activa_por_maquina también lo impide
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'La máquina ya tiene una asignación activa' });
    }
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('Error al crear instalación:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const deleteInstalacionController = async (req, res) => {
  try {
    const { id_instalacion } = req.params;
    const { observaciones_retiro, fecha_retiro } = req.body;

    const resultado = await deleteInstalacion(id_instalacion, observaciones_retiro, fecha_retiro, contextoAuditoria(req));

    res.status(200).json({
      success: true,
      message: 'Instalación retirada exitosamente',
      data: resultado
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('Error al retirar instalación:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getHistorialInstalacionesByMaquinaController = async (req, res) => {
  try {
    const { maquina_id } = req.params;
    const historial = await getHistorialInstalacionesByMaquina(maquina_id);

    res.status(200).json({
      success: true,
      total: historial.length,
      data: historial
    });
  } catch (err) {
    console.error('Error fetching historial instalaciones:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener historial de instalaciones'
    });
  }
};

const getResumenInstalacionesByClienteController = async (req, res) => {
  try {
    const { cliente_id } = req.params;
    const resumen = await getResumenInstalacionesByCliente(cliente_id);

    res.status(200).json({
      success: true,
      data: resumen
    });
  } catch (err) {
    console.error('Error fetching resumen instalaciones:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener resumen de instalaciones'
    });
  }
};

const getInstalacionByIdController = async (req, res) => {
  try {
    const { id_instalacion } = req.params;
    const instalacion = await getInstalacionById(id_instalacion);

    if (!instalacion) {
      return res.status(404).json({
        success: false,
        message: 'Instalación no encontrada'
      });
    }

    res.status(200).json({
      success: true,
      data: instalacion
    });
  } catch (err) {
    console.error('Error fetching instalación by ID:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener instalación'
    });
  }
};

const updateInstalacionController = async (req, res) => {
  try {
    const { id_instalacion } = req.params;

    const {
      ip_address,
      costo_renta_mensual,
      contador_acumulativo,
      contabilidad_por_usuario,
      fecha_instalacion
    } = req.body;

    if (!ip_address) {
      return res.status(400).json({
        success: false,
        message: 'La IP es obligatoria'
      });
    }

    const resultado = await updateInstalacionCompleta(
      id_instalacion,
      ip_address,
      costo_renta_mensual,
      contador_acumulativo,
      contabilidad_por_usuario,
      fecha_instalacion,
      contextoAuditoria(req)
    );

    res.status(200).json({
      success: true,
      message: 'Instalación actualizada exitosamente',
      data: resultado
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('Error al actualizar instalación:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


const getAllAreasController = async (req, res) => {
  try {
    const areas = await getAllAreas();

    res.status(200).json({
      success: true,
      total: areas.length,
      data: areas
    });
  } catch (err) {
    console.error('Error fetching todas las áreas:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener áreas'
    });
  }
};

const getAreasByClienteController = async (req, res) => {
  try {
    const { cliente_id } = req.params;
    const areas = await getAreasByCliente(cliente_id);

    res.status(200).json({
      success: true,
      total: areas.length,
      data: areas
    });
  } catch (err) {
    console.error('Error fetching áreas by cliente:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener áreas del cliente'
    });
  }
};

const getContratosByClienteController = async (req, res) => {
  try {
    const { cliente_id } = req.params;
    const contratos = await getContratosByCliente(cliente_id);

    res.status(200).json({
      success: true,
      total: contratos.length,
      data: contratos
    });
  } catch (err) {
    console.error('Error fetching contratos by cliente:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener contratos del cliente'
    });
  }
};

const updateRentaInstalacionController = async (req, res) => {
  try {
    const { id_instalacion } = req.params;
    const { costo_renta_mensual } = req.body;

    if (costo_renta_mensual === undefined || costo_renta_mensual === null) {
      return res.status(400).json({ success: false, message: 'costo_renta_mensual es requerido' });
    }

    const resultado = await updateRentaInstalacion(id_instalacion, costo_renta_mensual);

    if (!resultado) {
      return res.status(404).json({ success: false, message: 'Instalación no encontrada o ya retirada' });
    }

    res.status(200).json({ success: true, message: 'Renta actualizada exitosamente', data: resultado });
  } catch (error) {
    console.error('Error al actualizar renta:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getRentaByClienteController = async (req, res) => {
  try {
    const { cliente_id } = req.params;
    const rentas = await getRentaByCliente(cliente_id);
    const total = rentas.reduce((acc, r) => acc + parseFloat(r.costo_renta_mensual), 0);

    res.status(200).json({ success: true, total_renta: total, data: rentas });
  } catch (error) {
    console.error('Error al obtener renta:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getInstalacionCompletaByMaquinaController,
  getInstalacionCompletaByIPController,
  getInstalacionCompletaBySerieController,
  getInstalacionesActivasByClienteController,
  getTodasInstalacionesActivasController,
  getMaquinasSinInstalacionController,
  createInstalacionController,
  deleteInstalacionController,
  getHistorialInstalacionesByMaquinaController,
  getResumenInstalacionesByClienteController,
  getInstalacionByIdController,
  updateInstalacionController,
  getAllAreasController,
  getAreasByClienteController,
  getContratosByClienteController,
  updateRentaInstalacionController,
  getRentaByClienteController
};