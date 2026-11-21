const {
  normalizarSerie,
  buscarMaquinaPorSerie,
  estaAutorizada,
  motivoNoAutorizada
} = require('@services/autorizacionMaquina');

const { validarLectura } = require('@services/validacionLecturas');
const { fechaCorteDelReporte, fechaLecturaDelDetalle } = require('@utils/fechaCorte');

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
      const serieLimpia = normalizarSerie(consolidado.serie_maquina);

      // Misma regla que el reprocesar (S3-05): src/services/autorizacionMaquina.js
      if (serieLimpia) {
        if (maquinaCache[serieLimpia] === undefined) {
          maquinaCache[serieLimpia] = await buscarMaquinaPorSerie(client, serieLimpia);
        }
        maquinaIdTentativa = maquinaCache[serieLimpia].maquinaId;
        clienteIdTentativo = maquinaCache[serieLimpia].clienteId;
      }

      const totalServicio = consolidado.print_total || 0;

      let estadoMaquina = consolidado.estado_maquina || 'Desconocido';
      let procesarLectura = consolidado.procesar_lectura !== undefined ? consolidado.procesar_lectura : true;
      let mensajeAviso = consolidado.mensaje_aviso || null;

      // Caja 9, mejora 3.3: serie no registrada o sin asignación vigente → ERROR, sin lectura.
      // procesar_lectura = false hace que la aprobación la salte y que aparezca en las alertas del lote.
      const maquina = { serie: serieLimpia, maquinaId: maquinaIdTentativa, clienteId: clienteIdTentativo };
      const maquinaAutorizada = estaAutorizada(maquina);
      if (!maquinaAutorizada) {
        estadoMaquina = 'ERROR';
        procesarLectura = false;
        mensajeAviso = motivoNoAutorizada(maquina);
      }
      // Fecha de corte en hora de Ecuador (no a medianoche UTC): src/utils/fechaCorte.js
      // fecha_corte se guarda igual que fecha_lectura, con su desfase (-05:00): así el trigger
      // fix_global_time no la mueve y el día no depende de la zona horaria de la base.
      const { fechaCorte: fechaCorteConsolidado, fechaLectura: fechaLecturaConsolidado } =
        fechaCorteDelReporte(detalles, lote_info.fecha_carga);

      // S3-01: la lectura debe pasar las reglas (retroceso, salto anómalo, duplicada).
      // Solo se valida si la máquina está autorizada; si no, ya quedó en ERROR arriba.
      if (maquinaAutorizada) {
        const rechazo = await validarLectura(client, {
          maquinaId: maquinaIdTentativa,
          periodo: lote_info.periodo || fechaCorteConsolidado.substring(0, 7),
          fecha: fechaCorteConsolidado.substring(0, 10),
          contadorBn: consolidado.bn_total || 0,
          contadorColor: consolidado.color_total || 0
        });
        if (rechazo) {
          estadoMaquina = 'ERROR';
          procesarLectura = false;
          mensajeAviso = rechazo.motivo;
        }
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
        fechaLecturaConsolidado, // fecha_corte: el mismo instante, en hora de Ecuador
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

          // Hora de Ecuador explícita: el trigger sync_fecha_corte_from_detalle copia la mayor al corte
          const fechaLecturaDetalle = fechaLecturaDelDetalle(det) || new Date();

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