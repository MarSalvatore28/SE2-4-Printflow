const pool = require('@config/db');

// ---------------------------------------------------------------------------
// Notificaciones
// Las crea sobre todo la base de datos: el trigger notificar_nuevo_lote inserta una
// por cada lote nuevo y trg_notify_socket la avisa por pg_notify (ver src/socket.js).
// Son globales: la tabla no tiene usuario, así que todos los usuarios ven las mismas.
// ---------------------------------------------------------------------------

// Columnas comunes de una notificación, con los datos de su tipo y de su lote
const SELECT_NOTIFICACION = `
  SELECT
    n.id_notificacion,
    n.titulo,
    n.mensaje,
    n.datos_adicionales,
    n.lote_id,
    n.leida,
    n.fecha_creacion,
    n.fecha_lectura,
    n.tipo_notificacion_id,
    t.codigo AS tipo_codigo,
    t.nombre AS tipo_nombre,
    l.codigo_referencia AS codigo_lote,
    l.periodo,
    l.total_registros_cargados AS total_registros,
    l.fecha_aprobacion,
    NULLIF(TRIM(CONCAT(u.nombre, ' ', u.apellido)), '') AS usuario_nombre
  FROM notificaciones n
  JOIN tipos_notificacion t ON t.id_tipo_notificacion = n.tipo_notificacion_id
  LEFT JOIN lotes_carga l ON l.id_lote = n.lote_id
  LEFT JOIN usuarios u ON u.id_usuario = l.usuario_aprobacion_id
`;

const ORDEN_NOTIFICACIONES = 'ORDER BY n.fecha_creacion DESC, n.id_notificacion DESC';

// leida: true | false | undefined (todas). limite: máximo de filas (opcional)
const listarNotificaciones = async ({ leida, limite } = {}) => {
  const valores = [];
  const condiciones = [];

  if (leida !== undefined) {
    valores.push(leida);
    condiciones.push(`n.leida = $${valores.length}`);
  }

  let sql = SELECT_NOTIFICACION;
  if (condiciones.length) sql += ` WHERE ${condiciones.join(' AND ')}`;
  sql += ` ${ORDEN_NOTIFICACIONES}`;
  if (limite) {
    valores.push(limite);
    sql += ` LIMIT $${valores.length}`;
  }

  const { rows } = await pool.query(sql, valores);
  return rows;
};

const obtenerNotificacion = async (id) => {
  const { rows } = await pool.query(`${SELECT_NOTIFICACION} WHERE n.id_notificacion = $1`, [id]);
  return rows[0] || null;
};

const listarNotificacionesPorLote = async (loteId) => {
  const { rows } = await pool.query(
    `${SELECT_NOTIFICACION} WHERE n.lote_id = $1 ${ORDEN_NOTIFICACIONES}`,
    [loteId]
  );
  return rows;
};

const contarNoLeidas = async () => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM notificaciones WHERE leida = false');
  return rows[0].total;
};

