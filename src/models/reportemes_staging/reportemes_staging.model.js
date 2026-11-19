const pool = require('@config/db');

const { validarLectura } = require('@services/validacionLecturas');

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
      c.fecha_corte as consolidado_fecha_corte, 
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

    // El SELECT devuelve consolidado_print_total = print_total - copy_total (impresiones puras).
    // Para guardar correctamente en la BD, hay que reconstruir: print_total = imprimir + copias.
    const printOnlyEditado = data.consolidado_print_total !== undefined ? Number(data.consolidado_print_total) : null;
    const copyTotalEditado  = data.consolidado_copy_total  !== undefined ? Number(data.consolidado_copy_total)  : null;

    let printTotalParaGuardar = null;
    if (printOnlyEditado !== null && copyTotalEditado !== null) {
      // Ambos campos editados: recalcular el total bruto
      printTotalParaGuardar = printOnlyEditado + copyTotalEditado;
    } else if (printOnlyEditado !== null) {
      // Solo se editó el campo "imprimir", usar copy_total tal cual venía (no modificar)
      printTotalParaGuardar = printOnlyEditado; // el COALESCE de la BD lo completará
    }

    // totalservicio debe ser consistente con print_total (gran total)
    const totalServicioParaGuardar = printTotalParaGuardar !== null
      ? printTotalParaGuardar
      : (data.totalservicio !== undefined ? data.totalservicio : null);

    const values = [
      data.ip_detectada !== undefined ? data.ip_detectada : null,
      printTotalParaGuardar,
      copyTotalEditado,
      data.consolidado_impresion_bn !== undefined ? data.consolidado_impresion_bn : null,
      data.consolidado_impresion_color !== undefined ? data.consolidado_impresion_color : null,
      totalServicioParaGuardar,
      data.maquina_id_tentativa !== undefined ? data.maquina_id_tentativa : null,
      data.cliente_id_tentativo !== undefined ? data.cliente_id_tentativo : null,
      data.serie_maquina !== undefined ? data.serie_maquina : null,
      data.consolidado_fecha_lectura !== undefined ? data.consolidado_fecha_lectura : null,
      data.consolidado_fecha_corte !== undefined ? data.consolidado_fecha_corte : null,
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
      data.cuenta_id !== undefined ? data.cuenta_id : null, data.print_total !== undefined ? data.print_total : null,
      data.copy_total !== undefined ? data.copy_total : null, data.nombre_cuenta !== undefined ? data.nombre_cuenta : null,
      data.impresion_bn !== undefined ? data.impresion_bn : null, data.impresion_color !== undefined ? data.impresion_color : null,
      data.copia_bn !== undefined ? data.copia_bn : null, data.copia_color !== undefined ? data.copia_color : null,
      data.nombre_host !== undefined ? data.nombre_host : null, data.fecha_lectura !== undefined ? data.fecha_lectura : null,
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
        parseInt(sums.total_print) || 0, parseInt(sums.total_copy) || 0,
        parseInt(sums.total_impresion_bn) || 0, parseInt(sums.total_impresion_color) || 0,
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
        data.cuenta_id !== undefined ? data.cuenta_id : null, data.print_total !== undefined ? data.print_total : null,
        data.copy_total !== undefined ? data.copy_total : null, data.nombre_cuenta !== undefined ? data.nombre_cuenta : null,
        data.impresion_bn !== undefined ? data.impresion_bn : null, data.impresion_color !== undefined ? data.impresion_color : null,
        data.nombre_host !== undefined ? data.nombre_host : null, data.fecha_lectura !== undefined ? data.fecha_lectura : null,
        id_staging_detalle
      ];
      const { rows } = await client.query(query, values);
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

    if (typeof loteId === 'string' && isNaN(parseInt(loteId))) {
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

const approveStagingBatch = async (loteId, periodo = null, usuarioId = null) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const getStagingQuery = `
      SELECT * FROM reportes_consolidado_staging WHERE lote_id = $1
    `;
    const { rows: stagingRows } = await client.query(getStagingQuery, [loteId]);

    if (stagingRows.length === 0) {
      throw new Error('No se encontraron registros para este lote');
    }

    for (const row of stagingRows) {
      const insertOficialQuery = `
        INSERT INTO reportes_oficiales (
          lote_origen_id, 
          periodo, 
          maquina_id, 
          cliente_id,
          contador_impresiones_bn, 
          contador_impresiones_color,
          snap_maquina_serie, 
          snap_maquina_ip,
          print_total,
          copy_total,
          total_servicio,
          fecha_procesamiento,
          fecha_corte
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)
        RETURNING id_reporte
      `;

      const oficialValues = [
        row.lote_id,
        periodo || new Date().toISOString().slice(0, 7),
        row.maquina_id_tentativa,
        row.cliente_id_tentativo,
        row.impresion_bn || 0,
        row.impresion_color || 0,
        row.serie_maquina,
        row.ip_detectada,
        (row.print_total || 0) - (row.copy_total || 0),
        row.copy_total || 0,
        row.totalservicio || 0,
        row.fecha_corte || null
      ];

      const { rows: [newOficial] } = await client.query(insertOficialQuery, oficialValues);

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
      await client.query(moveDetailsQuery, [newOficial.id_reporte, row.id_staging_consolidado]);
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

    await client.query('COMMIT');
    return { success: true, message: 'Lote aprobado correctamente' };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const rejectStagingBatch = async (loteId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
  const getClienteQuery = `SELECT cliente_id_tentativo FROM reportes_consolidado_staging WHERE lote_id = $1 LIMIT 1`;
  const { rows: clienteRows } = await pool.query(getClienteQuery, [loteId]);

  if (clienteRows.length === 0) {
    return { esValido: false, errores: ["El lote está vacío o no contiene registros consolidados."] };
  }

  const cliente_id = clienteRows[0].cliente_id_tentativo;

  const queryMaquinasDB = `
    SELECT i.ip_address, m.serie, i.contabilidad_por_usuario
    FROM instalaciones i INNER JOIN maquinas m ON i.maquina_id = m.id_maquina INNER JOIN areas a ON i.area_id = a.id_area
    WHERE a.cliente_id = $1 AND i.activo = TRUE AND i.fecha_retiro IS NULL
  `;
  const { rows: maquinasDB } = await pool.query(queryMaquinasDB, [cliente_id]);

  const queryStagingConsolidado = `
    SELECT id_staging_consolidado, ip_detectada, serie_maquina, procesar_lectura, mensaje_aviso 
    FROM reportes_consolidado_staging 
    WHERE lote_id = $1
  `;
  const { rows: stagingConsolidado } = await pool.query(queryStagingConsolidado, [loteId]);

  const errores = [];

  if (maquinasDB.length !== stagingConsolidado.length) {
    errores.push(`Cantidad inconsistente: El cliente tiene ${maquinasDB.length} máquinas instaladas, pero el lote trajo ${stagingConsolidado.length} reportes.`);
  }

  stagingConsolidado.forEach(stg => {
    const maquinaBD = maquinasDB.find(m => m.serie === stg.serie_maquina);

    if (!maquinaBD) {
      errores.push(`La máquina con Serie ${stg.serie_maquina} (IP: ${stg.ip_detectada}) reportada en el lote no está asignada a este cliente en el sistema.`);
    } else if (maquinaBD.ip_address !== stg.ip_detectada) {
      errores.push(`Discrepancia de IP en la máquina ${stg.serie_maquina}: El archivo indica ${stg.ip_detectada}, pero en el sistema está registrada con ${maquinaBD.ip_address}.`);
    }

    if (stg.procesar_lectura === false) {
      errores.push(stg.mensaje_aviso || `La máquina ${stg.serie_maquina} tiene un error de estado y sus lecturas fueron bloqueadas.`);
    }
  });

  maquinasDB.forEach(m => {
    const estaEnStaging = stagingConsolidado.some(stg => stg.serie_maquina === m.serie);
    if (!estaEnStaging) {
      errores.push(`Falta el reporte de la máquina: Serie ${m.serie} (IP: ${m.ip_address}).`);
    }
  });

  const maquinasConContabilidadDB = maquinasDB.filter(m => m.contabilidad_por_usuario === true);

  if (maquinasConContabilidadDB.length > 0) {
    const queryStagingDetalle = `SELECT DISTINCT consolidado_staging_id FROM reportes_detalle_staging WHERE lote_id = $1`;
    const { rows: stagingDetalle } = await pool.query(queryStagingDetalle, [loteId]);
    const consolidadosConDetalle = new Set(stagingDetalle.map(d => d.consolidado_staging_id));

    maquinasConContabilidadDB.forEach(m => {
      const reporteConsolidado = stagingConsolidado.find(stg => stg.serie_maquina === m.serie);

      if (reporteConsolidado) {
        if (reporteConsolidado.procesar_lectura !== false && !consolidadosConDetalle.has(reporteConsolidado.id_staging_consolidado)) {
          errores.push(`La máquina Serie ${m.serie} (IP: ${m.ip_address}) requiere contabilidad por usuario, pero no se reportaron los contadores de los usuarios.`);
        }
      }
    });
  }

    // S3-01: volver a validar cada lectura. Entre la ingesta y la aprobación pudo
  // aprobarse otra lectura de la misma máquina y período.
  const { rows: loteRows } = await pool.query(
    'SELECT periodo FROM lotes_carga WHERE id_lote = $1',
    [loteId]
  );
  const { rows: lecturas } = await pool.query(
    `SELECT serie_maquina, maquina_id_tentativa, impresion_bn, impresion_color, fecha_corte
       FROM reportes_consolidado_staging
      WHERE lote_id = $1
        AND procesar_lectura IS DISTINCT FROM FALSE
        AND maquina_id_tentativa IS NOT NULL`,
    [loteId]
  );
  for (const l of lecturas) {
    const periodoLote = loteRows[0]?.periodo || new Date(l.fecha_corte).toISOString().slice(0, 7);
    const rechazo = await validarLectura(pool, {
      maquinaId: l.maquina_id_tentativa,
      periodo: periodoLote,
      fecha: new Date(l.fecha_corte).toISOString().slice(0, 10),
      contadorBn: l.impresion_bn || 0,
      contadorColor: l.impresion_color || 0
    });
    if (rechazo) errores.push(`Máquina ${l.serie_maquina}: ${rechazo.motivo}`);
  }

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