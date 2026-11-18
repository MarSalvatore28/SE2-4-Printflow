// Permisos por rol (tabla roles: admin, operador, auditor).
// Va DESPUÉS de protect, que deja en req.user el rol_id del usuario.
//
//   router.post('/', requireRole('admin'), controller)
//   router.post('/approve-batch', requireRole('admin', 'operador'), controller)
const pool = require('@config/db');

const ROLES = Object.freeze({ ADMIN: 'admin', OPERADOR: 'operador', AUDITOR: 'auditor' });

// Nombre del rol del usuario de la sesión (se consulta una sola vez por petición)
async function nombreDelRol(req) {
  if (req.user?.rol) return req.user.rol;
  if (!req.user?.rol_id) return null;
  const { rows } = await pool.query('SELECT nombre FROM roles WHERE id_rol = $1', [req.user.rol_id]);
  req.user.rol = rows[0]?.nombre || null;
  return req.user.rol;
}

const requireRole = (...rolesPermitidos) => async (req, res, next) => {
  let rol;
  try {
    rol = await nombreDelRol(req);
  } catch (error) {
    console.error('Error al consultar el rol del usuario:', error);
    return res.status(500).json({ success: false, message: 'No se pudo verificar el permiso' });
  }

  if (!rol) {
    return res.status(401).json({ success: false, message: 'Sesión sin rol válido' });
  }
  if (!rolesPermitidos.includes(rol)) {
    return res.status(403).json({ success: false, message: 'No tiene permiso para esta acción' });
  }
  next();
};

module.exports = { requireRole, ROLES };
