const pool = require('@config/db');

const { validarLectura } = require('@services/validacionLecturas');
const { sqlFechaEcuador, sqlDiaEcuador, diaEcuador } = require('@utils/fechaCorte');
const { agruparPorCliente, erroresDelCliente, erroresSinCliente } = require('@utils/validacionLote');
const { tarifasParaCongelar, COLUMNAS_CONGELADAS } = require('@utils/tarifasCongeladas');
const { ACCIONES, leerFila, auditarFila } = require('@services/auditoria');

// Un campo que no vino en la edición queda en null: el COALESCE del UPDATE conserva el valor actual
const valorONull = (valor) => (valor === undefined ? null : valor);

// print_total, copy_total y totalservicio a guardar al editar un consolidado.
// El SELECT devuelve consolidado_print_total = print_total - copy_total (impresiones puras).
// Para guardar correctamente en la BD, hay que reconstruir: print_total = imprimir + copias.
const totalesEditados = (data) => {
  const printOnlyEditado = data.consolidado_print_total === undefined ? null : Number(data.consolidado_print_total);
  const copyTotalEditado = data.consolidado_copy_total === undefined ? null : Number(data.consolidado_copy_total);

  let printTotal = null;
  if (printOnlyEditado !== null && copyTotalEditado !== null) {
    // Ambos campos editados: recalcular el total bruto
    printTotal = printOnlyEditado + copyTotalEditado;
  } else if (printOnlyEditado !== null) {
    // Solo se editó el campo "imprimir", usar copy_total tal cual venía (no modificar)
    printTotal = printOnlyEditado; // el COALESCE de la BD lo completará
  }

  // totalservicio debe ser consistente con print_total (gran total)
  const totalServicio = printTotal === null ? valorONull(data.totalservicio) : printTotal;
  return { printTotal, copyTotal: copyTotalEditado, totalServicio };
};

// S3-02: lo que la auditoría guarda de cada reporte del lote antes de aprobarlo o rechazarlo
const resumenStaging = (rows) => rows.map((r) => ({
  id_staging_consolidado: r.id_staging_consolidado,
  serie_maquina: r.serie_maquina,
  maquina_id_tentativa: r.maquina_id_tentativa,
  cliente_id_tentativo: r.cliente_id_tentativo,
  impresion_bn: r.impresion_bn,
  impresion_color: r.impresion_color,
  estado_maquina: r.estado_maquina,
  procesar_lectura: r.procesar_lectura,
}));

const getAllStaging = async () => {
  const query = `
    SELECT 
      r.*,
      l.codigo_referencia as lote_codigo,
      l.fecha_carga,
      c.nombre AS cliente_nombre
    FROM reportes_consolidado_staging r
    LEFT JOIN lotes_carga l ON r.lote_id = l.id_lote
    LEFT JOIN clientes c ON r.cliente_id_tentativo = c.id_cliente
    ORDER BY r.fecha_lectura DESC
  `;
  const { rows } = await pool.query(query);
  return rows;
};

const getStagingById = async (id_staging_consolidado) => {
  const query = `
    SELECT 
      r.*,
      l.codigo_referencia as lote_codigo,
      l.fecha_carga,
      c.nombre AS cliente_nombre
    FROM reportes_consolidado_staging r
    LEFT JOIN lotes_carga l ON r.lote_id = l.id_lote
    LEFT JOIN clientes c ON r.cliente_id_tentativo = c.id_cliente
    WHERE r.id_staging_consolidado = $1
  `;
  const { rows } = await pool.query(query, [id_staging_consolidado]);
  return rows[0] || null;
};

const getStagingByLote = async (lote_id) => {
  const query = `
    SELECT 
      d.id_staging_detalle,
      d.lote_id,
      d.consolidado_staging_id,
      d.cuenta_id,
      d.nombre_cuenta,
      d.print_total,
      d.copy_total,
      d.impresion_bn,
      d.impresion_color,
      d.nombre_host,
      d.fecha_lectura
    FROM reportes_detalle_staging d
    WHERE d.lote_id = $1 
    ORDER BY d.id_staging_detalle ASC
  `;
  try {
    const { rows } = await pool.query(query, [lote_id]);
    return rows;
  } catch (error) {
    console.error("Error in getStagingByLote:", error);
    return [];
  }
};

const getStagingPendientes = async () => {
  const query = `
    SELECT 
      r.*,
      l.codigo_referencia as lote_codigo,
      l.fecha_carga,
      c.nombre AS cliente_nombre
    FROM reportes_consolidado_staging r
    LEFT JOIN lotes_carga l ON r.lote_id = l.id_lote
    LEFT JOIN clientes c ON r.cliente_id_tentativo = c.id_cliente
    WHERE l.fecha_aprobacion IS NULL
    ORDER BY r.fecha_lectura DESC
  `;
  const { rows } = await pool.query(query);
  return rows;
};

