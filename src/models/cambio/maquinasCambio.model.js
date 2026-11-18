const pool = require('@config/db');
const { contadorMenorQueLectura } = require('@utils/maquinasCambio.reglas');

// Error de negocio: el controlador lo responde con su status (400/404/409) y su mensaje.
const errorNegocio = (status, message) => Object.assign(new Error(message), { status, esNegocio: true });

// Lectura B/N y color de un reporte oficial, igual que la calcula el consolidado:
// la suma de las cuentas de usuario si las tiene, si no los contadores del reporte.
const LECTURA_REPORTE = `
  COALESCE(det.bn, COALESCE(ro.contador_impresiones_bn, 0) + COALESCE(ro.contador_copias_bn, 0))::int AS bn,
  COALESCE(det.color, COALESCE(ro.contador_impresiones_color, 0) + COALESCE(ro.contador_copias_color, 0))::int AS color
`;
const DETALLE_REPORTE = `
  LEFT JOIN LATERAL (
    SELECT SUM(d.cnt_impresion_bn + d.cnt_copia_bn) AS bn,
           SUM(d.cnt_impresion_color + d.cnt_copia_color) AS color
    FROM reportes_detalle_oficial d
    WHERE d.reporte_oficial_id = ro.id_reporte
  ) det ON TRUE
`;

/**
 * Última lectura aprobada de la máquina ANTES del período (el contador acumulado
 * del que parte el consumo del período). null si no tiene ninguna.
 */
const getUltimaLecturaAntesDe = async (db, maquinaId, periodo) => {
  const { rows } = await db.query(
    `SELECT ro.periodo, ${LECTURA_REPORTE}
     FROM reportes_oficiales ro
     ${DETALLE_REPORTE}
     WHERE ro.maquina_id = $1 AND ro.periodo < $2
     ORDER BY ro.periodo DESC, ro.id_reporte DESC
     LIMIT 1`,
    [maquinaId, periodo]
  );
  return rows[0] || null;
};

// Datos de la máquina para el registro, con su asignación vigente (si la tiene) bloqueada
const getMaquinaParaCambio = async (db, maquinaId) => {
  const { rows } = await db.query(
    `SELECT m.id_maquina, m.serie, m.activo, mo.nombre AS modelo
     FROM maquinas m
     LEFT JOIN modelos mo ON mo.id_modelo = m.modelo_id
     WHERE m.id_maquina = $1`,
    [maquinaId]
  );
  return rows[0] || null;
};

const getAsignacionVigente = async (db, maquinaId) => {
  const { rows } = await db.query(
    `SELECT i.id_instalacion, i.area_id, i.contrato_id, i.ip_address,
            TO_CHAR(i.fecha_instalacion, 'YYYY-MM-DD') AS fecha_instalacion,
            i.costo_renta_mensual, i.contador_acumulativo, i.contabilidad_por_usuario,
            a.nombre AS area_nombre, a.cliente_id, c.nombre AS cliente_nombre
     FROM instalaciones i
     JOIN areas a ON a.id_area = i.area_id
     JOIN clientes c ON c.id_cliente = a.cliente_id
     WHERE i.maquina_id = $1 AND i.activo = TRUE AND i.fecha_retiro IS NULL
     FOR UPDATE OF i`,
    [maquinaId]
  );
  return rows[0] || null;
};

const insertarCabecera = (db, cambioId, maquinaId, tipo, contador, anterior) => {
  // Los contadores del cambio son el total B/N y el total color del equipo (impresiones
  // + copias), igual que los guarda la ingesta en contador_impresiones_*; las columnas
  // de copias quedan en 0.
  const ant = anterior || { bn: 0, color: 0 };
  const difBn = anterior ? contador.bn - ant.bn : 0;
  const difColor = anterior ? contador.color - ant.color : 0;
  return db.query(
    `INSERT INTO cabecera_contadores_cambio (
       maquina_cambio_id, maquina_id, tipo_maquina,
       contador_anterior_imp_bn, contador_anterior_imp_col, contador_anterior_total_impresiones, contador_anterior_global,
       contador_actual_imp_bn, contador_actual_imp_col, contador_actual_total_impresiones, contador_actual_global,
       diferencia_imp_bn, diferencia_imp_col, diferencia_total_impresiones, diferencia_global
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $9, $10, $11, $12, $12)`,
    [
      cambioId, maquinaId, tipo,
      ant.bn, ant.color, ant.bn + ant.color,
      contador.bn, contador.color, contador.bn + contador.color,
      difBn, difColor, difBn + difColor,
    ]
  );
};

