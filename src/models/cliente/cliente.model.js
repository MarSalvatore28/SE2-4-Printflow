const pool = require('@config/db');
const { ACCIONES, leerFila, auditarFila } = require('@services/auditoria');

const getAllClientesConDatos = async () => {
  const query = `
    SELECT 
      c.id_cliente,
      c.nombre,
      c.ruc,
      c.razon_social,
      c.activo,
      
      con.id_contrato, 
      
      con.impresiones_bn_incluidas,
      con.impresiones_color_incluidas,
      con.costo_impresion_bn,
      con.costo_impresion_color,
      con.costo_x_excedente_impresion_bn,
      con.costo_x_excedente_impresion_color,
      
      COUNT(DISTINCT i.id_instalacion) AS total_instalaciones,
      
      COALESCE(con.renta_equipo, false) AS tiene_renta,
      COALESCE(con.software_control, false) AS tiene_software_control,
      
      COALESCE(con.facturacion_de_impresora, 'Diferenciar B/N de Color') AS printer_bill
      
    FROM clientes c
    LEFT JOIN contratos con ON c.id_cliente = con.cliente_id 
      AND con.activo = TRUE
      AND (con.fecha_fin IS NULL OR con.fecha_fin >= CURRENT_DATE)
    LEFT JOIN instalaciones i ON con.id_contrato = i.contrato_id 
      AND i.activo = TRUE 
      AND i.fecha_retiro IS NULL
    WHERE c.activo = TRUE
    GROUP BY 
      c.id_cliente, 
      c.nombre, 
      c.ruc, 
      c.razon_social, 
      c.activo,
      con.id_contrato,                 
      con.impresiones_bn_incluidas,
      con.impresiones_color_incluidas,
      con.costo_impresion_bn,
      con.costo_impresion_color,
      con.costo_x_excedente_impresion_bn,
      con.costo_x_excedente_impresion_color,
      con.renta_equipo,
      con.software_control,
      con.facturacion_de_impresora
    ORDER BY c.nombre ASC
  `;

  const { rows } = await pool.query(query);
  return rows;
};

const getClientesInactivos = async () => {
  const query = `
    SELECT 
      c.id_cliente,
      c.nombre,
      c.ruc,
      c.razon_social,
      c.activo,
      
      con.id_contrato, 
      
      con.impresiones_bn_incluidas,
      con.impresiones_color_incluidas,
      con.costo_impresion_bn,
      con.costo_impresion_color,
      con.costo_x_excedente_impresion_bn,
      con.costo_x_excedente_impresion_color,
      
      0 AS total_instalaciones,
      
      COALESCE(con.renta_equipo, false) AS tiene_renta,
      COALESCE(con.software_control, false) AS tiene_software_control,
      
      COALESCE(con.facturacion_de_impresora, 'Diferenciar B/N de Color') AS printer_bill
      
    FROM clientes c
    LEFT JOIN LATERAL (
        SELECT * FROM contratos c2 
        WHERE c2.cliente_id = c.id_cliente 
        ORDER BY c2.fecha_inicio DESC 
        LIMIT 1
    ) con ON true
    WHERE c.activo = FALSE
    ORDER BY c.nombre ASC
  `;

  const { rows } = await pool.query(query);
  return rows;
};


const getClienteByIdConDatos = async (id) => {
  const query = `
    SELECT 
      c.id_cliente,
      c.nombre,
      c.ruc,
      c.razon_social,
      c.activo,
      
      -- Contrato activo
      con.id_contrato,
      con.costo_impresion_bn,
      con.costo_impresion_color,
      con.costo_x_excedente_impresion_bn,
      con.costo_x_excedente_impresion_color,
      
      -- Instalaciones
      (
        SELECT COUNT(*)
        FROM instalaciones i2
        INNER JOIN contratos con2 ON i2.contrato_id = con2.id_contrato
        WHERE con2.cliente_id = c.id_cliente
          AND i2.activo = TRUE
          AND i2.fecha_retiro IS NULL
      ) AS total_instalaciones
      
    FROM clientes c
    LEFT JOIN contratos con ON c.id_cliente = con.cliente_id 
      AND con.activo = TRUE
      AND (con.fecha_fin IS NULL OR con.fecha_fin >= CURRENT_DATE)
    WHERE c.id_cliente = $1
  `;

  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
};

