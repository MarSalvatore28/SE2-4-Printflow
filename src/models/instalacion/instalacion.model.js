const pool = require('../../config/db');
const { ACCIONES, leerFila, auditarFila, enTransaccion } = require('@services/auditoria');

// Error de regla de negocio: el controller responde con este status en lugar de 500.
const errorNegocio = (status, message) => Object.assign(new Error(message), { status });

/**
 * @function getInstalacionCompletaByMaquina
 * @desc     Obtiene información completa de una máquina incluyendo su instalación activa,
 * área asignada, cliente y contrato asociado. Retorna datos de modelo, formato,
 * tipo de impresión, IP, fechas de instalación y costos del contrato.
 * @param    {number} idMaquina - ID único de la máquina
 * @returns  {Promise<Object|null>} Objeto con información completa de la instalación o null si no existe
 * @throws   {Error} Si hay error en la consulta a la base de datos
 */
const getInstalacionCompletaByMaquina = async (idMaquina) => {
  const query = `
    SELECT 
      m.id_maquina,
      m.serie,
      m.activo as maquina_activa,
      mod.id_modelo,
      mod.nombre as modelo_nombre,
      tfi.id_formato,
      tfi.nombre as formato_impresion,
      ti.id_tipo_impresion,
      ti.nombre as tipo_impresion,
      
      i.id_instalacion,
      i.ip_address,
      i.fecha_instalacion,
      i.fecha_retiro,
      i.observaciones as instalacion_observaciones,
      i.contador_acumulativo,
      i.contabilidad_por_usuario,
      i.costo_renta_mensual,
      
      a.id_area,
      a.nombre as area_nombre,
      a.descripcion as area_descripcion,
      
      c.id_cliente,
      c.nombre as cliente_nombre,
      c.ruc as cliente_ruc,
      c.razon_social as cliente_razon_social,
      
      co.id_contrato,
      co.fecha_inicio as contrato_fecha_inicio,
      co.fecha_fin as contrato_fecha_fin,
      co.costo_impresion_bn,
      co.costo_impresion_color
      
    FROM maquinas m
    LEFT JOIN modelos mod ON m.modelo_id = mod.id_modelo
    LEFT JOIN tipos_formato_impresion tfi ON m.formato_impresion_id = tfi.id_formato
    LEFT JOIN tipos_impresion ti ON m.tipo_impresion_id = ti.id_tipo_impresion
    LEFT JOIN instalaciones i ON m.id_maquina = i.maquina_id 
      AND i.activo = TRUE 
      AND i.fecha_retiro IS NULL
    LEFT JOIN areas a ON i.area_id = a.id_area
    LEFT JOIN clientes c ON a.cliente_id = c.id_cliente
    LEFT JOIN contratos co ON i.contrato_id = co.id_contrato
    
    WHERE m.id_maquina = $1
  `;

  const { rows } = await pool.query(query, [idMaquina]);
  return rows[0] || null;
};

/**
 * @function getInstalacionCompletaByIP
 */
