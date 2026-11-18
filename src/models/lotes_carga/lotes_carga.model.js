const pool = require('@config/db');

const BASE_QUERY = `
  SELECT 
    l.*,
    e.nombre AS estado_nombre,
    e.color AS estado_color,
    e.codigo AS estado_codigo,
    c.name AS cliente_nombre,
    u.name_user AS usuario_aprobacion_nombre
  FROM lotes_carga l
  LEFT JOIN estados_lote e ON l.estado_id = e.id_estado
  LEFT JOIN cliente c ON l.cliente_id = c.idcliente
  LEFT JOIN usuario u ON l.usuario_aprobacion = u.idUsuario
  WHERE l.activo = 1
`;

const getAllLotes = async () => {
  const query = `${BASE_QUERY} ORDER BY l.fecha_carga DESC`;
  const [rows] = await pool.query(query);
  return rows;
};

const getLoteById = async (id_lote) => {
  const query = `${BASE_QUERY} AND l.id_lote = ?`;
  const [rows] = await pool.query(query, [id_lote]);
  return rows[0] || null;
};

const getLoteByCodigo = async (codigo_lote) => {
  const query = `${BASE_QUERY} AND l.codigo_lote = ?`;
  const [rows] = await pool.query(query, [codigo_lote]);
  return rows[0] || null;
};

const getLotesPendientes = async () => {
  const query = `${BASE_QUERY} AND e.codigo = 'PENDIENTE' ORDER BY l.fecha_carga DESC`;
  const [rows] = await pool.query(query);
  return rows;
};

const getLotesByEstado = async (estado_codigo) => {
  const query = `${BASE_QUERY} AND e.codigo = ? ORDER BY l.fecha_carga DESC`;
  const [rows] = await pool.query(query, [estado_codigo]);
  return rows;
};

const getLotesByCliente = async (cliente_id) => {
  const query = `${BASE_QUERY} AND l.cliente_id = ? ORDER BY l.fecha_carga DESC`;
  const [rows] = await pool.query(query, [cliente_id]);
  return rows;
};

const getLotesByPeriodo = async (periodo) => {
  const query = `${BASE_QUERY} AND l.periodo = ? ORDER BY l.fecha_carga DESC`;
  const [rows] = await pool.query(query, [periodo]);
  return rows;
};

const createLote = async (loteData) => {
  const query = `
    INSERT INTO lotes_carga (
      codigo_lote, total_registros, cliente_id, periodo, estado_id,
      usuario_carga, origen, observaciones, activo
    )
    VALUES (?, ?, ?, ?, 
      (SELECT id_estado FROM estados_lote WHERE codigo = 'PENDIENTE'),
      ?, ?, ?, 1
    )
  `;

  const values = [
    loteData.codigo_lote,
    loteData.total_registros,
    loteData.cliente_id || null,
    loteData.periodo || null,
    loteData.usuario_carga || null,
    loteData.origen || 'n8n',
    loteData.observaciones || null
  ];

  const [result] = await pool.query(query, values);
  return result.insertId;
};

const aprobarLote = async (codigo_lote, usuario_id, observaciones = null) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const [lote] = await connection.query(`
      SELECT l.*, e.codigo as estado_codigo
      FROM lotes_carga l
      LEFT JOIN estados_lote e ON l.estado_id = e.id_estado
      WHERE l.codigo_lote = ? AND l.activo = 1
    `, [codigo_lote]);

    if (lote.length === 0) {
      throw new Error('Lote no encontrado');
    }

    if (lote[0].estado_codigo !== 'PENDIENTE') {
      throw new Error(`Lote no está pendiente. Estado actual: ${lote[0].estado_codigo}`);
    }

    await connection.query(`
      UPDATE lotes_carga 
      SET estado_id = (SELECT id_estado FROM estados_lote WHERE codigo = 'PROCESANDO')
      WHERE codigo_lote = ? AND activo = 1
    `, [codigo_lote]);

    await connection.query(`
      INSERT INTO reportemes (
        modelName, ipAddress, hostName, cuentaId, cuentaNombre,
        printTotal, copyTotal, scanTotal, printFullColor, printBlackWhite,
        copyFullColor, copyBlackWhite, timeStamp, clienteIdcliente,
        periodo, totalA3, maquina_id, conteo_inicial, comentario
      )
      SELECT 
        modelName, ipAddress, hostName, cuentaId, cuentaNombre,
        printTotal, copyTotal, scanTotal, printFullColor, printBlackWhite,
        copyFullColor, copyBlackWhite, timeStamp, clienteIdcliente,
        periodo, totalA3, maquina_id, conteo_inicial, comentario
      FROM reportemes_staging
      WHERE lote_carga = ? AND activo = 1
        AND estado_id = (SELECT id_estado FROM estados_staging WHERE codigo = 'PENDIENTE')
    `, [codigo_lote]);

    await connection.query(`
      UPDATE reportemes_staging
      SET 
        estado_id = (SELECT id_estado FROM estados_staging WHERE codigo = 'APROBADO'),
        fecha_procesado = NOW(),
        usuario_aprobacion = ?,
        observaciones = ?
      WHERE lote_carga = ? AND activo = 1
    `, [usuario_id, observaciones, codigo_lote]);

    await connection.query(`
      UPDATE lotes_carga
      SET 
        estado_id = (SELECT id_estado FROM estados_lote WHERE codigo = 'APROBADO'),
        usuario_aprobacion = ?,
        fecha_aprobacion = NOW(),
        observaciones = ?
      WHERE codigo_lote = ? AND activo = 1
    `, [usuario_id, observaciones, codigo_lote]);

    await connection.commit();
    return { success: true, message: 'Lote aprobado exitosamente' };

  } catch (error) {
    await connection.rollback();
    console.error('Error en aprobarLote:', error);
    throw error;
  } finally {
    connection.release();
  }
};