const getClienteById = async (id) => {
  const query = `
    SELECT 
      id_cliente,
      nombre,
      ruc,
      razon_social,
      activo
    FROM clientes
    WHERE id_cliente = $1
  `;

  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
};

const getClienteCompleto = async (id) => {
  const query = `
    SELECT 
      c.id_cliente,
      c.nombre,
      c.ruc,
      c.razon_social,
      c.activo,
      
      -- Contratos (Traemos todos, incluyendo el que se desactivó)
      (
        SELECT json_agg(
          json_build_object(
            'id_contrato', con.id_contrato,
            'fecha_inicio', con.fecha_inicio,
            'fecha_fin', con.fecha_fin,
            'impresiones_bn_incluidas', con.impresiones_bn_incluidas,
            'impresiones_color_incluidas', con.impresiones_color_incluidas,
            'costo_impresion_bn', con.costo_impresion_bn,
            'costo_impresion_color', con.costo_impresion_color,
            'costo_excedente_impresion_bn', con.costo_x_excedente_impresion_bn,
            'costo_excedente_impresion_color', con.costo_x_excedente_impresion_color,
            'renta_equipo', con.renta_equipo,
            'software_control', con.software_control,
            'facturacion_de_impresora', con.facturacion_de_impresora,
            'tiene_renta', con.renta_equipo,
            'tiene_software_control', con.software_control,
            'printer_bill', con.facturacion_de_impresora,
            'activo', con.activo
          ) ORDER BY con.fecha_inicio DESC
        )
        FROM contratos con
        WHERE con.cliente_id = c.id_cliente
      ) AS contratos,
      
      -- Áreas (También traemos todas para historial)
      (
        SELECT json_agg(
          json_build_object(
            'id_area', a.id_area,
            'nombre', a.nombre,
            'descripcion', a.descripcion,
            'activo', a.activo
          ) ORDER BY a.nombre ASC
        )
        FROM areas a
        WHERE a.cliente_id = c.id_cliente
      ) AS areas,
      
      -- Instalaciones activas
      (
        SELECT json_agg(
          json_build_object(
            'id_instalacion', i.id_instalacion,
            'maquina_serie', m.serie,
            'maquina_modelo', mo.nombre,
            'area_nombre', a.nombre,
            'ip_address', i.ip_address,
            'fecha_instalacion', i.fecha_instalacion,
            'observaciones', i.observaciones
          )
        )
        FROM instalaciones i
        INNER JOIN maquinas m ON i.maquina_id = m.id_maquina
        INNER JOIN modelos mo ON m.modelo_id = mo.id_modelo
        INNER JOIN areas a ON i.area_id = a.id_area
        INNER JOIN contratos con ON i.contrato_id = con.id_contrato
        WHERE con.cliente_id = c.id_cliente 
          AND i.activo = TRUE 
          AND i.fecha_retiro IS NULL
      ) AS instalaciones_activas
      
    FROM clientes c
    WHERE c.id_cliente = $1
  `;

  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
};

const getClienteByRuc = async (ruc) => {
  const query = `
    SELECT 
      id_cliente,
      nombre,
      ruc,
      razon_social,
      activo
    FROM clientes
    WHERE ruc = $1
  `;

  const { rows } = await pool.query(query, [ruc]);
  return rows[0] || null;
};

const searchClientes = async (searchTerm) => {
  const query = `
    SELECT 
      id_cliente,
      nombre,
      ruc,
      razon_social,
      activo
    FROM clientes
    WHERE activo = TRUE
      AND (
        nombre ILIKE $1
        OR ruc ILIKE $1
        OR razon_social ILIKE $1
      )
    ORDER BY nombre ASC
    LIMIT 20
  `;

  const { rows } = await pool.query(query, [`%${searchTerm}%`]);
  return rows;
};

const createCliente = async (clienteData) => {
  const { nombre, ruc, razon_social } = clienteData;

  const query = `
    INSERT INTO clientes (nombre, ruc, razon_social, activo)
    VALUES ($1, $2, $3, TRUE)
    RETURNING id_cliente
  `;

  const { rows } = await pool.query(query, [nombre, ruc, razon_social || nombre]);
  return rows[0].id_cliente;
};