const getInstalacionCompletaByIP = async (ip_address) => {
  const query = `
    SELECT 
      m.id_maquina,
      m.serie,
      m.activo as maquina_activa,
      mod.id_modelo,
      mod.nombre as modelo_nombre,
      tfi.id_formato,
      tfi.nombre as formato_impresion,
      ti.id_tipo_impresion,
      ti.nombre as tipo_impresion,
      
      i.id_instalacion,
      i.ip_address,
      i.fecha_instalacion,
      i.fecha_retiro,
      i.observaciones as instalacion_observaciones,
      i.contador_acumulativo,
      i.contabilidad_por_usuario,
      i.costo_renta_mensual,
      
      a.id_area,
      a.nombre as area_nombre,
      a.descripcion as area_descripcion,
      
      c.id_cliente,
      c.nombre as cliente_nombre,
      c.ruc as cliente_ruc,
      c.razon_social as cliente_razon_social,
      
      co.id_contrato,
      co.fecha_inicio as contrato_fecha_inicio,
      co.fecha_fin as contrato_fecha_fin,
      co.costo_impresion_bn,
      co.costo_impresion_color
      
    FROM instalaciones i
    INNER JOIN maquinas m ON i.maquina_id = m.id_maquina
    LEFT JOIN modelos mod ON m.modelo_id = mod.id_modelo
    LEFT JOIN tipos_formato_impresion tfi ON m.formato_impresion_id = tfi.id_formato
    LEFT JOIN tipos_impresion ti ON m.tipo_impresion_id = ti.id_tipo_impresion
    LEFT JOIN areas a ON i.area_id = a.id_area
    LEFT JOIN clientes c ON a.cliente_id = c.id_cliente
    LEFT JOIN contratos co ON i.contrato_id = co.id_contrato
    
    WHERE i.ip_address = $1
      AND i.activo = TRUE 
      AND i.fecha_retiro IS NULL
  `;

  const { rows } = await pool.query(query, [ip_address]);
  return rows[0] || null;
};

/**
 * @function getInstalacionCompletaBySerie
 */
const getInstalacionCompletaBySerie = async (serie) => {
  const query = `
    SELECT 
      m.id_maquina,
      m.serie,
      m.activo as maquina_activa,
      mod.id_modelo,
      mod.nombre as modelo_nombre,
      tfi.id_formato,
      tfi.nombre as formato_impresion,
      ti.id_tipo_impresion,
      ti.nombre as tipo_impresion,
      
      i.id_instalacion,
      i.ip_address,
      i.fecha_instalacion,
      i.fecha_retiro,
      i.observaciones as instalacion_observaciones,
      i.contador_acumulativo,
      i.contabilidad_por_usuario,
      i.costo_renta_mensual,
      
      a.id_area,
      a.nombre as area_nombre,
      a.descripcion as area_descripcion,
      
      c.id_cliente,
      c.nombre as cliente_nombre,
      c.ruc as cliente_ruc,
      c.razon_social as cliente_razon_social,
      
      co.id_contrato,
      co.fecha_inicio as contrato_fecha_inicio,
      co.fecha_fin as contrato_fecha_fin,
      co.costo_impresion_bn,
      co.costo_impresion_color
      
    FROM maquinas m
    LEFT JOIN modelos mod ON m.modelo_id = mod.id_modelo
    LEFT JOIN tipos_formato_impresion tfi ON m.formato_impresion_id = tfi.id_formato
    LEFT JOIN tipos_impresion ti ON m.tipo_impresion_id = ti.id_tipo_impresion
    LEFT JOIN instalaciones i ON m.id_maquina = i.maquina_id 
      AND i.activo = TRUE 
      AND i.fecha_retiro IS NULL
    LEFT JOIN areas a ON i.area_id = a.id_area
    LEFT JOIN clientes c ON a.cliente_id = c.id_cliente
    LEFT JOIN contratos co ON i.contrato_id = co.id_contrato
    
    WHERE m.serie = $1
  `;

  const { rows } = await pool.query(query, [serie]);
  return rows[0] || null;
};

