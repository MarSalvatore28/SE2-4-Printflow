// Reglas de los usuarios (S4-03). Funciones puras: no tocan la base de datos,
// así se prueban en test/usuarios.test.js sin levantar PostgreSQL.

const EMAIL_MAX = 100; // usuarios.email es varchar(100)
const NOMBRE_MAX = 100;
const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72; // bcrypt ignora lo que pase de 72 bytes
const INT_MAX = 2147483647;

// algo@dominio.ext, sin espacios ni otra «@»: el dominio lleva un punto que no es ni su primer ni su
// último carácter. Se toma el primer punto después del primer carácter, así la regex no retrocede de más.
const EMAIL_VALIDO = /^[^\s@]+@[^\s@][^\s@.]*\.[^\s@]+$/;

const MENSAJES = Object.freeze({
  EMAIL_REPETIDO: 'Ya existe un usuario con ese correo',
  NO_DESACTIVARSE: 'No puede desactivar su propia cuenta',
  NO_QUITARSE_ADMIN: 'No puede quitarse el rol de administrador a sí mismo',
  ULTIMO_ADMIN: 'Debe quedar al menos un administrador activo',
});

// El correo se guarda en minúsculas y sin espacios: «Ana@X.com» y «ana@x.com» son el mismo usuario.
const normalizarEmail = (valor) => (typeof valor === 'string' ? valor.trim().toLowerCase() : '');

// Recorta y compacta los espacios; si no es texto, devuelve ''.
const normalizarTexto = (valor) => (typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '');

// Devuelve el entero positivo o null si el valor no es un id válido.
const parseId = (valor) => {
  if (typeof valor !== 'number' && typeof valor !== 'string') return null;
  const texto = String(valor).trim();
  if (!/^\d+$/.test(texto)) return null;
  const n = Number(texto);
  return n >= 1 && n <= INT_MAX ? n : null;
};

// Devuelve el mensaje de error de la contraseña o null si es válida.
const validarPassword = (password) => {
  if (typeof password !== 'string' || password.length === 0) return 'La contraseña es obligatoria';
  if (password.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`;
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return `La contraseña no puede tener más de ${PASSWORD_MAX_BYTES} caracteres`;
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return 'La contraseña debe tener al menos una letra y un número';
  return null;
};

/**
 * Valida y normaliza el cuerpo de POST /api/usuarios (esCreacion) o PUT /api/usuarios/:id.
 * Al editar, la contraseña es opcional: si no viene o viene vacía, no se cambia.
 * Devuelve { error } o { datos: { nombre, apellido, email, rol_id, password } }.
 */
const validarDatosUsuario = (body, { esCreacion }) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Faltan los datos del usuario' };
  }

  const nombre = normalizarTexto(body.nombre);
  if (!nombre) return { error: 'El nombre es obligatorio' };
  if (nombre.length > NOMBRE_MAX) return { error: `El nombre no puede tener más de ${NOMBRE_MAX} caracteres` };

  if (body.apellido !== undefined && body.apellido !== null && typeof body.apellido !== 'string') {
    return { error: 'El apellido debe ser texto' };
  }
  const apellido = normalizarTexto(body.apellido) || null;
  if (apellido && apellido.length > NOMBRE_MAX) return { error: `El apellido no puede tener más de ${NOMBRE_MAX} caracteres` };

  const email = normalizarEmail(body.email);
  if (!email) return { error: 'El correo es obligatorio' };
  if (email.length > EMAIL_MAX) return { error: `El correo no puede tener más de ${EMAIL_MAX} caracteres` };
  if (!EMAIL_VALIDO.test(email)) return { error: 'El correo no tiene un formato válido' };

  const rol_id = parseId(body.rol_id);
  if (!rol_id) return { error: 'Seleccione un rol válido' };

  let password = null;
  const vienePassword = body.password !== undefined && body.password !== null && body.password !== '';
  if (esCreacion || vienePassword) {
    const errorPassword = validarPassword(body.password);
    if (errorPassword) return { error: errorPassword };
    password = body.password;
  }

  return { datos: { nombre, apellido, email, rol_id, password } };
};

/**
 * Lo que un admin no puede hacerse a sí mismo. Devuelve el mensaje o null.
 *   cambios.rolNombre: nombre del rol nuevo (al editar)
 *   cambios.activo:    estado nuevo (al activar/desactivar)
 */
const validarCambioPropio = (idSesion, idObjetivo, cambios = {}) => {
  if (Number(idSesion) !== Number(idObjetivo)) return null;
  if (cambios.activo === false) return MENSAJES.NO_DESACTIVARSE;
  if (cambios.rolNombre !== undefined && cambios.rolNombre !== 'admin') return MENSAJES.NO_QUITARSE_ADMIN;
  return null;
};

module.exports = {
  MENSAJES,
  PASSWORD_MIN,
  normalizarEmail,
  normalizarTexto,
  parseId,
  validarPassword,
  validarDatosUsuario,
  validarCambioPropio,
};
