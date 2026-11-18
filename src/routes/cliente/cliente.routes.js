const express = require('express');
const router = express.Router();

const {
  fetchAllClientes,
  getClientesInactivosController,
  getClienteByIdController,
  getClienteCompletoController,
  getClienteByRucController,
  searchClientesController,
  crearClienteController,
  actualizarClienteController,
  eliminarClienteController,
  activarClienteController,

  getInstalacionesController,
  getHistorialClienteController,
  tieneHistorialController,
  getUltimoCambioController,
  getHistorialBatchController
} = require('@controllers/cliente/cliente.controller');

/**
 * @swagger
 * components:
 *   schemas:
 *     Cliente:
 *       type: object
 *       required:
 *         - nombre
 *         - ruc
 *       properties:
 *         id_cliente:
 *           type: integer
 *         nombre:
 *           type: string
 *         ruc:
 *           type: string
 *         razon_social:
 *           type: string
 *         activo:
 *           type: boolean
 *         tiene_renta:
 *           type: boolean
 *         total_instalaciones:
 *           type: integer
 */

/**
 * @swagger
 * /api/clientes/search:
 *   get:
 *     summary: Buscar clientes por nombre o RUC
 *     tags: [Clientes]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: true
 *         description: Término de búsqueda
 *     responses:
 *       200:
 *         description: Resultados de la búsqueda
 */
router.get('/search', searchClientesController);

/**
 * @swagger
 * /api/clientes/ruc/{ruc}:
 *   get:
 *     summary: Buscar cliente por RUC
 *     tags: [Clientes]
 *     parameters:
 *       - in: path
 *         name: ruc
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cliente encontrado
 */
router.get('/ruc/:ruc', getClienteByRucController);

/**
 * @swagger
 * /api/clientes:
 *   get:
 *     summary: Obtener todos los clientes activos
 *     tags: [Clientes]
 *     responses:
 *       200:
 *         description: Lista de clientes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Cliente'
 */
router.get('/', fetchAllClientes);
router.get('/inactivos', getClientesInactivosController);

/**
 * @swagger
 * /api/clientes/{id}/completo:
 *   get:
 *     summary: Obtener cliente con información completa
 *     description: Incluye contratos y áreas
 *     tags: [Clientes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Datos completos del cliente
 */
router.get('/:id/completo', getClienteCompletoController);

/**
 * @swagger
 * /api/clientes/{id}:
 *   get:
 *     summary: Obtener cliente por ID (datos básicos)
 *     tags: [Clientes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Datos del cliente
 */
router.get('/:id', getClienteByIdController);

/**
 * @swagger
 * /api/clientes:
 *   post:
 *     summary: Crear nuevo cliente
 *     tags: [Clientes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Cliente'
 *     responses:
 *       201:
 *         description: Cliente creado exitosamente
 */
router.post('/', crearClienteController);

/**
 * @swagger
 * /api/clientes/{id}:
 *   put:
 *     summary: Actualizar cliente
 *     tags: [Clientes]
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
 *             $ref: '#/components/schemas/Cliente'
 *     responses:
 *       200:
 *         description: Cliente actualizado
 */
router.put('/:id', actualizarClienteController);

/**
 * @swagger
 * /api/clientes/{id}/activar:
 *   patch:
 *     summary: Activar cliente
 *     tags: [Clientes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Cliente activado
 */
router.patch('/:id/activar', activarClienteController);

/**
 * @swagger
 * /api/clientes/{id}:
 *   delete:
 *     summary: Desactivar cliente (soft delete)
 *     tags: [Clientes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Cliente desactivado
 */
router.delete('/:id', eliminarClienteController);

/**
 * @swagger
 * /api/clientes/{id}/instalaciones:
 *   get:
 *     summary: Obtener instalaciones activas de un cliente
 *     tags: [Instalaciones]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de instalaciones activas
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Instalacion'
 */
router.get('/:id/instalaciones', getInstalacionesController);
/**
 * @swagger
 * /api/clientes/historial-batch:
 *   post:
 *     summary: Obtener historial de múltiples clientes
 *     description: Permite verificar múltiples clientes en una sola petición (máx 50)
 *     tags: [Clientes - Historial]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cliente_ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 example: [1, 2, 3, 4, 5]
 *     responses:
 *       200:
 *         description: Objeto con cliente_id como key y boolean como value
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   example: { "1": true, "2": false, "3": true }
 */
router.post('/historial-batch', getHistorialBatchController);

/**
 * @swagger
 * /api/clientes/{id}/historial:
 *   get:
 *     summary: Obtener historial completo de cambios de un cliente
 *     description: Retorna todos los cambios históricos ordenados por fecha descendente
 *     tags: [Clientes - Historial]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID del cliente
 *     responses:
 *       200:
 *         description: Historial de cambios del cliente
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
 *                     type: object
 *                     properties:
 *                       id_historial:
 *                         type: integer
 *                       nombre_anterior:
 *                         type: string
 *                       razon_social_anterior:
 *                         type: string
 *                       ruc_anterior:
 *                         type: string
 *                       fecha_cambio:
 *                         type: string
 *                         format: date-time
 *                       nombre_actual:
 *                         type: string
 *                       razon_social_actual:
 *                         type: string
 *                       ruc_actual:
 *                         type: string
 *                       cambio_nombre:
 *                         type: boolean
 *                       cambio_razon_social:
 *                         type: boolean
 *                       cambio_ruc:
 *                         type: boolean
 *                 count:
 *                   type: integer
 */
router.get('/:id/historial', getHistorialClienteController);

/**
 * @swagger
 * /api/clientes/{id}/tiene-historial:
 *   get:
 *     summary: Verificar si un cliente tiene historial de cambios
 *     description: Endpoint rápido para verificar existencia de historial (no trae datos)
 *     tags: [Clientes - Historial]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Indicador de existencia de historial
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 tiene_historial:
 *                   type: boolean
 */
router.get('/:id/tiene-historial', tieneHistorialController);

/**
 * @swagger
 * /api/clientes/{id}/ultimo-cambio:
 *   get:
 *     summary: Obtener solo el último cambio de un cliente
 *     description: Retorna únicamente el cambio más reciente
 *     tags: [Clientes - Historial]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Último cambio del cliente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   nullable: true
 */
router.get('/:id/ultimo-cambio', getUltimoCambioController);

module.exports = router;