/**
 * Registra el reemplazo en una sola transacción:
 *  1. maquinas_cambio y las dos cabeceras de contadores (SALIENTE al salir, ENTRANTE al entrar);
 *  2. retira la asignación de la saliente (fecha de retiro = fecha del daño);
 *  3. crea la asignación de la entrante en la misma área, contrato e IP (o la IP indicada).
 * Lanza errorNegocio (status 400/404/409) si algo no cuadra; no deja nada a medias.
 */
const registrarReemplazo = async (datos) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const saliente = await getMaquinaParaCambio(client, datos.maquina_saliente_id);
    if (!saliente) throw errorNegocio(404, 'La máquina saliente no existe');
    const entrante = await getMaquinaParaCambio(client, datos.maquina_entrante_id);
    if (!entrante) throw errorNegocio(404, 'La máquina entrante no existe');

    const asignacion = await getAsignacionVigente(client, saliente.id_maquina);
    if (!asignacion) {
      throw errorNegocio(409, `La máquina saliente ${saliente.serie} no tiene una asignación vigente: solo se reemplaza una máquina asignada`);
    }

    if (!entrante.activo) throw errorNegocio(409, `La máquina entrante ${entrante.serie} está inactiva`);
    const asignacionEntrante = await getAsignacionVigente(client, entrante.id_maquina);
    if (asignacionEntrante) {
      throw errorNegocio(409, `La máquina entrante ${entrante.serie} ya está asignada a ${asignacionEntrante.cliente_nombre} · ${asignacionEntrante.area_nombre}. Elija una máquina libre`);
    }

    if (datos.fecha_danio < asignacion.fecha_instalacion) {
      throw errorNegocio(400, `La fecha del daño no puede ser anterior a la instalación de ${saliente.serie} (${asignacion.fecha_instalacion})`);
    }
    if (datos.fecha_instalacion_entrante < asignacion.fecha_instalacion) {
      throw errorNegocio(400, `La fecha de instalación de la entrante no puede ser anterior a la instalación de ${saliente.serie} (${asignacion.fecha_instalacion})`);
    }

    // Un período ya aprobado no se recalcula: el cambio debe registrarse antes de aprobar su lote
    const { rows: yaAprobado } = await client.query(
      `SELECT m.serie FROM reportes_oficiales ro JOIN maquinas m ON m.id_maquina = ro.maquina_id
       WHERE ro.periodo = $1 AND ro.maquina_id = ANY($2::int[]) LIMIT 1`,
      [datos.periodo_afectado, [saliente.id_maquina, entrante.id_maquina]]
    );
    if (yaAprobado.length > 0) {
      throw errorNegocio(409, `El período ${datos.periodo_afectado} ya tiene lecturas aprobadas de ${yaAprobado[0].serie}. El reemplazo debe registrarse antes de aprobar el lote de ese período`);
    }

    // Una máquina participa en un solo cambio por período (el consolidado muestra una fila por cambio)
    const { rows: otroCambio } = await client.query(
      `SELECT id_maquina_cambio FROM maquinas_cambio
       WHERE activo = TRUE AND periodo_afectado = $1
         AND (maquina_saliente_id = ANY($2::int[]) OR maquina_entrante_id = ANY($2::int[]))
       LIMIT 1`,
      [datos.periodo_afectado, [saliente.id_maquina, entrante.id_maquina]]
    );
    if (otroCambio.length > 0) {
      throw errorNegocio(409, `Una de las máquinas ya participa en el reemplazo #${otroCambio[0].id_maquina_cambio} del período ${datos.periodo_afectado}`);
    }

    // El contrato de la asignación tiene que seguir vigente cuando se instala la entrante
    const { rows: contrato } = await client.query(
      `SELECT ($2::date BETWEEN fecha_inicio AND COALESCE(fecha_fin, 'infinity'::date)) AS vigente
       FROM contratos WHERE id_contrato = $1 AND activo = TRUE`,
      [asignacion.contrato_id, datos.fecha_instalacion_entrante]
    );
    if (contrato.length === 0 || !contrato[0].vigente) {
      throw errorNegocio(409, `El contrato de la asignación de ${saliente.serie} no está vigente el ${datos.fecha_instalacion_entrante}`);
    }

    const ip = datos.ip_address || asignacion.ip_address;
    if (!ip) throw errorNegocio(400, `La asignación de ${saliente.serie} no tiene IP: indique la IP de la entrante`);
    const { rows: ipEnUso } = await client.query(
      `SELECT m.serie FROM instalaciones i JOIN maquinas m ON m.id_maquina = i.maquina_id
       WHERE i.ip_address = $1 AND i.activo = TRUE AND i.fecha_retiro IS NULL AND i.maquina_id <> $2
       LIMIT 1`,
      [ip, saliente.id_maquina]
    );
    if (ipEnUso.length > 0) throw errorNegocio(409, `La IP ${ip} ya está siendo usada por la máquina ${ipEnUso[0].serie}`);

    // Contadores acumulados: no pueden ser menores que la última lectura aprobada de cada máquina
    const finalSaliente = { bn: datos.contador_final_saliente_bn, color: datos.contador_final_saliente_color };
    const inicialEntrante = { bn: datos.contador_inicial_entrante_bn, color: datos.contador_inicial_entrante_color };
    const lecturaSaliente = await getUltimaLecturaAntesDe(client, saliente.id_maquina, datos.periodo_afectado);
    const lecturaEntrante = await getUltimaLecturaAntesDe(client, entrante.id_maquina, datos.periodo_afectado);
    const errorContador =
      contadorMenorQueLectura('El contador final', saliente.serie, finalSaliente, lecturaSaliente) ||
      contadorMenorQueLectura('El contador inicial', entrante.serie, inicialEntrante, lecturaEntrante);
    if (errorContador) throw errorNegocio(400, errorContador);

    const { rows: [cambio] } = await client.query(
      `INSERT INTO maquinas_cambio (
         fecha_danio, periodo_afectado, maquina_saliente_id, maquina_entrante_id, instalacion_saliente_id,
         area_id, razon_cambio, tipo_cambio,
         snap_maquina_saliente_serie, snap_maquina_saliente_modelo, snap_maquina_entrante_serie, snap_maquina_entrante_modelo,
         fecha_instalacion_entrante, activo
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE)
       RETURNING id_maquina_cambio`,
      [
        datos.fecha_danio, datos.periodo_afectado, saliente.id_maquina, entrante.id_maquina, asignacion.id_instalacion,
        asignacion.area_id, datos.razon_cambio, datos.tipo_cambio,
        saliente.serie, saliente.modelo, entrante.serie, entrante.modelo,
        datos.fecha_instalacion_entrante,
      ]
    );
    const cambioId = cambio.id_maquina_cambio;

    await client.query(
      `UPDATE instalaciones
       SET fecha_retiro = $2::date, activo = FALSE,
           observaciones = COALESCE(observaciones || ' | ', '') || $3
       WHERE id_instalacion = $1`,
      [asignacion.id_instalacion, datos.fecha_danio, `RETIRO: reemplazo #${cambioId} por ${entrante.serie} (${datos.tipo_cambio})`]
    );

    // Misma área, contrato, renta y forma de contar que la saliente
    const { rows: [nueva] } = await client.query(
      `INSERT INTO instalaciones (
         maquina_id, area_id, contrato_id, ip_address, fecha_instalacion, observaciones, activo,
         costo_renta_mensual, contador_acumulativo, contabilidad_por_usuario
       ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9)
       RETURNING id_instalacion`,
      [
        entrante.id_maquina, asignacion.area_id, asignacion.contrato_id, ip, datos.fecha_instalacion_entrante,
        `Reemplazo #${cambioId} de ${saliente.serie}`,
        asignacion.costo_renta_mensual || 0, asignacion.contador_acumulativo, asignacion.contabilidad_por_usuario,
      ]
    );

    await client.query(
      'UPDATE maquinas_cambio SET instalacion_entrante_id = $2 WHERE id_maquina_cambio = $1',
      [cambioId, nueva.id_instalacion]
    );

    await insertarCabecera(client, cambioId, saliente.id_maquina, 'SALIENTE', finalSaliente, lecturaSaliente);
    await insertarCabecera(client, cambioId, entrante.id_maquina, 'ENTRANTE', inicialEntrante, lecturaEntrante);

    await client.query('COMMIT');
    return cambioId;
  } catch (error) {
    await client.query('ROLLBACK');
    // Dos registros a la vez con la misma entrante: el índice único de asignaciones frena el segundo
    if (error.code === '23505' && error.constraint === 'instalaciones_una_activa_por_maquina') {
      throw errorNegocio(409, 'La máquina entrante acaba de ser asignada en otra operación. Elija otra máquina libre');
    }
    throw error;
  } finally {
    client.release();
  }
};