const getStagingByCliente = async (clienteId) => {
  const query = `
    SELECT 
      r.*,
      l.codigo_referencia as lote_codigo,
      l.fecha_carga,
      c.nombre AS cliente_nombre
    FROM reportes_consolidado_staging r
    LEFT JOIN lotes_carga l ON r.lote_id = l.id_lote
    LEFT JOIN clientes c ON r.cliente_id_tentativo = c.id_cliente
    WHERE r.cliente_id_tentativo = $1
    ORDER BY r.fecha_lectura DESC
  `;
  const { rows } = await pool.query(query, [clienteId]);
  return rows;
};

const getStagingByPeriodo = async (periodo) => {
  const query = `
    SELECT 
      r.*,
      l.codigo_referencia as lote_codigo,
      l.fecha_carga,
      c.nombre AS cliente_nombre
    FROM reportes_consolidado_staging r
    LEFT JOIN lotes_carga l ON r.lote_id = l.id_lote
    LEFT JOIN clientes c ON r.cliente_id_tentativo = c.id_cliente
    WHERE l.codigo_referencia LIKE $1
    ORDER BY r.fecha_lectura DESC
  `;
  const { rows } = await pool.query(query, [`%${periodo}%`]);
  return rows;
};

const getConsolidadoConDetallesByLote = async (lote_id) => {
  // 1. Auto-sincronización de registros globales en lotes mixtos
  // Los registros globales (sin detalles) heredarán la fecha mayor de los detalles del mismo lote.
  const querySyncMixed = `
    WITH max_fecha_lote AS (
      SELECT MAX(fecha_lectura) as max_val 
      FROM reportes_detalle_staging 
      WHERE lote_id = $1
    )
    UPDATE reportes_consolidado_staging rcs
    SET 
      fecha_corte = (SELECT max_val FROM max_fecha_lote),
      fecha_lectura = (SELECT max_val FROM max_fecha_lote)
    WHERE rcs.lote_id = $1
      AND (SELECT COUNT(*) FROM reportes_detalle_staging rds WHERE rds.consolidado_staging_id = rcs.id_staging_consolidado) = 0
      AND (SELECT max_val FROM max_fecha_lote) IS NOT NULL
      AND (
        rcs.fecha_corte IS DISTINCT FROM (SELECT max_val FROM max_fecha_lote) OR
        rcs.fecha_lectura IS DISTINCT FROM (SELECT max_val FROM max_fecha_lote)
      );
  `;
  try {
    await pool.query(querySyncMixed, [lote_id]);
  } catch (err) {
    console.error("Error auto-sincronizando mixtos antes de la lectura:", err);
  }

  const query = `
    SELECT 
      c.id_staging_consolidado,
      c.lote_id,
      c.ip_detectada,
      CAST(COALESCE(c.print_total, 0) - COALESCE(c.copy_total, 0) AS INTEGER) as consolidado_print_total,
      c.copy_total as consolidado_copy_total,
      c.fecha_lectura as consolidado_fecha_lectura,
      -- En hora de Ecuador con su desfase: en UTC, un corte a las 23:00 se veía del día siguiente
      ${sqlFechaEcuador('c.fecha_corte')} as consolidado_fecha_corte,
      c.maquina_id_tentativa,
      c.cliente_id_tentativo,
      c.serie_maquina,
      c.impresion_bn as consolidado_impresion_bn,
      c.impresion_color as consolidado_impresion_color,
      c.copia_bn as consolidado_copia_bn,
      c.copia_color as consolidado_copia_color,
      c.print_total as totalservicio,
      
      c.estado_maquina,
      c.procesar_lectura,
      c.mensaje_aviso,
      c.intentos_reproceso,
      
      l.codigo_referencia as lote_codigo,
      l.fecha_carga as lote_fecha_carga,
      l.fecha_corte as lote_fecha_corte, 
      l.periodo as lote_periodo,
      
      m.serie as maquina_serie_oficial,
      m.modelo_id as maquina_modelo_id,
      mo.nombre as maquina_modelo_nombre,
      
      cl.nombre as cliente_nombre,
      cl.ruc as cliente_ruc,
      
      COALESCE(
        json_agg(
          json_build_object(
            'id_staging_detalle', d.id_staging_detalle,
            'cuenta_id', d.cuenta_id,
            'print_total', d.print_total,
            'copy_total', d.copy_total,
            'nombre_cuenta', d.nombre_cuenta,
            'impresion_bn', d.impresion_bn,
            'impresion_color', d.impresion_color,
            'copia_bn', d.copia_bn,
            'copia_color', d.copia_color,
            'nombre_host', d.nombre_host,
            'fecha_lectura', d.fecha_lectura
          ) ORDER BY d.id_staging_detalle
        ) FILTER (WHERE d.id_staging_detalle IS NOT NULL),
        '[]'
      ) as detalles
      
    FROM reportes_consolidado_staging c
    LEFT JOIN lotes_carga l ON c.lote_id = l.id_lote
    LEFT JOIN maquinas m ON c.maquina_id_tentativa = m.id_maquina
    LEFT JOIN modelos mo ON m.modelo_id = mo.id_modelo
    LEFT JOIN clientes cl ON c.cliente_id_tentativo = cl.id_cliente
    LEFT JOIN reportes_detalle_staging d ON c.id_staging_consolidado = d.consolidado_staging_id
    WHERE c.lote_id = $1
    GROUP BY 
      c.id_staging_consolidado, c.lote_id, c.ip_detectada, c.print_total, c.copy_total,
      c.fecha_lectura, c.fecha_corte, c.maquina_id_tentativa, c.cliente_id_tentativo,
      c.serie_maquina, c.impresion_bn, c.impresion_color, c.copia_bn, c.copia_color, c.totalservicio,
      c.estado_maquina, c.procesar_lectura, c.mensaje_aviso, c.intentos_reproceso,
      l.codigo_referencia, l.fecha_carga, l.fecha_corte, l.periodo,
      m.serie, m.modelo_id, mo.nombre, cl.nombre, cl.ruc
    ORDER BY c.id_staging_consolidado
  `;

  try {
    const { rows } = await pool.query(query, [lote_id]);
    return rows;
  } catch (error) {
    console.error("Error en getConsolidadoConDetallesByLote:", error);
    throw error;
  }
};

