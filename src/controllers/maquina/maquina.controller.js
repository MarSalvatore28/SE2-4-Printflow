const {
  getAllMaquinas,
  getMaquinaById,
  searchMaquinas,
  getMaquinaBySerie,
  createMaquina,
  updateMaquina,
  setActivoMaquina,
  getModelos,
  getModeloActivoById,
  getModeloByNombre,
  createModelo,
  getTiposImpresion,
  getTipoImpresionActivoById,
  getFormatosImpresion,
  getFormatoActivoById,
} = require('@models/maquina/maquina.model');

// --- Reglas de negocio ---

const PG_UNIQUE_VIOLATION = '23505';
const SERIE_MAX = 50; // maquinas.serie es varchar(50)
const MODELO_MAX = 100; // modelos.nombre es varchar(100)
const INT_MAX = 2147483647;

const MSG_SERIE_REPETIDA = 'Ya existe una máquina con esa serie';
const MSG_MODELO_REPETIDO = 'Ya existe un modelo con ese nombre';

// La serie se guarda en mayúsculas y sin espacios: así «abc 123» y «ABC123» son la misma máquina.
const normalizarSerie = (valor) => (
  typeof valor === 'string' || typeof valor === 'number'
    ? String(valor).replace(/\s+/g, '').toUpperCase()
    : ''
);

const normalizarNombreModelo = (valor) => (
  typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : ''
);

// Devuelve el entero positivo o null si el valor no es un id válido.
const parseId = (valor) => {
  if (typeof valor === 'number' && Number.isInteger(valor)) {
    return valor > 0 && valor <= INT_MAX ? valor : null;
  }
  if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) {
    const n = Number(valor.trim());
    return n > 0 && n <= INT_MAX ? n : null;
  }
  return null;
};

const errorServidor = (res, mensaje, err) => {
  console.error(`${mensaje}:`, err);
  return res.status(500).json({
    success: false,
    message: mensaje,
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
};

/**
 * Valida y normaliza el cuerpo de crear/editar máquina.
 * Devuelve { error: { status, message } } o { data }.
 */
const validarDatosMaquina = async (body) => {
  const { serie, modelo_id, tipo_impresion_id, formato_impresion_id } = body || {};

  const serieNormalizada = normalizarSerie(serie);
  if (!serieNormalizada) {
    return { error: { status: 400, message: 'La serie es obligatoria' } };
  }
  if (serieNormalizada.length > SERIE_MAX) {
    return { error: { status: 400, message: `La serie no puede tener más de ${SERIE_MAX} caracteres` } };
  }

  const modeloId = parseId(modelo_id);
  if (!modeloId || !(await getModeloActivoById(modeloId))) {
    return { error: { status: 400, message: 'Seleccione un modelo válido' } };
  }

  const tipoId = parseId(tipo_impresion_id);
  if (!tipoId || !(await getTipoImpresionActivoById(tipoId))) {
    return { error: { status: 400, message: 'Seleccione un tipo de impresión válido' } };
  }

  // El formato es opcional; si viene, debe existir.
  let formatoId = null;
  if (formato_impresion_id !== undefined && formato_impresion_id !== null && formato_impresion_id !== '') {
    formatoId = parseId(formato_impresion_id);
    if (!formatoId || !(await getFormatoActivoById(formatoId))) {
      return { error: { status: 400, message: 'Seleccione un formato de impresión válido' } };
    }
  }

  return {
    data: {
      serie: serieNormalizada,
      modelo_id: modeloId,
      tipo_impresion_id: tipoId,
      formato_impresion_id: formatoId,
    },
  };
};

// --- Máquinas ---

const fetchAllMaquinas = async (_req, res) => {
  try {
    const maquinas = await getAllMaquinas();
    res.status(200).json({ success: true, data: maquinas, count: maquinas.length });
  } catch (err) {
    errorServidor(res, 'Error al obtener las máquinas', err);
  }
};

const searchMaquinasController = async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length === 0) {
      return res.status(400).json({ success: false, message: 'Ingrese un término de búsqueda' });
    }

    const maquinas = await searchMaquinas(q);
    res.status(200).json({ success: true, data: maquinas, count: maquinas.length });
  } catch (err) {
    errorServidor(res, 'Error al buscar máquinas', err);
  }
};

const getMaquinaByIdController = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID de máquina inválido' });
    }

    const maquina = await getMaquinaById(id);
    if (!maquina) {
      return res.status(404).json({ success: false, message: 'Máquina no encontrada' });
    }

    res.status(200).json({ success: true, data: maquina });
  } catch (err) {
    errorServidor(res, 'Error al obtener la máquina', err);
  }
};