const getInstalacionesActivasByCliente = async (cliente_id) => {
  const query = `
    SELECT 
      m.id_maquina,
      m.serie,
      m.activo as maquina_activa,
      mod.nombre as modelo_nombre,
      tfi.nombre as formato_impresion,
      ti.nombre as tipo_impresion,
      
      i.id_instalacion,
      i.ip_address,
      i.fecha_instalacion,
      i.observaciones,
      i.contador_acumulativo,
      i.contabilidad_por_usuario,
      i.costo_renta_mensual,
      
      a.id_area,
      a.nombre as area_nombre,
      a.descripcion as area_descripcion,
      
      c.id_cliente,
      c.nombre as cliente_nombre,
      c.ruc as cliente_ruc,
      c.razon_social as cliente_razon_social,
      
      co.id_contrato,
      co.costo_impresion_bn,
      co.costo_impresion_color,
      co.renta_equipo
      
    FROM maquinas m
    LEFT JOIN modelos mod ON m.modelo_id = mod.id_modelo
    LEFT JOIN tipos_formato_impresion tfi ON m.formato_impresion_id = tfi.id_formato
    LEFT JOIN tipos_impresion ti ON m.tipo_impresion_id = ti.id_tipo_impresion
    INNER JOIN instalaciones i ON m.id_maquina = i.maquina_id 
      AND i.activo = TRUE 
      AND i.fecha_retiro IS NULL
    INNER JOIN areas a ON i.area_id = a.id_area
    INNER JOIN clientes c ON a.cliente_id = c.id_cliente
    INNER JOIN contratos co ON i.contrato_id = co.id_contrato
    
    WHERE a.cliente_id = $1 AND m.activo = TRUE
    ORDER BY c.nombre ASC, a.nombre ASC, mod.nombre ASC
  `;

  const { rows } = await pool.query(query, [cliente_id]);
  return rows;
};

const getTodasInstalacionesActivas = async () => {
  const query = `
    SELECT 
      m.id_maquina,
      m.serie,
      m.activo as maquina_activa,
      mod.nombre as modelo_nombre,
      tfi.nombre as formato_impresion,
      ti.nombre as tipo_impresion,
      
      i.id_instalacion,
      i.ip_address,
      i.fecha_instalacion,
      i.observaciones,
      i.contador_acumulativo,
      i.contabilidad_por_usuario,
      i.costo_renta_mensual,
      
      a.id_area,
      a.nombre as area_nombre,
      a.descripcion as area_descripcion,
      
      c.id_cliente,
      c.nombre as cliente_nombre,
      c.ruc as cliente_ruc,
      c.razon_social as cliente_razon_social,
      
      co.id_contrato,
      co.costo_impresion_bn,
      co.costo_impresion_color,
      co.renta_equipo
      
    FROM maquinas m
    LEFT JOIN modelos mod ON m.modelo_id = mod.id_modelo
    LEFT JOIN tipos_formato_impresion tfi ON m.formato_impresion_id = tfi.id_formato
    LEFT JOIN tipos_impresion ti ON m.tipo_impresion_id = ti.id_tipo_impresion
    INNER JOIN instalaciones i ON m.id_maquina = i.maquina_id 
      AND i.activo = TRUE 
      AND i.fecha_retiro IS NULL
    INNER JOIN areas a ON i.area_id = a.id_area
    INNER JOIN clientes c ON a.cliente_id = c.id_cliente
    INNER JOIN contratos co ON i.contrato_id = co.id_contrato
    
    WHERE m.activo = TRUE
    ORDER BY c.nombre ASC, a.nombre ASC, mod.nombre ASC
  `;

  const { rows } = await pool.query(query);
  return rows;
};

const getMaquinasSinInstalacion = async () => {
  const query = `
    SELECT 
      m.id_maquina,
      m.serie,
      m.activo,
      mod.nombre as modelo_nombre,
      tfi.nombre as formato_impresion,
      ti.nombre as tipo_impresion
    FROM maquinas m
    LEFT JOIN modelos mod ON m.modelo_id = mod.id_modelo
    LEFT JOIN tipos_formato_impresion tfi ON m.formato_impresion_id = tfi.id_formato
    LEFT JOIN tipos_impresion ti ON m.tipo_impresion_id = ti.id_tipo_impresion
    LEFT JOIN instalaciones i ON m.id_maquina = i.maquina_id 
      AND i.activo = TRUE 
      AND i.fecha_retiro IS NULL
    WHERE i.id_instalacion IS NULL 
      AND m.activo = TRUE
    ORDER BY mod.nombre ASC
  `;

  const { rows } = await pool.query(query);
  return rows;
};

