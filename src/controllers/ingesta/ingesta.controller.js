const {
  normalizarSerie,
  buscarMaquinaPorSerie,
  estaAutorizada,
  motivoNoAutorizada
} = require('@services/autorizacionMaquina');

const { validarLectura } = require('@services/validacionLecturas');
const { fechaCorteDelReporte, fechaLecturaDelDetalle } = require('@utils/fechaCorte');

// Caja 9, mejora 3.2: true si el correo (Message-ID) ya se procesó en otra petición
async function correoYaProcesado(client, messageId, vistosEnEstaPeticion) {
  if (!messageId || vistosEnEstaPeticion.has(messageId)) return false;
  const yaProcesado = await client.query(
    'SELECT id_lote FROM public.lotes_carga WHERE message_id = $1',
    [messageId]
  );
  if (yaProcesado.rows.length > 0) return true;
  vistosEnEstaPeticion.add(messageId);
  return false;
}

// Id del lote del código de referencia: el de la caché, el que ya existe o uno nuevo
async function obtenerLote(client, loteInfo, messageId, loteCache) {
  if (loteCache[loteInfo.codigo_referencia]) return loteCache[loteInfo.codigo_referencia];

  const buscarLote = await client.query(
    'SELECT id_lote FROM public.lotes_carga WHERE codigo_referencia = $1',
    [loteInfo.codigo_referencia]
  );
  let idLote;
  if (buscarLote.rows.length > 0) {
    idLote = buscarLote.rows[0].id_lote;
  } else {
    const crearLote = await client.query(
      `INSERT INTO public.lotes_carga
       (codigo_referencia, fecha_carga, total_registros_cargados, periodo, message_id)
       VALUES ($1, NOW(), 0, $2, $3)
       RETURNING id_lote`,
      [loteInfo.codigo_referencia, loteInfo.periodo || null, messageId]
    );
    idLote = crearLote.rows[0].id_lote;
  }
  loteCache[loteInfo.codigo_referencia] = idLote;
  return idLote;
}

// Misma regla que el reprocesar (S3-05): src/services/autorizacionMaquina.js
async function maquinaDeLaSerie(client, serieLimpia, maquinaCache) {
  if (!serieLimpia) return { serie: serieLimpia, maquinaId: null, clienteId: null };
  if (maquinaCache[serieLimpia] === undefined) {
    maquinaCache[serieLimpia] = await buscarMaquinaPorSerie(client, serieLimpia);
  }
  const { maquinaId, clienteId } = maquinaCache[serieLimpia];
  return { serie: serieLimpia, maquinaId, clienteId };
}

// Estado con el que la lectura entra a staging: el que trae el reporte, o ERROR si la máquina no
// está autorizada o si la lectura no pasa las reglas.
async function estadoDeLaLectura(client, { consolidado, maquina, maquinaAutorizada, periodoLote, fechaCorte }) {
  // Caja 9, mejora 3.3: serie no registrada o sin asignación vigente → ERROR, sin lectura.
  // procesar_lectura = false hace que la aprobación la salte y que aparezca en las alertas del lote.
  if (!maquinaAutorizada) {
    return { estadoMaquina: 'ERROR', procesarLectura: false, mensajeAviso: motivoNoAutorizada(maquina) };
  }

  // S3-01: la lectura debe pasar las reglas (retroceso, salto anómalo, duplicada).
  // Solo se valida si la máquina está autorizada.
  const rechazo = await validarLectura(client, {
    maquinaId: maquina.maquinaId,
    periodo: periodoLote || fechaCorte.substring(0, 7),
    fecha: fechaCorte.substring(0, 10),
    contadorBn: consolidado.bn_total || 0,
    contadorColor: consolidado.color_total || 0
  });
  if (rechazo) return { estadoMaquina: 'ERROR', procesarLectura: false, mensajeAviso: rechazo.motivo };

  return {
    estadoMaquina: consolidado.estado_maquina || 'Desconocido',
    procesarLectura: consolidado.procesar_lectura === undefined ? true : consolidado.procesar_lectura,
    mensajeAviso: consolidado.mensaje_aviso || null
  };
}