const crearMaquinaController = async (req, res) => {
  try {
    const { error, data } = await validarDatosMaquina(req.body);
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    if (await getMaquinaBySerie(data.serie)) {
      return res.status(409).json({ success: false, message: MSG_SERIE_REPETIDA });
    }

    const nuevoId = await createMaquina(data);
    const maquina = await getMaquinaById(nuevoId);

    res.status(201).json({ success: true, message: 'Máquina creada exitosamente', data: maquina });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ success: false, message: MSG_SERIE_REPETIDA });
    }
    errorServidor(res, 'Error al crear la máquina', err);
  }
};

const actualizarMaquinaController = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID de máquina inválido' });
    }

    if (!(await getMaquinaById(id))) {
      return res.status(404).json({ success: false, message: 'Máquina no encontrada' });
    }

    const { error, data } = await validarDatosMaquina(req.body);
    if (error) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    const otra = await getMaquinaBySerie(data.serie);
    if (otra && otra.id_maquina !== id) {
      return res.status(409).json({ success: false, message: MSG_SERIE_REPETIDA });
    }

    const filas = await updateMaquina(id, data);
    if (filas === 0) {
      return res.status(404).json({ success: false, message: 'Máquina no encontrada' });
    }

    const maquina = await getMaquinaById(id);
    res.status(200).json({ success: true, message: 'Máquina actualizada exitosamente', data: maquina });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ success: false, message: MSG_SERIE_REPETIDA });
    }
    errorServidor(res, 'Error al actualizar la máquina', err);
  }
};

const cambiarEstadoMaquinaController = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID de máquina inválido' });
    }

    const { activo } = req.body || {};
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ success: false, message: 'El campo activo debe ser true o false' });
    }

    const resultado = await setActivoMaquina(id, activo);
    if (resultado === 'no_existe') {
      return res.status(404).json({ success: false, message: 'Máquina no encontrada' });
    }
    if (resultado === 'asignada') {
      const maquina = await getMaquinaById(id);
      const donde = maquina && maquina.cliente_nombre
        ? ` (${maquina.cliente_nombre}${maquina.area_nombre ? ` · ${maquina.area_nombre}` : ''})`
        : '';
      return res.status(409).json({
        success: false,
        message: `No se puede desactivar: la máquina tiene una asignación vigente${donde}. Retírela primero en Asignaciones.`,
      });
    }

    const maquina = await getMaquinaById(id);
    res.status(200).json({
      success: true,
      message: activo ? 'Máquina activada exitosamente' : 'Máquina desactivada exitosamente',
      data: maquina,
    });
  } catch (err) {
    errorServidor(res, 'Error al cambiar el estado de la máquina', err);
  }
};

// --- Catálogos ---

const fetchModelosController = async (_req, res) => {
  try {
    const modelos = await getModelos();
    res.status(200).json({ success: true, data: modelos, count: modelos.length });
  } catch (err) {
    errorServidor(res, 'Error al obtener los modelos', err);
  }
};

const crearModeloController = async (req, res) => {
  try {
    const nombre = normalizarNombreModelo((req.body || {}).nombre);
    if (!nombre) {
      return res.status(400).json({ success: false, message: 'El nombre del modelo es obligatorio' });
    }
    if (nombre.length > MODELO_MAX) {
      return res.status(400).json({ success: false, message: `El nombre del modelo no puede tener más de ${MODELO_MAX} caracteres` });
    }

    if (await getModeloByNombre(nombre)) {
      return res.status(409).json({ success: false, message: MSG_MODELO_REPETIDO });
    }

    const modelo = await createModelo(nombre);
    res.status(201).json({ success: true, message: 'Modelo creado exitosamente', data: modelo });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ success: false, message: MSG_MODELO_REPETIDO });
    }
    errorServidor(res, 'Error al crear el modelo', err);
  }
};

const fetchTiposImpresionController = async (_req, res) => {
  try {
    const tipos = await getTiposImpresion();
    res.status(200).json({ success: true, data: tipos, count: tipos.length });
  } catch (err) {
    errorServidor(res, 'Error al obtener los tipos de impresión', err);
  }
};

const fetchFormatosImpresionController = async (_req, res) => {
  try {
    const formatos = await getFormatosImpresion();
    res.status(200).json({ success: true, data: formatos, count: formatos.length });
  } catch (err) {
    errorServidor(res, 'Error al obtener los formatos de impresión', err);
  }
};

module.exports = {
  fetchAllMaquinas,
  searchMaquinasController,
  getMaquinaByIdController,
  crearMaquinaController,
  actualizarMaquinaController,
  cambiarEstadoMaquinaController,
  fetchModelosController,
  crearModeloController,
  fetchTiposImpresionController,
  fetchFormatosImpresionController,
  // Para las pruebas unitarias
  normalizarSerie,
  normalizarNombreModelo,
  parseId,
};
