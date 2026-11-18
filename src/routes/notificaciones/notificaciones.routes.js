const express = require('express');
const router = express.Router();

const {
  listarController,
  listarNoLeidasController,
  listarLeidasController,
  contarNoLeidasController,
  estadisticasController,
  obtenerController,
  listarPorLoteController,
  crearController,
  marcarLeidaController,
  marcarVariasLeidasController,
  marcarTodasLeidasController,
  eliminarController,
  limpiarAntiguasController,
  aprobarPorNotificacionController,
  rechazarPorNotificacionController,
} = require('@controllers/notificaciones/notificaciones.controller');

// Todas las rutas pasan antes por protect (app.js): exigen Authorization: Bearer <token>.
// Las rutas fijas van antes de /:id para que Express no las confunda con un ID.

/**
 * @swagger
 * tags:
 *   - name: Notificaciones
 *     description: Notificaciones en tiempo real
 * components:
 *   schemas:
 *     Notificacion:
 *       type: object
 *       properties:
 *         id_notificacion: { type: integer }
 *         titulo: { type: string }
 *         mensaje: { type: string, nullable: true }
 *         datos_adicionales: { type: object, nullable: true }
 *         lote_id: { type: integer, nullable: true }
 *         leida: { type: boolean }
 *         fecha_creacion: { type: string, format: date-time }
 *         fecha_lectura: { type: string, format: date-time, nullable: true }
 *         tipo_notificacion_id: { type: integer }
 *         tipo_codigo: { type: string, example: NUEVO_LOTE }
 *         tipo_nombre: { type: string }
 *         codigo_lote: { type: string, nullable: true }
 *         periodo: { type: string, nullable: true, example: '2026-10' }
 *         total_registros: { type: integer, nullable: true }
 *         fecha_aprobacion: { type: string, format: date-time, nullable: true }
 *         usuario_nombre: { type: string, nullable: true, description: Quién aprobó el lote }
 *     ErroresAprobacion:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: false }
 *         message: { type: string }
 *         errores:
 *           type: array
 *           items: { type: string }
 */

/**
 * @swagger
 * /api/notificaciones:
 *   get:
 *     summary: Lista las notificaciones (más recientes primero)
 *     tags: [Notificaciones]
 *     parameters:
 *       - in: query
 *         name: leida
 *         schema: { type: boolean }
 *         description: Solo leídas (true) o no leídas (false)
 *       - in: query
 *         name: limite
 *         schema: { type: integer, minimum: 1, maximum: 500 }
 *     responses:
 *       200:
 *         description: Lista de notificaciones
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 total: { type: integer }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Notificacion' }
 *       400: { description: Parámetros inválidos }
 *       401: { description: Sin token o token inválido }
 *   post:
 *     summary: Crea una notificación (se avisa en tiempo real)
 *     tags: [Notificaciones]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [titulo]
 *             properties:
 *               titulo: { type: string, maxLength: 200 }
 *               mensaje: { type: string }
 *               lote_id: { type: integer }
 *               tipo_codigo: { type: string, default: LOTE_PENDIENTE }
 *               datos_adicionales: { type: object }
 *     responses:
 *       201: { description: Notificación creada }
 *       400: { description: Datos inválidos, tipo o lote inexistente }
 */
router.get('/', listarController);
router.post('/', crearController);

/**
 * @swagger
 * /api/notificaciones/no-leidas:
 *   get:
 *     summary: Notificaciones no leídas
 *     tags: [Notificaciones]
 *     responses:
 *       200: { description: Lista de notificaciones no leídas }
 * /api/notificaciones/leidas:
 *   get:
 *     summary: Notificaciones leídas
 *     tags: [Notificaciones]
 *     responses:
 *       200: { description: Lista de notificaciones leídas }
 * /api/notificaciones/contar-no-leidas:
 *   get:
 *     summary: Cuántas notificaciones no leídas hay (contador de la campana)
 *     tags: [Notificaciones]
 *     responses:
 *       200:
 *         description: Total de no leídas en data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: integer, example: 3 }
 * /api/notificaciones/estadisticas:
 *   get:
 *     summary: Totales de notificaciones, leídas, no leídas y por tipo
 *     tags: [Notificaciones]
 *     responses:
 *       200: { description: Estadísticas }
 */