const createInstalacion = async (
  maquina_id,
  area_id,
  contrato_id,
  ip_address,
  observaciones = null,
  fecha_instalacion = null,
  costo_renta_mensual = 0,
  contador_acumulativo = true,
  contabilidad_por_usuario = false,
  auditoria = {} // S3-02: { usuarioId, ip } de la petición
) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!ip_address || ip_address.trim() === '') {
      throw errorNegocio(400, 'La dirección IP es obligatoria');
    }

    const { rows: maquina } = await client.query(
      'SELECT id_maquina, serie FROM maquinas WHERE id_maquina = $1 AND activo = TRUE',
      [maquina_id]
    );

    if (maquina.length === 0) {
      throw errorNegocio(400, 'Máquina no encontrada o está inactiva');
    }

    const { rows: instalacionExistente } = await client.query(
      'SELECT id_instalacion FROM instalaciones WHERE maquina_id = $1 AND activo = TRUE AND fecha_retiro IS NULL',
      [maquina_id]
    );

    if (instalacionExistente.length > 0) {
      throw errorNegocio(409, 'La máquina ya tiene una asignación activa');
    }

    const { rows: area } = await client.query(
      'SELECT a.id_area, a.nombre, c.id_cliente, c.nombre as cliente_nombre FROM areas a INNER JOIN clientes c ON a.cliente_id = c.id_cliente WHERE a.id_area = $1',
      [area_id]
    );

    if (area.length === 0) {
      throw errorNegocio(400, 'Área no encontrada');
    }

    // Caja 6, mejora 3.2: el área debe ser del cliente del contrato y el contrato debe estar vigente
    const { rows: contrato } = await client.query(
      `SELECT id_contrato, cliente_id,
              COALESCE($2::date, CURRENT_DATE) BETWEEN fecha_inicio AND COALESCE(fecha_fin, 'infinity'::date) AS vigente
       FROM contratos WHERE id_contrato = $1 AND activo = TRUE`,
      [contrato_id, fecha_instalacion || null]
    );

    if (contrato.length === 0) {
      throw errorNegocio(400, 'Contrato no encontrado o inactivo');
    }
    if (contrato[0].cliente_id !== area[0].id_cliente) {
      throw errorNegocio(400, 'El área no pertenece al cliente del contrato');
    }
    if (!contrato[0].vigente) {
      throw errorNegocio(400, 'El contrato no está vigente en la fecha de instalación');
    }

    const { rows: ipCheck } = await client.query(
      `SELECT m.serie, m.id_maquina 
       FROM instalaciones i 
       INNER JOIN maquinas m ON i.maquina_id = m.id_maquina 
       WHERE i.ip_address = $1 AND i.activo = TRUE AND i.fecha_retiro IS NULL`,
      [ip_address.trim()]
    );

    if (ipCheck.length > 0) {
      throw errorNegocio(409, `La IP ${ip_address} ya está siendo usada por la máquina ${ipCheck[0].serie} (ID: ${ipCheck[0].id_maquina})`);
    }

    // INSERT ACTUALIZADO CON LOS NUEVOS CAMPOS
    const { rows: result } = await client.query(
      `INSERT INTO instalaciones 
       (maquina_id, area_id, contrato_id, ip_address, fecha_instalacion, observaciones, activo, costo_renta_mensual, contador_acumulativo, contabilidad_por_usuario) 
       VALUES ($1, $2, $3, $4, COALESCE($6, CURRENT_DATE), $5, TRUE, $7, $8, $9)
       RETURNING id_instalacion`,
      [
        maquina_id,
        area_id,
        contrato_id,
        ip_address.trim(),
        observaciones,
        fecha_instalacion,
        costo_renta_mensual || 0,
        contador_acumulativo,
        contabilidad_por_usuario
      ]
    );

    await auditarFila(client, {
      tabla: 'instalaciones', idRegistro: result[0].id_instalacion, accion: ACCIONES.CREAR, ...auditoria,
    });

    await client.query('COMMIT');

    return {
      success: true,
      id_instalacion: result[0].id_instalacion,
      maquina_serie: maquina[0].serie,
      area_nombre: area[0].nombre,
      cliente_nombre: area[0].cliente_nombre,
      ip_address: ip_address.trim()
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// auditoria (S3-02): { usuarioId, ip } de la petición
const deleteInstalacion = async (id_instalacion, observaciones_retiro = null, fecha_retiro = null, auditoria = {}) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: instalacion } = await client.query(
      `SELECT i.id_instalacion, i.fecha_instalacion, m.serie, a.nombre as area_nombre, c.nombre as cliente_nombre,
              COALESCE($2::date, CURRENT_DATE) >= i.fecha_instalacion AS fecha_valida
       FROM instalaciones i
       INNER JOIN maquinas m ON i.maquina_id = m.id_maquina
       INNER JOIN areas a ON i.area_id = a.id_area
       INNER JOIN clientes c ON a.cliente_id = c.id_cliente
       WHERE i.id_instalacion = $1 AND i.activo = TRUE AND i.fecha_retiro IS NULL`,
      [id_instalacion, fecha_retiro || null]
    );

    if (instalacion.length === 0) {
      throw errorNegocio(404, 'Instalación no encontrada o ya fue retirada');
    }
    // Caja 6, mejora 3.3: el retiro no puede ser anterior a la instalación (y no se borra el registro)
    if (!instalacion[0].fecha_valida) {
      throw errorNegocio(400, 'La fecha de retiro no puede ser anterior a la de instalación');
    }

    const observacionesFinal = observaciones_retiro || 'Retiro sin observaciones';
    const antes = await leerFila(client, 'instalaciones', id_instalacion, { bloquear: true });

    await client.query(
      `UPDATE instalaciones
       SET fecha_retiro = COALESCE($3::date, CURRENT_DATE),
           activo = FALSE,
           observaciones = COALESCE(observaciones, '') || ' | RETIRO: ' || $1
       WHERE id_instalacion = $2`,
      [observacionesFinal, id_instalacion, fecha_retiro || null]
    );

    await auditarFila(client, {
      tabla: 'instalaciones', idRegistro: id_instalacion, accion: ACCIONES.RETIRAR, antes, ...auditoria,
    });

    await client.query('COMMIT');

    return {
      success: true,
      maquina_serie: instalacion[0].serie,
      area_nombre: instalacion[0].area_nombre,
      cliente_nombre: instalacion[0].cliente_nombre
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getHistorialInstalacionesByMaquina = async (maquina_id) => {
  const query = `
    SELECT 
      i.id_instalacion,
      i.ip_address,
      i.fecha_instalacion,
      i.fecha_retiro,
      i.activo,
      i.observaciones,
      i.contador_acumulativo,
      i.contabilidad_por_usuario,
      
      a.id_area,
      a.nombre as area_nombre,
      
      c.id_cliente,
      c.nombre as cliente_nombre,
      c.ruc as cliente_ruc,
      
      co.id_contrato,
      
      COALESCE(i.fecha_retiro, CURRENT_DATE) - i.fecha_instalacion as dias_instalado
      
    FROM instalaciones i
    INNER JOIN areas a ON i.area_id = a.id_area
    INNER JOIN clientes c ON a.cliente_id = c.id_cliente
    INNER JOIN contratos co ON i.contrato_id = co.id_contrato
    
    WHERE i.maquina_id = $1
    ORDER BY i.fecha_instalacion DESC
  `;

  const { rows } = await pool.query(query, [maquina_id]);
  return rows;
};

const getResumenInstalacionesByCliente = async (cliente_id) => {
  const query = `
    SELECT 
      a.id_area,
      a.nombre as area_nombre,
      COUNT(DISTINCT i.id_instalacion) as total_instalaciones_activas,
      STRING_AGG(DISTINCT CONCAT(m.serie, ' (', i.ip_address, ')'), ', ' ORDER BY CONCAT(m.serie, ' (', i.ip_address, ')')) as maquinas_detalle
      
    FROM areas a
    LEFT JOIN instalaciones i ON a.id_area = i.area_id 
      AND i.activo = TRUE 
      AND i.fecha_retiro IS NULL
    LEFT JOIN maquinas m ON i.maquina_id = m.id_maquina
    
    WHERE a.cliente_id = $1 AND a.activo = TRUE
    GROUP BY a.id_area, a.nombre
    ORDER BY a.nombre ASC
  `;

  const { rows } = await pool.query(query, [cliente_id]);
  return rows;
};

const getInstalacionById = async (id_instalacion) => {
  const query = `
    SELECT 
      i.id_instalacion,
      i.maquina_id,
      i.area_id,
      i.contrato_id,
      i.ip_address,
      i.fecha_instalacion,
      i.fecha_retiro,
      i.activo,
      i.observaciones,
      i.contador_acumulativo,
      i.contabilidad_por_usuario,
      i.costo_renta_mensual,
      
      m.serie as maquina_serie,
      mod.nombre as modelo_nombre,
      
      a.nombre as area_nombre,
      
      c.id_cliente,
      c.nombre as cliente_nombre,
      c.ruc as cliente_ruc
      
    FROM instalaciones i
    INNER JOIN maquinas m ON i.maquina_id = m.id_maquina
    LEFT JOIN modelos mod ON m.modelo_id = mod.id_modelo
    INNER JOIN areas a ON i.area_id = a.id_area
    INNER JOIN clientes c ON a.cliente_id = c.id_cliente
    
    WHERE i.id_instalacion = $1
  `;

  const { rows } = await pool.query(query, [id_instalacion]);
  return rows[0] || null;
};

const updateIpInstalacion = async (id_instalacion, nueva_ip) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!nueva_ip || nueva_ip.trim() === '') {
      throw new Error('La IP no puede estar vacía');
    }

    const { rows: instalacion } = await client.query(
      'SELECT id_instalacion, maquina_id FROM instalaciones WHERE id_instalacion = $1 AND activo = TRUE AND fecha_retiro IS NULL',
      [id_instalacion]
    );

    if (instalacion.length === 0) {
      throw new Error('Instalación no encontrada o ya fue retirada');
    }

    const { rows: ipCheck } = await client.query(
      `SELECT m.serie, i.id_instalacion
       FROM instalaciones i 
       INNER JOIN maquinas m ON i.maquina_id = m.id_maquina 
       WHERE i.ip_address = $1
         AND i.activo = TRUE 
         AND i.fecha_retiro IS NULL
         AND i.id_instalacion != $2`,
      [nueva_ip.trim(), id_instalacion]
    );

    if (ipCheck.length > 0) {
      throw errorNegocio(409, `La IP ${nueva_ip} ya está siendo usada por otra máquina (Serie: ${ipCheck[0].serie})`);
    }

    await client.query(
      'UPDATE instalaciones SET ip_address = $1 WHERE id_instalacion = $2',
      [nueva_ip.trim(), id_instalacion]
    );

    await client.query('COMMIT');

    return {
      success: true,
      id_instalacion,
      nueva_ip: nueva_ip.trim()
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getAllAreas = async () => {
  const query = `
    SELECT 
      a.id_area,
      a.nombre as area_nombre,
      a.descripcion,
      c.id_cliente,
      c.nombre as cliente_nombre,
      c.ruc as cliente_ruc
    FROM areas a
    INNER JOIN clientes c ON a.cliente_id = c.id_cliente
    WHERE a.activo = TRUE AND c.activo = TRUE
    ORDER BY c.nombre ASC, a.nombre ASC
  `;

  const { rows } = await pool.query(query);
  return rows;
};

const getAreasByCliente = async (cliente_id) => {
  const query = `
    SELECT 
      id_area,
      nombre as area_nombre,
      descripcion,
      cliente_id
    FROM areas
    WHERE cliente_id = $1 AND activo = TRUE
    ORDER BY nombre ASC
  `;

  const { rows } = await pool.query(query, [cliente_id]);
  return rows;
};

const getContratosByCliente = async (cliente_id) => {
  const query = `
    SELECT 
      id_contrato,
      cliente_id,
      fecha_inicio,
      fecha_fin,
      costo_impresion_bn,
      costo_impresion_color,
      renta_equipo,
      software_control,
      facturacion_de_impresora
    FROM contratos
    WHERE cliente_id = $1 AND activo = TRUE
    ORDER BY fecha_inicio DESC
  `;

  const { rows } = await pool.query(query, [cliente_id]);
  return rows;
};
const updateRentaInstalacion = async (id_instalacion, costo_renta_mensual) => {
  const query = `
    UPDATE instalaciones 
    SET costo_renta_mensual = $1 
    WHERE id_instalacion = $2 AND activo = TRUE AND fecha_retiro IS NULL
    RETURNING id_instalacion, costo_renta_mensual
  `;
  const { rows } = await pool.query(query, [costo_renta_mensual || 0, id_instalacion]);
  return rows[0] || null;
};

const getRentaByCliente = async (cliente_id) => {
  const query = `
    SELECT 
      i.id_instalacion,
      i.costo_renta_mensual,
      m.serie,
      mod.nombre as modelo_nombre,
      a.nombre as area_nombre
    FROM instalaciones i
    INNER JOIN maquinas m ON i.maquina_id = m.id_maquina
    LEFT JOIN modelos mod ON m.modelo_id = mod.id_modelo
    INNER JOIN areas a ON i.area_id = a.id_area
    WHERE a.cliente_id = $1
      AND i.activo = TRUE
      AND i.fecha_retiro IS NULL
      AND i.costo_renta_mensual > 0
    ORDER BY mod.nombre ASC
  `;
  const { rows } = await pool.query(query, [cliente_id]);
  return rows;
};

const updateInstalacionCompleta = async (
  id_instalacion,
  ip_address,
  costo_renta_mensual,
  contador_acumulativo,
  contabilidad_por_usuario,
  fecha_instalacion,
  auditoria = {} // S3-02: { usuarioId, ip } de la petición
) => {
  const renta = costo_renta_mensual || 0;
  const acumulativo = contador_acumulativo !== undefined ? contador_acumulativo : true;
  const contabilidad = contabilidad_por_usuario !== undefined ? contabilidad_por_usuario : false;

  const query = `
    UPDATE instalaciones
    SET
        ip_address = $1,
        costo_renta_mensual = $2,
        contador_acumulativo = $3,
        contabilidad_por_usuario = $4,
        fecha_instalacion = COALESCE($5, fecha_instalacion)
    WHERE id_instalacion = $6 AND fecha_retiro IS NULL
    RETURNING *;
  `;

  const values = [ip_address, renta, acumulativo, contabilidad, fecha_instalacion, id_instalacion];

  // El cambio y su auditoría, en la misma transacción
  return enTransaccion(pool, async (client) => {
    const antes = await leerFila(client, 'instalaciones', id_instalacion, { bloquear: true });
    const { rows } = await client.query(query, values);

    if (rows.length === 0) {
      throw errorNegocio(404, 'Instalación no encontrada o ya está retirada.');
    }

    await auditarFila(client, {
      tabla: 'instalaciones', idRegistro: id_instalacion, accion: ACCIONES.ACTUALIZAR, antes, ...auditoria,
    });
    return rows[0];
  });
};

module.exports = {
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
  updateIpInstalacion,
  getAllAreas,
  getAreasByCliente,
  getContratosByCliente,
  updateRentaInstalacion,
  getRentaByCliente,
  updateInstalacionCompleta
};