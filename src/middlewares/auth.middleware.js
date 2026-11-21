const pool = require('@config/db');
const { tokenDeSesion, verifyToken, sesionVigente, SESION_TERMINADA } = require('@utils/jwt.util');

const protect = async (req, res, next) => {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'No hay token, autorización denegada'
        });
    }

    let decoded;
    let user;
    try {
        decoded = verifyToken(header.split(' ')[1]);

        // El rol se lee de la base en cada petición: si se lo cambian al usuario, vale desde ya
        const result = await pool.query(
            `SELECT u.id_usuario, u.email, u.nombre, u.apellido, u.rol_id, u.activo, u.version_sesion, r.nombre AS rol_nombre
             FROM usuarios u
             LEFT JOIN roles r ON r.id_rol = u.rol_id
             WHERE u.id_usuario = $1`,
            [decoded.id]
        );
        user = result.rows[0];
    } catch {
        return res.status(401).json({
            success: false,
            message: 'Token inválido'
        });
    }

    if (!user?.activo) {
        return res.status(401).json({
            success: false,
            message: 'Usuario no autorizado o inactivo'
        });
    }

    // Le cambiaron la contraseña o el rol (o lo desactivaron y reactivaron): el token es de una
    // sesión anterior y ya no vale (migración 033)
    if (!sesionVigente(decoded, user.version_sesion)) {
        return res.status(401).json({
            success: false,
            message: SESION_TERMINADA
        });
    }

    req.user = {
        id: user.id_usuario,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        rol_id: user.rol_id,
        // requireRole lo usa sin volver a consultar la base
        rol: user.rol_nombre || null,
        activo: user.activo,
        versionSesion: user.version_sesion ?? 0,
        loginAt: decoded.loginAt,
        tokenIssuedAt: new Date(decoded.iat * 1000).toISOString(),
        tokenExpiresAt: new Date(decoded.exp * 1000).toISOString()
    };

    // Sesión de 30 min sin actividad: cada petición válida recibe un token nuevo.
    // El frontend lo guarda (apiFetch, cabecera X-Nuevo-Token). Lleva el rol y el correo
    // actuales de la base, no los del token viejo, y la versión de la sesión.
    res.setHeader('X-Nuevo-Token', tokenDeSesion({
        id: user.id_usuario,
        email: user.email,
        rol: user.rol_nombre || null,
        loginAt: decoded.loginAt,
        versionSesion: user.version_sesion ?? 0
    }));

    next();
};

module.exports = { protect };
