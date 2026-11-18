const express = require('express');
const router = express.Router();
const { requireRole } = require('@middlewares/role.middleware');
const {
  getInstalacionCompletaByMaquinaController,
  getInstalacionCompletaByIPController,
  getInstalacionCompletaBySerieController,
  getInstalacionesActivasByClienteController,
  getTodasInstalacionesActivasController,
  getMaquinasSinInstalacionController,
  createInstalacionController,
  deleteInstalacionController,
  getHistorialInstalacionesByMaquinaController,
  getResumenInstalacionesByClienteController,
  getInstalacionByIdController,
  getAllAreasController,
  getAreasByClienteController,
  getContratosByClienteController,
  getRentaByClienteController,
  updateInstalacionController
} = require('@controllers/instalacion/instalacion.controller');

/**
 * @swagger
 * components:
 *   schemas:
 *     Instalacion:
 *       type: object
 *       properties:
 *         id_instalacion:
 *           type: integer
 *         maquina_id:
 *           type: integer
 *         area_id:
 *           type: integer
 *         contrato_id:
 *           type: integer
 *         ip_address:
 *           type: string
 *         fecha_instalacion:
 *           type: string
 *           format: date-time
 *         fecha_retiro:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         observaciones:
 *           type: string
 *         activo:
 *           type: boolean
 */

/**
 * @swagger
 * /api/instalacion/disponibles:
 *   get:
 *     summary: Obtener máquinas sin instalación activa
 *     tags: [Instalaciones]
 *     responses:
 *       200:
 *         description: Lista de máquinas disponibles
 */
router.get('/disponibles', getMaquinasSinInstalacionController);

/**
 * @swagger
 * /api/instalacion/areas:
 *   get:
 *     summary: Obtener todas las áreas disponibles
 *     tags: [Instalaciones]
 *     responses:
 *       200:
 *         description: Lista de áreas
 */
router.get('/areas', getAllAreasController);

/**
 * @swagger
 * /api/instalacion/areas/cliente/{cliente_id}:
 *   get:
 *     summary: Obtener áreas de un cliente
 *     tags: [Instalaciones]
 *     parameters:
 *       - in: path
 *         name: cliente_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de áreas del cliente
 */
router.get('/areas/cliente/:cliente_id', getAreasByClienteController);

/**
 * @swagger
 * /api/instalacion/contratos/cliente/{cliente_id}:
 *   get:
 *     summary: Obtener contratos de un cliente para selección
 *     tags: [Instalaciones]
 *     parameters:
 *       - in: path
 *         name: cliente_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de contratos
 */
router.get('/contratos/cliente/:cliente_id', getContratosByClienteController);

/**
 * @swagger
 * /api/instalacion/cliente/{cliente_id}:
 *   get:
 *     summary: Obtener instalaciones activas por cliente
 *     tags: [Instalaciones]
 *     parameters:
 *       - in: path
 *         name: cliente_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de instalaciones
 */
router.get('/cliente/:cliente_id', getInstalacionesActivasByClienteController);
router.get('/instalaciones/activas', getTodasInstalacionesActivasController);
router.get('/resumen/cliente/:cliente_id', getResumenInstalacionesByClienteController);

/**
 * @swagger
 * /api/instalacion/historial/maquina/{maquina_id}:
 *   get:
 *     summary: Obtener historial de instalaciones de una máquina
 *     tags: [Instalaciones]
 *     parameters:
 *       - in: path
 *         name: maquina_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Historial de instalaciones
 */
router.get('/historial/maquina/:maquina_id', getHistorialInstalacionesByMaquinaController);

/**
 * @swagger
 * /api/instalacion/maquina/{maquina_id}:
 *   get:
 *     summary: Obtener información completa de instalación por ID de máquina
 *     tags: [Instalaciones]
 *     parameters:
 *       - in: path
 *         name: maquina_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Datos completos de instalación
 */
router.get('/maquina/:maquina_id', getInstalacionCompletaByMaquinaController);

/**
 * @swagger
 * /api/instalacion/ip/{ip}:
 *   get:
 *     summary: Buscar instalación activa por dirección IP
 *     tags: [Instalaciones]
 *     parameters:
 *       - in: path
 *         name: ip
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Datos de la instalación
 */
router.get('/ip/:ip', getInstalacionCompletaByIPController);

/**
 * @swagger
 * /api/instalacion/serie/{serie}:
 *   get:
 *     summary: Obtener información completa de instalación por serie
 *     tags: [Instalaciones]
 *     parameters:
 *       - in: path
 *         name: serie
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Datos de la instalación
 */
router.get('/serie/:serie', getInstalacionCompletaBySerieController);

/**
 * @swagger
 * /api/instalacion/{id_instalacion}:
 *   get:
 *     summary: Obtener instalación por ID
 *     tags: [Instalaciones]
 *     parameters:
 *       - in: path
 *         name: id_instalacion
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Detalle de instalación
 */
// Antes de /:id_instalacion; si no, Express nunca llega a esta ruta
router.get('/renta/cliente/:cliente_id', getRentaByClienteController);
router.get('/:id_instalacion', getInstalacionByIdController);

/**
 * @swagger
 * /api/instalacion:
 *   post:
 *     summary: Crear nueva instalación
 *     tags: [Instalaciones]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Instalacion'
 *     responses:
 *       201:
 *         description: Instalación creada
 */
router.post('/', requireRole('admin'), createInstalacionController);

/**
 * @swagger
 * /api/instalacion/{id_instalacion}/retirar:
 *   patch:
 *     summary: Retirar instalación (finalizar)
 *     tags: [Instalaciones]
 *     parameters:
 *       - in: path
 *         name: id_instalacion
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Instalación retirada
 */
router.patch('/:id_instalacion/retirar', requireRole('admin'), deleteInstalacionController);
router.patch('/:id_instalacion', requireRole('admin'), updateInstalacionController);

module.exports = router;



