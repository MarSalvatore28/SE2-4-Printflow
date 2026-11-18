const express = require('express');
const router = express.Router();

const {
  getReporteConsolidadoController,
  getReporteDetalladoController,
  getPeriodosDisponiblesController,
  fetchAllReportemes,
  searchReportemesController,
  getReportesConteoInicialController,
  getReportemesByClienteController,
  getReportemesByPeriodoController,
  getReportemesByMaquinaController,
  getReportemesByIPController,
  getReportemesByCuentaController,
  getReportemeByIdController,
  crearReportemeController,
  actualizarReportemeController,
  actualizarComentarioController,
  eliminarReportemeController,
} = require('@controllers/reportemes/reportemes.controller');

/**
 * @swagger
 * components:
 *   schemas:
 *     ReporteMes:
 *       type: object
 *       properties:
 *         id_reporte:
 *           type: integer
 *         maquina_id:
 *           type: integer
 *         periodo:
 *           type: string
 *         contador_anterior:
 *           type: integer
 *         contador_actual:
 *           type: integer
 *         diferencia:
 *           type: integer
 *         fecha_reporte:
 *           type: string
 *           format: date-time
 *         observaciones:
 *           type: string
 *         validado:
 *           type: boolean
 */

/**
 * @swagger
 * /api/reportemes:
 *   get:
 *     summary: Obtener todos los reportes de mes
 *     tags: [ReportesMes]
 *     responses:
 *       200:
 *         description: Lista de reportes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ReporteMes'
 */
router.get('/', fetchAllReportemes);

/**
 * @swagger
 * /api/reportemes/search:
 *   get:
 *     summary: Buscar reportes con filtros
 *     tags: [ReportesMes]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Término de búsqueda
 *     responses:
 *       200:
 *         description: Resultados de la búsqueda
 */
router.get('/search', searchReportemesController);

/**
 * @swagger
 * /api/reportemes/conteo-inicial:
 *   get:
 *     summary: Obtener reportes de conteo inicial
 *     tags: [ReportesMes]
 *     responses:
 *       200:
 *         description: Lista de conteos iniciales
 */
router.get('/conteo-inicial', getReportesConteoInicialController);

/**
 * @swagger
 * /api/reportemes/cliente/{id}:
 *   get:
 *     summary: Obtener reportes de un cliente
 *     tags: [ReportesMes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de reportes del cliente
 */
router.get('/cliente/:id', getReportemesByClienteController);

/**
 * @swagger
 * /api/reportemes/periodo/{periodo}:
 *   get:
 *     summary: Obtener reportes por periodo
 *     tags: [ReportesMes]
 *     parameters:
 *       - in: path
 *         name: periodo
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de reportes del periodo
 */
router.get('/periodo/:periodo', getReportemesByPeriodoController);

/**
 * @swagger
 * /api/reportemes/maquina/{id}:
 *   get:
 *     summary: Obtener reportes de una máquina
 *     tags: [ReportesMes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de reportes de la máquina
 */
router.get('/maquina/:id', getReportemesByMaquinaController);

/**
 * @swagger
 * /api/reportemes/ip/{ip}:
 *   get:
 *     summary: Obtener reportes por IP de máquina
 *     tags: [ReportesMes]
 *     parameters:
 *       - in: path
 *         name: ip
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de reportes
 */
router.get('/ip/:ip', getReportemesByIPController);

/**
 * @swagger
 * /api/reportemes/cuenta/{cuentaId}:
 *   get:
 *     summary: Obtener reportes por ID de cuenta
 *     tags: [ReportesMes]
 *     parameters:
 *       - in: path
 *         name: cuentaId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de reportes
 */
router.get('/cuenta/:cuentaId', getReportemesByCuentaController);

/**
 * @swagger
 * /api/reportemes/consolidado/{clienteId}/{periodo}:
 *   get:
 *     summary: Obtener reporte consolidado por cliente y periodo
 *     tags: [ReportesMes]
 *     parameters:
 *       - in: path
 *         name: clienteId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: periodo
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Reporte consolidado
 */
router.get('/consolidado/:clienteId/:periodo', getReporteConsolidadoController);

router.get('/detallado/:clienteId/:periodo', getReporteDetalladoController);

/**
 * @swagger
 * /api/reportemes/{id}:
 *   get:
 *     summary: Obtener detalles de un reporte
 *     tags: [ReportesMes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Detalle del reporte
 */
router.get('/:id', getReportemeByIdController);

/**
 * @swagger
 * /api/reportemes:
 *   post:
 *     summary: Crear nuevo reporte
 *     tags: [ReportesMes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReporteMes'
 *     responses:
 *       201:
 *         description: Reporte creado
 */
router.post('/', crearReportemeController);

/**
 * @swagger
 * /api/reportemes/{id}:
 *   put:
 *     summary: Actualizar reporte
 *     tags: [ReportesMes]
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
 *             $ref: '#/components/schemas/ReporteMes'
 *     responses:
 *       200:
 *         description: Reporte actualizado
 */
router.put('/:id', actualizarReportemeController);

/**
 * @swagger
 * /api/reportemes/{id}/comentario:
 *   patch:
 *     summary: Actualizar comentario de reporte
 *     tags: [ReportesMes]
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
 *             properties:
 *               comentario:
 *                 type: string
 *     responses:
 *       200:
 *         description: Comentario actualizado
 */
router.patch('/:id/comentario', actualizarComentarioController);

/**
 * @swagger
 * /api/reportemes/{id}:
 *   delete:
 *     summary: Eliminar reporte
 *     tags: [ReportesMes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Reporte eliminado
 */
router.delete('/:id', eliminarReportemeController);

module.exports = router;

