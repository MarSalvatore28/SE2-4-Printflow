const express = require('express');
const router = express.Router();
const { requireRole } = require('@middlewares/role.middleware');

const {
  fetchAllMaquinas,
  searchMaquinasController,
  getMaquinaByIdController,
  crearMaquinaController,
  actualizarMaquinaController,
  cambiarEstadoMaquinaController,
  fetchModelosController,
  crearModeloController,
  fetchTiposImpresionController,
  fetchFormatosImpresionController,
} = require('@controllers/maquina/maquina.controller');

/**
 * @swagger
 * components:
 *   schemas:
 *     Maquina:
 *       type: object
 *       properties:
 *         id_maquina:
 *           type: integer
 *         serie:
 *           type: string
 *           description: En mayúsculas y sin espacios
 *         activo:
 *           type: boolean
 *         modelo_id:
 *           type: integer
 *         modelo:
 *           type: string
 *         tipo_impresion_id:
 *           type: integer
 *         tipo_impresion:
 *           type: string
 *         formato_impresion_id:
 *           type: integer
 *           nullable: true
 *         formato_impresion:
 *           type: string
 *           nullable: true
 *         asignada:
 *           type: boolean
 *           description: true si tiene una asignación vigente
 *         id_instalacion:
 *           type: integer
 *           nullable: true
 *         ip:
 *           type: string
 *           nullable: true
 *         fecha_instalacion:
 *           type: string
 *           format: date
 *           nullable: true
 *         contrato_id:
 *           type: integer
 *           nullable: true
 *         area_id:
 *           type: integer
 *           nullable: true
 *         area_nombre:
 *           type: string
 *           nullable: true
 *         cliente_id:
 *           type: integer
 *           nullable: true
 *         cliente_nombre:
 *           type: string
 *           nullable: true
 *     MaquinaInput:
 *       type: object
 *       required:
 *         - serie
 *         - modelo_id
 *         - tipo_impresion_id
 *       properties:
 *         serie:
 *           type: string
 *           example: SIMA0001
 *         modelo_id:
 *           type: integer
 *         tipo_impresion_id:
 *           type: integer
 *         formato_impresion_id:
 *           type: integer
 *           nullable: true
 *     Modelo:
 *       type: object
 *       properties:
 *         id_modelo:
 *           type: integer
 *         nombre:
 *           type: string
 *         activo:
 *           type: boolean
 *     TipoImpresion:
 *       type: object
 *       properties:
 *         id_tipo_impresion:
 *           type: integer
 *         nombre:
 *           type: string
 *         activo:
 *           type: boolean
 */

// Rutas fijas: van ANTES de /:id para que Express no las tome como un id.

/**
 * @swagger
 * /api/maquinas:
 *   get:
 *     summary: Listar todas las máquinas con modelo, tipo y asignación vigente
 *     tags: [Maquinas]
 *     responses:
 *       200:
 *         description: Lista de máquinas
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
 *                     $ref: '#/components/schemas/Maquina'
 *                 count:
 *                   type: integer
 *       401:
 *         description: Sin token o token inválido
 */
router.get('/', fetchAllMaquinas);

/**
 * @swagger
 * /api/maquinas/search:
 *   get:
 *     summary: Buscar máquinas por serie, modelo o IP
 *     tags: [Maquinas]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Término de búsqueda (parte de la serie, del modelo o de la IP)
 *     responses:
 *       200:
 *         description: Máquinas que coinciden
 *       400:
 *         description: Falta el término de búsqueda
 */
router.get('/search', searchMaquinasController);

/**
 * @swagger
 * /api/maquinas/modelos:
 *   get:
 *     summary: Listar los modelos de máquina
 *     tags: [Maquinas]
 *     responses:
 *       200:
 *         description: Lista de modelos
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
 *                     $ref: '#/components/schemas/Modelo'
 *   post:
 *     summary: Crear un modelo de máquina
 *     tags: [Maquinas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nombre
 *             properties:
 *               nombre:
 *                 type: string
 *                 example: Ricoh IM C3000
 *     responses:
 *       201:
 *         description: Modelo creado
 *       400:
 *         description: Falta el nombre
 *       409:
 *         description: Ya existe un modelo con ese nombre
 */
router.get('/modelos', fetchModelosController);
router.post('/modelos', requireRole('admin'), crearModeloController);

/**
 * @swagger
 * /api/maquinas/tipos-impresion:
 *   get:
 *     summary: Listar los tipos de impresión (Color, BN)
 *     tags: [Maquinas]
 *     responses:
 *       200:
 *         description: Lista de tipos de impresión
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
 *                     $ref: '#/components/schemas/TipoImpresion'
 */
router.get('/tipos-impresion', fetchTiposImpresionController);

/**
 * @swagger
 * /api/maquinas/formatos:
 *   get:
 *     summary: Listar los formatos de impresión (A4, ...)
 *     tags: [Maquinas]
 *     responses:
 *       200:
 *         description: Lista de formatos de impresión
 */
router.get('/formatos', fetchFormatosImpresionController);

/**
 * @swagger
 * /api/maquinas:
 *   post:
 *     summary: Crear una máquina
 *     description: La serie se guarda en mayúsculas y sin espacios.
 *     tags: [Maquinas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MaquinaInput'
 *     responses:
 *       201:
 *         description: Máquina creada
 *       400:
 *         description: Falta la serie o el modelo/tipo no es válido
 *       409:
 *         description: Ya existe una máquina con esa serie
 */
router.post('/', requireRole('admin'), crearMaquinaController);

/**
 * @swagger
 * /api/maquinas/{id}:
 *   get:
 *     summary: Obtener una máquina por ID
 *     tags: [Maquinas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Detalle de la máquina
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Maquina'
 *       400:
 *         description: ID inválido
 *       404:
 *         description: Máquina no encontrada
 *   put:
 *     summary: Editar una máquina
 *     tags: [Maquinas]
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
 *             $ref: '#/components/schemas/MaquinaInput'
 *     responses:
 *       200:
 *         description: Máquina actualizada
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Máquina no encontrada
 *       409:
 *         description: Ya existe otra máquina con esa serie
 */
router.get('/:id', getMaquinaByIdController);
router.put('/:id', requireRole('admin'), actualizarMaquinaController);

/**
 * @swagger
 * /api/maquinas/{id}/activo:
 *   patch:
 *     summary: Activar o desactivar una máquina
 *     description: No se puede desactivar una máquina con una asignación vigente.
 *     tags: [Maquinas]
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
 *       404:
 *         description: Máquina no encontrada
 *       409:
 *         description: La máquina tiene una asignación vigente
 */
router.patch('/:id/activo', requireRole('admin'), cambiarEstadoMaquinaController);

module.exports = router;