const updateCliente = async (id, clienteData) => {
  const { nombre, ruc, razon_social, activo } = clienteData;

  const updates = [];
  const values = [];
  let paramCounter = 1;

  if (nombre !== undefined) {
    updates.push(`nombre = $${paramCounter++}`);
    values.push(nombre);
  }
  if (ruc !== undefined) {
    updates.push(`ruc = $${paramCounter++}`);
    values.push(ruc);
  }
  if (razon_social !== undefined) {
    updates.push(`razon_social = $${paramCounter++}`);
    values.push(razon_social);
  }
  if (activo !== undefined) {
    updates.push(`activo = $${paramCounter++}`);
    values.push(activo);
  }

  if (updates.length === 0) {
    return 0;
  }

  values.push(id);

  const query = `
    UPDATE clientes
    SET ${updates.join(', ')}
    WHERE id_cliente = $${paramCounter}
  `;

  const { rowCount } = await pool.query(query, values);
  return rowCount;
};

// Ids de las filas que la cascada va a cambiar, bloqueadas hasta el fin de la transacción
const idsBloqueados = async (client, sql, id) => {
  const { rows } = await client.query(sql, [id]);
  return rows.map((r) => r.id);
};

// Cómo estaban esas filas antes del cambio (S3-02)
const filasAntes = async (client, tabla, ids) => {
  const antes = new Map();
  for (const idFila of ids) antes.set(idFila, await leerFila(client, tabla, idFila)); // NOSONAR: en orden, misma transacción y mismo client
  return antes;
};

// Registra en la auditoría cada fila que cambió la cascada, con su antes y su después
const auditarCascada = async (client, tabla, antes, accion, auditoria) => {
  for (const [idFila, fila] of antes) {
    await auditarFila(client, { tabla, idRegistro: idFila, accion, antes: fila, ...auditoria }); // NOSONAR: en orden, misma transacción
  }
};

/**
 * Desactiva el cliente en cascada: retira sus asignaciones vigentes y desactiva sus áreas y
 * contratos, en una transacción. Las asignaciones retiradas (RETIRAR) y los contratos
 * desactivados (DESACTIVAR) quedan en la auditoría (S3-02) con `auditoria` = { usuarioId, ip }.
 *   db   pool de pg (por defecto el de la app)
 */
const deleteCliente = async (id, auditoria = {}, db = pool) => {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const instalaciones = await idsBloqueados(client, `
      SELECT id_instalacion AS id FROM instalaciones
      WHERE activo = TRUE
        AND area_id IN (SELECT id_area FROM areas WHERE cliente_id = $1)
      ORDER BY id_instalacion
      FOR UPDATE`, id);
    const contratos = await idsBloqueados(client, `
      SELECT id_contrato AS id FROM contratos
      WHERE cliente_id = $1 AND activo = TRUE
      ORDER BY id_contrato
      FOR UPDATE`, id);
    const instalacionesAntes = await filasAntes(client, 'instalaciones', instalaciones);
    const contratosAntes = await filasAntes(client, 'contratos', contratos);

    await client.query(`UPDATE clientes SET activo = FALSE WHERE id_cliente = $1`, [id]);

    const queryInstalaciones = `
      UPDATE instalaciones
      SET activo = FALSE,
          fecha_retiro = CURRENT_DATE,
          observaciones = COALESCE(observaciones, '') || ' | RETIRO AUTOMÁTICO POR BAJA DE CLIENTE'
      WHERE activo = TRUE
        AND area_id IN (SELECT id_area FROM areas WHERE cliente_id = $1)
    `;
    await client.query(queryInstalaciones, [id]);

    await client.query(`UPDATE areas SET activo = FALSE WHERE cliente_id = $1`, [id]);

    await client.query(`UPDATE contratos SET activo = FALSE WHERE cliente_id = $1`, [id]);

    await auditarCascada(client, 'instalaciones', instalacionesAntes, ACCIONES.RETIRAR, auditoria);
    await auditarCascada(client, 'contratos', contratosAntes, ACCIONES.DESACTIVAR, auditoria);

    await client.query('COMMIT');
    return 1;

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error desactivando el cliente en cascada: ", error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Reactiva el cliente con sus áreas y contratos, en una transacción. Los contratos que vuelven a
 * estar activos quedan en la auditoría (ACTIVAR, S3-02). Las asignaciones retiradas no vuelven.
 */
const activarCliente = async (id, auditoria = {}, db = pool) => {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const contratos = await idsBloqueados(client, `
      SELECT id_contrato AS id FROM contratos
      WHERE cliente_id = $1 AND activo IS DISTINCT FROM TRUE
      ORDER BY id_contrato
      FOR UPDATE`, id);
    const contratosAntes = await filasAntes(client, 'contratos', contratos);

    await client.query(`UPDATE clientes SET activo = TRUE WHERE id_cliente = $1`, [id]);
    await client.query(`UPDATE areas SET activo = TRUE WHERE cliente_id = $1`, [id]);
    await client.query(`UPDATE contratos SET activo = TRUE WHERE cliente_id = $1`, [id]);

    await auditarCascada(client, 'contratos', contratosAntes, ACCIONES.ACTIVAR, auditoria);

    await client.query('COMMIT');
    return 1;

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error al reactivar el cliente: ", error);
    throw error;
  } finally {
    client.release();
  }
};