const rechazarLote = async (codigo_lote, usuario_id, observaciones = null) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const [lote] = await connection.query(`
      SELECT l.*, e.codigo as estado_codigo
      FROM lotes_carga l
      LEFT JOIN estados_lote e ON l.estado_id = e.id_estado
      WHERE l.codigo_lote = ? AND l.activo = 1
    `, [codigo_lote]);

    if (lote.length === 0) {
      throw new Error('Lote no encontrado');
    }

    if (lote[0].estado_codigo !== 'PENDIENTE') {
      throw new Error(`Lote no está pendiente. Estado actual: ${lote[0].estado_codigo}`);
    }

    await connection.query(`
      UPDATE reportemes_staging
      SET 
        estado_id = (SELECT id_estado FROM estados_staging WHERE codigo = 'RECHAZADO'),
        fecha_procesado = NOW(),
        usuario_aprobacion = ?,
        observaciones = ?
      WHERE lote_carga = ? AND activo = 1
    `, [usuario_id, observaciones, codigo_lote]);

    await connection.query(`
      UPDATE lotes_carga
      SET 
        estado_id = (SELECT id_estado FROM estados_lote WHERE codigo = 'RECHAZADO'),
        usuario_aprobacion = ?,
        fecha_aprobacion = NOW(),
        observaciones = ?
      WHERE codigo_lote = ? AND activo = 1
    `, [usuario_id, observaciones, codigo_lote]);

    await connection.commit();
    return { success: true, message: 'Lote rechazado exitosamente' };

  } catch (error) {
    await connection.rollback();
    console.error('Error en rechazarLote:', error);
    throw error;
  } finally {
    connection.release();
  }
};

const getPreviewLote = async (codigo_lote) => {
  const query = `
    SELECT 
      r.*,
      e.nombre AS estado_nombre,
      c.name AS cliente_nombre
    FROM reportemes_staging r
    LEFT JOIN estados_staging e ON r.estado_id = e.id_estado
    LEFT JOIN cliente c ON r.clienteIdcliente = c.idcliente
    WHERE r.lote_carga = ? AND r.activo = 1
    ORDER BY r.fecha_carga ASC
  `;
  const [rows] = await pool.query(query, [codigo_lote]);
  return rows;
};

const deleteLote = async (codigo_lote) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    await connection.query(`
      UPDATE reportemes_staging
      SET activo = 0
      WHERE lote_carga = ?
    `, [codigo_lote]);

    const [result] = await connection.query(`
      UPDATE lotes_carga
      SET activo = 0
      WHERE codigo_lote = ?
    `, [codigo_lote]);

    await connection.query(`
      UPDATE notificaciones
      SET activo = 0
      WHERE lote_id = (SELECT id_lote FROM lotes_carga WHERE codigo_lote = ?)
    `, [codigo_lote]);

    await connection.commit();
    return result.affectedRows;

  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getEstadisticasLotes = async () => {
  const query = `
    SELECT 
      e.codigo,
      e.nombre,
      e.color,
      COUNT(l.id_lote) as total
    FROM estados_lote e
    LEFT JOIN lotes_carga l ON e.id_estado = l.estado_id AND l.activo = 1
    GROUP BY e.id_estado, e.codigo, e.nombre, e.color
    ORDER BY e.orden
  `;
  const [rows] = await pool.query(query);
  return rows;
};

module.exports = {
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
};