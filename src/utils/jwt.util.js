const jwt = require('jsonwebtoken');

// La sesión dura 30 min sin actividad: protect renueva el token en cada petición (X-Nuevo-Token).
function generateToken(payload, expiresIn = '30m') {
  return jwt.sign(payload, process.env.SECRET_KEY, { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.SECRET_KEY);
}

module.exports = { generateToken, verifyToken };