const getContratosByCliente = async (clienteId) => {
  const query = `
    SELECT 
      id_contrato,
      fecha_inicio,
      fecha_fin,
      impresiones_bn_incluidas,
      impresiones_color_incluidas,
      costo_impresion_bn,
      costo_impresion_color,
      costo_x_excedente_impresion_bn AS costo_excedente_impresion_bn,
      costo_x_excedente_impresion_color AS costo_excedente_impresion_color,
      renta_equipo,
      renta_equipo as tiene_renta,
      software_control,
      software_control as tiene_software_control,
      facturacion_de_impresora,
      facturacion_de_impresora as printer_bill,
      activo,
      fecha_creacion
    FROM contratos
    WHERE cliente_id = $1
    ORDER BY fecha_inicio DESC
  `;

  const { rows } = await pool.query(query, [clienteId]);
  return rows;
};

const getAllContratos = async () => {
  const query = `
    SELECT 
      c.id_contrato,
      c.fecha_inicio,
      c.fecha_fin,
      c.renta_equipo,
      c.software_control,
      c.facturacion_de_impresora,
      c.activo,
      c.fecha_creacion,
      cl.id_cliente,
      cl.nombre AS cliente_nombre,
      cl.ruc AS cliente_ruc
    FROM contratos c
    INNER JOIN clientes cl ON c.cliente_id = cl.id_cliente
    ORDER BY c.fecha_inicio DESC
  `;

  const { rows } = await pool.query(query);
  return rows;
};

const getContratoById = async (contratoId) => {
  const query = `
    SELECT 
      c.*,
      cl.nombre AS cliente_nombre,
      cl.ruc AS cliente_ruc
    FROM contratos c
    INNER JOIN clientes cl ON c.cliente_id = cl.id_cliente
    WHERE c.id_contrato = $1
  `;

  const { rows } = await pool.query(query, [contratoId]);
  return rows[0] || null;
};

// Otro contrato ACTIVO del mismo cliente cuyas fechas se cruzan (fecha_fin NULL = sin fin).
const getContratoSuperpuesto = async (clienteId, fechaInicio, fechaFin, excluirId = null) => {
  const query = `
    SELECT id_contrato
    FROM contratos
    WHERE cliente_id = $1
      AND activo = true
      AND ($4::int IS NULL OR id_contrato <> $4::int)
      AND fecha_inicio <= COALESCE($3::date, 'infinity'::date)
      AND COALESCE(fecha_fin, 'infinity'::date) >= $2::date
    ORDER BY id_contrato
    LIMIT 1
  `;

  const { rows } = await pool.query(query, [clienteId, fechaInicio, fechaFin || null, excluirId]);
  return rows[0] || null;
};

