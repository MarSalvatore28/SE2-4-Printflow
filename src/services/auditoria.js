// S3-02 · Auditoría: deja en registro_auditoria quién cambió qué, cuándo y desde qué IP.
//
// Uso, dentro de la transacción del que llama (el client que hizo BEGIN):
//   const antes = await leerFila(client, 'contratos', id, { bloquear: true });
//   ... UPDATE ...
//   await auditarFila(client, { tabla: 'contratos', idRegistro: id, accion: ACCIONES.ACTUALIZAR, antes, ...contextoAuditoria(req) });
//
// Si la auditoría falla, lanza el error: el que llama hace ROLLBACK y el cambio no se guarda.

const ACCIONES = Object.freeze({
  CREAR: 'CREAR',
  ACTUALIZAR: 'ACTUALIZAR',
  ACTIVAR: 'ACTIVAR',
  DESACTIVAR: 'DESACTIVAR',
  RETIRAR: 'RETIRAR',
  APROBAR: 'APROBAR',
  RECHAZAR: 'RECHAZAR',
  REPROCESAR: 'REPROCESAR',
  ANULAR: 'ANULAR',
});

// Tablas auditadas y su clave primaria. Solo estas se pueden leer con leerFila (los nombres
// van dentro del SQL, por eso no se acepta cualquier texto).
const TABLAS = Object.freeze({
  contratos: 'id_contrato',
  areas: 'id_area',
  instalaciones: 'id_instalacion',
  maquinas: 'id_maquina',
  maquinas_cambio: 'id_maquina_cambio',
  lotes_carga: 'id_lote',
  usuarios: 'id_usuario',
  reportes_oficiales: 'id_reporte',
  reportes_consolidado_staging: 'id_staging_consolidado',
});

// Campos que nunca se guardan en la bitácora
const CAMPOS_SECRETOS = new Set(['password', 'password_hash']);

// 5 o «5»: sí. 0, -1, 1.5, «abc», true: no
const esEnteroPositivo = (valor) => {
  const n = typeof valor === 'string' && /^\d+$/.test(valor.trim()) ? Number(valor) : valor;
  return Number.isInteger(n) && n > 0;
};

// Quita las contraseñas de un valor (también dentro de objetos y arreglos)
const sinSecretos = (valor) => {
  if (Array.isArray(valor)) return valor.map(sinSecretos);
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([clave]) => !CAMPOS_SECRETOS.has(clave))
        .map(([clave, v]) => [clave, sinSecretos(v)])
    );
  }
  return valor;
};

const aJson = (valor) => (valor === undefined || valor === null ? null : JSON.stringify(sinSecretos(valor)));

// «::ffff:10.0.0.5» (IPv4 dentro de IPv6, como la entrega Node) queda «10.0.0.5»
const limpiarIp = (ip) => {
  if (typeof ip !== 'string' || ip.trim() === '') return null;
  const limpia = ip.trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  return limpia.slice(0, 45);
};

/**
 * Registra un cambio. `db` es el client de la transacción del que llama (o el pool si no hay).
 * Lanza un error si faltan datos o si la base no lo guarda.
 * Devuelve { id, fecha }.
 */
const registrarAuditoria = async (db, { tabla, idRegistro, accion, usuarioId = null, antes = null, despues = null, ip = null } = {}) => {
  if (!db || typeof db.query !== 'function') throw new Error('registrarAuditoria: falta la conexión (db)');
  if (typeof tabla !== 'string' || tabla.trim() === '') throw new Error('registrarAuditoria: falta la tabla');
  if (!esEnteroPositivo(idRegistro)) throw new Error(`registrarAuditoria: id de registro inválido (${idRegistro})`);
  if (!Object.values(ACCIONES).includes(accion)) throw new Error(`registrarAuditoria: acción desconocida (${accion})`);

  const { rows } = await db.query(
    `INSERT INTO registro_auditoria (tabla, id_registro, accion, usuario_id, valor_anterior, valor_nuevo, ip)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
     RETURNING id, fecha`,
    [tabla.trim(), Number(idRegistro), accion, usuarioId ?? null, aJson(antes), aJson(despues), limpiarIp(ip)]
  );
  return rows[0] || null;
};

