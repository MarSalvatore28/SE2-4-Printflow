const pool = require('@config/db');
const { generateToken, verifyToken } = require('@utils/jwt.util');

const protect = async (req, res, next) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'No hay token, autorización denegada'
        });
    }

    let decoded;
    let user;
    try {
        decoded = verifyToken(header.split(' ')[1]);

        const result = await pool.query(
            `SELECT id_usuario, email, nombre, apellido, rol_id, activo
             FROM usuarios
             WHERE id_usuario = $1`,
            [decoded.id]
        );
        user = result.rows[0];
    } catch {
        return res.status(401).json({
            success: false,
            message: 'Token inválido'
        });
    }

    if (!user || !user.activo) {
        return res.status(401).json({
            success: false,
            message: 'Usuario no autorizado o inactivo'
        });
    }

    req.user = {
        id: user.id_usuario,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        rol_id: user.rol_id,
        activo: user.activo,
        loginAt: decoded.loginAt,
        tokenIssuedAt: new Date(decoded.iat * 1000).toISOString(),
        tokenExpiresAt: new Date(decoded.exp * 1000).toISOString()
    };

    // Sesión de 30 min sin actividad: cada petición válida recibe un token nuevo.
    // El frontend lo guarda (apiFetch, cabecera X-Nuevo-Token).
    res.setHeader('X-Nuevo-Token', generateToken({
        id: decoded.id,
        email: decoded.email,
        rol: decoded.rol,
        loginAt: decoded.loginAt
    }));

    next();
};

module.exports = { protect };