// Alta, cambio y baja de contratos: `db` es el client de la transacción del que llama (S3-02: el
// controlador guarda el cambio y su auditoría juntos). Sin él, usan el pool.
const createContrato = async (contratoData, db = pool) => {
  const {
    cliente_id,
    fecha_inicio,
    fecha_fin,
    impresiones_bn_incluidas = 0,
    impresiones_color_incluidas = 0,
    costo_impresion_bn = 0,
    costo_impresion_color = 0,
    costo_excedente_impresion_bn = 0,
    costo_excedente_impresion_color = 0,
    renta_equipo,
    tiene_renta,
    software_control,
    tiene_software_control,
    facturacion_de_impresora,
    printer_bill
  } = contratoData;

  const valRenta = renta_equipo !== undefined ? renta_equipo : (tiene_renta || false);
  const valSoftware = software_control !== undefined ? software_control : (tiene_software_control || false);
  const valFacturacion = facturacion_de_impresora || printer_bill || 'Diferenciar B/N de Color';

  const query = `
    INSERT INTO contratos (
      cliente_id, fecha_inicio, fecha_fin,
      impresiones_bn_incluidas, impresiones_color_incluidas,
      costo_impresion_bn, costo_impresion_color,
      costo_x_excedente_impresion_bn, costo_x_excedente_impresion_color,
      renta_equipo, software_control, facturacion_de_impresora,
      activo
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 0.0), COALESCE($9, 0.0), $10, $11, $12, TRUE)
    RETURNING id_contrato
  `;

  const { rows } = await db.query(query, [
    cliente_id, fecha_inicio, fecha_fin,
    impresiones_bn_incluidas, impresiones_color_incluidas,
    costo_impresion_bn, costo_impresion_color,
    costo_excedente_impresion_bn,
    costo_excedente_impresion_color,
    valRenta,
    valSoftware,
    valFacturacion
  ]);

  return rows[0].id_contrato;
};

const updateContrato = async (contratoId, contratoData, db = pool) => {
  const {
    fecha_inicio,
    fecha_fin,
    impresiones_bn_incluidas,
    impresiones_color_incluidas,
    costo_impresion_bn,
    costo_impresion_color,
    costo_excedente_impresion_bn = 0,
    costo_excedente_impresion_color = 0,
    renta_equipo,
    tiene_renta,
    software_control,
    tiene_software_control,
    facturacion_de_impresora,
    printer_bill
  } = contratoData;

  const valRenta = renta_equipo !== undefined ? renta_equipo : (tiene_renta || false);
  const valSoftware = software_control !== undefined ? software_control : (tiene_software_control || false);
  const valFacturacion = facturacion_de_impresora || printer_bill || 'Diferenciar B/N de Color';

  const query = `
    UPDATE contratos
    SET fecha_inicio = $1,
        fecha_fin = $2,
        impresiones_bn_incluidas = $3,
        impresiones_color_incluidas = $4,
        costo_impresion_bn = $5,
        costo_impresion_color = $6,
        costo_x_excedente_impresion_bn = COALESCE($7, 0.0),
        costo_x_excedente_impresion_color = COALESCE($8, 0.0),
        renta_equipo = $9,
        software_control = $10,
        facturacion_de_impresora = $11
    WHERE id_contrato = $12
  `;

  const { rowCount } = await db.query(query, [
    fecha_inicio, fecha_fin,
    impresiones_bn_incluidas, impresiones_color_incluidas,
    costo_impresion_bn, costo_impresion_color,
    costo_excedente_impresion_bn,
    costo_excedente_impresion_color,
    valRenta,
    valSoftware,
    valFacturacion,
    contratoId
  ]);

  return rowCount;
};

const desactivarContrato = async (contratoId, db = pool) => {
  const query = `
    UPDATE contratos
    SET activo = FALSE
    WHERE id_contrato = $1
  `;

  const { rowCount } = await db.query(query, [contratoId]);
  return rowCount;
};