/**
 * La fila completa de una tabla auditada, como objeto (null si no existe).
 * Con `bloquear`, la deja tomada (FOR UPDATE) hasta el fin de la transacción.
 */
const leerFila = async (db, tabla, id, { bloquear = false } = {}) => {
  const columna = TABLAS[tabla];
  if (!columna) throw new Error(`leerFila: la tabla ${tabla} no se audita`);
  const { rows } = await db.query(
    `SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE t.${columna} = $1${bloquear ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return rows[0]?.fila ? sinSecretos(rows[0].fila) : null;
};

/**
 * Lee la fila tal como quedó y registra el cambio con su `antes`.
 * `extra` se agrega al valor nuevo (por ejemplo { password_cambiada: true }).
 */
const auditarFila = async (db, { tabla, idRegistro, accion, antes = null, usuarioId = null, ip = null, extra = null }) => {
  const fila = await leerFila(db, tabla, idRegistro);
  const despues = extra ? { ...fila, ...extra } : fila;
  return registrarAuditoria(db, { tabla, idRegistro, accion, usuarioId, antes, despues, ip });
};

// Usuario e IP de la petición
const contextoAuditoria = (req) => ({
  usuarioId: req?.user?.id ?? null,
  ip: req?.ip ?? null,
});

/**
 * Ejecuta `fn(client)` en una transacción: COMMIT si termina bien, ROLLBACK si lanza.
 * Para los cambios que hoy son una sola consulta (contratos, alta de usuario): el cambio y su
 * auditoría quedan juntos.
 */
const enTransaccion = async (pool, fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
};

const LIMITE_POR_DEFECTO = 100;
const LIMITE_MAXIMO = 500;

/**
 * Valida los filtros de GET /api/auditoria.
 * Devuelve { error } o { data: { tabla, idRegistro, limite } }.
 */
const validarFiltrosAuditoria = (query = {}) => {
  const tabla = typeof query.tabla === 'string' && query.tabla.trim() !== '' ? query.tabla.trim() : null;
  if (tabla && !TABLAS[tabla]) {
    return { error: `Tabla inválida. Use una de: ${Object.keys(TABLAS).join(', ')}` };
  }

  let idRegistro = null;
  if (query.id_registro !== undefined && query.id_registro !== '') {
    if (!/^\d+$/.test(String(query.id_registro)) || !esEnteroPositivo(query.id_registro)) {
      return { error: 'id_registro debe ser un entero positivo' };
    }
    if (!tabla) return { error: 'Para filtrar por id_registro indique también la tabla' };
    idRegistro = Number(query.id_registro);
  }

  let limite = LIMITE_POR_DEFECTO;
  if (query.limite !== undefined && query.limite !== '') {
    if (!/^\d+$/.test(String(query.limite)) || Number(query.limite) < 1) {
      return { error: 'limite debe ser un entero positivo' };
    }
    limite = Math.min(Number(query.limite), LIMITE_MAXIMO);
  }

  return { data: { tabla, idRegistro, limite } };
};

// Registros de la bitácora, del más nuevo al más viejo, con el nombre de quien hizo el cambio
const consultarAuditoria = async (db, { tabla = null, idRegistro = null, limite = LIMITE_POR_DEFECTO } = {}) => {
  const { rows } = await db.query(
    `SELECT ra.id, ra.tabla, ra.id_registro, ra.accion, ra.fecha, ra.ip,
            ra.usuario_id, u.email AS usuario_email,
            NULLIF(TRIM(CONCAT(u.nombre, ' ', u.apellido)), '') AS usuario_nombre,
            ra.valor_anterior, ra.valor_nuevo
     FROM registro_auditoria ra
     LEFT JOIN usuarios u ON u.id_usuario = ra.usuario_id
     WHERE ($1::text IS NULL OR ra.tabla = $1)
       AND ($2::int IS NULL OR ra.id_registro = $2)
     ORDER BY ra.fecha DESC, ra.id DESC
     LIMIT $3`,
    [tabla, idRegistro, limite]
  );
  return rows;
};

module.exports = {
  ACCIONES,
  TABLAS,
  LIMITE_MAXIMO,
  sinSecretos,
  limpiarIp,
  registrarAuditoria,
  leerFila,
  auditarFila,
  contextoAuditoria,
  enTransaccion,
  validarFiltrosAuditoria,
  consultarAuditoria,
};
