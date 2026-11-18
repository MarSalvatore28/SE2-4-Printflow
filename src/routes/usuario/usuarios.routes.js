// Gestión de usuarios (S4-03). Todas las rutas son solo para admin.
// Se monta en app.js como /api/usuarios (líneas [B-F4]); el login sigue en usuario.routes.js.
const express = require('express');
const router = express.Router();
const { requireRole } = require('@middlewares/role.middleware');
const {
  listarUsuariosController,
  listarRolesController,
  crearUsuarioController,
  actualizarUsuarioController,
  cambiarActivoController,
} = require('@controllers/usuario/usuarios.controller');

/**
 * @swagger
 * components:
 *   schemas:
 *     Usuario:
 *       type: object
 *       description: La contraseña nunca se devuelve.
 *       properties:
 *         id_usuario:
 *           type: integer
 *         nombre:
 *           type: string
 *         apellido:
 *           type: string
 *           nullable: true
 *         email:
 *           type: string
 *         activo:
 *           type: boolean
 *         rol_id:
 *           type: integer
 *         rol:
 *           type: string
 *           example: operador
 *         rol_descripcion:
 *           type: string
 *     UsuarioEntrada:
 *       type: object
 *       required:
 *         - nombre
 *         - email
 *         - rol_id
 *       properties:
 *         nombre:
 *           type: string
 *         apellido:
 *           type: string
 *         email:
 *           type: string
 *           description: Único sin distinguir mayúsculas; se guarda en minúsculas.
 *         rol_id:
 *           type: integer
 *         password:
 *           type: string
 *           description: Mínimo 8 caracteres, con al menos una letra y un número. Obligatoria al crear; al editar, si viene, se cambia.
 */

/**
 * @swagger
 * /api/usuarios:
 *   get:
 *     summary: Listar usuarios (solo admin)
 *     tags: [Usuarios]
 *     responses:
 *       200:
 *         description: Lista de usuarios, sin contraseñas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Usuario'
 *       401:
 *         description: Sin sesión
 *       403:
 *         description: El rol no es admin
 */
router.get('/', requireRole('admin'), listarUsuariosController);

/**
 * @swagger
 * /api/usuarios/roles:
 *   get:
 *     summary: Listar los roles que se pueden asignar (solo admin)
 *     tags: [Usuarios]
 *     responses:
 *       200:
 *         description: Lista de roles (id_rol, nombre, descripcion)
 *       403:
 *         description: El rol no es admin
 */
router.get('/roles', requireRole('admin'), listarRolesController);

/**
 * @swagger
 * /api/usuarios:
 *   post:
 *     summary: Crear un usuario (solo admin)
 *     tags: [Usuarios]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UsuarioEntrada'
 *     responses:
 *       201:
 *         description: Usuario creado (activo)
 *       400:
 *         description: Datos inválidos o el rol no existe
 *       403:
 *         description: El rol no es admin
 *       409:
 *         description: Ya existe un usuario con ese correo
 */
router.post('/', requireRole('admin'), crearUsuarioController);

/**
 * @swagger
 * /api/usuarios/{id}:
 *   put:
 *     summary: Editar un usuario (solo admin)
 *     description: Cambia nombre, apellido, correo y rol. La contraseña es opcional; si viene, se cambia. Un admin no puede quitarse el rol admin a sí mismo y siempre debe quedar al menos un admin activo.
 *     tags: [Usuarios]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UsuarioEntrada'
 *     responses:
 *       200:
 *         description: Usuario actualizado
 *       400:
 *         description: Datos inválidos, ID inválido o el rol no existe
 *       403:
 *         description: El rol no es admin
 *       404:
 *         description: Usuario no encontrado
 *       409:
 *         description: Correo repetido, quitarse el rol admin a sí mismo o dejar el sistema sin admin activo
 */
router.put('/:id', requireRole('admin'), actualizarUsuarioController);

/**
 * @swagger
 * /api/usuarios/{id}/activo:
 *   patch:
 *     summary: Activar o desactivar un usuario (solo admin)
 *     description: Un usuario desactivado no puede iniciar sesión y su sesión abierta deja de valer. Un admin no puede desactivarse a sí mismo y siempre debe quedar al menos un admin activo.
 *     tags: [Usuarios]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - activo
 *             properties:
 *               activo:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Estado actualizado
 *       400:
 *         description: activo no es booleano o ID inválido
 *       403:
 *         description: El rol no es admin
 *       404:
 *         description: Usuario no encontrado
 *       409:
 *         description: Desactivarse a sí mismo o dejar el sistema sin admin activo
 */
router.patch('/:id/activo', requireRole('admin'), cambiarActivoController);

module.exports = router;
