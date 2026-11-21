const {
  getAllClientesConDatos,
  getClientesInactivos,
  getClienteById,
  getClienteCompleto,
  getClienteByRuc,
  searchClientes,
  createCliente,
  updateCliente,
  deleteCliente,
  activarCliente, 

  getContratosByCliente,
  getAllContratos,
  getContratoById,
  createContrato,
  updateContrato,
  desactivarContrato,

  getInstalacionesByCliente,
  getHistorialCliente,
  tieneHistorial,
  getUltimoCambioCliente,
  getClientesConHistorialBatch,
  getContratoSuperpuesto

} = require('@models/cliente/cliente.model');
const { ACCIONES, leerFila, auditarFila, contextoAuditoria, enTransaccion } = require('@services/auditoria');
const { parseId } = require('@utils/usuarios.validacion');
const { validarContrato, contratoComoCuerpo, avisoSuperposicion } = require('@utils/contratos.validacion');
const { validarCliente } = require('@utils/clientes.validacion');

// --- Reglas de negocio (caja 5, mejoras 3.1 y 3.3) ---

const PG_UNIQUE_VIOLATION = '23505';

const advertenciaSuperposicion = async (clienteId, datos, excluirId = null) => {
  const otro = await getContratoSuperpuesto(clienteId, datos.fecha_inicio, datos.fecha_fin, excluirId);
  return avisoSuperposicion(otro);
};

