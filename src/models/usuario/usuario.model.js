const pool = require('@config/db');
const bcrypt = require('bcrypt');

const findByEmail = async (email) => {
  const query = `
    SELECT 
      id_usuario,
      nombre,
      apellido,
      email,
      password_hash,
      rol_id,
      activo
    FROM usuarios
    WHERE email = $1
  `;
  const result = await pool.query(query, [email]);
  return result.rows[0];
};

const findById = async (id_usuario) => {
  const query = `
    SELECT 
      id_usuario,
      nombre,
      apellido,
      email,
      password_hash,
      rol_id,
      activo
    FROM usuarios
    WHERE id_usuario = $1
  `;
  const result = await pool.query(query, [id_usuario]);
  return result.rows[0];
};

const getRolCompleto = async (usuarioId) => {
  const query = `
    SELECT 
      r.id_rol,
      r.nombre,
      r.descripcion
    FROM roles r
    JOIN usuarios u ON u.rol_id = r.id_rol
    WHERE u.id_usuario = $1
  `;
  const result = await pool.query(query, [usuarioId]);
  return result.rows[0];
};

const validateLogin = async (email, password) => {
  const user = await findByEmail(email);
  
  if (!user) {
    return null;
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  
  if (!isMatch) {
    return null;
  }
  
  if (!user.activo) {
    return null;
  }

  const rol = await getRolCompleto(user.id_usuario);

  return {
    id: user.id_usuario,
    nombre: user.nombre,
    apellido: user.apellido,
    email: user.email,
    rol_id: user.rol_id,
    activo: user.activo,
    rol: rol || null
  };
};

const getRolNombre = async (usuarioId) => {
  const query = `
    SELECT r.nombre
    FROM roles r
    JOIN usuarios u ON u.rol_id = r.id_rol
    WHERE u.id_usuario = $1
  `;
  const result = await pool.query(query, [usuarioId]);
  return result.rows[0]?.nombre || null;
};

const hasRole = async (usuarioId, rolNombre) => {
  const query = `
    SELECT 1
    FROM usuarios u
    JOIN roles r ON r.id_rol = u.rol_id
    WHERE u.id_usuario = $1
    AND r.nombre = $2
  `;
  const result = await pool.query(query, [usuarioId, rolNombre]);
  return !!result.rows[0];
};

const isActive = async (usuarioId) => {
  const query = `
    SELECT activo
    FROM usuarios
    WHERE id_usuario = $1
  `;
  const result = await pool.query(query, [usuarioId]);
  return result.rows[0]?.activo || false;
};

module.exports = {
  findByEmail,
  findById,
  getRolCompleto,
  validateLogin,
  getRolNombre,
  hasRole,
  isActive
};