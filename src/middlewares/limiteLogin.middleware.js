// Límite de intentos de inicio de sesión (POST /api/auth/login) para frenar a quien prueba
// contraseñas a ciegas. Cuenta por IP del cliente: req.ip, que ya es la del cliente y no la del
// nginx gracias al `trust proxy` de src/app.js.
//
// Solo cuentan los intentos fallidos (credenciales incorrectas, datos que faltan): un inicio de
// sesión correcto no gasta intentos, así que una oficina entera detrás de la misma IP no se bloquea.
// Al pasar el límite responde 429 hasta que termina la ventana de 15 minutos.
//
// LOGIN_MAX_INTENTOS (en el .env) cambia el límite; vacío o inválido = 10.
// El contador vive en la memoria de la API: se reinicia al reiniciarla.
const { rateLimit } = require('express-rate-limit');

const MAX_INTENTOS_POR_DEFECTO = 10;
const VENTANA_MS = 15 * 60 * 1000;

function maxIntentos(valor = process.env.LOGIN_MAX_INTENTOS) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : MAX_INTENTOS_POR_DEFECTO;
}

const minutosHasta = (fecha) => Math.max(1, Math.ceil((fecha.getTime() - Date.now()) / 60000));

function crearLimiteLogin({ max = maxIntentos(), ventanaMs = VENTANA_MS } = {}) {
  return rateLimit({
    windowMs: ventanaMs,
    limit: max,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, _next, opciones) => {
      const reinicio = req.rateLimit?.resetTime;
      const minutos = reinicio ? minutosHasta(reinicio) : Math.ceil(ventanaMs / 60000);
      res.status(opciones.statusCode).json({
        success: false,
        message: `Demasiados intentos de inicio de sesión. Espera ${minutos} min y vuelve a intentarlo.`,
      });
    },
  });
}

const limiteLogin = crearLimiteLogin();

module.exports = { limiteLogin, crearLimiteLogin, maxIntentos, MAX_INTENTOS_POR_DEFECTO };