router.get('/no-leidas', listarNoLeidasController);
router.get('/leidas', listarLeidasController);
router.get('/contar-no-leidas', contarNoLeidasController);
router.get('/estadisticas', estadisticasController);

/**
 * @swagger
 * /api/notificaciones/marcar-varias-leidas:
 *   patch:
 *     summary: Marca varias notificaciones como leídas
 *     tags: [Notificaciones]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: integer }
 *     responses:
 *       200: { description: Cuántas se marcaron (data.actualizadas) }
 *       400: { description: ids inválidos }
 * /api/notificaciones/marcar-todas-leidas:
 *   patch:
 *     summary: Marca todas las notificaciones como leídas
 *     tags: [Notificaciones]
 *     responses:
 *       200: { description: Cuántas se marcaron (data.actualizadas) }
 * /api/notificaciones/limpiar-antiguas:
 *   delete:
 *     summary: Borra las notificaciones LEÍDAS de más de N días
 *     tags: [Notificaciones]
 *     parameters:
 *       - in: query
 *         name: dias
 *         schema: { type: integer, default: 30, minimum: 1, maximum: 3650 }
 *     responses:
 *       200: { description: Cuántas se borraron (data.eliminadas) }
 *       400: { description: dias inválido }
 */
router.patch('/marcar-varias-leidas', marcarVariasLeidasController);
router.patch('/marcar-todas-leidas', marcarTodasLeidasController);
router.delete('/limpiar-antiguas', limpiarAntiguasController);

/**
 * @swagger
 * /api/notificaciones/lote/{loteId}:
 *   get:
 *     summary: Notificaciones de un lote
 *     tags: [Notificaciones]
 *     parameters:
 *       - in: path
 *         name: loteId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Lista de notificaciones del lote }
 *       400: { description: ID inválido }
 */
router.get('/lote/:loteId', listarPorLoteController);

/**
 * @swagger
 * /api/notificaciones/{id}:
 *   get:
 *     summary: Una notificación
 *     tags: [Notificaciones]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Notificación }
 *       404: { description: Notificación no encontrada }
 *   delete:
 *     summary: Elimina una notificación ya leída
 *     tags: [Notificaciones]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Notificación eliminada }
 *       404: { description: Notificación no encontrada }
 *       409: { description: La notificación no está leída }
 * /api/notificaciones/{id}/marcar-leida:
 *   patch:
 *     summary: Marca una notificación como leída
 *     tags: [Notificaciones]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Notificación marcada como leída }
 *       404: { description: Notificación no encontrada }
 * /api/notificaciones/{id}/aprobar:
 *   post:
 *     summary: Aprueba el lote de una notificación
 *     description: Valida el lote como /api/staging/approve-batch y guarda quién lo aprobó (el usuario del token).
 *     tags: [Notificaciones]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               periodo: { type: string, example: '2026-10' }
 *               fecha_corte: { type: string, description: 'Si no hay período, se toma el mes de esta fecha' }
 *     responses:
 *       200: { description: Lote aprobado }
 *       400: { description: La notificación no tiene lote o el período es inválido }
 *       404: { description: Notificación o lote no encontrado }
 *       409:
 *         description: No se puede aprobar
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErroresAprobacion' }
 * /api/notificaciones/{id}/rechazar:
 *   post:
 *     summary: Rechaza el lote de una notificación
 *     tags: [Notificaciones]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               motivo: { type: string, maxLength: 500 }
 *     responses:
 *       200: { description: Lote rechazado }
 *       400: { description: La notificación no tiene lote }
 *       404: { description: Notificación o lote no encontrado }
 *       409: { description: El lote ya estaba aprobado o rechazado }
 */
router.get('/:id', obtenerController);
router.delete('/:id', eliminarController);
router.patch('/:id/marcar-leida', marcarLeidaController);
router.post('/:id/aprobar', aprobarPorNotificacionController);
router.post('/:id/rechazar', rechazarPorNotificacionController);

module.exports = router;