const updateConsolidadoStaging = async (id_staging_consolidado, data) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const query = `
      UPDATE reportes_consolidado_staging
      SET 
        ip_detectada = COALESCE($1, ip_detectada),
        print_total = COALESCE($2, print_total),
        copy_total = COALESCE($3, copy_total),
        impresion_bn = COALESCE($4, impresion_bn),
        impresion_color = COALESCE($5, impresion_color),
        totalservicio = COALESCE($6, totalservicio),
        maquina_id_tentativa = COALESCE($7, maquina_id_tentativa),
        cliente_id_tentativo = COALESCE($8, cliente_id_tentativo),
        serie_maquina = COALESCE($9, serie_maquina),
        fecha_lectura = COALESCE($10, fecha_lectura),
        fecha_corte = COALESCE($11, fecha_corte) 
      WHERE id_staging_consolidado = $12
      RETURNING *
    `;

    const totales = totalesEditados(data);

    const values = [
      valorONull(data.ip_detectada),
      totales.printTotal,
      totales.copyTotal,
      valorONull(data.consolidado_impresion_bn),
      valorONull(data.consolidado_impresion_color),
      totales.totalServicio,
      valorONull(data.maquina_id_tentativa),
      valorONull(data.cliente_id_tentativo),
      valorONull(data.serie_maquina),
      valorONull(data.consolidado_fecha_lectura),
      valorONull(data.consolidado_fecha_corte),
      id_staging_consolidado
    ];

    const { rows, rowCount } = await client.query(query, values);
    if (rowCount === 0) throw new Error('No se encontró el registro para actualizar');

    // Update IP in Details if ip_detectada is provided
    if (data.ip_detectada !== undefined && data.ip_detectada !== null) {
      const updateDetalleQuery = `
        UPDATE reportes_detalle_staging
        SET nombre_host = $1
        WHERE consolidado_staging_id = $2
      `;
      await client.query(updateDetalleQuery, [data.ip_detectada, id_staging_consolidado]);
    }

    // Update Date in Details exactly as provided by the user (now includes both date and time)
    if (data.consolidado_fecha_corte !== undefined && data.consolidado_fecha_corte !== null) {
      const updateDetalleDateQuery = `
        UPDATE reportes_detalle_staging
        SET fecha_lectura = CAST($1 AS TIMESTAMPTZ)
        WHERE consolidado_staging_id = $2
      `;
      await client.query(updateDetalleDateQuery, [data.consolidado_fecha_corte, id_staging_consolidado]);
    }

    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error en updateConsolidadoStaging:", error);
    throw error;
  } finally {
    client.release();
  }
};

