// Valida el parámetro :id de las rutas (router.param('id', idValido)): un id que no es un entero
// positivo responde 400 en lugar de llegar a la consulta y terminar en 500.
const { parseId } = require('@utils/usuarios.validacion');

const idValido = (req, res, next, valor) => {
  if (parseId(valor)) return next();
  return res.status(400).json({ success: false, message: 'El identificador no es válido' });
};

module.exports = { idValido };