const SELECT_CAMBIO = `
  SELECT
    mc.id_maquina_cambio,
    mc.periodo_afectado,
    TO_CHAR(mc.fecha_danio, 'YYYY-MM-DD') AS fecha_danio,
    TO_CHAR(mc.fecha_instalacion_entrante, 'YYYY-MM-DD') AS fecha_instalacion_entrante,
    mc.tipo_cambio,
    mc.razon_cambio,
    mc.activo,
    mc.fecha_registro,
    mc.area_id,
    a.nombre AS area_nombre,
    c.id_cliente AS cliente_id,
    c.nombre AS cliente_nombre,
    mc.maquina_saliente_id,
    mc.snap_maquina_saliente_serie AS saliente_serie,
    mc.snap_maquina_saliente_modelo AS saliente_modelo,
    mc.instalacion_saliente_id,
    mc.maquina_entrante_id,
    mc.snap_maquina_entrante_serie AS entrante_serie,
    mc.snap_maquina_entrante_modelo AS entrante_modelo,
    mc.instalacion_entrante_id,
    ie.ip_address AS entrante_ip,
    cs.contador_actual_imp_bn AS saliente_contador_final_bn,
    cs.contador_actual_imp_col AS saliente_contador_final_color,
    ce.contador_actual_imp_bn AS entrante_contador_inicial_bn,
    ce.contador_actual_imp_col AS entrante_contador_inicial_color,
    EXISTS (
      SELECT 1 FROM reportes_oficiales ro
      WHERE ro.maquina_cambio_id = mc.id_maquina_cambio
    ) AS periodo_aprobado
  FROM maquinas_cambio mc
  LEFT JOIN areas a ON a.id_area = mc.area_id
  LEFT JOIN clientes c ON c.id_cliente = a.cliente_id
  LEFT JOIN instalaciones ie ON ie.id_instalacion = mc.instalacion_entrante_id
  LEFT JOIN cabecera_contadores_cambio cs ON cs.maquina_cambio_id = mc.id_maquina_cambio AND cs.tipo_maquina = 'SALIENTE'
  LEFT JOIN cabecera_contadores_cambio ce ON ce.maquina_cambio_id = mc.id_maquina_cambio AND ce.tipo_maquina = 'ENTRANTE'
`;

