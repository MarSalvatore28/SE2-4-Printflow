const express = require('express');
const router = express.Router();
const { requireRole } = require('@middlewares/role.middleware');

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
  listarLotesController,
  obtenerLoteController,
  aprobarLoteController,
  rechazarLoteController,
  aprobarPorNotificacionController,
  rechazarPorNotificacionController,
} = require('@controllers/notificaciones/notificaciones.controller');

// Todas las rutas pasan antes por protect (app.js): exigen Authorization: Bearer <token>.
// Las rutas fijas van antes de /:id para que Express no las confunda con un ID.

/**
 * @swagger
 * tags:
 *   - name: Notificaciones
 *     description: Notificaciones en tiempo real y lotes recibidos por la ingesta
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
 *     Lote:
 *       type: object
 *       properties:
 *         id_lote: { type: integer }
 *         codigo_referencia: { type: string }
 *         periodo: { type: string, nullable: true }
 *         estado:
 *           type: string
 *           enum: [PENDIENTE, PROCESADO, DESCARTADO, ERROR]
 *           description: >
 *             PROCESADO = aprobado; DESCARTADO = rechazado (con fecha_rechazo, o sin reportes en staging);
 *             ERROR = en staging con reportes bloqueados (procesar_lectura = false);
 *             PENDIENTE = en staging esperando aprobación.
 *         motivo: { type: string, nullable: true, description: Motivo del error o del rechazo }
 *         fecha_carga: { type: string, format: date-time, description: Fecha de recepción }
 *         fecha_procesamiento: { type: string, format: date-time, nullable: true, description: Fecha de aprobación o rechazo }
 *         fecha_aprobacion: { type: string, format: date-time, nullable: true }
 *         fecha_corte: { type: string, format: date-time, nullable: true }
 *         total_registros_cargados: { type: integer }
 *         reportes_staging: { type: integer }
 *         reportes_con_error: { type: integer }
 *         reportes_oficiales: { type: integer }
 *         notificaciones_no_leidas: { type: integer }
 *         usuario_aprobacion_nombre: { type: string, nullable: true }
 *         fecha_rechazo: { type: string, format: date-time, nullable: true, description: Cuándo se rechazó (guardado en el lote desde la migración 034) }
 *         motivo_rechazo: { type: string, nullable: true }
 *         usuario_rechazo_id: { type: integer, nullable: true }
 *         usuario_rechazo_nombre: { type: string, nullable: true, description: Quién rechazó el lote }
 *         clientes:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id_cliente: { type: integer }
 *               nombre: { type: string }
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
router.post('/', requireRole('admin', 'operador'), crearController);

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
 *     summary: Borra las notificaciones LEÍDAS de más de N días (salvo las de lotes pendientes)
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
router.delete('/limpiar-antiguas', requireRole('admin'), limpiarAntiguasController);

/**
 * @swagger
 * /api/notificaciones/lotes:
 *   get:
 *     summary: Lotes recibidos, con su estado (más recientes primero)
 *     description: Reemplaza al antiguo /api/lotes. Ordena por fecha de recepción descendente.
 *     tags: [Notificaciones]
 *     parameters:
 *       - in: query
 *         name: estado
 *         schema: { type: string, enum: [PENDIENTE, PROCESADO, DESCARTADO, ERROR] }
 *       - in: query
 *         name: cliente_id
 *         schema: { type: integer }
 *         description: Lotes con reportes de ese cliente
 *       - in: query
 *         name: desde
 *         schema: { type: string, format: date }
 *         description: Fecha de recepción desde (inclusive)
 *       - in: query
 *         name: hasta
 *         schema: { type: string, format: date }
 *         description: Fecha de recepción hasta (inclusive)
 *     responses:
 *       200:
 *         description: Lista de lotes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 total: { type: integer }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Lote' }
 *       400: { description: Filtros inválidos }
 * /api/notificaciones/lotes/{loteId}:
 *   get:
 *     summary: Un lote con su estado
 *     tags: [Notificaciones]
 *     parameters:
 *       - in: path
 *         name: loteId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Lote
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Lote' }
 *       404: { description: Lote no encontrado }
 * /api/notificaciones/lotes/{loteId}/aprobar:
 *   post:
 *     summary: Aprueba un lote (pasa sus reportes de staging a oficiales)
 *     description: Valida el lote como /api/staging/approve-batch y guarda quién lo aprobó.
 *     tags: [Notificaciones]
 *     parameters:
 *       - in: path
 *         name: loteId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               periodo: { type: string, example: '2026-10', description: 'AAAA-MM. Si falta, se usa el del lote' }
 *     responses:
 *       200: { description: Lote aprobado; data trae el lote actualizado }
 *       400: { description: Período inválido }
 *       404: { description: Lote no encontrado }
 *       409:
 *         description: No se puede aprobar (ya aprobado, rechazado o con errores de validación)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErroresAprobacion' }
 * /api/notificaciones/lotes/{loteId}/rechazar:
 *   post:
 *     summary: Rechaza un lote (borra su staging; queda DESCARTADO con el motivo)
 *     tags: [Notificaciones]
 *     parameters:
 *       - in: path
 *         name: loteId
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
 *       200: { description: Lote rechazado; data trae el lote actualizado }
 *       404: { description: Lote no encontrado }
 *       409: { description: El lote ya estaba aprobado o rechazado }
 */
router.get('/lotes', listarLotesController);
router.get('/lotes/:loteId', obtenerLoteController);
router.post('/lotes/:loteId/aprobar', requireRole('admin', 'operador'), aprobarLoteController);
router.post('/lotes/:loteId/rechazar', requireRole('admin', 'operador'), rechazarLoteController);

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
 *       409: { description: La notificación no está leída, o es de un lote pendiente (la de un lote aprobado o rechazado sí se borra; el rechazo queda en el lote) }
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
 *     description: Igual que /api/notificaciones/lotes/{loteId}/aprobar. El aprobador es el usuario del token.
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
router.delete('/:id', requireRole('admin', 'operador'), eliminarController);
router.patch('/:id/marcar-leida', marcarLeidaController);
router.post('/:id/aprobar', requireRole('admin', 'operador'), aprobarPorNotificacionController);
router.post('/:id/rechazar', requireRole('admin', 'operador'), rechazarPorNotificacionController);

module.exports = router;
