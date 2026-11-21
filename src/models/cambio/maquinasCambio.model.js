const pool = require('@config/db');
const { contadorMenorQueLectura, motivoNoAnulable, quitarNotaRetiro } = require('@utils/maquinasCambio.reglas');
const { ACCIONES, leerFila, auditarFila, registrarAuditoria } = require('@services/auditoria');

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

// Las dos máquinas y la asignación de la saliente, validadas para registrar el reemplazo
const validarMaquinasDelCambio = async (client, datos) => {
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
  return { saliente, entrante, asignacion };
};

// El período afectado y el contrato admiten el reemplazo
const validarPeriodoDelCambio = async (client, datos, { saliente, entrante, asignacion }) => {
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
};

// IP de la entrante: la indicada o la de la saliente, que no use otra máquina
const ipDeLaEntrante = async (client, datos, saliente, asignacion) => {
  const ip = datos.ip_address || asignacion.ip_address;
  if (!ip) throw errorNegocio(400, `La asignación de ${saliente.serie} no tiene IP: indique la IP de la entrante`);
  const { rows: ipEnUso } = await client.query(
    `SELECT m.serie FROM instalaciones i JOIN maquinas m ON m.id_maquina = i.maquina_id
     WHERE i.ip_address = $1 AND i.activo = TRUE AND i.fecha_retiro IS NULL AND i.maquina_id <> $2
     LIMIT 1`,
    [ip, saliente.id_maquina]
  );
  if (ipEnUso.length > 0) throw errorNegocio(409, `La IP ${ip} ya está siendo usada por la máquina ${ipEnUso[0].serie}`);
  return ip;
};

/**
 * Registra el reemplazo en una sola transacción:
 *  1. maquinas_cambio y las dos cabeceras de contadores (SALIENTE al salir, ENTRANTE al entrar);
 *  2. retira la asignación de la saliente (fecha de retiro = fecha del daño);
 *  3. crea la asignación de la entrante en la misma área, contrato e IP (o la IP indicada).
 * Lanza errorNegocio (status 400/404/409) si algo no cuadra; no deja nada a medias.
 * S3-02: audita el reemplazo, el retiro de la saliente y la asignación de la entrante
 * con `auditoria` = { usuarioId, ip } de la petición.
 */
