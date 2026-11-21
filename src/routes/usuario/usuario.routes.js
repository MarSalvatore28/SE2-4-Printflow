const express = require('express');
const router = express.Router();
const {
  loginUsuario,
  tokenUsuario,
  obtenerPerfil,
  logoutUsuario
} = require('@controllers/usuario/usuario.controller');
const { protect } = require('@middlewares/auth.middleware');
const { limiteLogin } = require('@middlewares/limiteLogin.middleware');

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Iniciar sesión (devuelve el token para «Authorize»)
 *     description: >
 *       Usuarios de prueba: admin@printflow.local, operador@printflow.local y auditor@printflow.local,
 *       contraseña Printflow2026*. El token dura 30 min sin uso.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@printflow.local
 *               password:
 *                 type: string
 *                 example: Printflow2026*
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 user:
 *                   type: object
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Demasiados intentos fallidos desde la misma IP (10 cada 15 minutos; se cambia con LOGIN_MAX_INTENTOS)
 */
router.post('/login', limiteLogin, loginUsuario);

/**
 * @swagger
 * /api/auth/validate-token:
 *   get:
 *     summary: Validate user token
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Token is valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 user:
 *                   type: object
 *       401:
 *         description: Invalid or expired token
 */
router.get('/validate-token', tokenUsuario);

/**
 * @swagger
 * /api/auth/perfil:
 *   get:
 *     summary: Get user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 */
router.get('/perfil', protect, obtenerPerfil);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: Unauthorized
 */
router.post('/logout', protect, logoutUsuario);

module.exports = router;