const jwt = require('jsonwebtoken');
const pool = require('@config/db');

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            
            const decoded = jwt.verify(token, process.env.SECRET_KEY);

            const result = await pool.query(
                `SELECT id_usuario, email, nombre, apellido, rol_id, activo 
                 FROM usuarios 
                 WHERE id_usuario = $1`,
                [decoded.id]
            );

            const user = result.rows[0];

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
            
            next();
        } catch (error) {
            return res.status(401).json({ 
                success: false, 
                message: 'Token inválido' 
            });
        }
    } else {
        return res.status(401).json({ 
            success: false, 
            message: 'No hay token, autorización denegada' 
        });
    }
};

module.exports = { protect };