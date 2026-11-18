const pool = require('@config/db');

/**
 * Obtener todas las áreas
 */
const getAllAreas = async () => {
  const query = `
    SELECT 
      a.id_area,
      a.nombre,
      a.descripcion,
      a.activo,
      c.id_cliente,
      c.nombre AS cliente_nombre,
      c.ruc AS cliente_ruc,
      -- Contar instalaciones activas en esta área
      (
        SELECT COUNT(*)
        FROM instalaciones i
        WHERE i.area_id = a.id_area 
          AND i.activo = TRUE 
          AND i.fecha_retiro IS NULL
      ) AS total_instalaciones_activas
    FROM areas a
    LEFT JOIN clientes c ON a.cliente_id = c.id_cliente
    ORDER BY c.nombre, a.nombre ASC
  `;
  
  const { rows } = await pool.query(query);
  return rows;
};

/**
 * Obtener área por ID
 */
const getAreaById = async (id_area) => {
  const query = `
    SELECT 
      a.id_area,
      a.nombre,
      a.descripcion,
      a.activo,
      c.id_cliente,
      c.nombre AS cliente_nombre,
      c.ruc AS cliente_ruc,
      c.razon_social AS cliente_razon_social,
      -- Instalaciones activas
      (
        SELECT json_agg(
          json_build_object(
            'id_instalacion', i.id_instalacion,
            'maquina_serie', m.serie,
            'maquina_modelo', mo.nombre,
            'ip_address', i.ip_address,
            'ubicacion_fisica', NULL, -- la columna no existe en el esquema; se mantiene la clave para el frontend
            'fecha_instalacion', i.fecha_instalacion
          )
        )
        FROM instalaciones i
        INNER JOIN maquinas m ON i.maquina_id = m.id_maquina
        INNER JOIN modelos mo ON m.modelo_id = mo.id_modelo
        WHERE i.area_id = a.id_area 
          AND i.activo = TRUE 
          AND i.fecha_retiro IS NULL
      ) AS instalaciones_activas
    FROM areas a
    LEFT JOIN clientes c ON a.cliente_id = c.id_cliente
    WHERE a.id_area = $1
  `;
  
  const { rows } = await pool.query(query, [id_area]);
  return rows[0] || null;
};

/**
 * Obtener áreas de un cliente específico
 */
const getAreasByCliente = async (cliente_id) => {
  const query = `
    SELECT 
      a.id_area,
      a.nombre,
      a.descripcion,
      a.activo,
      -- Contar instalaciones activas
      (
        SELECT COUNT(*)
        FROM instalaciones i
        WHERE i.area_id = a.id_area 
          AND i.activo = TRUE 
          AND i.fecha_retiro IS NULL
      ) AS total_instalaciones_activas
    FROM areas a
    WHERE a.cliente_id = $1 
      AND a.activo = TRUE
    ORDER BY a.nombre ASC
  `;
  
  const { rows } = await pool.query(query, [cliente_id]);
  return rows;
};

/**
 * Obtener todas las áreas activas
 */
const getAreasActivas = async () => {
  const query = `
    SELECT 
      a.id_area,
      a.nombre,
      a.descripcion,
      a.activo,
      c.id_cliente,
      c.nombre AS cliente_nombre,
      c.ruc AS cliente_ruc,
      (
        SELECT COUNT(*)
        FROM instalaciones i
        WHERE i.area_id = a.id_area 
          AND i.activo = TRUE 
          AND i.fecha_retiro IS NULL
      ) AS total_instalaciones_activas
    FROM areas a
    LEFT JOIN clientes c ON a.cliente_id = c.id_cliente
    WHERE a.activo = TRUE
    ORDER BY c.nombre, a.nombre ASC
  `;
  
  const { rows } = await pool.query(query);
  return rows;
};

/**
 * Obtener todas las áreas inactivas
 */
