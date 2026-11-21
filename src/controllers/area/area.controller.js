const {
  getAllAreas,
  getAreaById,
  getAreasByCliente,
  getAreasActivas,
  getAreasInactivas,
  searchAreas,
  createArea,
  updateArea,
  getAreaParaCambio,
  getAreaConMismoNombre,
  deleteArea,
  deleteAreaPermanente,
  activarArea,
  getAreasConContratosVigentes,
  getEstadisticasArea,
  getHistorialCambiosArea
} = require('@models/area/area.model');
const { getClienteById } = require('@models/cliente/cliente.model');
const { validarArea } = require('@utils/areas.validacion');

const PG_FOREIGN_KEY_VIOLATION = '23503';

// Mensaje si el cliente ya tiene un área con ese nombre, o null
const nombreRepetido = async (clienteId, nombre, excluirId = null) => {
  const otra = await getAreaConMismoNombre(clienteId, nombre, excluirId);
  if (!otra) return null;
  return otra.activo
    ? `El cliente ya tiene un área llamada «${otra.nombre}»`
    : `El cliente ya tiene un área inactiva llamada «${otra.nombre}»: actívela en lugar de crear otra`;
};

// Mensaje si el cliente no existe o está inactivo (para crear o mover un área), o null
const problemaCliente = async (clienteId) => {
  const cliente = await getClienteById(clienteId);
  if (!cliente) return { estado: 404, mensaje: 'Cliente no encontrado' };
  if (!cliente.activo) return { estado: 409, mensaje: 'El cliente está inactivo: actívelo antes de agregarle áreas' };
  return null;
};


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
    const { error, datos } = validarArea(req.body, { esCreacion: true });
    if (error) return res.status(400).json({ success: false, message: error });

    const problema = await problemaCliente(datos.cliente_id);
    if (problema) return res.status(problema.estado).json({ success: false, message: problema.mensaje });

    const repetido = await nombreRepetido(datos.cliente_id, datos.nombre);
    if (repetido) return res.status(409).json({ success: false, message: repetido });

    const nuevoId = await createArea(datos);

    res.status(201).json({
      success: true,
      message: 'Área creada exitosamente',
      data: { id_area: nuevoId }
    });
  } catch (error) {
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }
    console.error('Error al crear área:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear área',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Edita nombre, descripción o cliente. Lo que no viene conserva su valor; el estado (activo)
// cambia solo con DELETE y PATCH /:id/activar.
const actualizarAreaController = async (req, res) => {
  try {
    const { id } = req.params;
    const { error, datos } = validarArea(req.body, { esCreacion: false });
    if (error) return res.status(400).json({ success: false, message: error });

    const area = await getAreaParaCambio(id);
    if (!area) return res.status(404).json({ success: false, message: 'Área no encontrada' });

    const cambiaCliente = datos.cliente_id !== undefined && Number(datos.cliente_id) !== Number(area.cliente_id);
    if (cambiaCliente) {
      // Sus asignaciones (y sus lecturas) quedarían en el cliente equivocado
      if (area.instalaciones_totales > 0) {
        return res.status(409).json({
          success: false,
          message: 'No se puede cambiar el cliente de un área que ya tiene máquinas asignadas (vigentes o retiradas)'
        });
      }
      const problema = await problemaCliente(datos.cliente_id);
      if (problema) return res.status(problema.estado).json({ success: false, message: problema.mensaje });
    }

    const clienteFinal = cambiaCliente ? datos.cliente_id : area.cliente_id;
    const repetido = await nombreRepetido(clienteFinal, datos.nombre ?? area.nombre, Number(id));
    if (repetido) return res.status(409).json({ success: false, message: repetido });

    const affectedRows = await updateArea(id, datos);

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
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }
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
    const area = await getAreaParaCambio(id);
    if (!area) return res.status(404).json({ success: false, message: 'Área no encontrada' });

    // Una máquina asignada a un área inactiva seguiría recibiendo lecturas sin que el área aparezca
    if (area.instalaciones_activas > 0) {
      const una = area.instalaciones_activas === 1;
      const maquinas = una ? '1 máquina asignada' : `${area.instalaciones_activas} máquinas asignadas`;
      const accion = una ? 'retírela o muévala' : 'retírelas o muévalas';
      return res.status(409).json({
        success: false,
        message: `El área «${area.nombre}» tiene ${maquinas}: ${accion} en Asignaciones antes de desactivarla`
      });
    }

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
    const area = await getAreaParaCambio(id);
    if (!area) return res.status(404).json({ success: false, message: 'Área no encontrada' });
    if (area.cliente_activo === false) {
      return res.status(409).json({ success: false, message: 'El cliente del área está inactivo: actívelo primero' });
    }
    const otra = await getAreaConMismoNombre(area.cliente_id, area.nombre, Number(id));
    if (otra?.activo) {
      return res.status(409).json({ success: false, message: `El cliente ya tiene un área activa llamada «${otra.nombre}»` });
    }

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
    if (!/^\d+$/.test(id) || Number(id) <= 0) {
      return res.status(400).json({ success: false, message: 'ID de área inválido' });
    }
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
    if (!/^\d+$/.test(id) || Number(id) <= 0) {
      return res.status(400).json({ success: false, message: 'ID de área inválido' });
    }
    if (!(await getAreaById(id))) {
      return res.status(404).json({ success: false, message: 'Área no encontrada' });
    }
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