const listarReemplazos = async ({ cliente_id, periodo, maquina_id } = {}) => {
  const condiciones = [];
  const valores = [];
  if (cliente_id) {
    valores.push(cliente_id);
    condiciones.push(`a.cliente_id = $${valores.length}`);
  }
  if (periodo) {
    valores.push(periodo);
    condiciones.push(`mc.periodo_afectado = $${valores.length}`);
  }
  if (maquina_id) {
    valores.push(maquina_id);
    condiciones.push(`(mc.maquina_saliente_id = $${valores.length} OR mc.maquina_entrante_id = $${valores.length})`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `${SELECT_CAMBIO} ${where} ORDER BY mc.periodo_afectado DESC, mc.fecha_danio DESC, mc.id_maquina_cambio DESC`,
    valores
  );
  return rows;
};

const getReemplazoById = async (id) => {
  const { rows } = await pool.query(`${SELECT_CAMBIO} WHERE mc.id_maquina_cambio = $1`, [id]);
  return rows[0] || null;
};

const ultimaLecturaAntesDe = (maquinaId, periodo) => getUltimaLecturaAntesDe(pool, maquinaId, periodo);

const existeMaquina = async (maquinaId) => {
  const { rows } = await pool.query('SELECT serie FROM maquinas WHERE id_maquina = $1', [maquinaId]);
  return rows[0] || null;
};

module.exports = {
  registrarReemplazo,
  listarReemplazos,
  getReemplazoById,
  ultimaLecturaAntesDe,
  existeMaquina,
};