async function insertarConsolidado(client, { idLote, consolidado, fechaLectura, maquina, estado }) {
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
    fechaLectura,
    fechaLectura, // fecha_corte: el mismo instante, en hora de Ecuador
    maquina.maquinaId,
    maquina.clienteId,
    consolidado.serie_maquina,
    0,
    0,
    consolidado.bn_total || 0,
    consolidado.color_total || 0,
    consolidado.print_total || 0, // totalservicio
    estado.estadoMaquina,
    estado.procesarLectura,
    estado.mensajeAviso
  ];

  const resConsolidado = await client.query(queryConsolidado, valuesConsolidado);
  return resConsolidado.rows[0].id_staging_consolidado;
}

async function insertarDetalles(client, { idLote, idPadre, maquinaId, detalles }) {
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

  for (const det of detalles) {
    // Hora de Ecuador explícita: el trigger sync_fecha_corte_from_detalle copia la mayor al corte
    const fechaLecturaDetalle = fechaLecturaDelDetalle(det) || new Date();

    const valuesDetalle = [
      idLote,
      idPadre,
      det.cuenta_id,
      det.print_diario,
      det.copy_diario,
      det.usuario_trabajo,
      fechaLecturaDetalle,
      maquinaId,
      det.copia_bn || 0,
      det.copia_color || 0,
      det.impresion_bn || 0,
      det.impresion_color || 0,
      det.ip_detectada
    ];

    await client.query(queryDetalle, valuesDetalle); // NOSONAR: en orden, misma transacción y mismo client
  }
}

// Registra un reporte en staging. Devuelve false si se descartó porque el correo ya se había procesado.
async function procesarReporte(client, item, ctx) {
  const { lote_info, consolidado, detalles } = item;

  const messageId = lote_info.message_id ? String(lote_info.message_id).trim() : null;
  if (await correoYaProcesado(client, messageId, ctx.messageIdsDeEstaPeticion)) {
    ctx.descartados.push({ message_id: messageId, estado: 'DESCARTADO', motivo: 'Correo ya procesado' });
    return false;
  }

  const idLote = await obtenerLote(client, lote_info, messageId, ctx.loteCache);
  ctx.conteoPorLote[idLote] = (ctx.conteoPorLote[idLote] || 0) + 1;

  const maquina = await maquinaDeLaSerie(client, normalizarSerie(consolidado.serie_maquina), ctx.maquinaCache);
  const maquinaAutorizada = estaAutorizada(maquina);

  // Fecha de corte en hora de Ecuador (no a medianoche UTC): src/utils/fechaCorte.js
  // fecha_corte se guarda igual que fecha_lectura, con su desfase (-05:00): así el trigger
  // fix_global_time no la mueve y el día no depende de la zona horaria de la base.
  const { fechaCorte, fechaLectura } = fechaCorteDelReporte(detalles, lote_info.fecha_carga);

  const estado = await estadoDeLaLectura(client, {
    consolidado, maquina, maquinaAutorizada, periodoLote: lote_info.periodo, fechaCorte
  });

  const idPadre = await insertarConsolidado(client, { idLote, consolidado, fechaLectura, maquina, estado });

  // Una máquina no autorizada no registra los contadores por usuario
  if (maquinaAutorizada && detalles && detalles.length > 0) {
    await insertarDetalles(client, { idLote, idPadre, maquinaId: maquina.maquinaId, detalles });
  }
  return true;
}

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
    const ctx = {
      loteCache: {},
      maquinaCache: {},
      conteoPorLote: {},
      descartados: [],
      messageIdsDeEstaPeticion: new Set()
    };

    for (const item of payload) {
      if (await procesarReporte(client, item, ctx)) totalProcesados++; // NOSONAR: en orden, cada reporte usa las cachés y los message_id de los anteriores
    }

    for (const idLote in ctx.conteoPorLote) {
      const cantidad = ctx.conteoPorLote[idLote];
      await client.query( // NOSONAR: en orden, misma transacción y mismo client
        `UPDATE public.lotes_carga
         SET total_registros_cargados = COALESCE(total_registros_cargados, 0) + $1
         WHERE id_lote = $2`,
        [cantidad, idLote]
      );
    }

    await client.query('COMMIT');

    const { descartados } = ctx;
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
