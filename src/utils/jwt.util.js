const jwt = require('jsonwebtoken');

// La sesión dura 30 min sin actividad: protect renueva el token en cada petición (X-Nuevo-Token).
function generateToken(payload, expiresIn = '30m') {
  return jwt.sign(payload, process.env.SECRET_KEY, { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.SECRET_KEY);
}

// Mensaje del 401 cuando el token es de una versión de sesión anterior (migración 033)
const SESION_TERMINADA = 'Tu sesión terminó: inicia sesión de nuevo';

/**
 * Token de la sesión de un usuario. Lleva la versión de su sesión (usuarios.version_sesion):
 * si la contraseña, el rol o el estado del usuario cambian, la versión sube y el token deja de valer.
 */
function tokenDeSesion({ id, email, rol = null, loginAt, versionSesion = 0 }) {
  return generateToken({ id, email, rol, loginAt, versionSesion });
}

/**
 * ¿El token es de la sesión vigente del usuario? Compara la versión del token con la de la base.
 * Un token sin versión (emitido antes de la migración 033) cuenta como versión 0.
 */
function sesionVigente(datosToken, versionEnBase) {
  return Number(datosToken?.versionSesion ?? 0) === Number(versionEnBase ?? 0);
}

module.exports = { generateToken, verifyToken, tokenDeSesion, sesionVigente, SESION_TERMINADA };
