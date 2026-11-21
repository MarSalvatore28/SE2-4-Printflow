// Cabeceras de seguridad de la API (helmet): X-Content-Type-Options, X-Frame-Options, HSTS,
// Referrer-Policy, Cross-Origin-*, Content-Security-Policy, etc.
//
// Dos políticas de contenido (CSP):
//   - La API solo devuelve JSON: no carga nada (default-src 'none') ni se deja enmarcar.
//   - Swagger UI (/api-docs) es una página: sus scripts y su CSS vienen del mismo origen, pero usa
//     estilos inline e íconos en data:. «Try it out» llama a la misma dirección (connect-src 'self').
//     Sin upgrade-insecure-requests: en local se abre por http://localhost.
//
// Socket.IO no pasa por aquí: atiende /socket.io/ antes que Express.
// En producción Caddy repite las principales (deploy/Caddyfile), por si alguna respuesta no viene de la API.
const helmet = require('helmet');

const comunes = {
  // same-site y no same-origin: en desarrollo la web (localhost:5173) llama a la API (localhost:9000)
  crossOriginResourcePolicy: { policy: 'same-site' },
};

const cabecerasApi = helmet({
  ...comunes,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
});

const cabecerasSwagger = helmet({
  ...comunes,
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
});

const esSwagger = (ruta) => ruta === '/api-docs' || ruta.startsWith('/api-docs/');

const cabecerasSeguridad = (req, res, next) => (esSwagger(req.path) ? cabecerasSwagger : cabecerasApi)(req, res, next);

module.exports = { cabecerasSeguridad };
