const {
  getAllAreas,
  getAreaById,
  getAreasByCliente,
  getAreasActivas,
  getAreasInactivas,
  searchAreas,
  createArea,
  updateArea,
  deleteArea,
  deleteAreaPermanente,
  activarArea,
  getAreasConContratosVigentes,
  getEstadisticasArea,
  getHistorialCambiosArea
} = require('@models/area/area.model');


const fetchAllAreas = async (req, res) => {
  try {
    const areas = await getAllAreas();
    
    res.status(200).json({
      success: true,
      data: areas,
      count: areas.length
    });
  } catch (err) {
    console.error('Error fetching areas:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener áreas',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

const getAreaByIdController = async (req, res) => {
  try {
    const { id } = req.params;
    const area = await getAreaById(id);

    if (!area) {
      return res.status(404).json({
        success: false,
        message: 'Área no encontrada'
      });
    }

    res.status(200).json({
      success: true,
      data: area
    });
  } catch (err) {
    console.error('Error fetching area by ID:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener área',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

const getAreasByClienteController = async (req, res) => {
  try {
    const { id } = req.params;
    const areas = await getAreasByCliente(id);

    res.json({
      success: true,
      data: areas,
      count: areas.length
    });
  } catch (error) {
    console.error('Error obteniendo áreas por cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener áreas del cliente',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * GET /api/areas/activas
 * Obtener todas las áreas activas
 */
const getAreasActivasController = async (req, res) => {
  try {
    const areas = await getAreasActivas();

    res.json({
      success: true,
      data: areas,
      count: areas.length
    });
  } catch (error) {
    console.error('Error obteniendo áreas activas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener áreas activas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getAreasInactivasController = async (req, res) => {
  try {
    const areas = await getAreasInactivas();

    res.json({
      success: true,
      data: areas,
      count: areas.length
    });
  } catch (error) {
    console.error('Error obteniendo áreas inactivas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener áreas inactivas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const searchAreasController = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'El término de búsqueda debe tener al menos 2 caracteres'
      });
    }

    const areas = await searchAreas(q);

    res.json({
      success: true,
      data: areas,
      count: areas.length
    });
  } catch (error) {
    console.error('Error buscando áreas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al buscar áreas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const crearAreaController = async (req, res) => {
  try {
    const { cliente_id, nombre, descripcion } = req.body;

    if (!cliente_id || !nombre) {
      return res.status(400).json({
        success: false,
        message: 'Cliente y nombre son obligatorios'
      });
    }

    const nuevoId = await createArea({ cliente_id, nombre, descripcion });

    res.status(201).json({
      success: true,
      message: 'Área creada exitosamente',
      data: { id_area: nuevoId }
    });
  } catch (error) {
    console.error('Error al crear área:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear área',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const actualizarAreaController = async (req, res) => {
  try {
    const { id } = req.params;
    const { cliente_id, nombre, descripcion, activo } = req.body;

    if (!cliente_id || !nombre) {
      return res.status(400).json({
        success: false,
        message: 'Cliente y nombre son obligatorios'
      });
    }

    const affectedRows = await updateArea(id, { 
      cliente_id, 
      nombre, 
      descripcion, 
      activo 
    });

    if (affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Área no encontrada'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Área actualizada exitosamente'
    });
  } catch (error) {
    console.error('Error al actualizar área:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar área',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const eliminarAreaController = async (req, res) => {
  try {
    const { id } = req.params;
    const affectedRows = await deleteArea(id);

    if (affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Área no encontrada'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Área desactivada exitosamente'
    });
  } catch (error) {
    console.error('Error al desactivar área:', error);
    res.status(500).json({
      success: false,
      message: 'Error al desactivar área',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const eliminarAreaPermanenteController = async (req, res) => {
  try {
    const { id } = req.params;
    const affectedRows = await deleteAreaPermanente(id);

    if (affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Área no encontrada'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Área eliminada permanentemente'
    });
  } catch (error) {
    console.error('Error al eliminar área permanentemente:', error);
    
    if (error.message.includes('instalaciones asociadas')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error al eliminar área',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const activarAreaController = async (req, res) => {
  try {
    const { id } = req.params;
    const affectedRows = await activarArea(id);

    if (affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Área no encontrada'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Área activada exitosamente'
    });
  } catch (error) {
    console.error('Error al activar área:', error);
    res.status(500).json({
      success: false,
      message: 'Error al activar área',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getAreasVigentesController = async (req, res) => {
  try {
    const areas = await getAreasConContratosVigentes();

    res.json({
      success: true,
      data: areas,
      count: areas.length
    });
  } catch (error) {
    console.error('Error obteniendo áreas vigentes:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener áreas con contratos vigentes',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getEstadisticasAreaController = async (req, res) => {
  try {
    const { id } = req.params;
    const estadisticas = await getEstadisticasArea(id);

    if (!estadisticas) {
      return res.status(404).json({
        success: false,
        message: 'Área no encontrada'
      });
    }

    res.json({
      success: true,
      data: estadisticas
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas de área:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener estadísticas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getHistorialCambiosAreaController = async (req, res) => {
  try {
    const { id } = req.params;
    const historial = await getHistorialCambiosArea(id);

    res.json({
      success: true,
      data: historial,
      count: historial.length
    });
  } catch (error) {
    console.error('Error obteniendo historial de cambios:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener historial de cambios',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


module.exports = {
  fetchAllAreas,
  getAreaByIdController,
  getAreasByClienteController,
  getAreasActivasController,
  getAreasInactivasController,
  searchAreasController,
  crearAreaController,
  actualizarAreaController,
  eliminarAreaController,
  eliminarAreaPermanenteController,
  activarAreaController,
  
  getAreasVigentesController,
  getEstadisticasAreaController,
  getHistorialCambiosAreaController
};