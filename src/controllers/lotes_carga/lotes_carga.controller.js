const {
  getAllLotes,
  getLoteById,
  getLoteByCodigo,
  getLotesPendientes,
  getLotesByEstado,
  getLotesByCliente,
  getLotesByPeriodo,
  createLote,
  aprobarLote,
  rechazarLote,
  getPreviewLote,
  deleteLote,
  getEstadisticasLotes
} = require('@models/lotes_carga/lotes_carga.model');

const fetchAllLotes = async (req, res) => {
  try {
    const lotes = await getAllLotes();
    res.status(200).json({ success: true, data: lotes });
  } catch (err) {
    console.error('Error fetching lotes:', err);
    res.status(500).json({ success: false, message: 'Error al obtener lotes' });
  }
};

const getLoteByIdController = async (req, res) => {
  try {
    const { id } = req.params;
    const lote = await getLoteById(id);
    if (!lote) {
      return res.status(404).json({ success: false, message: 'Lote no encontrado' });
    }
    res.status(200).json({ success: true, data: lote });
  } catch (err) {
    console.error('Error getting lote by ID:', err);
    res.status(500).json({ success: false, message: 'Error al obtener lote' });
  }
};

const getLoteByCodigoController = async (req, res) => {
  try {
    const { codigo } = req.params;
    const lote = await getLoteByCodigo(codigo);
    if (!lote) {
      return res.status(404).json({ success: false, message: 'Lote no encontrado' });
    }
    res.status(200).json({ success: true, data: lote });
  } catch (err) {
    console.error('Error getting lote by codigo:', err);
    res.status(500).json({ success: false, message: 'Error al obtener lote' });
  }
};

const getLotesPendientesController = async (req, res) => {
  try {
    const lotes = await getLotesPendientes();
    res.status(200).json({ success: true, data: lotes });
  } catch (err) {
    console.error('Error getting lotes pendientes:', err);
    res.status(500).json({ success: false, message: 'Error al obtener lotes pendientes' });
  }
};

const getLotesByEstadoController = async (req, res) => {
  try {
    const { estado } = req.params;
    const lotes = await getLotesByEstado(estado.toUpperCase());
    res.status(200).json({ success: true, data: lotes });
  } catch (err) {
    console.error('Error getting lotes by estado:', err);
    res.status(500).json({ success: false, message: 'Error al obtener lotes por estado' });
  }
};

const getLotesByClienteController = async (req, res) => {
  try {
    const { clienteId } = req.params;
    const lotes = await getLotesByCliente(clienteId);
    res.status(200).json({ success: true, data: lotes });
  } catch (err) {
    console.error('Error getting lotes by cliente:', err);
    res.status(500).json({ success: false, message: 'Error al obtener lotes por cliente' });
  }
};

const getLotesByPeriodoController = async (req, res) => {
  try {
    const { periodo } = req.params;
    const lotes = await getLotesByPeriodo(periodo);
    res.status(200).json({ success: true, data: lotes });
  } catch (err) {
    console.error('Error getting lotes by periodo:', err);
    res.status(500).json({ success: false, message: 'Error al obtener lotes por periodo' });
  }
};

const createLoteController = async (req, res) => {
  try {
    const { codigo_lote, total_registros, cliente_id, periodo, usuario_carga, origen, observaciones } = req.body;

    if (!codigo_lote || !total_registros) {
      return res.status(400).json({ 
        success: false, 
        message: 'Faltan campos requeridos: codigo_lote y total_registros' 
      });
    }

    const nuevoId = await createLote({
      codigo_lote,
      total_registros,
      cliente_id,
      periodo,
      usuario_carga,
      origen,
      observaciones
    });

    res.status(201).json({ 
      success: true, 
      message: 'Lote creado exitosamente', 
      data: { id_lote: nuevoId, codigo_lote } 
    });
  } catch (err) {
    console.error('Error creating lote:', err);
    
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ 
        success: false, 
        message: 'El código de lote ya existe' 
      });
    }
    
    res.status(500).json({ success: false, message: 'Error al crear lote' });
  }
};

const aprobarLoteController = async (req, res) => {
  try {
    const { codigo } = req.params;
    const { usuario_id, observaciones } = req.body;

    if (!usuario_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Se requiere usuario_id' 
      });
    }

    const result = await aprobarLote(codigo, usuario_id, observaciones);
    
    res.status(200).json({ 
      success: true, 
      message: result.message,
      data: { codigo_lote: codigo }
    });
  } catch (err) {
    console.error('Error aprobando lote:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message || 'Error al aprobar lote' 
    });
  }
};

const rechazarLoteController = async (req, res) => {
  try {
    const { codigo } = req.params;
    const { usuario_id, observaciones } = req.body;

    if (!usuario_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Se requiere usuario_id' 
      });
    }

    const result = await rechazarLote(codigo, usuario_id, observaciones);
    
    res.status(200).json({ 
      success: true, 
      message: result.message,
      data: { codigo_lote: codigo }
    });
  } catch (err) {
    console.error('Error rechazando lote:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message || 'Error al rechazar lote' 
    });
  }
};

const getPreviewLoteController = async (req, res) => {
  try {
    const { codigo } = req.params;
    
    const lote = await getLoteByCodigo(codigo);
    if (!lote) {
      return res.status(404).json({ 
        success: false, 
        message: 'Lote no encontrado' 
      });
    }

    const reportes = await getPreviewLote(codigo);
    
    res.status(200).json({ 
      success: true, 
      data: {
        lote: lote,
        reportes: reportes,
        total_reportes: reportes.length
      }
    });
  } catch (err) {
    console.error('Error getting preview:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener preview del lote' 
    });
  }
};

const deleteLoteController = async (req, res) => {
  try {
    const { codigo } = req.params;
    
    const affected = await deleteLote(codigo);
    
    if (affected === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Lote no encontrado' 
      });
    }
    
    res.status(200).json({ 
      success: true, 
      message: 'Lote eliminado exitosamente' 
    });
  } catch (err) {
    console.error('Error deleting lote:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Error al eliminar lote' 
    });
  }
};

const getEstadisticasLotesController = async (req, res) => {
  try {
    const stats = await getEstadisticasLotes();
    res.status(200).json({ success: true, data: stats });
  } catch (err) {
    console.error('Error getting estadísticas:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener estadísticas' 
    });
  }
};

module.exports = {
  fetchAllLotes,
  getLoteByIdController,
  getLoteByCodigoController,
  getLotesPendientesController,
  getLotesByEstadoController,
  getLotesByClienteController,
  getLotesByPeriodoController,
  createLoteController,
  aprobarLoteController,
  rechazarLoteController,
  getPreviewLoteController,
  deleteLoteController,
  getEstadisticasLotesController
};