const updateDetalleStaging = async (id_staging_detalle, data) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const query = `
      UPDATE reportes_detalle_staging
      SET 
        cuenta_id = COALESCE($1, cuenta_id), print_total = COALESCE($2, print_total),
        copy_total = COALESCE($3, copy_total), nombre_cuenta = COALESCE($4, nombre_cuenta),
        impresion_bn = COALESCE($5, impresion_bn), impresion_color = COALESCE($6, impresion_color),
        copia_bn = COALESCE($7, copia_bn), copia_color = COALESCE($8, copia_color),
        nombre_host = COALESCE($9, nombre_host), fecha_lectura = COALESCE($10, fecha_lectura)
      WHERE id_staging_detalle = $11
      RETURNING *, consolidado_staging_id
    `;
    const values = [
      valorONull(data.cuenta_id), valorONull(data.print_total),
      valorONull(data.copy_total), valorONull(data.nombre_cuenta),
      valorONull(data.impresion_bn), valorONull(data.impresion_color),
      valorONull(data.copia_bn), valorONull(data.copia_color),
      valorONull(data.nombre_host), valorONull(data.fecha_lectura),
      id_staging_detalle
    ];

    const { rows, rowCount } = await client.query(query, values);
    if (rowCount === 0) throw new Error('No se encontró el detalle para actualizar');

    const updatedDetalle = rows[0];
    const consolidadoId = updatedDetalle.consolidado_staging_id;

    if (consolidadoId) {
      const sumQuery = `
        SELECT SUM(print_total) as total_print, SUM(copy_total) as total_copy,
               SUM(impresion_bn) as total_impresion_bn, SUM(impresion_color) as total_impresion_color
        FROM reportes_detalle_staging WHERE consolidado_staging_id = $1
      `;
      const { rows: sumRows } = await client.query(sumQuery, [consolidadoId]);
      const sums = sumRows[0];

      const updateConsolidadoQuery = `
        UPDATE reportes_consolidado_staging
        SET print_total = $1, copy_total = $2, impresion_bn = $3, impresion_color = $4,
            totalservicio = CAST($1 AS INTEGER) + CAST($2 AS INTEGER)
        WHERE id_staging_consolidado = $5
      `;
      await client.query(updateConsolidadoQuery, [
        Number.parseInt(sums.total_print, 10) || 0, Number.parseInt(sums.total_copy, 10) || 0,
        Number.parseInt(sums.total_impresion_bn, 10) || 0, Number.parseInt(sums.total_impresion_color, 10) || 0,
        consolidadoId
      ]);
    }
    await client.query('COMMIT');
    return updatedDetalle;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error en updateDetalleStaging:", error);
    throw error;
  } finally {
    client.release();
  }
};

const updateMultiplesDetallesStaging = async (detalles) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updatedDetalles = [];
    for (const detalle of detalles) {
      const { id_staging_detalle, ...data } = detalle;
      const query = `
        UPDATE reportes_detalle_staging
        SET 
          cuenta_id = COALESCE($1, cuenta_id), print_total = COALESCE($2, print_total),
          copy_total = COALESCE($3, copy_total), nombre_cuenta = COALESCE($4, nombre_cuenta),
          impresion_bn = COALESCE($5, impresion_bn), impresion_color = COALESCE($6, impresion_color),
          nombre_host = COALESCE($7, nombre_host), fecha_lectura = COALESCE($8, fecha_lectura)
        WHERE id_staging_detalle = $9 RETURNING *
      `;
      const values = [
        valorONull(data.cuenta_id), valorONull(data.print_total),
        valorONull(data.copy_total), valorONull(data.nombre_cuenta),
        valorONull(data.impresion_bn), valorONull(data.impresion_color),
        valorONull(data.nombre_host), valorONull(data.fecha_lectura),
        id_staging_detalle
      ];
      const { rows } = await client.query(query, values); // NOSONAR: en orden, misma transacción y mismo client
      updatedDetalles.push(rows[0]);
    }
    await client.query('COMMIT');
    return updatedDetalles;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error en updateMultiplesDetallesStaging:", error);
    throw error;
  } finally {
    client.release();
  }
};

