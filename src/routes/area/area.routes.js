const express = require('express');
const router = express.Router();
const { requireRole } = require('@middlewares/role.middleware');
const { idValido } = require('@middlewares/idParam.middleware');

// Un :id que no es un entero positivo responde 400
router.param('id', idValido);

const {
  fetchAllAreas,
  getAreaByIdController,
  getAreasByClienteController,
  getAreasActivasController,
  getAreasInactivasController,
  searchAreasController,
  crearAreaController,
  actualizarAreaController,
  eliminarAreaController,
  eliminarAreaPermanenteController,
  activarAreaController,

  getAreasVigentesController,
  getEstadisticasAreaController,
  getHistorialCambiosAreaController
} = require('@controllers/area/area.controller');

/**
 * @swagger
 * components:
 *   schemas:
 *     Area:
 *       type: object
 *       required:
 *         - cliente_id
 *         - nombre
 *       properties:
 *         id_area:
 *           type: integer
 *         cliente_id:
 *           type: integer
 *         nombre:
 *           type: string
 *         descripcion:
 *           type: string
 *         activo:
 *           type: boolean
 */

/**
 * @swagger
 * /api/areas:
 *   get:
 *     summary: Obtener todas las áreas
 *     tags: [Areas]
 *     responses:
 *       200:
 *         description: Lista de áreas
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Area'
 */
router.get('/', fetchAllAreas);

/**
 * @swagger
 * /api/areas/search:
 *   get:
 *     summary: Buscar áreas
 *     tags: [Areas]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Término de búsqueda
 *     responses:
 *       200:
 *         description: Resultados de búsqueda
 */
router.get('/search', searchAreasController);

/**
 * @swagger
 * /api/areas/activas:
 *   get:
 *     summary: Obtener todas las áreas activas
 *     tags: [Areas]
 *     responses:
 *       200:
 *         description: Lista de áreas activas
 */
router.get('/activas', getAreasActivasController);

/**
 * @swagger
 * /api/areas/inactivas:
 *   get:
 *     summary: Obtener todas las áreas inactivas
 *     tags: [Areas]
 *     responses:
 *       200:
 *         description: Lista de áreas inactivas
 */
router.get('/inactivas', getAreasInactivasController);

/**
 * @swagger
 * /api/areas/vigentes:
 *   get:
 *     summary: Obtener áreas con contratos vigentes
 *     tags: [Areas]
 *     responses:
 *       200:
 *         description: Lista de áreas vigentes
 */
router.get('/vigentes', getAreasVigentesController);

/**
 * @swagger
 * /api/areas/cliente/{id}:
 *   get:
 *     summary: Obtener áreas de un cliente específico
 *     tags: [Areas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de áreas del cliente
 */
router.get('/cliente/:id', getAreasByClienteController);

/**
 * @swagger
 * /api/areas/{id}:
 *   get:
 *     summary: Obtener área por ID
 *     tags: [Areas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Detalles del área
 */
router.get('/:id', getAreaByIdController);

/**
 * @swagger
 * /api/areas/{id}/estadisticas:
 *   get:
 *     summary: Obtener estadísticas de un área
 *     tags: [Areas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Estadísticas del área
 */
router.get('/:id/estadisticas', getEstadisticasAreaController);

/**
 * @swagger
 * /api/areas/{id}/historial-cambios:
 *   get:
 *     summary: Obtener historial de cambios de máquinas en un área
 *     tags: [Areas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Historial de cambios
 */
router.get('/:id/historial-cambios', getHistorialCambiosAreaController);

/**
 * @swagger
 * /api/areas:
 *   post:
 *     summary: Crear nueva área
 *     tags: [Areas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Area'
 *     responses:
 *       201:
 *         description: Área creada
 */
router.post('/', requireRole('admin'), crearAreaController);

/**
 * @swagger
 * /api/areas/{id}:
 *   put:
 *     summary: Actualizar área
 *     tags: [Areas]
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
 *             $ref: '#/components/schemas/Area'
 *     responses:
 *       200:
 *         description: Área actualizada
 */
router.put('/:id', requireRole('admin'), actualizarAreaController);

/**
 * @swagger
 * /api/areas/{id}/activar:
 *   patch:
 *     summary: Activar área desactivada
 *     tags: [Areas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Área activada
 */
router.patch('/:id/activar', requireRole('admin'), activarAreaController);

/**
 * @swagger
 * /api/areas/{id}:
 *   delete:
 *     summary: Desactivar área (soft delete)
 *     tags: [Areas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Área desactivada
 */
router.delete('/:id', requireRole('admin'), eliminarAreaController);

/**
 * @swagger
 * /api/areas/{id}/permanente:
 *   delete:
 *     summary: Eliminar área permanentemente
 *     tags: [Areas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Área eliminada permanentemente
 */
router.delete('/:id/permanente', requireRole('admin'), eliminarAreaPermanenteController);


module.exports = router;