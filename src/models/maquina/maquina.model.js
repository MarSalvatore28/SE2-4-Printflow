const pool = require('@config/db');
const { ACCIONES, leerFila, auditarFila, enTransaccion } = require('@services/auditoria');

// Datos de la máquina con su catálogo y, si la tiene, su asignación vigente
// (instalación activa y sin fecha de retiro). El índice único
// instalaciones_una_activa_por_maquina garantiza como máximo una fila por máquina.
const SELECT_MAQUINA = `
  SELECT
    m.id_maquina,
    m.serie,
    m.activo,
    m.modelo_id,
    mo.nombre AS modelo,
    m.tipo_impresion_id,
    ti.nombre AS tipo_impresion,
    m.formato_impresion_id,
    tf.nombre AS formato_impresion,
    i.id_instalacion,
    i.ip_address AS ip,
    TO_CHAR(i.fecha_instalacion, 'YYYY-MM-DD') AS fecha_instalacion,
    i.contrato_id,
    a.id_area AS area_id,
    a.nombre AS area_nombre,
    c.id_cliente AS cliente_id,
    c.nombre AS cliente_nombre,
    (i.id_instalacion IS NOT NULL) AS asignada
  FROM maquinas m
  LEFT JOIN modelos mo ON mo.id_modelo = m.modelo_id
  LEFT JOIN tipos_impresion ti ON ti.id_tipo_impresion = m.tipo_impresion_id
  LEFT JOIN tipos_formato_impresion tf ON tf.id_formato = m.formato_impresion_id
  LEFT JOIN instalaciones i ON i.maquina_id = m.id_maquina
    AND i.activo = TRUE
    AND i.fecha_retiro IS NULL
  LEFT JOIN areas a ON a.id_area = i.area_id
  LEFT JOIN clientes c ON c.id_cliente = a.cliente_id
`;

// Escapa los comodines de LIKE para que el término se busque tal cual.
const escaparLike = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

const getAllMaquinas = async () => {
  const { rows } = await pool.query(`${SELECT_MAQUINA} ORDER BY m.serie ASC`);
  return rows;
};

const getMaquinaById = async (idMaquina) => {
  const { rows } = await pool.query(`${SELECT_MAQUINA} WHERE m.id_maquina = $1`, [idMaquina]);
  return rows[0] || null;
};

/**
 * Busca por serie, nombre de modelo o IP de la asignación vigente.
 * Con varias palabras, cada una debe aparecer en alguno de esos campos
 * («ricoh 10.20» encuentra la Ricoh con IP 10.20.x.x).
 */
const searchMaquinas = async (termino) => {
  const palabras = termino.split(/\s+/).filter(Boolean).slice(0, 5);
  const condiciones = palabras.map((_, idx) => (
    `(m.serie ILIKE $${idx + 1} OR mo.nombre ILIKE $${idx + 1} OR i.ip_address ILIKE $${idx + 1})`
  ));
  const { rows } = await pool.query(
    `${SELECT_MAQUINA}
     WHERE ${condiciones.join(' AND ')}
     ORDER BY m.serie ASC
     LIMIT 100`,
    palabras.map((p) => `%${escaparLike(p)}%`)
  );
  return rows;
};

const getMaquinaBySerie = async (serie) => {
  const { rows } = await pool.query(
    'SELECT id_maquina, serie FROM maquinas WHERE UPPER(serie) = UPPER($1)',
    [serie]
  );
  return rows[0] || null;
};