const createStaging = async (reporteData) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let loteId = reporteData.lote_id || reporteData.lote_carga;
    if (!loteId) throw new Error('lote_id o lote_carga es requerido');

    if (typeof loteId === 'string' && Number.isNaN(Number.parseInt(loteId, 10))) {
      const loteQuery = `SELECT id_lote FROM lotes_carga WHERE codigo_referencia = $1`;
      const { rows: loteRows } = await client.query(loteQuery, [loteId]);
      if (loteRows.length > 0) {
        loteId = loteRows[0].id_lote;
      } else {
        const createLoteQ = `INSERT INTO lotes_carga (codigo_referencia, total_registros_cargados) VALUES ($1, 0) RETURNING id_lote`;
        const { rows: newLote } = await client.query(createLoteQ, [loteId]);
        loteId = newLote[0].id_lote;
      }
    }

    const insertConsolidadoQuery = `
      INSERT INTO reportes_consolidado_staging (
        lote_id, ip_detectada, serie_maquina, print_total, copy_total, impresion_bn, impresion_color, totalservicio, maquina_id_tentativa, cliente_id_tentativo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id_staging_consolidado
    `;
    const consolidadoValues = [
      loteId, reporteData.ipAddress || reporteData.ip || '0.0.0.0', reporteData.modelName || reporteData.serie || reporteData.serialNumber || 'UNKNOWN',
      reporteData.printTotal || 0, reporteData.copyTotal || 0, reporteData.impresion_bn || reporteData.printBlackWhite || 0,
      reporteData.impresion_color || reporteData.printFullColor || 0, (reporteData.printTotal || 0) + (reporteData.copyTotal || 0),
      reporteData.maquina_id || null, reporteData.clienteId || reporteData.cliente_id || null
    ];
    const { rows: consolidadoResult } = await client.query(insertConsolidadoQuery, consolidadoValues);
    const newConsolidadoId = consolidadoResult[0].id_staging_consolidado;

    const insertDetalleQuery = `
      INSERT INTO reportes_detalle_staging (
        lote_id, consolidado_staging_id, cuenta_id, nombre_cuenta, print_total, copy_total, impresion_bn, impresion_color, nombre_host, maquina_id_tentativa
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;
    const detalleValues = [
      loteId, newConsolidadoId, reporteData.cuentaId || reporteData.accountId || '', reporteData.cuentaNombre || reporteData.accountName || '',
      reporteData.printTotal || 0, reporteData.copyTotal || 0, reporteData.impresion_bn || reporteData.printBlackWhite || 0,
      reporteData.impresion_color || reporteData.printFullColor || 0, reporteData.hostName || reporteData.nombre_host || null, reporteData.maquina_id || null
    ];
    await client.query(insertDetalleQuery, detalleValues);

    await client.query(`UPDATE lotes_carga SET total_registros_cargados = total_registros_cargados + 1 WHERE id_lote = $1`, [loteId]);
    await client.query('COMMIT');
    return newConsolidadoId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const updateStaging = async (id_staging_consolidado, reporteData) => {
  const query = `
    UPDATE reportes_consolidado_staging
    SET ip_detectada = $1, serie_maquina = $2, print_total = $3, copy_total = $4,
        impresion_bn = $5, impresion_color = $6, totalservicio = $7, maquina_id_tentativa = $8, cliente_id_tentativo = $9
    WHERE id_staging_consolidado = $10
  `;
  const values = [
    reporteData.ipAddress || reporteData.ip, reporteData.modelName || reporteData.serie,
    reporteData.printTotal, reporteData.copyTotal, reporteData.impresion_bn, reporteData.impresion_color,
    reporteData.totalservicio, reporteData.maquina_id, reporteData.cliente_id, id_staging_consolidado
  ];
  const { rowCount } = await pool.query(query, values);
  return rowCount;
};

const deleteStaging = async (id_staging_consolidado) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM reportes_detalle_staging WHERE consolidado_staging_id = $1`, [id_staging_consolidado]);
    const { rowCount } = await client.query(`DELETE FROM reportes_consolidado_staging WHERE id_staging_consolidado = $1`, [id_staging_consolidado]);
    await client.query('COMMIT');
    return rowCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const deleteOldAprobados = async (dias = 90) => {
  const { rowCount } = await pool.query(`DELETE FROM reportes_consolidado_staging WHERE lote_id IN (SELECT id_lote FROM lotes_carga WHERE fecha_aprobacion < NOW() - INTERVAL '${dias} days')`);
  return rowCount;
};

const deleteOldRechazados = async (dias = 30) => {
  const { rowCount } = await pool.query(`DELETE FROM reportes_consolidado_staging WHERE lote_id IN (SELECT id_lote FROM lotes_carga WHERE fecha_aprobacion IS NULL AND fecha_carga < NOW() - INTERVAL '${dias} days')`);
  return rowCount;
};

const getEstadisticasStaging = async () => {
  const query = `
    SELECT CASE WHEN l.fecha_aprobacion IS NOT NULL THEN 'APROBADO' ELSE 'PENDIENTE' END as estado,
           COUNT(r.id_staging_consolidado) as total, MIN(r.fecha_lectura) as primer_registro, MAX(r.fecha_lectura) as ultimo_registro
    FROM reportes_consolidado_staging r LEFT JOIN lotes_carga l ON r.lote_id = l.id_lote GROUP BY l.fecha_aprobacion
  `;
  const { rows } = await pool.query(query);
  return rows;
};

