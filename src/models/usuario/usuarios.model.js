// Gestión de usuarios (S4-03): listado, alta, edición y activación.
// El login y la sesión siguen en usuario.model.js.
// Ninguna consulta de este archivo devuelve password_hash.
const pool = require('@config/db');

// Columnas públicas del usuario (sin la contraseña)
const COLUMNAS_USUARIO = `
  u.id_usuario,
  u.nombre,
  u.apellido,
  u.email,
  u.activo,
  u.rol_id,
  r.nombre AS rol,
  r.descripcion AS rol_descripcion
`;

// Llave del candado de la transacción que puede dejar al sistema sin administradores:
// dos cambios simultáneos sobre admins distintos no pueden pasar a la vez el control.
const CANDADO_ADMINS = 4401;

const listarUsuarios = async () => {
  const { rows } = await pool.query(`
    SELECT ${COLUMNAS_USUARIO}
    FROM usuarios u
    LEFT JOIN roles r ON r.id_rol = u.rol_id
    ORDER BY u.activo DESC, LOWER(u.nombre), LOWER(COALESCE(u.apellido, '')), u.id_usuario
  `);
  return rows;
};

const obtenerUsuario = async (id, cliente = pool) => {
  const { rows } = await cliente.query(`
    SELECT ${COLUMNAS_USUARIO}
    FROM usuarios u
    LEFT JOIN roles r ON r.id_rol = u.rol_id
    WHERE u.id_usuario = $1
  `, [id]);
  return rows[0] || null;
};

const listarRoles = async () => {
  const { rows } = await pool.query('SELECT id_rol, nombre, descripcion FROM roles ORDER BY id_rol');
  return rows;
};

const obtenerRol = async (id) => {
  const { rows } = await pool.query('SELECT id_rol, nombre, descripcion FROM roles WHERE id_rol = $1', [id]);
  return rows[0] || null;
};

// ¿Hay otro usuario con ese correo? Sin distinguir mayúsculas.
const existeEmail = async (email, excluirId = null) => {
  const { rows } = await pool.query(
    'SELECT 1 FROM usuarios WHERE LOWER(email) = LOWER($1) AND ($2::int IS NULL OR id_usuario <> $2) LIMIT 1',
    [email, excluirId]
  );
  return rows.length > 0;
};

const crearUsuario = async ({ nombre, apellido, email, rol_id, passwordHash }) => {
  const { rows } = await pool.query(`
    INSERT INTO usuarios (nombre, apellido, email, password_hash, rol_id, activo)
    VALUES ($1, $2, $3, $4, $5, true)
    RETURNING id_usuario
  `, [nombre, apellido, email, passwordHash, rol_id]);
  return obtenerUsuario(rows[0].id_usuario);
};

/**
 * Ejecuta un cambio y, antes de confirmarlo, comprueba que siga habiendo al menos
 * un admin activo. Si no queda ninguno, deshace el cambio.
 * Devuelve { usuario } (null si el usuario no existe) o { sinAdmin: true }.
 */
const conAdminGarantizado = async (cambio) => {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('SELECT pg_advisory_xact_lock($1)', [CANDADO_ADMINS]);

    const id = await cambio(cliente);
    if (!id) {
      await cliente.query('ROLLBACK');
      return { usuario: null };
    }

    const { rows } = await cliente.query(`
      SELECT COUNT(*)::int AS total
      FROM usuarios u
      JOIN roles r ON r.id_rol = u.rol_id
      WHERE r.nombre = 'admin' AND u.activo = true
    `);
    if (rows[0].total === 0) {
      await cliente.query('ROLLBACK');
      return { sinAdmin: true };
    }

    const usuario = await obtenerUsuario(id, cliente);
    await cliente.query('COMMIT');
    return { usuario };
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
};

// passwordHash null = la contraseña no cambia
const actualizarUsuario = (id, { nombre, apellido, email, rol_id, passwordHash }) => (
  conAdminGarantizado(async (cliente) => {
    const { rows } = await cliente.query(`
      UPDATE usuarios
      SET nombre = $2,
          apellido = $3,
          email = $4,
          rol_id = $5,
          password_hash = COALESCE($6, password_hash)
      WHERE id_usuario = $1
      RETURNING id_usuario
    `, [id, nombre, apellido, email, rol_id, passwordHash]);
    return rows[0]?.id_usuario;
  })
);

const cambiarActivo = (id, activo) => (
  conAdminGarantizado(async (cliente) => {
    const { rows } = await cliente.query(
      'UPDATE usuarios SET activo = $2 WHERE id_usuario = $1 RETURNING id_usuario',
      [id, activo]
    );
    return rows[0]?.id_usuario;
  })
);

module.exports = {
  listarUsuarios,
  obtenerUsuario,
  listarRoles,
  obtenerRol,
  existeEmail,
  crearUsuario,
  actualizarUsuario,
  cambiarActivo,
};