const getAreasInactivas = async () => {
  const query = `
    SELECT 
      a.id_area,
      a.nombre,
      a.descripcion,
      a.activo,
      c.id_cliente,
      c.nombre AS cliente_nombre,
      c.ruc AS cliente_ruc,
      (
        SELECT COUNT(*)
        FROM instalaciones i
        WHERE i.area_id = a.id_area
      ) AS total_instalaciones_historicas
    FROM areas a
    LEFT JOIN clientes c ON a.cliente_id = c.id_cliente
    WHERE a.activo = FALSE
    ORDER BY c.nombre, a.nombre ASC
  `;
  
  const { rows } = await pool.query(query);
  return rows;
};

/**
 * Buscar áreas por nombre o descripción
 */
const searchAreas = async (termino) => {
  const query = `
    SELECT 
      a.id_area,
      a.nombre,
      a.descripcion,
      a.activo,
      c.id_cliente,
      c.nombre AS cliente_nombre,
      c.ruc AS cliente_ruc,
      (
        SELECT COUNT(*)
        FROM instalaciones i
        WHERE i.area_id = a.id_area 
          AND i.activo = TRUE 
          AND i.fecha_retiro IS NULL
      ) AS total_instalaciones_activas
    FROM areas a
    LEFT JOIN clientes c ON a.cliente_id = c.id_cliente
    WHERE (
      a.nombre ILIKE $1 
      OR a.descripcion ILIKE $1
      OR c.nombre ILIKE $1
    )
    AND a.activo = TRUE
    ORDER BY c.nombre, a.nombre ASC
    LIMIT 100
  `;
  
  const { rows } = await pool.query(query, [`%${termino}%`]);
  return rows;
};

/**
 * Crear nueva área
 */
const createArea = async (areaData) => {
  const { cliente_id, nombre, descripcion } = areaData;
  
  const query = `
    INSERT INTO areas (cliente_id, nombre, descripcion, activo)
    VALUES ($1, $2, $3, TRUE)
    RETURNING id_area
  `;
  
  const { rows } = await pool.query(query, [
    cliente_id,
    nombre,
    descripcion || null
  ]);
  
  return rows[0].id_area;
};

/**
 * Actualizar área
 */
const updateArea = async (id_area, areaData) => {
  const { cliente_id, nombre, descripcion, activo } = areaData;
  
  const query = `
    UPDATE areas
    SET cliente_id = $1,
        nombre = $2,
        descripcion = $3,
        activo = $4
    WHERE id_area = $5
  `;
  
  const { rowCount } = await pool.query(query, [
    cliente_id,
    nombre,
    descripcion,
    activo,
    id_area
  ]);
  
  return rowCount;
};

/**
 * Desactivar área (soft delete)
 */
const deleteArea = async (id_area) => {
  const query = `
    UPDATE areas
    SET activo = FALSE
    WHERE id_area = $1
  `;
  
  const { rowCount } = await pool.query(query, [id_area]);
  return rowCount;
};

/**
 * Eliminar área permanentemente
 * NOTA: Solo si no tiene instalaciones asociadas
 */
const deleteAreaPermanente = async (id_area) => {
  const checkQuery = `
    SELECT COUNT(*) as total
    FROM instalaciones
    WHERE area_id = $1
  `;
  
  const { rows: checkRows } = await pool.query(checkQuery, [id_area]);
  
  if (parseInt(checkRows[0].total) > 0) {
    throw new Error('No se puede eliminar el área porque tiene instalaciones asociadas');
  }
  
  const deleteQuery = `
    DELETE FROM areas
    WHERE id_area = $1
  `;
  
  const { rowCount } = await pool.query(deleteQuery, [id_area]);
  return rowCount;
};

/**
 * Activar área
 */
const activarArea = async (id_area) => {
  const query = `
    UPDATE areas
    SET activo = TRUE
    WHERE id_area = $1
  `;
  
  const { rowCount } = await pool.query(query, [id_area]);
  return rowCount;
};