const obtenerEstadisticas = async () => {
  const { rows: [totales] } = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE leida = false)::int AS no_leidas,
      COUNT(*) FILTER (WHERE leida = true)::int AS leidas,
      MAX(fecha_creacion) AS ultima
    FROM notificaciones
  `);
  const { rows: porTipo } = await pool.query(`
    SELECT t.codigo, t.nombre,
           COUNT(n.id_notificacion)::int AS total,
           COUNT(n.id_notificacion) FILTER (WHERE n.leida = false)::int AS no_leidas
    FROM tipos_notificacion t
    LEFT JOIN notificaciones n ON n.tipo_notificacion_id = t.id_tipo_notificacion
    GROUP BY t.id_tipo_notificacion, t.codigo, t.nombre
    HAVING COUNT(n.id_notificacion) > 0
    ORDER BY total DESC, t.codigo
  `);
  return { ...totales, por_tipo: porTipo };
};

const obtenerTipoPorCodigo = async (codigo) => {
  const { rows } = await pool.query(
    'SELECT id_tipo_notificacion, codigo, nombre FROM tipos_notificacion WHERE codigo = $1 AND activo = true',
    [codigo]
  );
  return rows[0] || null;
};

// Al insertar, el trigger trg_notify_socket la avisa en tiempo real
const crearNotificacion = async ({ titulo, mensaje, lote_id, tipo_notificacion_id, datos_adicionales }) => {
  const { rows } = await pool.query(
    `INSERT INTO notificaciones (titulo, mensaje, lote_id, tipo_notificacion_id, datos_adicionales)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id_notificacion`,
    [titulo, mensaje ?? null, lote_id ?? null, tipo_notificacion_id, datos_adicionales ?? null]
  );
  return rows[0].id_notificacion;
};

// Devuelve la fila actualizada o null si no existe. Si ya estaba leída, conserva la fecha.
const marcarLeida = async (id) => {
  const { rows } = await pool.query(
    `UPDATE notificaciones
     SET leida = true, fecha_lectura = COALESCE(fecha_lectura, NOW())
     WHERE id_notificacion = $1
     RETURNING id_notificacion, leida, fecha_lectura`,
    [id]
  );
  return rows[0] || null;
};

const marcarVariasLeidas = async (ids) => {
  const { rowCount } = await pool.query(
    `UPDATE notificaciones
     SET leida = true, fecha_lectura = NOW()
     WHERE id_notificacion = ANY($1::int[]) AND leida = false`,
    [ids]
  );
  return rowCount;
};

const marcarTodasLeidas = async () => {
  const { rowCount } = await pool.query(
    'UPDATE notificaciones SET leida = true, fecha_lectura = NOW() WHERE leida = false'
  );
  return rowCount;
};

const eliminarNotificacion = async (id) => {
  const { rowCount } = await pool.query('DELETE FROM notificaciones WHERE id_notificacion = $1', [id]);
  return rowCount;
};

// Solo borra las ya leídas: una sin leer todavía espera que alguien la atienda
const eliminarLeidasAntiguas = async (dias) => {
  const { rowCount } = await pool.query(
    `DELETE FROM notificaciones
     WHERE leida = true AND fecha_creacion < NOW() - make_interval(days => $1)`,
    [dias]
  );
  return rowCount;
};

// ---------------------------------------------------------------------------
// Lotes (lo que antes daba /api/lotes, que ya no existe)
//
// Estado de un lote, con las palabras del plan (PLAN.md, sección 7):
//   PROCESADO  -> tiene fecha_aprobacion.
//   DESCARTADO -> no está aprobado y ya no tiene reportes en staging: se rechazó
//                 (el rechazo borra el staging; si se rechazó por esta API, además
//                 queda el motivo en notificaciones.datos_adicionales).
//   ERROR      -> sigue en staging y al menos un reporte tiene procesar_lectura = false
//                 (máquina no autorizada o con falla); no se puede aprobar.
//   PENDIENTE  -> sigue en staging, sin reportes con error, esperando aprobación.
// Los correos repetidos (mismo Message-ID) se descartan en la ingesta sin crear lote.
// ---------------------------------------------------------------------------
const SELECT_LOTES = `
  WITH base AS (
    SELECT
      l.id_lote,
      l.codigo_referencia,
      l.periodo,
      l.fecha_carga,
      l.fecha_aprobacion,
      l.fecha_corte,
      l.total_registros_cargados,
      l.usuario_aprobacion_id,
      NULLIF(TRIM(CONCAT(u.nombre, ' ', u.apellido)), '') AS usuario_aprobacion_nombre,
      st.reportes_staging,
      st.reportes_con_error,
      st.motivo_error,
      ofi.reportes_oficiales,
      rz.fecha_rechazo,
      rz.motivo_rechazo,
      nt.notificaciones_no_leidas,
      cli.clientes
    FROM lotes_carga l
    LEFT JOIN usuarios u ON u.id_usuario = l.usuario_aprobacion_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS reportes_staging,
        COUNT(*) FILTER (WHERE s.procesar_lectura = false)::int AS reportes_con_error,
        string_agg(DISTINCT s.mensaje_aviso, ' | ') FILTER (WHERE s.procesar_lectura = false) AS motivo_error
      FROM reportes_consolidado_staging s
      WHERE s.lote_id = l.id_lote
    ) st ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS reportes_oficiales
      FROM reportes_oficiales o
      WHERE o.lote_origen_id = l.id_lote
    ) ofi ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(MAX((nr.datos_adicionales->>'fecha_rechazo')::timestamptz), MAX(nr.fecha_lectura)) AS fecha_rechazo,
        MAX(nr.datos_adicionales->>'motivo_rechazo') AS motivo_rechazo
      FROM notificaciones nr
      WHERE nr.lote_id = l.id_lote
        AND (nr.datos_adicionales->>'estado_lote' = 'DESCARTADO' OR nr.mensaje LIKE '%(RECHAZADO)')
    ) rz ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS notificaciones_no_leidas
      FROM notificaciones nn
      WHERE nn.lote_id = l.id_lote AND nn.leida = false
    ) nt ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        json_agg(json_build_object('id_cliente', c.id_cliente, 'nombre', c.nombre) ORDER BY c.nombre),
        '[]'::json
      ) AS clientes
      FROM clientes c
      WHERE c.id_cliente IN (
        SELECT s.cliente_id_tentativo FROM reportes_consolidado_staging s WHERE s.lote_id = l.id_lote
        UNION
        SELECT o.cliente_id FROM reportes_oficiales o WHERE o.lote_origen_id = l.id_lote
      )
    ) cli ON true
  )
  SELECT
    base.*,
    CASE
      WHEN base.fecha_aprobacion IS NOT NULL THEN 'PROCESADO'
      WHEN base.reportes_staging = 0 THEN 'DESCARTADO'
      WHEN base.reportes_con_error > 0 THEN 'ERROR'
      ELSE 'PENDIENTE'
    END AS estado,
    CASE
      WHEN base.fecha_aprobacion IS NOT NULL THEN base.fecha_aprobacion
      WHEN base.reportes_staging = 0 THEN base.fecha_rechazo
    END AS fecha_procesamiento,
    CASE
      WHEN base.fecha_aprobacion IS NOT NULL THEN NULL
      WHEN base.reportes_staging = 0 THEN COALESCE(base.motivo_rechazo, 'Lote rechazado')
      WHEN base.reportes_con_error > 0 THEN base.motivo_error
    END AS motivo
  FROM base