const getInstalacionesByCliente = async (clienteId) => {
  const query = `
    SELECT 
      i.id_instalacion,
      i.ip_address,
      i.fecha_instalacion,
      i.fecha_retiro,
      i.observaciones,
      i.activo,
      m.serie AS maquina_serie,
      mo.nombre AS maquina_modelo,
      a.nombre AS area_nombre,
      con.id_contrato
    FROM instalaciones i
    INNER JOIN maquinas m ON i.maquina_id = m.id_maquina
    INNER JOIN modelos mo ON m.modelo_id = mo.id_modelo
    INNER JOIN areas a ON i.area_id = a.id_area
    INNER JOIN contratos con ON i.contrato_id = con.id_contrato
    WHERE con.cliente_id = $1
      AND i.activo = TRUE
      AND i.fecha_retiro IS NULL
    ORDER BY i.fecha_instalacion DESC
  `;

  const { rows } = await pool.query(query, [clienteId]);
  return rows;
};

const getHistorialCliente = async (clienteId) => {
  const query = `
    SELECT 
      ch.id_historial,
      ch.nombre_anterior,
      ch.razon_social_anterior,
      ch.ruc_anterior,
      ch.fecha_cambio,
      c.nombre as nombre_actual,
      c.razon_social as razon_social_actual,
      c.ruc as ruc_actual,
      -- Detectar qué campos cambiaron
      CASE 
        WHEN ch.nombre_anterior != c.nombre THEN true 
        ELSE false 
      END as cambio_nombre,
      CASE 
        WHEN COALESCE(ch.razon_social_anterior, '') != COALESCE(c.razon_social, '') THEN true 
        ELSE false 
      END as cambio_razon_social,
      CASE 
        WHEN ch.ruc_anterior != c.ruc THEN true 
        ELSE false 
      END as cambio_ruc
    FROM clientes_historial ch
    INNER JOIN clientes c ON c.id_cliente = ch.id_cliente
    WHERE ch.id_cliente = $1
    ORDER BY ch.fecha_cambio DESC
  `;

  const { rows } = await pool.query(query, [clienteId]);
  return rows;
};

const tieneHistorial = async (clienteId) => {
  const query = `
    SELECT EXISTS(
      SELECT 1 
      FROM clientes_historial 
      WHERE id_cliente = $1
    ) as tiene_historial
  `;

  const { rows } = await pool.query(query, [clienteId]);
  return rows[0].tiene_historial;
};

const getUltimoCambioCliente = async (clienteId) => {
  const query = `
    SELECT 
      ch.id_historial,
      ch.nombre_anterior,
      ch.razon_social_anterior,
      ch.ruc_anterior,
      ch.fecha_cambio,
      c.nombre as nombre_actual,
      c.razon_social as razon_social_actual,
      c.ruc as ruc_actual,
      CASE 
        WHEN ch.nombre_anterior != c.nombre THEN true 
        ELSE false 
      END as cambio_nombre,
      CASE 
        WHEN COALESCE(ch.razon_social_anterior, '') != COALESCE(c.razon_social, '') THEN true 
        ELSE false 
      END as cambio_razon_social,
      CASE 
        WHEN ch.ruc_anterior != c.ruc THEN true 
        ELSE false 
      END as cambio_ruc
    FROM clientes_historial ch
    INNER JOIN clientes c ON c.id_cliente = ch.id_cliente
    WHERE ch.id_cliente = $1
    ORDER BY ch.fecha_cambio DESC
    LIMIT 1
  `;

  const { rows } = await pool.query(query, [clienteId]);
  return rows[0] || null;
};

const getClientesConHistorialBatch = async (clienteIds) => {
  if (!clienteIds || clienteIds.length === 0) {
    return {};
  }

  const query = `
    SELECT 
      c.id_cliente,
      EXISTS(
        SELECT 1 
        FROM clientes_historial ch 
        WHERE ch.id_cliente = c.id_cliente
      ) as tiene_historial
    FROM clientes c
    WHERE c.id_cliente = ANY($1)
  `;

  const { rows } = await pool.query(query, [clienteIds]);
  const resultado = {};
  rows.forEach(row => {
    resultado[row.id_cliente] = row.tiene_historial;
  });

  return resultado;
};

module.exports = {
  getAllClientesConDatos,
  getClientesInactivos,
  getClienteByIdConDatos,

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
  getContratoSuperpuesto,
  createContrato,
  updateContrato,
  desactivarContrato,

  getInstalacionesByCliente,
  getHistorialCliente,
  tieneHistorial,
  getUltimoCambioCliente,
  getClientesConHistorialBatch
};