const fetchAllClientes = async (req, res) => {
  try {
    const clientes = await getAllClientesConDatos();

    res.status(200).json({
      success: true,
      data: clientes,
      count: clientes.length
    });
  } catch (err) {
    console.error('Error fetching clientes:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener clientes',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

const getClientesInactivosController = async (req, res) => {
  try {
    const clientes = await getClientesInactivos();

    res.status(200).json({
      success: true,
      data: clientes,
      count: clientes.length
    });
  } catch (err) {
    console.error('Error fetching clientes inactivos:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener clientes inactivos',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

const getClienteByIdController = async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await getClienteById(id);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    res.status(200).json({
      success: true,
      data: cliente
    });
  } catch (err) {
    console.error('Error fetching cliente by ID:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener cliente',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

const getClienteCompletoController = async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await getClienteCompleto(id);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    res.status(200).json({
      success: true,
      data: cliente
    });
  } catch (err) {
    console.error('Error fetching cliente completo:', err);
    res.status(500).json({
      success: false,
      message: 'Error al obtener datos completos del cliente',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

const getClienteByRucController = async (req, res) => {
  try {
    const { ruc } = req.params;
    const cliente = await getClienteByRuc(ruc);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado con ese RUC'
      });
    }

    res.status(200).json({
      success: true,
      data: cliente
    });
  } catch (err) {
    console.error('Error fetching cliente by RUC:', err);
    res.status(500).json({
      success: false,
      message: 'Error al buscar cliente por RUC',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

const searchClientesController = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'El término de búsqueda debe tener al menos 2 caracteres'
      });
    }

    const clientes = await searchClientes(q);

    res.json({
      success: true,
      data: clientes,
      count: clientes.length
    });
  } catch (error) {
    console.error('Error buscando clientes:', error);
    res.status(500).json({
      success: false,
      message: 'Error al buscar clientes',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const crearClienteController = async (req, res) => {
  try {
    const { error, datos } = validarCliente(req.body, { esCreacion: true });
    if (error) return res.status(400).json({ success: false, message: error });

    const clienteExistente = await getClienteByRuc(datos.ruc);
    if (clienteExistente) {
      return res.status(409).json({
        success: false,
        message: 'Ya existe un cliente con ese RUC'
      });
    }

    const nuevoId = await createCliente(datos);

    res.status(201).json({
      success: true,
      message: 'Cliente creado exitosamente',
      data: { id_cliente: nuevoId }
    });
  } catch (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ success: false, message: 'Ya existe un cliente con ese RUC' });
    }
    console.error('Error al crear cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear cliente',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Edita nombre, RUC y razón social. El estado (activo) cambia solo con DELETE y PATCH /:id/activar,
// que hacen la cascada sobre contratos, áreas y asignaciones.
const actualizarClienteController = async (req, res) => {
  try {
    const { id } = req.params;
    const { error, datos } = validarCliente(req.body, { esCreacion: false });
    if (error) return res.status(400).json({ success: false, message: error });

    if (datos.ruc) {
      const conEseRuc = await getClienteByRuc(datos.ruc);
      if (conEseRuc && Number(conEseRuc.id_cliente) !== Number(id)) {
        return res.status(409).json({ success: false, message: 'Ya existe un cliente con ese RUC' });
      }
    }

    const affectedRows = await updateCliente(id, datos);

    if (affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Cliente actualizado exitosamente'
    });
  } catch (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ success: false, message: 'Ya existe un cliente con ese RUC' });
    }
    console.error('Error al actualizar cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar cliente',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const eliminarClienteController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await getClienteById(id))) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }
    const affectedRows = await deleteCliente(id, contextoAuditoria(req), req.pool);

    if (affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Cliente desactivado exitosamente'
    });
  } catch (error) {
    console.error('Error al desactivar cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al desactivar cliente',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const activarClienteController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await getClienteById(id))) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }
    const affectedRows = await activarCliente(id, contextoAuditoria(req), req.pool);

    if (affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Cliente activado exitosamente'
    });
  } catch (error) {
    console.error('Error al activar cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al activar cliente',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const fetchAllContratos = async (req, res) => {
  try {
    const contratos = await getAllContratos();

    res.json({
      success: true,
      data: contratos,
      count: contratos.length
    });
  } catch (error) {
    console.error('Error obteniendo todos los contratos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener contratos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getContratosController = async (req, res) => {
  try {
    const { id } = req.params;
    const contratos = await getContratosByCliente(id);

    res.json({
      success: true,
      data: contratos,
      count: contratos.length
    });
  } catch (error) {
    console.error('Error obteniendo contratos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener contratos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getContratoByIdController = async (req, res) => {
  try {
    const { id } = req.params;
    const contrato = await getContratoById(id);

    if (!contrato) {
      return res.status(404).json({
        success: false,
        message: 'Contrato no encontrado'
      });
    }

    res.json({
      success: true,
      data: contrato
    });
  } catch (error) {
    console.error('Error obteniendo contrato:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener contrato',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const crearContratoController = async (req, res) => {
  try {
    const clienteId = parseId(req.params.id);
    if (!clienteId) return res.status(400).json({ success: false, message: 'Seleccione un cliente válido' });

    const { error, datos } = validarContrato(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const cliente = await getClienteById(clienteId);
    if (!cliente) return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    if (!cliente.activo) {
      return res.status(409).json({ success: false, message: 'El cliente está inactivo: actívelo antes de asignarle un contrato' });
    }

    const contratoData = { ...datos, cliente_id: clienteId };
    const advertencia = await advertenciaSuperposicion(clienteId, contratoData);
    // S3-02: el alta y su auditoría van en la misma transacción
    const nuevoId = await enTransaccion(req.pool, async (db) => {
      const id = await createContrato(contratoData, db);
      await auditarFila(db, { tabla: 'contratos', idRegistro: id, accion: ACCIONES.CREAR, ...contextoAuditoria(req) });
      return id;
    });

    res.status(201).json({
      success: true,
      message: 'Contrato creado exitosamente',
      advertencia,
      data: { id_contrato: nuevoId }
    });
  } catch (error) {
    console.error('Error al crear contrato:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear contrato',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const actualizarContratoController = async (req, res) => {
  try {
    const { id } = req.params;

    const actual = await getContratoById(id);
    if (!actual) {
      return res.status(404).json({ success: false, message: 'Contrato no encontrado' });
    }

    // Lo que no viene en la petición conserva el valor guardado
    const { error, datos: contratoData } = validarContrato(req.body, contratoComoCuerpo(actual));
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const advertencia = await advertenciaSuperposicion(actual.cliente_id, contratoData, Number(id));
    const affectedRows = await enTransaccion(req.pool, async (db) => {
      const antes = await leerFila(db, 'contratos', id, { bloquear: true });
      const filas = await updateContrato(id, contratoData, db);
      if (filas > 0) {
        await auditarFila(db, { tabla: 'contratos', idRegistro: id, accion: ACCIONES.ACTUALIZAR, antes, ...contextoAuditoria(req) });
      }
      return filas;
    });

    if (affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contrato no encontrado'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Contrato actualizado exitosamente',
      advertencia
    });
  } catch (error) {
    console.error('Error al actualizar contrato:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar contrato',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const desactivarContratoController = async (req, res) => {
  try {
    const { id } = req.params;
    const affectedRows = await enTransaccion(req.pool, async (db) => {
      const antes = await leerFila(db, 'contratos', id, { bloquear: true });
      const filas = await desactivarContrato(id, db);
      if (filas > 0) {
        await auditarFila(db, { tabla: 'contratos', idRegistro: id, accion: ACCIONES.DESACTIVAR, antes, ...contextoAuditoria(req) });
      }
      return filas;
    });

    if (affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contrato no encontrado'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Contrato desactivado exitosamente'
    });
  } catch (error) {
    console.error('Error al desactivar contrato:', error);
    res.status(500).json({
      success: false,
      message: 'Error al desactivar contrato',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getInstalacionesController = async (req, res) => {
  try {
    const { id } = req.params;
    const instalaciones = await getInstalacionesByCliente(id);

    res.json({
      success: true,
      data: instalaciones,
      count: instalaciones.length
    });
  } catch (error) {
    console.error('Error obteniendo instalaciones:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener instalaciones',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getHistorialClienteController = async (req, res) => {
  try {
    const { id } = req.params;
    
    const historial = await getHistorialCliente(id);

    res.json({
      success: true,
      data: historial,
      count: historial.length
    });
  } catch (error) {
    console.error('Error al obtener historial del cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener historial del cliente',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
const tieneHistorialController = async (req, res) => {
  try {
    const { id } = req.params;
    
    const tiene = await tieneHistorial(id);

    res.json({
      success: true,
      tiene_historial: tiene
    });
  } catch (error) {
    console.error('Error al verificar historial del cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al verificar historial del cliente',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
const getUltimoCambioController = async (req, res) => {
  try {
    const { id } = req.params;
    
    const ultimoCambio = await getUltimoCambioCliente(id);

    if (!ultimoCambio) {
      return res.json({
        success: true,
        data: null,
        message: 'Este cliente no tiene historial de cambios'
      });
    }

    res.json({
      success: true,
      data: ultimoCambio
    });
  } catch (error) {
    console.error('Error al obtener último cambio:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener último cambio',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
const getHistorialBatchController = async (req, res) => {
  try {
    const { cliente_ids } = req.body;

    if (!Array.isArray(cliente_ids) || cliente_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere un array de cliente_ids'
      });
    }

    if (cliente_ids.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Máximo 50 clientes por petición'
      });
    }

    const resultado = await getClientesConHistorialBatch(cliente_ids);

    res.json({
      success: true,
      data: resultado
    });
  } catch (error) {
    console.error('Error al obtener historial batch:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener historial batch',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
module.exports = {
  fetchAllClientes,
  getClientesInactivosController,
  getClienteByIdController,
  getClienteCompletoController,
  getClienteByRucController,
  searchClientesController,
  crearClienteController,
  actualizarClienteController,
  eliminarClienteController,
  activarClienteController,

  fetchAllContratos,
  getContratosController,
  getContratoByIdController,
  crearContratoController,
  actualizarContratoController,
  desactivarContratoController,

  getInstalacionesController,
  
  getHistorialClienteController,
  tieneHistorialController,
  getUltimoCambioController,
  getHistorialBatchController
};