// Asignación de la máquina en el período que se aprueba (la misma regla que INSTALACION_DEL_PERIODO
// del consolidado): prefiere la del cliente del reporte, luego la que cubre el período y luego la
// vigente. De ahí salen el área y las tarifas de su contrato, que quedan guardadas (congeladas)
// en el reporte oficial.
const ASIGNACION_DEL_PERIODO = `
  SELECT a.nombre AS area_nombre,
         i.contrato_id,
         c.impresiones_bn_incluidas,
         c.impresiones_color_incluidas,
         c.costo_impresion_bn,
         c.costo_impresion_color,
         c.costo_x_excedente_impresion_bn,
         c.costo_x_excedente_impresion_color,
         c.facturacion_de_impresora
  FROM instalaciones i
  JOIN areas a ON a.id_area = i.area_id
  LEFT JOIN contratos c ON c.id_contrato = i.contrato_id
  WHERE i.maquina_id = $1
  ORDER BY
    (a.cliente_id = $2::int) DESC NULLS LAST,
    (i.fecha_instalacion < TO_DATE($3::text || '-01', 'YYYY-MM-DD') + INTERVAL '1 month'
      AND (i.fecha_retiro IS NULL OR i.fecha_retiro >= TO_DATE($3::text || '-01', 'YYYY-MM-DD'))) DESC NULLS LAST,
    (i.activo AND i.fecha_retiro IS NULL) DESC NULLS LAST,
    i.fecha_instalacion DESC,
    i.id_instalacion DESC
  LIMIT 1`;

const asignacionDelReporte = async (db, row, periodo) => {
  if (!row.maquina_id_tentativa) return null;
  const { rows } = await db.query(ASIGNACION_DEL_PERIODO, [row.maquina_id_tentativa, row.cliente_id_tentativo ?? null, periodo]);
  return rows[0] || null;
};

// ip (S3-02): la de la petición, para la auditoría de la aprobación
const approveStagingBatch = async (loteId, periodo = null, usuarioId = null, ip = null) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const loteAntes = await leerFila(client, 'lotes_carga', loteId, { bloquear: true });

    const getStagingQuery = `
      SELECT * FROM reportes_consolidado_staging WHERE lote_id = $1
    `;
    const { rows: stagingRows } = await client.query(getStagingQuery, [loteId]);

    if (stagingRows.length === 0) {
      throw new Error('No se encontraron registros para este lote');
    }

    const periodoFinal = periodo || new Date().toISOString().slice(0, 7);
    const idsOficiales = [];

    for (const row of stagingRows) {
      // El consolidado de meses pasados toma el área y las copias de aquí, no de la asignación de hoy
      const asignacion = await asignacionDelReporte(client, row, periodoFinal); // NOSONAR: en orden, misma transacción
      // Tarifas del contrato en el momento de aprobar: el importe de este mes ya no cambia
      // aunque después se modifique el contrato (TAREAS-CHRISTIAN.md, sección 2)
      const tarifas = tarifasParaCongelar(asignacion);

      const insertOficialQuery = `
        INSERT INTO reportes_oficiales (
          lote_origen_id, 
          periodo, 
          maquina_id, 
          cliente_id,
          contador_impresiones_bn, 
          contador_impresiones_color,
          contador_copias_bn,
          contador_copias_color,
          snap_maquina_serie, 
          snap_maquina_ip,
          snap_area_nombre,
          print_total,
          copy_total,
          total_servicio,
          fecha_procesamiento,
          fecha_corte,
          usuario_validacion_id,
          ${COLUMNAS_CONGELADAS.join(',\n          ')},
          fecha_congelacion
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), $15,
          $${16 + COLUMNAS_CONGELADAS.length},
          ${COLUMNAS_CONGELADAS.map((_, i) => `$${16 + i}`).join(', ')},
          CASE WHEN $16::int IS NULL THEN NULL ELSE NOW() END)
        RETURNING id_reporte
      `;

      const oficialValues = [
        row.lote_id,
        periodoFinal,
        row.maquina_id_tentativa,
        row.cliente_id_tentativo,
        row.impresion_bn || 0,
        row.impresion_color || 0,
        row.copia_bn || 0,
        row.copia_color || 0,
        row.serie_maquina,
        row.ip_detectada,
        asignacion?.area_nombre ?? null,
        (row.print_total || 0) - (row.copy_total || 0),
        row.copy_total || 0,
        row.totalservicio || 0,
        row.fecha_corte || null,
        ...COLUMNAS_CONGELADAS.map((col) => (tarifas ? tarifas[col] : null)),
        // S3-02: trazabilidad de la lectura, quién aprobó el lote que la trajo
        usuarioId
      ];

      const { rows: [newOficial] } = await client.query(insertOficialQuery, oficialValues); // NOSONAR: en orden, misma transacción
      idsOficiales.push(newOficial.id_reporte);

      const moveDetailsQuery = `
        INSERT INTO reportes_detalle_oficial (
          reporte_oficial_id, 
          fecha_transaccion, 
          cuenta_id,
          usuario_trabajo,
          cnt_impresion_bn,
          cnt_impresion_color,
          cnt_copia_bn,
          cnt_copia_color,
          print_total,
          copy_total
        )
        SELECT
          $1,
          fecha_lectura,
          CAST(cuenta_id AS TEXT),
          nombre_cuenta,
          impresion_bn,
          impresion_color,
          -- Las copias también se facturan: el consolidado suma cnt_copia_* por usuario
          COALESCE(copia_bn, 0),
          COALESCE(copia_color, 0),
          print_total,
          copy_total
        FROM reportes_detalle_staging
        WHERE consolidado_staging_id = $2
      `;
      await client.query(moveDetailsQuery, [newOficial.id_reporte, row.id_staging_consolidado]); // NOSONAR: necesita el id del INSERT anterior
    }

    // Reemplazo de máquina (caja 4): los reportes de la saliente y de la entrante del período
    // afectado quedan enlazados al cambio. Con eso el consolidado arma una sola fila con el
    // consumo de las dos máquinas (saliente hasta el daño + entrante desde su instalación).
    await client.query(
      `UPDATE reportes_oficiales ro
       SET maquina_cambio_id = mc.id_maquina_cambio,
           tiene_cambio_maquina = TRUE,
           es_parte_cambio = TRUE,
           es_maquina_reemplazo = (ro.maquina_id = mc.maquina_entrante_id)
       FROM maquinas_cambio mc
       JOIN areas a ON a.id_area = mc.area_id
       WHERE ro.lote_origen_id = $1
         AND mc.activo = TRUE
         AND mc.periodo_afectado = ro.periodo
         AND a.cliente_id = ro.cliente_id
         AND ro.maquina_id IN (mc.maquina_saliente_id, mc.maquina_entrante_id)`,
      [loteId]
    );

    await client.query(`DELETE FROM reportes_detalle_staging WHERE lote_id = $1`, [loteId]);
    await client.query(`DELETE FROM reportes_consolidado_staging WHERE lote_id = $1`, [loteId]);

    await client.query(
      `UPDATE lotes_carga SET fecha_aprobacion = NOW(), usuario_aprobacion_id = $1 WHERE id_lote = $2`,
      [usuarioId, loteId]
    );

    await client.query(
      `UPDATE notificaciones SET leida = true, fecha_lectura = NOW() WHERE lote_id = $1`,
      [loteId]
    );

    // S3-02: el lote antes (con sus reportes de staging) y después (con las lecturas oficiales)
    await auditarFila(client, {
      tabla: 'lotes_carga',
      idRegistro: loteId,
      accion: ACCIONES.APROBAR,
      antes: { ...loteAntes, reportes_staging: resumenStaging(stagingRows) },
      extra: { estado: 'PROCESADO', periodo: periodoFinal, reportes_oficiales: idsOficiales },
      usuarioId,
      ip,
    });

    await client.query('COMMIT');
    return { success: true, message: 'Lote aprobado correctamente' };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// auditoria (S3-02): { usuarioId, ip, motivo } de la petición