/**
 * Obtener áreas con contratos vigentes
 */
const getAreasConContratosVigentes = async () => {
  const query = `
    SELECT DISTINCT
      a.id_area,
      a.nombre,
      a.descripcion,
      c.nombre AS cliente_nombre,
      COUNT(DISTINCT con.id_contrato) AS total_contratos,
      COUNT(DISTINCT i.id_instalacion) AS total_instalaciones
    FROM areas a
    INNER JOIN clientes c ON a.cliente_id = c.id_cliente
    LEFT JOIN instalaciones i ON a.id_area = i.area_id AND i.activo = TRUE
    LEFT JOIN contratos con ON i.contrato_id = con.id_contrato
    WHERE a.activo = TRUE
      AND con.activo = TRUE
      AND (con.fecha_fin IS NULL OR con.fecha_fin >= CURRENT_DATE)
    GROUP BY a.id_area, a.nombre, a.descripcion, c.nombre
    ORDER BY c.nombre, a.nombre
  `;
  
  const { rows } = await pool.query(query);
  return rows;
};

/**
 * Obtener estadísticas de un área
 */
const getEstadisticasArea = async (id_area) => {
  const query = `
    SELECT 
      a.id_area,
      a.nombre AS area_nombre,
      c.nombre AS cliente_nombre,
      -- Total de instalaciones
      (
        SELECT COUNT(*)
        FROM instalaciones i
        WHERE i.area_id = a.id_area
      ) AS total_instalaciones_historicas,
      -- Instalaciones activas
      (
        SELECT COUNT(*)
        FROM instalaciones i
        WHERE i.area_id = a.id_area 
          AND i.activo = TRUE 
          AND i.fecha_retiro IS NULL
      ) AS instalaciones_activas,
      -- Instalaciones retiradas
      (
        SELECT COUNT(*)
        FROM instalaciones i
        WHERE i.area_id = a.id_area 
          AND i.fecha_retiro IS NOT NULL
      ) AS instalaciones_retiradas,
      -- Cambios de máquina
      (
        SELECT COUNT(DISTINCT hc.id_cambio)
        FROM historial_cambios hc
        INNER JOIN historial_ubicaciones hu ON hc.id_cambio = hu.cambio_id
        WHERE hu.area_id = a.id_area
      ) AS total_cambios_maquina
    FROM areas a
    LEFT JOIN clientes c ON a.cliente_id = c.id_cliente
    WHERE a.id_area = $1
  `;
  
  const { rows } = await pool.query(query, [id_area]);
  return rows[0] || null;
};

/**
 * Obtener historial de cambios de máquinas en un área
 */
const getHistorialCambiosArea = async (id_area) => {
  const query = `
    SELECT 
      hc.id_cambio,
      hf.fecha_cambio_completa,
      hf.periodo_afectado,
      hm.maquina_saliente_id,
      ms.serie AS maquina_saliente_serie,
      hm.maquina_entrante_id,
      me.serie AS maquina_entrante_serie,
      hc.motivo_cambio,
      u.nombre AS usuario_nombre
    FROM historial_cambios hc
    INNER JOIN historial_ubicaciones hu ON hc.id_cambio = hu.cambio_id
    INNER JOIN historial_fechas hf ON hc.id_cambio = hf.cambio_id
    LEFT JOIN historial_maquinas hm ON hc.id_cambio = hm.cambio_id
    LEFT JOIN maquinas ms ON hm.maquina_saliente_id = ms.id_maquina
    LEFT JOIN maquinas me ON hm.maquina_entrante_id = me.id_maquina
    LEFT JOIN usuarios u ON hc.usuario_id = u.id_usuario
    WHERE hu.area_id = $1
    ORDER BY hf.fecha_cambio_completa DESC
  `;
  
  const { rows } = await pool.query(query, [id_area]);
  return rows;
};


module.exports = {
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
};