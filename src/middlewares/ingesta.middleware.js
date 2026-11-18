// La ingesta no usa la sesión de un usuario: n8n se identifica con su propio token (INGESTA_TOKEN).
const exigirTokenIngesta = (req, res, next) => {
  const esperado = process.env.INGESTA_TOKEN;

  if (!esperado) {
    return res.status(503).json({ success: false, message: 'Ingesta no configurada' });
  }
  if (req.headers.authorization !== `Bearer ${esperado}`) {
    return res.status(401).json({ success: false, message: 'Token de ingesta inválido' });
  }
  next();
};

module.exports = { exigirTokenIngesta };