const rejectStagingBatch = async (loteId, { usuarioId = null, ip = null, motivo = null } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lo que se descarta queda en la auditoría: el staging se borra
    const loteAntes = await leerFila(client, 'lotes_carga', loteId, { bloquear: true });
    const { rows: stagingRows } = await client.query(
      'SELECT * FROM reportes_consolidado_staging WHERE lote_id = $1 ORDER BY id_staging_consolidado',
      [loteId]
    );

    await client.query(`DELETE FROM reportes_detalle_staging WHERE lote_id = $1`, [loteId]);

    await client.query(`DELETE FROM reportes_consolidado_staging WHERE lote_id = $1`, [loteId]);

    await client.query(
      `UPDATE notificaciones 
       SET leida = true, 
           fecha_lectura = NOW(),
           mensaje = CONCAT(mensaje, ' (RECHAZADO)')
       WHERE lote_id = $1`,
      [loteId]
    );

    await auditarFila(client, {
      tabla: 'lotes_carga',
      idRegistro: loteId,
      accion: ACCIONES.RECHAZAR,
      antes: { ...loteAntes, reportes_staging: resumenStaging(stagingRows) },
      extra: { estado: 'DESCARTADO', motivo: motivo || null, reportes_descartados: stagingRows.length },
      usuarioId,
      ip,
    });

    await client.query('COMMIT');
    return { success: true, message: 'Lote rechazado correctamente' };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const validarLoteStaging = async (loteId) => {
  const { rows: stagingConsolidado } = await pool.query(
    `SELECT id_staging_consolidado, ip_detectada, serie_maquina, procesar_lectura, mensaje_aviso, cliente_id_tentativo
       FROM reportes_consolidado_staging
      WHERE lote_id = $1
      ORDER BY id_staging_consolidado`,
    [loteId]
  );

  if (stagingConsolidado.length === 0) {
    return { esValido: false, errores: ["El lote está vacío o no contiene registros consolidados."] };
  }

  // Cada cliente del lote se valida con sus propias máquinas (antes: el del primer reporte, LIMIT 1)
  const { porCliente, sinCliente } = agruparPorCliente(stagingConsolidado);
  const clienteIds = [...porCliente.keys()];

  const { rows: maquinasDB } = clienteIds.length === 0 ? { rows: [] } : await pool.query(
    `SELECT a.cliente_id, i.ip_address, m.serie, i.contabilidad_por_usuario
       FROM instalaciones i
       INNER JOIN maquinas m ON i.maquina_id = m.id_maquina
       INNER JOIN areas a ON i.area_id = a.id_area
      WHERE a.cliente_id = ANY($1::int[]) AND i.activo = TRUE AND i.fecha_retiro IS NULL`,
    [clienteIds]
  );

  // Con varios clientes, cada error dice de cuál es
  const nombres = new Map();
  if (clienteIds.length > 1) {
    const { rows } = await pool.query(
      'SELECT id_cliente, nombre FROM clientes WHERE id_cliente = ANY($1::int[])',
      [clienteIds]
    );
    rows.forEach((c) => nombres.set(Number(c.id_cliente), c.nombre));
  }

  const { rows: stagingDetalle } = await pool.query(
    'SELECT DISTINCT consolidado_staging_id FROM reportes_detalle_staging WHERE lote_id = $1',
    [loteId]
  );
  const consolidadosConDetalle = new Set(stagingDetalle.map((d) => d.consolidado_staging_id));

  const errores = [];
  for (const [clienteId, reportes] of porCliente) {
    const nombreCliente = nombres.get(clienteId) || `#${clienteId}`;
    const prefijo = clienteIds.length > 1 ? `Cliente ${nombreCliente}: ` : '';
    const maquinasDelCliente = maquinasDB.filter((m) => Number(m.cliente_id) === clienteId);
    errores.push(...erroresDelCliente(maquinasDelCliente, reportes, consolidadosConDetalle, prefijo));
  }
  errores.push(...erroresSinCliente(sinCliente));

  // S3-01: volver a validar cada lectura. Entre la ingesta y la aprobación pudo
  // aprobarse otra lectura de la misma máquina y período.
  const { rows: loteRows } = await pool.query(
    'SELECT periodo FROM lotes_carga WHERE id_lote = $1',
    [loteId]
  );
  const { rows: lecturas } = await pool.query(
    `SELECT serie_maquina, maquina_id_tentativa, impresion_bn, impresion_color,
            ${sqlDiaEcuador('fecha_corte')} AS dia_corte
       FROM reportes_consolidado_staging
      WHERE lote_id = $1
        AND procesar_lectura IS DISTINCT FROM FALSE
        AND maquina_id_tentativa IS NOT NULL`,
    [loteId]
  );
  // Solo lee (con el pool, fuera de una transacción): se validan a la vez y los errores quedan
  // en el orden de las lecturas
  const rechazos = await Promise.all(lecturas.map((l) => {
    const diaCorte = l.dia_corte || diaEcuador(new Date());
    // El día del corte en Ecuador, no en UTC (un corte a las 23:00 no es del día siguiente)
    const periodoLote = loteRows[0]?.periodo || diaCorte.slice(0, 7);
    return validarLectura(pool, {
      maquinaId: l.maquina_id_tentativa,
      periodo: periodoLote,
      fecha: diaCorte,
      contadorBn: l.impresion_bn || 0,
      contadorColor: l.impresion_color || 0
    });
  }));
  rechazos.forEach((rechazo, i) => {
    if (rechazo) errores.push(`Máquina ${lecturas[i].serie_maquina}: ${rechazo.motivo}`);
  });

  const erroresUnicos = [...new Set(errores)];

  return { esValido: erroresUnicos.length === 0, errores: erroresUnicos };
};

const getAlertasPorLote = async (lote_id) => {
  const query = `
    SELECT 
      serie_maquina, 
      ip_detectada, 
      estado_maquina, 
      mensaje_aviso 
    FROM reportes_consolidado_staging
    WHERE lote_id = $1 
      AND procesar_lectura = FALSE
    ORDER BY serie_maquina ASC
  `;

  try {
    const { rows } = await pool.query(query, [lote_id]);
    return rows;
  } catch (error) {
    console.error("Error en getAlertasPorLote:", error);
    throw error;
  }
};

module.exports = {
  getAllStaging, getStagingById, getStagingByLote, getStagingPendientes, getStagingByCliente, getStagingByPeriodo,
  createStaging, updateStaging, deleteStaging, deleteOldAprobados, deleteOldRechazados, getEstadisticasStaging,
  approveStagingBatch, rejectStagingBatch, getConsolidadoConDetallesByLote, updateConsolidadoStaging,
  updateDetalleStaging, updateMultiplesDetallesStaging, validarLoteStaging,
  getAlertasPorLote
};