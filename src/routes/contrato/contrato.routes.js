const express = require('express');
const router = express.Router();
const { requireRole } = require('@middlewares/role.middleware');
const { idValido } = require('@middlewares/idParam.middleware');

// Un :id que no es un entero positivo responde 400
router.param('id', idValido);

const {
    fetchAllContratos,
    getContratoByIdController,
    getContratosController,
    crearContratoController,
    actualizarContratoController,
    desactivarContratoController
} = require('@controllers/cliente/cliente.controller');

/**
 * @swagger
 * components:
 *   schemas:
 *     Contrato:
 *       type: object
 *       required:
 *         - cliente_id
 *         - fecha_inicio
 *       properties:
 *         id_contrato:
 *           type: integer
 *         cliente_id:
 *           type: integer
 *         fecha_inicio:
 *           type: string
 *           format: date
 *         fecha_fin:
 *           type: string
 *           format: date
 *           nullable: true
 *         impresiones_bn_incluidas:
 *           type: integer
 *           default: 0
 *         impresiones_color_incluidas:
 *           type: integer
 *           default: 0
 *         costo_impresion_bn:
 *           type: number
 *           format: float
 *         costo_impresion_color:
 *           type: number
 *           format: float
 *         activo:
 *           type: boolean
 */

/**
 * @swagger
 * /api/contratos:
 *   get:
 *     summary: Obtener todos los contratos
 *     tags: [Contratos]
 *     responses:
 *       200:
 *         description: Lista de contratos
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Contrato'
 */
router.get('/', fetchAllContratos);

/**
 * @swagger
 * /api/contratos/{id}:
 *   get:
 *     summary: Obtener contrato por ID
 *     tags: [Contratos]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Detalles del contrato
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contrato'
 *       404:
 *         description: Contrato no encontrado
 */
router.get('/:id', getContratoByIdController);

/**
 * @swagger
 * /api/contratos/cliente/{id_cliente}:
 *   get:
 *     summary: Obtener contratos de un cliente
 *     tags: [Contratos]
 *     parameters:
 *       - in: path
 *         name: id_cliente
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de contratos del cliente
 */
router.get('/cliente/:id', getContratosController);

/**
 * @swagger
 * /api/contratos:
 *   post:
 *     summary: Crear nuevo contrato
 *     tags: [Contratos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Contrato'
 *     responses:
 *       201:
 *         description: Contrato creado
 */
router.post('/', requireRole('admin'), (req, res, next) => {
    req.params.id = req.body.cliente_id;
    next();
}, crearContratoController);

/**
 * @swagger
 * /api/contratos/{id}:
 *   put:
 *     summary: Actualizar contrato
 *     tags: [Contratos]
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
 *             $ref: '#/components/schemas/Contrato'
 *     responses:
 *       200:
 *         description: Contrato actualizado
 */
router.put('/:id', requireRole('admin'), actualizarContratoController);

/**
 * @swagger
 * /api/contratos/{id}:
 *   delete:
 *     summary: Desactivar contrato
 *     tags: [Contratos]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Contrato desactivado
 */
router.delete('/:id', requireRole('admin'), desactivarContratoController);

module.exports = router;
