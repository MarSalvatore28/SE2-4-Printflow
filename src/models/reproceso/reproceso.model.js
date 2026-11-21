// S3-05 · Reprocesar un reporte de staging en ERROR (procesar_lectura = false): después de
// corregir la causa (registrar la máquina o su asignación), se vuelve a validar con la misma
// regla de la ingesta y con validarLectura (S3-01). Máximo MAX_INTENTOS veces por reporte.
const validacionLecturas = require('@services/validacionLecturas');
const { buscarMaquinaPorSerie, motivoNoAutorizada } = require('@services/autorizacionMaquina');
const { ACCIONES, leerFila, registrarAuditoria } = require('@services/auditoria');

const MAX_INTENTOS = 3;
const MENSAJE_MAXIMO = 'Máximo de intentos alcanzado: descarte o corrija manualmente';
// La ingesta reemplaza el estado que mandó el correo por ERROR y no lo guarda: al corregirse
// el reporte queda con su valor por defecto («Desconocido»), como cuando el correo no lo trae.
const ESTADO_ERROR = 'ERROR';
const ESTADO_RECUPERADO = 'Desconocido';

const errorNegocio = (status, message, extra = {}) => Object.assign(new Error(message), { status, esNegocio: true, ...extra });

const textoIntentos = (intentos) => `${intentos} de ${MAX_INTENTOS}`;

/**
 * ¿Se puede reprocesar? null si sí, o { status, message } (404 / 409).
 *   reporte: fila de reportes_consolidado_staging (o null)
 */
const motivoNoReprocesable = (reporte) => {
  if (!reporte) return { status: 404, message: 'Reporte no encontrado en staging' };
  if (reporte.procesar_lectura !== false) {
    return { status: 409, message: 'El reporte no está en error: no hace falta reprocesarlo' };
  }
  if ((reporte.intentos_reproceso ?? 0) >= MAX_INTENTOS) {
    return { status: 409, message: MENSAJE_MAXIMO, extra: { intentos: reporte.intentos_reproceso, max_intentos: MAX_INTENTOS } };
  }
  return null;
};

const getReporteParaReprocesar = async (db, id) => {
  const { rows } = await db.query(
    `SELECT s.id_staging_consolidado, s.lote_id, s.serie_maquina, s.ip_detectada,
            s.impresion_bn, s.impresion_color, s.estado_maquina, s.procesar_lectura, s.mensaje_aviso,
            s.intentos_reproceso,
            TO_CHAR(s.fecha_corte AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD') AS fecha,
            l.periodo AS lote_periodo
     FROM reportes_consolidado_staging s
     LEFT JOIN lotes_carga l ON l.id_lote = s.lote_id
     WHERE s.id_staging_consolidado = $1
     FOR UPDATE OF s`,
    [id]
  );
  return rows[0] || null;
};

// ¿La asignación vigente exige las cuentas de usuario? El correo de una máquina no autorizada no
// las guardó, así que el lote no pasará la validación aunque el reporte quede corregido.
const exigeCuentasDeUsuario = async (db, instalacionId, reporteId) => {
  const { rows } = await db.query(
    `SELECT i.contabilidad_por_usuario,
            EXISTS (SELECT 1 FROM reportes_detalle_staging d WHERE d.consolidado_staging_id = $2) AS tiene_cuentas
     FROM instalaciones i WHERE i.id_instalacion = $1`,
    [instalacionId, reporteId]
  );
  return Boolean(rows[0]?.contabilidad_por_usuario && !rows[0].tiene_cuentas);
};

/**
 * Reprocesa el reporte `id`. Lanza errorNegocio(404/409) si no se puede.
 * Devuelve { reporte, intentos, max_intentos, intentos_texto, corregido, motivo, codigo, aviso }.
 * S3-02: cada intento queda auditado con `auditoria` = { usuarioId, ip } de la petición.
 */
const reprocesarReporte = async (pool, id, auditoria = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reporte = await getReporteParaReprocesar(client, id);
    const bloqueo = motivoNoReprocesable(reporte);
    if (bloqueo) throw errorNegocio(bloqueo.status, bloqueo.message, bloqueo.extra);

    const intentos = (reporte.intentos_reproceso ?? 0) + 1;
    const antes = await leerFila(client, 'reportes_consolidado_staging', id);

    // 1. La máquina por serie y su asignación vigente, igual que la ingesta
    const maquina = await buscarMaquinaPorSerie(client, reporte.serie_maquina);
    let motivo = motivoNoAutorizada(maquina);
    let codigo = motivo ? 'NO_AUTORIZADA' : null;

    // 2. Autorizada: la lectura pasa por validarLectura (S3-01)
    if (!motivo) {
      const fecha = reporte.fecha;
      const rechazo = await validacionLecturas.validarLectura(client, {
        maquinaId: maquina.maquinaId,
        instalacionId: maquina.instalacionId,
        periodo: reporte.lote_periodo || (fecha ? fecha.slice(0, 7) : null),
        fecha,
        contadorBn: Number(reporte.impresion_bn) || 0,
        contadorColor: Number(reporte.impresion_color) || 0,
      });
      if (rechazo) {
        motivo = rechazo.motivo;
        codigo = rechazo.codigo;
      }
    }

    const corregido = !motivo;
    const estado = corregido
      ? (reporte.estado_maquina === ESTADO_ERROR ? ESTADO_RECUPERADO : reporte.estado_maquina)
      : ESTADO_ERROR;

    const { rows } = await client.query(
      `UPDATE reportes_consolidado_staging
       SET intentos_reproceso = $2,
           maquina_id_tentativa = $3,
           cliente_id_tentativo = $4,
           procesar_lectura = $5,
           estado_maquina = $6,
           mensaje_aviso = $7
       WHERE id_staging_consolidado = $1
       RETURNING *`,
      [id, intentos, maquina.maquinaId, maquina.clienteId, corregido, estado, corregido ? null : motivo]
    );

    const aviso = corregido && (await exigeCuentasDeUsuario(client, maquina.instalacionId, id))
      ? 'La asignación lleva contabilidad por usuario y este reporte no trae las cuentas: el lote no pasará la validación. Registre una lectura manual o pida el correo de nuevo.'
      : null;

    await registrarAuditoria(client, {
      tabla: 'reportes_consolidado_staging', idRegistro: id, accion: ACCIONES.REPROCESAR, antes, despues: rows[0], ...auditoria,
    });

    await client.query('COMMIT');
    return {
      reporte: rows[0],
      intentos,
      max_intentos: MAX_INTENTOS,
      intentos_texto: textoIntentos(intentos),
      corregido,
      motivo: motivo || null,
      codigo,
      aviso,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { MAX_INTENTOS, MENSAJE_MAXIMO, motivoNoReprocesable, textoIntentos, reprocesarReporte };
