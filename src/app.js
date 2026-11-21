const express = require('express');
const cors = require('cors');
const pool = require('./config/db');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const swaggerDocs = require('./config/swagger');
const app = express();

// No anunciar en cada respuesta que la API es Express (cabecera X-Powered-By)
app.disable('x-powered-by');

// Cabeceras de seguridad (helmet) en todas las respuestas; Swagger UI tiene su propia CSP
const { cabecerasSeguridad } = require('./middlewares/cabeceras.middleware');
app.use(cabecerasSeguridad);

// S3-02: la auditoría guarda req.ip. La API solo se alcanza por el nginx del frontend (y Caddy en
// producción) dentro de la red privada de Docker: se confía en esos proxies para que req.ip sea la
// IP del cliente (X-Forwarded-For) y no la del contenedor de nginx.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

app.use(morgan('dev'));

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  exposedHeaders: ['X-Nuevo-Token'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// persistAuthorization: el token pegado en «Authorize» se mantiene al recargar la página
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs, { swaggerOptions: { persistAuthorization: true } }));

app.use((req, _res, next) => {
  req.pool = pool;
  next();
});

// /api/health es la misma comprobación, accesible desde internet por el proxy (monitoreo, S4-04).
// Va antes del middleware de /api, así que no pide token. Solo dice si la API y la base responden.
app.get(['/health', '/api/health'], async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.json({ status: 'ok', db_time: result.rows[0].now });
  } catch (error) {
    console.error('Error consultando la BD:', error);
    res.status(500).json({ status: 'error', message: 'Error al conectar con la base de datos' });
  }
});

// ===========================================================================
// LINEAS DE CADA EQUIPO
// Cada equipo SOLO quita el "// " del inicio de las lineas que terminan con
// su etiqueta (por ejemplo "// [B-F1]"). No se escriben lineas nuevas aqui ni se
// tocan las de otro equipo. La etiqueta del final de la linea se queda.
// ===========================================================================

// --- Seguridad de la API (Equipo C, Fase 2): todo /api exige token, salvo login y la ingesta,
//     que usa su propio token. Va ANTES de las rutas.
const { protect } = require('@middlewares/auth.middleware'); // [C-F2]
const RUTAS_PUBLICAS = new Set(['/auth/login', '/auth/validate-token']); // [C-F2]
app.use('/api', (req, res, next) => (RUTAS_PUBLICAS.has(req.path) || req.path.startsWith('/ingesta') ? next() : protect(req, res, next))); // [C-F2]

// --- Fase 0
const authRoutes = require('@routes/usuario/usuario.routes'); // [C-F0]
app.use('/api/auth', authRoutes); // [C-F0]

// --- Fase 1
const maquinaRoutes = require('@routes/maquina/maquina.routes'); // [A-F1]
const maquinasCambioRoutes = require('@routes/cambio/maquinasCambio.routes'); // [A-F1]
app.use('/api/maquinas', maquinaRoutes); // [A-F1]
app.use('/api/maquinas-cambio', maquinasCambioRoutes); // [A-F1]
const clienteRoutes = require('@routes/cliente/cliente.routes'); // [B-F1]
const contratoRoutes = require('@routes/contrato/contrato.routes'); // [B-F1]
const areaRoutes = require('@routes/area/area.routes'); // [B-F1]
app.use('/api/clientes', clienteRoutes); // [B-F1]
app.use('/api/contratos', contratoRoutes); // [B-F1]
app.use('/api/areas', areaRoutes); // [B-F1]
const instalacionRoutes = require('@routes/instalacion/instalacion.routes'); // [C-F1]
app.use('/api/instalacion', instalacionRoutes); // [C-F1]

// --- Fase 2
const notificacionesRoutes = require('@routes/notificaciones/notificaciones.routes'); // [A-F2]
app.use('/api/notificaciones', notificacionesRoutes); // [A-F2]
const ingestaRoutes = require('@routes/ingesta/ingesta.routes'); // [C-F2]
const stagingRoutes = require('@routes/reportemes_staging/reportemes_staging.routes'); // [C-F2]
app.use('/api/ingesta', ingestaRoutes); // [C-F2]
app.use('/api/staging', stagingRoutes); // [C-F2]

// --- Fase 3
const reportemesRoutes = require('@routes/reportemes/reportemes.routes'); // [C-F3]
app.use('/api/reportes', reportemesRoutes); // [C-F3]
const lecturaRoutes = require('@routes/lectura/lectura.routes'); // [B-F3]
app.use('/api/lecturas', lecturaRoutes); // [B-F3]
const reprocesoRoutes = require('@routes/reproceso/reproceso.routes'); // [B-F3]
app.use('/api/staging', reprocesoRoutes); // [B-F3]
const usuariosRoutes = require('@routes/usuario/usuarios.routes'); // [B-F4]
app.use('/api/usuarios', usuariosRoutes); // [B-F4]
const auditoriaRoutes = require('@routes/auditoria/auditoria.routes'); // [C-F3]
app.use('/api/auditoria', auditoriaRoutes); // [C-F3]

// Ruta que no existe: responde JSON (el frontend siempre espera JSON)
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
});

// Error no controlado (por ejemplo, un JSON mal formado): responde JSON, nunca la página HTML de Express
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('Error no controlado:', err);
  let message = status >= 500 ? 'Error interno del servidor' : err.message;
  if (err.type === 'entity.parse.failed') message = 'El cuerpo de la petición no es un JSON válido';
  res.status(status).json({ success: false, message });
});

module.exports = app;
