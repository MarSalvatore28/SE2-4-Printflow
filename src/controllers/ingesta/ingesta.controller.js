const processIngestaController = async (req, res) => {
  const payload = req.body;

  if (!Array.isArray(payload) || payload.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'El cuerpo de la petición debe ser un array de reportes.'
    });
  }

  const client = await req.pool.connect();

  try {
    await client.query('BEGIN');

    let totalProcesados = 0;
    const loteCache = {};
    const maquinaCache = {};
    const conteoPorLote = {};
    const descartados = [];
    const messageIdsDeEstaPeticion = new Set();

    for (const item of payload) {
      const { lote_info, consolidado, detalles } = item;
      let idLote;

      // Caja 9, mejora 3.2: si el correo (Message-ID) ya se procesó en otra petición, se descarta
      const messageId = lote_info.message_id ? String(lote_info.message_id).trim() : null;
      if (messageId && !messageIdsDeEstaPeticion.has(messageId)) {
        const yaProcesado = await client.query(
          'SELECT id_lote FROM public.lotes_carga WHERE message_id = $1',
          [messageId]
        );
        if (yaProcesado.rows.length > 0) {
          descartados.push({ message_id: messageId, estado: 'DESCARTADO', motivo: 'Correo ya procesado' });
          continue;
        }
        messageIdsDeEstaPeticion.add(messageId);
      }

      if (loteCache[lote_info.codigo_referencia]) {
        idLote = loteCache[lote_info.codigo_referencia];
      } else {
        const buscarLote = await client.query(
          'SELECT id_lote FROM public.lotes_carga WHERE codigo_referencia = $1',
          [lote_info.codigo_referencia]
        );

        if (buscarLote.rows.length > 0) {
          idLote = buscarLote.rows[0].id_lote;
        } else {
          const crearLote = await client.query(
            `INSERT INTO public.lotes_carga
             (codigo_referencia, fecha_carga, total_registros_cargados, periodo, message_id)
             VALUES ($1, NOW(), 0, $2, $3)
             RETURNING id_lote`,
            [lote_info.codigo_referencia, lote_info.periodo || null, messageId]
          );
          idLote = crearLote.rows[0].id_lote;
        }
        loteCache[lote_info.codigo_referencia] = idLote;
      }

      if (!conteoPorLote[idLote]) conteoPorLote[idLote] = 0;
      conteoPorLote[idLote]++;

      let maquinaIdTentativa = null;
      let clienteIdTentativo = null;
      let serieLimpia = consolidado.serie_maquina ? consolidado.serie_maquina.trim().toUpperCase() : null;

      if (serieLimpia) {
        if (maquinaCache[serieLimpia] !== undefined) {
          const cached = maquinaCache[serieLimpia];
          maquinaIdTentativa = cached.id_maquina;
          clienteIdTentativo = cached.id_cliente;
        } else {
          const buscarDatos = await client.query(
            `SELECT m.id_maquina, a.cliente_id
             FROM public.maquinas m
             LEFT JOIN public.instalaciones i 
                ON m.id_maquina = i.maquina_id 
                AND i.activo = true 
                AND i.fecha_retiro IS NULL
             LEFT JOIN public.areas a 
                ON i.area_id = a.id_area
             WHERE UPPER(TRIM(m.serie)) = $1 LIMIT 1`,
            [serieLimpia]
          );

          if (buscarDatos.rows.length > 0) {
            const row = buscarDatos.rows[0];
            maquinaIdTentativa = row.id_maquina;
            clienteIdTentativo = row.cliente_id || null;
          }

          maquinaCache[serieLimpia] = {
            id_maquina: maquinaIdTentativa,
            id_cliente: clienteIdTentativo
          };
        }
      }

      const totalServicio = consolidado.print_total || 0;

      let estadoMaquina = consolidado.estado_maquina || 'Desconocido';
      let procesarLectura = consolidado.procesar_lectura !== undefined ? consolidado.procesar_lectura : true;
      let mensajeAviso = consolidado.mensaje_aviso || null;

      // Caja 9, mejora 3.3: serie no registrada o sin asignación vigente → ERROR, sin lectura.
      // procesar_lectura = false hace que la aprobación la salte y que aparezca en las alertas del lote.
      const maquinaAutorizada = maquinaIdTentativa !== null && clienteIdTentativo !== null;
      if (!maquinaAutorizada) {
        estadoMaquina = 'ERROR';
        procesarLectura = false;
        mensajeAviso = maquinaIdTentativa === null
          ? `Máquina no autorizada: la serie ${serieLimpia || '(vacía)'} no está registrada`
          : `Máquina no autorizada: la serie ${serieLimpia} no tiene una asignación vigente`;
      }
      // Función para extraer YYYY-MM-DD seguro
      const extractDate = (dateStr) => {
        if (!dateStr) return null;
        const s = dateStr.trim();
        // Si tiene formato YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
        // Si tiene formato DD/MM/YYYY o DD-MM-YYYY
        const parts = s.split(/[/-]/);
        if (parts.length === 3) {
          if (parts[2].length === 4) { // DD/MM/YYYY
             const day = parts[0].padStart(2, '0');
             const month = parts[1].padStart(2, '0');
             return `${parts[2]}-${month}-${day}`;
          }
        }
        try {
          const d = new Date(s);
          if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
        } catch (e) {}
        return null;
      };

      let fechaLecturaConsolidado;
      let fechaCorteConsolidado;

      if (detalles && detalles.length > 0) {
        let maxTime = 0;
        let bestDateStr = null;
        
        for (const d of detalles) {
          const fmtDate = extractDate(d.fecha_transaccion);
          if (fmtDate) {
            const time = new Date(`${fmtDate}T00:00:00.000Z`).getTime();
            if (time > maxTime) {
              maxTime = time;
              bestDateStr = fmtDate;
            }
          }
        }

        if (bestDateStr) {
          fechaCorteConsolidado = bestDateStr;
          fechaLecturaConsolidado = `${bestDateStr}T00:00:00.000Z`;
        } else {
          const fb = lote_info.fecha_carga ? new Date(lote_info.fecha_carga) : new Date();
          fechaLecturaConsolidado = fb.toISOString();
          fechaCorteConsolidado = fb.toISOString().substring(0, 10);
        }
      } else {
        const fb = lote_info.fecha_carga ? new Date(lote_info.fecha_carga) : new Date();
        fechaLecturaConsolidado = fb.toISOString();
        fechaCorteConsolidado = fb.toISOString().substring(0, 10);
      }

      const queryConsolidado = `
        INSERT INTO public.reportes_consolidado_staging
        (
          lote_id, ip_detectada, print_total, copy_total, 
          fecha_lectura, fecha_corte, maquina_id_tentativa, cliente_id_tentativo, 
          serie_maquina, 
          copia_bn, copia_color,
          impresion_bn, impresion_color, 
          totalservicio,
          estado_maquina, procesar_lectura, mensaje_aviso
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id_staging_consolidado
      `;

      const valuesConsolidado = [
        idLote,
        consolidado.ip_detectada,
        consolidado.print_total,
        consolidado.copy_total,
        fechaLecturaConsolidado,
        fechaCorteConsolidado,
        maquinaIdTentativa,
        clienteIdTentativo,
        consolidado.serie_maquina,
        0,
        0,
        consolidado.bn_total || 0,
        consolidado.color_total || 0,
        totalServicio,
        estadoMaquina,
        procesarLectura,
        mensajeAviso
      ];

      const resConsolidado = await client.query(queryConsolidado, valuesConsolidado);
      const idPadre = resConsolidado.rows[0].id_staging_consolidado;

      // Una máquina no autorizada no registra los contadores por usuario
      if (maquinaAutorizada && detalles && detalles.length > 0) {
        for (const det of detalles) {

          let fechaLecturaDetalle = new Date();
          const pFmt = extractDate(det.fecha_transaccion);
          if (pFmt && det.hora_transaccion) {
            fechaLecturaDetalle = `${pFmt} ${det.hora_transaccion}`;
          } else if (pFmt) {
            fechaLecturaDetalle = `${pFmt} 00:00:00`;
          }

          let imp_bn = det.impresion_bn || 0;
          let imp_color = det.impresion_color || 0;
          let cop_bn = det.copia_bn || 0;
          let cop_color = det.copia_color || 0;

          const queryDetalle = `
            INSERT INTO public.reportes_detalle_staging
            (
              lote_id, consolidado_staging_id, cuenta_id, 
              print_total, copy_total, nombre_cuenta, fecha_lectura, 
              maquina_id_tentativa, copia_bn, copia_color,
              impresion_bn, impresion_color, nombre_host
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `;

          const valuesDetalle = [
            idLote,
            idPadre,
            det.cuenta_id,
            det.print_diario,
            det.copy_diario,
            det.usuario_trabajo,
            fechaLecturaDetalle,
            maquinaIdTentativa,
            cop_bn,
            cop_color,
            imp_bn,
            imp_color,
            det.ip_detectada
          ];

          await client.query(queryDetalle, valuesDetalle);
        }
      }

      totalProcesados++;
    }

    for (const idLote in conteoPorLote) {
      const cantidad = conteoPorLote[idLote];
      await client.query(
        `UPDATE public.lotes_carga 
         SET total_registros_cargados = COALESCE(total_registros_cargados, 0) + $1 
         WHERE id_lote = $2`,
        [cantidad, idLote]
      );
    }

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: totalProcesados > 0 ? 'Ingesta procesada correctamente' : 'Correo ya procesado: no se registró nada',
      estado: totalProcesados > 0 ? 'PROCESADO' : 'DESCARTADO',
      data: { total_procesados: totalProcesados, total_descartados: descartados.length, descartados }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    // Dos peticiones con el mismo Message-ID a la vez: el índice único frena la segunda
    if (error.code === '23505' && error.constraint === 'lotes_carga_message_id_uq') {
      return res.status(200).json({
        success: true,
        message: 'Correo ya procesado: no se registró nada',
        estado: 'DESCARTADO',
        data: { total_procesados: 0 }
      });
    }
    console.error('Error en ingesta controller:', error);
    res.status(500).json({
      success: false,
      message: 'Error al procesar la ingesta',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

module.exports = { processIngestaController };