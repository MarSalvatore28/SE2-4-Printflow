const Usuario = require('@models/usuario/usuario.model');
const { generateToken, verifyToken } = require('@utils/jwt.util');

const loginUsuario = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña son requeridos'
      });
    }

    const user = await Usuario.validateLogin(email, password);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales incorrectas o usuario inactivo'
      });
    }

    const loginAt = new Date().toISOString();

    const token = generateToken({
      id: user.id,
      email: user.email,
      rol: user.rol?.nombre || null,
      loginAt: loginAt
    });

    res.json({
      success: true,
      token,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        rol: user.rol,
        loginAt: loginAt
      }
    });
  } catch (err) {
    console.error('💥 Error en login:', err);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};

const tokenUsuario = async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: 'Token no proporcionado'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const data = verifyToken(token);
    const usuario = await Usuario.findByEmail(data.email);

    if (!usuario) {
      return res.status(401).json({
        success: false,
        message: 'Usuario inválido'
      });
    }

    if (!usuario.activo) {
      return res.status(401).json({
        success: false,
        message: 'Usuario inactivo'
      });
    }

    const rol = await Usuario.getRolCompleto(usuario.id_usuario);

    res.json({
      success: true,
      usuario: {
        id: usuario.id_usuario,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        rol: rol || null,
        loginAt: data.loginAt || null,
        tokenIssuedAt: new Date(data.iat * 1000).toISOString(),
        tokenExpiresAt: new Date(data.exp * 1000).toISOString()
      }
    });
  } catch (err) {
    console.error('Error en verificación de token:', err);
    res.status(401).json({
      success: false,
      message: 'Token inválido o expirado'
    });
  }
};

const obtenerPerfil = async (req, res) => {
  try {
    const usuarioId = req.user.id; 

    const usuario = await Usuario.findById(usuarioId);

    if (!usuario) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    const rol = await Usuario.getRolCompleto(usuarioId);

    res.json({
      success: true,
      usuario: {
        id: usuario.id_usuario,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        activo: usuario.activo,
        rol: rol || null
      }
    });
  } catch (err) {
    console.error('Error al obtener perfil:', err);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};

const logoutUsuario = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(400).json({
        success: false,
        message: 'No hay token para cerrar sesión'
      });
    }

    const token = authHeader.split(' ')[1];
    const data = verifyToken(token);

    const logoutAt = new Date().toISOString();
    const loginAt = data.loginAt;

    const sessionDuration = loginAt 
      ? Math.floor((new Date(logoutAt) - new Date(loginAt)) / 1000) 
      : null;

    res.json({
      success: true,
      message: 'Sesión cerrada exitosamente',
      sessionInfo: {
        loginAt: loginAt,
        logoutAt: logoutAt,
        sessionDuration: sessionDuration,
        sessionDurationFormatted: sessionDuration 
          ? formatDuration(sessionDuration)
          : null
      }
    });
  } catch (err) {
    console.error('Error en logout:', err);
    res.status(500).json({
      success: false,
      message: 'Error al cerrar sesión'
    });
  }
};

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

module.exports = {
  loginUsuario,
  tokenUsuario,
  obtenerPerfil,
  logoutUsuario
};