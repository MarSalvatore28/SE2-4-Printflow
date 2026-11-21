// Gestión de usuarios (S4-03). Solo admin: el permiso se exige en usuarios.routes.js.
const bcrypt = require('bcrypt');
const {
  listarUsuarios,
  obtenerUsuario,
  listarRoles,
  obtenerRol,
  existeEmail,
  crearUsuario,
  actualizarUsuario,
  cambiarActivo,
} = require('@models/usuario/usuarios.model');
const {
  MENSAJES,
  parseId,
  validarDatosUsuario,
  validarCambioPropio,
} = require('@utils/usuarios.validacion');
const { ACCIONES, auditarFila, contextoAuditoria, enTransaccion } = require('@services/auditoria');
const { getVersionSesion } = require('@models/usuario/usuario.model');
const { tokenDeSesion } = require('@utils/jwt.util');

const BCRYPT_RONDAS = 10;
const PG_UNIQUE_VIOLATION = '23505';

const errorInterno = (res, mensaje, err) => {
  console.error(`${mensaje}:`, err);
  return res.status(500).json({
    success: false,
    message: mensaje,
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
};

const listarUsuariosController = async (req, res) => {
  try {
    const usuarios = await listarUsuarios();
    res.status(200).json({ success: true, data: usuarios, count: usuarios.length });
  } catch (err) {
    errorInterno(res, 'Error al obtener los usuarios', err);
  }
};

const listarRolesController = async (req, res) => {
  try {
    const roles = await listarRoles();
    res.status(200).json({ success: true, data: roles, count: roles.length });
  } catch (err) {
    errorInterno(res, 'Error al obtener los roles', err);
  }
};

const crearUsuarioController = async (req, res) => {
  try {
    const { error, datos } = validarDatosUsuario(req.body, { esCreacion: true });
    if (error) return res.status(400).json({ success: false, message: error });

    if (!(await obtenerRol(datos.rol_id))) {
      return res.status(400).json({ success: false, message: 'El rol seleccionado no existe' });
    }
    if (await existeEmail(datos.email)) {
      return res.status(409).json({ success: false, message: MENSAJES.EMAIL_REPETIDO });
    }

    const passwordHash = await bcrypt.hash(datos.password, BCRYPT_RONDAS);
    // S3-02: el alta y su auditoría van en la misma transacción (sin la contraseña)
    const usuario = await enTransaccion(req.pool, async (db) => {
      const nuevo = await crearUsuario({ ...datos, passwordHash }, db);
      await auditarFila(db, { tabla: 'usuarios', idRegistro: nuevo.id_usuario, accion: ACCIONES.CREAR, ...contextoAuditoria(req) });
      return nuevo;
    });

    res.status(201).json({ success: true, message: 'Usuario creado exitosamente', data: usuario });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ success: false, message: MENSAJES.EMAIL_REPETIDO });
    }
    errorInterno(res, 'Error al crear el usuario', err);
  }
};

const actualizarUsuarioController = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID de usuario inválido' });

    const { error, datos } = validarDatosUsuario(req.body, { esCreacion: false });
    if (error) return res.status(400).json({ success: false, message: error });

    if (!(await obtenerUsuario(id))) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const rol = await obtenerRol(datos.rol_id);
    if (!rol) return res.status(400).json({ success: false, message: 'El rol seleccionado no existe' });

    const errorPropio = validarCambioPropio(req.user.id, id, { rolNombre: rol.nombre });
    if (errorPropio) return res.status(409).json({ success: false, message: errorPropio });

    if (await existeEmail(datos.email, id)) {
      return res.status(409).json({ success: false, message: MENSAJES.EMAIL_REPETIDO });
    }

    const passwordHash = datos.password ? await bcrypt.hash(datos.password, BCRYPT_RONDAS) : null;
    const resultado = await actualizarUsuario(id, { ...datos, passwordHash }, contextoAuditoria(req));

    if (resultado.sinAdmin) return res.status(409).json({ success: false, message: MENSAJES.ULTIMO_ADMIN });
    if (!resultado.usuario) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    // Si el admin cambió su propia contraseña, sus otras sesiones terminan, pero la de esta
    // petición sigue: el token renovado lleva la versión nueva (el de protect ya no valdría)
    if (Number(req.user.id) === id) {
      res.setHeader('X-Nuevo-Token', tokenDeSesion({
        id,
        email: resultado.usuario.email,
        rol: resultado.usuario.rol || null,
        loginAt: req.user.loginAt,
        versionSesion: (await getVersionSesion(id)) ?? 0,
      }));
    }

    res.status(200).json({
      success: true,
      message: datos.password ? 'Usuario y contraseña actualizados exitosamente' : 'Usuario actualizado exitosamente',
      data: resultado.usuario,
    });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ success: false, message: MENSAJES.EMAIL_REPETIDO });
    }
    errorInterno(res, 'Error al actualizar el usuario', err);
  }
};

const cambiarActivoController = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID de usuario inválido' });

    const { activo } = req.body || {};
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ success: false, message: 'El campo activo debe ser true o false' });
    }

    const errorPropio = validarCambioPropio(req.user.id, id, { activo });
    if (errorPropio) return res.status(409).json({ success: false, message: errorPropio });

    const resultado = await cambiarActivo(id, activo, contextoAuditoria(req));
    if (resultado.sinAdmin) return res.status(409).json({ success: false, message: MENSAJES.ULTIMO_ADMIN });
    if (!resultado.usuario) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    res.status(200).json({
      success: true,
      message: activo ? 'Usuario activado exitosamente' : 'Usuario desactivado exitosamente',
      data: resultado.usuario,
    });
  } catch (err) {
    errorInterno(res, 'Error al cambiar el estado del usuario', err);
  }
};

module.exports = {
  listarUsuariosController,
  listarRolesController,
  crearUsuarioController,
  actualizarUsuarioController,
  cambiarActivoController,
};