// Alta, edición y cambio de estado quedan en la auditoría (S3-02) dentro de la misma transacción:
// si no se puede auditar, no se guarda. `auditoria` = { usuarioId, ip } de la petición.
const createMaquina = async ({ serie, modelo_id, tipo_impresion_id, formato_impresion_id = null }, auditoria = {}) =>
  enTransaccion(pool, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO maquinas (serie, modelo_id, tipo_impresion_id, formato_impresion_id, activo)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id_maquina`,
      [serie, modelo_id, tipo_impresion_id, formato_impresion_id]
    );
    const idMaquina = rows[0].id_maquina;
    await auditarFila(client, { tabla: 'maquinas', idRegistro: idMaquina, accion: ACCIONES.CREAR, ...auditoria });
    return idMaquina;
  });

// Devuelve cuántas filas cambió (0 si la máquina no existe)
const updateMaquina = async (idMaquina, { serie, modelo_id, tipo_impresion_id, formato_impresion_id = null }, auditoria = {}) =>
  enTransaccion(pool, async (client) => {
    const antes = await leerFila(client, 'maquinas', idMaquina, { bloquear: true });
    if (!antes) return 0;
    const { rowCount } = await client.query(
      `UPDATE maquinas
       SET serie = $1, modelo_id = $2, tipo_impresion_id = $3, formato_impresion_id = $4
       WHERE id_maquina = $5`,
      [serie, modelo_id, tipo_impresion_id, formato_impresion_id, idMaquina]
    );
    await auditarFila(client, { tabla: 'maquinas', idRegistro: idMaquina, accion: ACCIONES.ACTUALIZAR, antes, ...auditoria });
    return rowCount;
  });

/**
 * Cambia el estado de la máquina. Al desactivar, el UPDATE solo se aplica si
 * la máquina no tiene una asignación vigente (se comprueba en la misma sentencia).
 * Devuelve 'no_existe', 'asignada' o 'ok'.
 */
const setActivoMaquina = async (idMaquina, activo, auditoria = {}) =>
  enTransaccion(pool, async (client) => {
    const antes = await leerFila(client, 'maquinas', idMaquina, { bloquear: true });
    if (!antes) return 'no_existe';
    const { rowCount } = await client.query(
      `UPDATE maquinas m
       SET activo = $2
       WHERE m.id_maquina = $1
         AND ($2 = TRUE OR NOT EXISTS (
           SELECT 1 FROM instalaciones i
           WHERE i.maquina_id = m.id_maquina AND i.activo = TRUE AND i.fecha_retiro IS NULL
         ))`,
      [idMaquina, activo]
    );
    if (rowCount === 0) return 'asignada';
    await auditarFila(client, {
      tabla: 'maquinas', idRegistro: idMaquina, accion: activo ? ACCIONES.ACTIVAR : ACCIONES.DESACTIVAR, antes, ...auditoria,
    });
    return 'ok';
  });

// --- Catálogos ---

const getModelos = async () => {
  const { rows } = await pool.query(
    'SELECT id_modelo, nombre, activo FROM modelos ORDER BY nombre ASC'
  );
  return rows;
};

const getModeloActivoById = async (idModelo) => {
  const { rows } = await pool.query(
    'SELECT id_modelo, nombre FROM modelos WHERE id_modelo = $1 AND activo = TRUE',
    [idModelo]
  );
  return rows[0] || null;
};

const getModeloByNombre = async (nombre) => {
  const { rows } = await pool.query(
    'SELECT id_modelo, nombre FROM modelos WHERE LOWER(nombre) = LOWER($1)',
    [nombre]
  );
  return rows[0] || null;
};

const createModelo = async (nombre) => {
  const { rows } = await pool.query(
    'INSERT INTO modelos (nombre, activo) VALUES ($1, TRUE) RETURNING id_modelo, nombre, activo',
    [nombre]
  );
  return rows[0];
};

const getTiposImpresion = async () => {
  const { rows } = await pool.query(
    'SELECT id_tipo_impresion, nombre, activo FROM tipos_impresion WHERE activo = TRUE ORDER BY nombre ASC'
  );
  return rows;
};

const getTipoImpresionActivoById = async (idTipo) => {
  const { rows } = await pool.query(
    'SELECT id_tipo_impresion, nombre FROM tipos_impresion WHERE id_tipo_impresion = $1 AND activo = TRUE',
    [idTipo]
  );
  return rows[0] || null;
};

const getFormatosImpresion = async () => {
  const { rows } = await pool.query(
    'SELECT id_formato, nombre, activo FROM tipos_formato_impresion WHERE activo = TRUE ORDER BY nombre ASC'
  );
  return rows;
};

const getFormatoActivoById = async (idFormato) => {
  const { rows } = await pool.query(
    'SELECT id_formato, nombre FROM tipos_formato_impresion WHERE id_formato = $1 AND activo = TRUE',
    [idFormato]
  );
  return rows[0] || null;
};

module.exports = {
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
};
