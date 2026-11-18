const express = require('express');
const router = express.Router();
const {
  fetchAllLotes,
  getLoteByIdController,
  getLoteByCodigoController,
  getLotesPendientesController,
  getLotesByEstadoController,
  getLotesByClienteController,
  getLotesByPeriodoController,
  createLoteController,
  aprobarLoteController,
  rechazarLoteController,
  getPreviewLoteController,
  deleteLoteController,
  getEstadisticasLotesController
} = require('@controllers/lotes_carga/lotes_carga.controller');

/**
 * @swagger
 * components:
 *   schemas:
 *     LoteCarga:
 *       type: object
 *       properties:
 *         id_lote:
 *           type: integer
 *         codigo:
 *           type: string
 *         cliente_id:
 *           type: integer
 *         estado:
 *           type: string
 *           enum: [PENDIENTE, APROBADO, RECHAZADO, PROCESANDO]
 *         periodo:
 *           type: string
 *         total_registros:
 *           type: integer
 *         fecha_carga:
 *           type: string
 *           format: date-time
 *         usuario_id:
 *           type: integer
 */

/**
 * @swagger
 * /api/lotes:
 *   get:
 *     summary: Obtener todos los lotes
 *     tags: [LotesCarga]
 *     responses:
 *       200:
 *         description: Lista de lotes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/LoteCarga'
 */
router.get('/', fetchAllLotes);

/**
 * @swagger
 * /api/lotes/estadisticas:
 *   get:
 *     summary: Obtener estadísticas de lotes
 *     tags: [LotesCarga]
 *     responses:
 *       200:
 *         description: Estadísticas generales
 */
router.get('/estadisticas', getEstadisticasLotesController);

/**
 * @swagger
 * /api/lotes/pendientes:
 *   get:
 *     summary: Obtener lotes pendientes de aprobación
 *     tags: [LotesCarga]
 *     responses:
 *       200:
 *         description: Lista de lotes pendientes
 */
router.get('/pendientes', getLotesPendientesController);

/**
 * @swagger
 * /api/lotes/estado/{estado}:
 *   get:
 *     summary: Obtener lotes por estado
 *     tags: [LotesCarga]
 *     parameters:
 *       - in: path
 *         name: estado
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de lotes por estado
 */
router.get('/estado/:estado', getLotesByEstadoController);

/**
 * @swagger
 * /api/lotes/cliente/{clienteId}:
 *   get:
 *     summary: Obtener lotes de un cliente
 *     tags: [LotesCarga]
 *     parameters:
 *       - in: path
 *         name: clienteId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de lotes del cliente
 */
router.get('/cliente/:clienteId', getLotesByClienteController);

/**
 * @swagger
 * /api/lotes/periodo/{periodo}:
 *   get:
 *     summary: Obtener lotes por periodo
 *     tags: [LotesCarga]
 *     parameters:
 *       - in: path
 *         name: periodo
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de lotes por periodo
 */
router.get('/periodo/:periodo', getLotesByPeriodoController);

/**
 * @swagger
 * /api/lotes/codigo/{codigo}:
 *   get:
 *     summary: Obtener lote por código
 *     tags: [LotesCarga]
 *     parameters:
 *       - in: path
 *         name: codigo
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detalles del lote
 */
router.get('/codigo/:codigo', getLoteByCodigoController);

/**
 * @swagger
 * /api/lotes/codigo/{codigo}/preview:
 *   get:
 *     summary: Previsualizar contenido de un lote
 *     tags: [LotesCarga]
 *     parameters:
 *       - in: path
 *         name: codigo
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Previsualización de datos
 */
router.get('/codigo/:codigo/preview', getPreviewLoteController);

/**
 * @swagger
 * /api/lotes/{id}:
 *   get:
 *     summary: Obtener lote por ID
 *     tags: [LotesCarga]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Detalles del lote
 */
router.get('/:id', getLoteByIdController);

/**
 * @swagger
 * /api/lotes:
 *   post:
 *     summary: Crear nuevo lote de carga
 *     tags: [LotesCarga]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Lote creado y procesado
 */
router.post('/', createLoteController);

/**
 * @swagger
 * /api/lotes/codigo/{codigo}/aprobar:
 *   post:
 *     summary: Aprobar lote
 *     tags: [LotesCarga]
 *     parameters:
 *       - in: path
 *         name: codigo
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lote aprobado
 */
router.post('/codigo/:codigo/aprobar', aprobarLoteController);

/**
 * @swagger
 * /api/lotes/codigo/{codigo}/rechazar:
 *   post:
 *     summary: Rechazar lote
 *     tags: [LotesCarga]
 *     parameters:
 *       - in: path
 *         name: codigo
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lote rechazado
 */
router.post('/codigo/:codigo/rechazar', rechazarLoteController);

/**
 * @swagger
 * /api/lotes/codigo/{codigo}:
 *   delete:
 *     summary: Eliminar lote
 *     tags: [LotesCarga]
 *     parameters:
 *       - in: path
 *         name: codigo
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lote eliminado
 */
router.delete('/codigo/:codigo', deleteLoteController);

module.exports = router;

