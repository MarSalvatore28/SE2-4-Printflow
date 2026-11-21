// S3-04 · Lectura manual: los contadores que el operador leyó en la máquina pasan directo a
// reportes_oficiales (origen = 'MANUAL'), como si fueran la lectura aprobada del mes.
// Se importa el módulo entero (no la función) para usar siempre la versión vigente de validarLectura.
const validacionLecturas = require('@services/validacionLecturas');
const { motivoAsignacionNoVigente } = require('@utils/lecturaManual.reglas');
const { ACCIONES, auditarFila } = require('@services/auditoria');

// Error de negocio: el controlador lo responde con su status y su mensaje
const errorNegocio = (status, message, extra = {}) => Object.assign(new Error(message), { status, esNegocio: true, ...extra });

// La asignación con su máquina, área y cliente (bloqueada mientras dura el registro)
const getAsignacion = async (db, instalacionId) => {
  const { rows } = await db.query(
    `SELECT i.id_instalacion, i.maquina_id, i.ip_address, i.activo,
            TO_CHAR(i.fecha_instalacion, 'YYYY-MM-DD') AS fecha_instalacion,
            TO_CHAR(i.fecha_retiro, 'YYYY-MM-DD') AS fecha_retiro,
            m.serie, m.activo AS maquina_activa,
            a.id_area, a.nombre AS area_nombre, a.cliente_id, c.nombre AS cliente_nombre
     FROM instalaciones i
     JOIN maquinas m ON m.id_maquina = i.maquina_id
     JOIN areas a ON a.id_area = i.area_id
     LEFT JOIN clientes c ON c.id_cliente = a.cliente_id
     WHERE i.id_instalacion = $1
     FOR SHARE OF i`,
    [instalacionId]
  );
  return rows[0] || null;
};

// Igual que la aprobación de un lote: contador_impresiones_* guarda el total B/N y el total
// color (impresiones + copias) y las columnas de copias quedan en 0. La fecha de corte es el
// mediodía de Ecuador del día de la lectura, para que no cambie de día con la zona horaria.
const insertarLectura = async (db, asignacion, datos, usuarioId) => {
  const total = datos.contadorBn + datos.contadorColor;
  const { rows } = await db.query(
    `INSERT INTO reportes_oficiales (
       periodo, maquina_id, cliente_id,
       contador_impresiones_bn, contador_impresiones_color, contador_copias_bn, contador_copias_color,
       print_total, copy_total, total_servicio,
       snap_maquina_serie, snap_maquina_ip, snap_area_nombre,
       fecha_procesamiento, fecha_corte,
       origen, observacion, usuario_registro_id
     ) VALUES (
       $1, $2, $3,
       $4, $5, 0, 0,
       $6, 0, $6,
       $7, $8, $9,
       NOW(), ($10::date + TIME '12:00') AT TIME ZONE 'America/Guayaquil',
       'MANUAL', $11, $12
     )
     RETURNING id_reporte, periodo, maquina_id, cliente_id,
               contador_impresiones_bn AS contador_bn, contador_impresiones_color AS contador_color,
               snap_maquina_serie, snap_maquina_ip, snap_area_nombre,
               fecha_corte, fecha_procesamiento, origen, observacion, usuario_registro_id`,
    [
      datos.periodo, asignacion.maquina_id, asignacion.cliente_id,
      datos.contadorBn, datos.contadorColor,
      total,
      asignacion.serie, asignacion.ip_address, asignacion.area_nombre,
      datos.fecha,
      datos.observacion, usuarioId,
    ]
  );
  return rows[0];
};

/**
 * Registra una lectura manual. `datos` viene de validarDatosLecturaManual.
 * Lanza errorNegocio(400) si la asignación no está vigente o si validarLectura la rechaza
 * (con su motivo tal cual y su código).
 * S3-02: el alta queda auditada con el usuario y la `ip` de la petición.
 */
const registrarLecturaManual = async (pool, datos, usuarioId, ip = null) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const asignacion = await getAsignacion(client, datos.instalacionId);
    const noVigente = motivoAsignacionNoVigente(asignacion, datos.fecha);
    if (noVigente) throw errorNegocio(400, noVigente);

    const rechazo = await validacionLecturas.validarLectura(client, {
      maquinaId: asignacion.maquina_id,
      instalacionId: asignacion.id_instalacion,
      periodo: datos.periodo,
      fecha: datos.fecha,
      contadorBn: datos.contadorBn,
      contadorColor: datos.contadorColor,
    });
    if (rechazo) throw errorNegocio(400, rechazo.motivo, { codigo: rechazo.codigo });

    const lectura = await insertarLectura(client, asignacion, datos, usuarioId);
    await auditarFila(client, {
      tabla: 'reportes_oficiales', idRegistro: lectura.id_reporte, accion: ACCIONES.CREAR, usuarioId, ip,
    });
    await client.query('COMMIT');

    return {
      ...lectura,
      instalacion_id: asignacion.id_instalacion,
      area_id: asignacion.id_area,
      cliente_nombre: asignacion.cliente_nombre,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { registrarLecturaManual };