`;

const ESTADOS_LOTE = ['PENDIENTE', 'PROCESADO', 'DESCARTADO', 'ERROR'];

// filtros: { estado, clienteId, desde: 'YYYY-MM-DD', hasta: 'YYYY-MM-DD' } (todos opcionales).
// Las fechas filtran por la fecha de recepción (fecha_carga), ambas inclusive.
const listarLotes = async ({ estado, clienteId, desde, hasta } = {}) => {
  const valores = [];
  const condiciones = [];

  if (estado) {
    valores.push(estado);
    condiciones.push(`lotes.estado = $${valores.length}`);
  }
  if (clienteId) {
    valores.push(clienteId);
    condiciones.push(`EXISTS (
      SELECT 1 FROM json_array_elements(lotes.clientes) c
      WHERE (c->>'id_cliente')::int = $${valores.length}
    )`);
  }
  if (desde) {
    valores.push(desde);
    condiciones.push(`lotes.fecha_carga >= $${valores.length}::date`);
  }
  if (hasta) {
    valores.push(hasta);
    condiciones.push(`lotes.fecha_carga < ($${valores.length}::date + 1)`);
  }

  let sql = `SELECT * FROM (${SELECT_LOTES}) lotes`;
  if (condiciones.length) sql += ` WHERE ${condiciones.join(' AND ')}`;
  sql += ' ORDER BY lotes.fecha_carga DESC, lotes.id_lote DESC';

  const { rows } = await pool.query(sql, valores);
  return rows;
};

const obtenerLote = async (loteId) => {
  const { rows } = await pool.query(
    `SELECT * FROM (${SELECT_LOTES}) lotes WHERE lotes.id_lote = $1`,
    [loteId]
  );
  return rows[0] || null;
};

// approveStagingBatch (staging) deja usuario_aprobacion_id en NULL: aquí se guarda quién aprobó
const registrarAprobador = async (loteId, usuarioId) => {
  await pool.query(
    'UPDATE lotes_carga SET usuario_aprobacion_id = $2 WHERE id_lote = $1 AND fecha_aprobacion IS NOT NULL',
    [loteId, usuarioId]
  );
};

// rejectStagingBatch (staging) no deja rastro en lotes_carga: el rechazo queda en sus notificaciones
const registrarRechazo = async (loteId, usuarioId, motivo) => {
  await pool.query(
    `UPDATE notificaciones
     SET leida = true,
         fecha_lectura = COALESCE(fecha_lectura, NOW()),
         datos_adicionales = COALESCE(datos_adicionales, '{}'::jsonb) || jsonb_build_object(
           'estado_lote', 'DESCARTADO',
           'motivo_rechazo', $3::text,
           'usuario_rechazo_id', $2::int,
           'fecha_rechazo', NOW()
         )
     WHERE lote_id = $1`,
    [loteId, usuarioId, motivo || null]
  );
};

module.exports = {
  listarNotificaciones,
  obtenerNotificacion,
  listarNotificacionesPorLote,
  contarNoLeidas,
  obtenerEstadisticas,
  obtenerTipoPorCodigo,
  crearNotificacion,
  marcarLeida,
  marcarVariasLeidas,
  marcarTodasLeidas,
  eliminarNotificacion,
  eliminarLeidasAntiguas,
  ESTADOS_LOTE,
  listarLotes,
  obtenerLote,
  registrarAprobador,
  registrarRechazo,
};