const registrarReemplazo = async (datos, auditoria = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { saliente, entrante, asignacion } = await validarMaquinasDelCambio(client, datos);
    await validarPeriodoDelCambio(client, datos, { saliente, entrante, asignacion });
    const ip = await ipDeLaEntrante(client, datos, saliente, asignacion);

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

    const asignacionAntes = await leerFila(client, 'instalaciones', asignacion.id_instalacion, { bloquear: true });
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

    await auditarFila(client, { tabla: 'maquinas_cambio', idRegistro: cambioId, accion: ACCIONES.CREAR, ...auditoria });
    await auditarFila(client, {
      tabla: 'instalaciones', idRegistro: asignacion.id_instalacion, accion: ACCIONES.RETIRAR, antes: asignacionAntes, ...auditoria,
    });
    await auditarFila(client, { tabla: 'instalaciones', idRegistro: nueva.id_instalacion, accion: ACCIONES.CREAR, ...auditoria });

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

// Asignación que el registro creó para la entrante (bloqueada), o null si ya no es de la entrante
const asignacionEntranteDelCambio = async (client, cambio) => {
  if (!cambio.instalacion_entrante_id) return null;
  const { rows: [entrante] } = await client.query(
    `SELECT id_instalacion, maquina_id, (activo = TRUE AND fecha_retiro IS NULL) AS vigente
     FROM instalaciones WHERE id_instalacion = $1
     FOR UPDATE`,
    [cambio.instalacion_entrante_id]
  );
  return entrante && entrante.maquina_id === cambio.maquina_entrante_id ? entrante : null;
};

// Lo que decide si un cambio activo se puede anular (ver motivoNoAnulable)
const estadoParaAnular = async (client, cambio) => {
  const estado = { cambio };
  const maquinas = [cambio.maquina_saliente_id, cambio.maquina_entrante_id];

  // Lecturas aprobadas que usan el cambio, o de cualquiera de las dos máquinas desde el período afectado
  const { rows: [lectura] } = await client.query(
    `SELECT ro.periodo, COALESCE(m.serie, ro.snap_maquina_serie) AS serie
     FROM reportes_oficiales ro
     LEFT JOIN maquinas m ON m.id_maquina = ro.maquina_id
     WHERE ro.maquina_cambio_id = $1
        OR (ro.maquina_id = ANY($2::int[]) AND ro.periodo >= $3)
     ORDER BY ro.periodo, ro.id_reporte
     LIMIT 1`,
    [cambio.id_maquina_cambio, maquinas, cambio.periodo_afectado]
  );
  estado.lecturaAprobada = lectura || null;

  // Un lote sin aprobar con esas máquinas se aprobaría con una asignación que ya no existe
  const { rows: [lote] } = await client.query(
    `SELECT l.codigo_referencia AS codigo, s.serie_maquina AS serie
     FROM reportes_consolidado_staging s
     JOIN lotes_carga l ON l.id_lote = s.lote_id
     WHERE l.fecha_aprobacion IS NULL
       AND s.maquina_id_tentativa = ANY($1::int[])
       AND COALESCE(l.periodo, $2) >= $2
     ORDER BY l.id_lote
     LIMIT 1`,
    [maquinas, cambio.periodo_afectado]
  );
  estado.lotePendiente = lote || null;

  estado.asignacionEntrante = await asignacionEntranteDelCambio(client, cambio);
  estado.asignacionSaliente = await getAsignacionVigente(client, cambio.maquina_saliente_id);

  if (cambio.instalacion_saliente_id) {
    const { rows: [ip] } = await client.query(
      `SELECT m.serie
       FROM instalaciones sal
       JOIN instalaciones i ON i.ip_address = sal.ip_address
       JOIN maquinas m ON m.id_maquina = i.maquina_id
       WHERE sal.id_instalacion = $1
         AND i.activo = TRUE AND i.fecha_retiro IS NULL
         AND i.id_instalacion NOT IN ($1, COALESCE($2, 0))
       LIMIT 1`,
      [cambio.instalacion_saliente_id, cambio.instalacion_entrante_id]
    );
    estado.ipEnUso = ip ? ip.serie : null;
  }
  return estado;
};

// Auditoría (S3-02) de la anulación: el cambio y las dos asignaciones, con cómo estaban antes
const auditarAnulacion = async (client, cambio, { cambioAntes, entranteAntes, salienteAntes }, auditoria) => {
  await auditarFila(client, {
    tabla: 'maquinas_cambio', idRegistro: cambio.id_maquina_cambio, accion: ACCIONES.ANULAR, antes: cambioAntes, ...auditoria,
  });
  if (entranteAntes) {
    await registrarAuditoria(client, {
      tabla: 'instalaciones', idRegistro: cambio.instalacion_entrante_id, accion: ACCIONES.ANULAR, antes: entranteAntes, despues: null, ...auditoria,
    });
  }
  if (salienteAntes) {
    await auditarFila(client, {
      tabla: 'instalaciones', idRegistro: cambio.instalacion_saliente_id, accion: ACCIONES.ACTIVAR, antes: salienteAntes, ...auditoria,
    });
  }
};

/**
 * Anula un reemplazo registrado por error, en una sola transacción:
 *  1. la asignación de la saliente vuelve a estar vigente (activo, sin fecha de retiro y sin la
 *     nota de retiro que agregó el registro);
 *  2. se borra la asignación que el registro creó para la entrante, que queda libre;
 *  3. se borran las cabeceras de contadores del cambio;
 *  4. el cambio queda con activo = false, la fecha, el usuario y el motivo de la anulación.
 * Solo si ningún período aprobado (ni un lote pendiente) usa el cambio: ver motivoNoAnulable.
 * Lanza errorNegocio (404/409) si no se puede; no deja nada a medias.
 *   pool   pool de pg (req.pool)
 */
const anularReemplazo = async (pool, id, { motivo = null, usuarioId = null, ip = null } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [cambio] } = await client.query(
      `SELECT id_maquina_cambio, activo, periodo_afectado, maquina_saliente_id, maquina_entrante_id,
              instalacion_saliente_id, instalacion_entrante_id,
              snap_maquina_saliente_serie, snap_maquina_entrante_serie
       FROM maquinas_cambio WHERE id_maquina_cambio = $1
       FOR UPDATE`,
      [id]
    );

    const estado = cambio && cambio.activo !== false
      ? await estadoParaAnular(client, cambio)
      : { cambio: cambio || null };

    const bloqueo = motivoNoAnulable(estado);
    if (bloqueo) throw errorNegocio(bloqueo.status, bloqueo.message);

    // Auditoría (S3-02): cómo estaban el cambio y las dos asignaciones antes de anular
    const antes = {
      cambioAntes: await leerFila(client, 'maquinas_cambio', cambio.id_maquina_cambio),
      entranteAntes: cambio.instalacion_entrante_id
        ? await leerFila(client, 'instalaciones', cambio.instalacion_entrante_id)
        : null,
      salienteAntes: cambio.instalacion_saliente_id
        ? await leerFila(client, 'instalaciones', cambio.instalacion_saliente_id)
        : null,
    };

    // Primero se suelta la referencia a la asignación de la entrante y después se borra
    await client.query(
      `UPDATE maquinas_cambio
       SET activo = FALSE, instalacion_entrante_id = NULL,
           fecha_anulacion = NOW(), usuario_anulacion_id = $2, motivo_anulacion = $3
       WHERE id_maquina_cambio = $1`,
      [cambio.id_maquina_cambio, usuarioId, motivo]
    );
    await client.query('DELETE FROM cabecera_contadores_cambio WHERE maquina_cambio_id = $1', [cambio.id_maquina_cambio]);
    await client.query('DELETE FROM instalaciones WHERE id_instalacion = $1', [cambio.instalacion_entrante_id]);

    const { rows: [saliente] } = await client.query(
      'SELECT observaciones FROM instalaciones WHERE id_instalacion = $1 FOR UPDATE',
      [cambio.instalacion_saliente_id]
    );
    await client.query(
      `UPDATE instalaciones SET activo = TRUE, fecha_retiro = NULL, observaciones = $2
       WHERE id_instalacion = $1`,
      [cambio.instalacion_saliente_id, quitarNotaRetiro(saliente ? saliente.observaciones : null, cambio.id_maquina_cambio)]
    );

    await auditarAnulacion(client, cambio, antes, { usuarioId, ip });

    await client.query('COMMIT');
    return cambio.id_maquina_cambio;
  } catch (error) {
    await client.query('ROLLBACK');
    // Otra operación asignó la saliente mientras tanto: el índice único de asignaciones lo frena
    if (error.code === '23505' && error.constraint === 'instalaciones_una_activa_por_maquina') {
      throw errorNegocio(409, 'La máquina saliente acaba de ser asignada en otra operación: no se puede anular el reemplazo');
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
    mc.fecha_anulacion,
    mc.motivo_anulacion,
    ua.nombre AS usuario_anulacion_nombre,
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
  LEFT JOIN usuarios ua ON ua.id_usuario = mc.usuario_anulacion_id
  LEFT JOIN cabecera_contadores_cambio cs ON cs.maquina_cambio_id = mc.id_maquina_cambio AND cs.tipo_maquina = 'SALIENTE'
  LEFT JOIN cabecera_contadores_cambio ce ON ce.maquina_cambio_id = mc.id_maquina_cambio AND ce.tipo_maquina = 'ENTRANTE'
`;

const listarReemplazos = async ({ cliente_id, periodo, maquina_id, incluir_anulados = false } = {}) => {
  // Los anulados no se listan salvo que se pidan
  const condiciones = incluir_anulados ? [] : ['mc.activo = TRUE'];
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

// db: pool o client de pg (por defecto el pool de la app)
const getReemplazoById = async (id, db = pool) => {
  const { rows } = await db.query(`${SELECT_CAMBIO} WHERE mc.id_maquina_cambio = $1`, [id]);
  return rows[0] || null;
};

const ultimaLecturaAntesDe = (maquinaId, periodo) => getUltimaLecturaAntesDe(pool, maquinaId, periodo);

const existeMaquina = async (maquinaId) => {
  const { rows } = await pool.query('SELECT serie FROM maquinas WHERE id_maquina = $1', [maquinaId]);
  return rows[0] || null;
};

module.exports = {
  registrarReemplazo,
  anularReemplazo,
  listarReemplazos,
  getReemplazoById,
  ultimaLecturaAntesDe,
  existeMaquina,
};
