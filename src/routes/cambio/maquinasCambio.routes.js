const express = require('express');
const router = express.Router();
const { requireRole } = require('@middlewares/role.middleware');

const {
  registrarReemplazoController,
  listarReemplazosController,
  getReemplazoController,
  ultimaLecturaController,
  tiposCambioController,
} = require('@controllers/cambio/maquinasCambio.controller');

/**
 * @swagger
 * components:
 *   schemas:
 *     ReemplazoInput:
 *       type: object
 *       description: >
 *         Los contadores son el total B/N y el total color del equipo (impresiones + copias),
 *         como los muestra su página de contadores.
 *       required:
 *         - maquina_saliente_id
 *         - maquina_entrante_id
 *         - fecha_danio
 *         - fecha_instalacion_entrante
 *         - periodo_afectado
 *         - tipo_cambio
 *         - razon_cambio
 *         - contador_final_saliente_bn
 *         - contador_final_saliente_color
 *         - contador_inicial_entrante_bn
 *         - contador_inicial_entrante_color
 *       properties:
 *         maquina_saliente_id:
 *           type: integer
 *           description: Máquina dañada; debe tener una asignación vigente
 *         maquina_entrante_id:
 *           type: integer
 *           description: Máquina activa y sin asignación vigente
 *         fecha_danio:
 *           type: string
 *           format: date
 *           example: '2026-11-12'
 *           description: Fecha de retiro de la saliente. No futura ni anterior a su instalación
 *         fecha_instalacion_entrante:
 *           type: string
 *           format: date
 *           example: '2026-11-13'
 *           description: Igual o posterior a la fecha del daño y dentro del período afectado
 *         periodo_afectado:
 *           type: string
 *           example: '2026-11'
 *           description: Mes del daño o el siguiente; no debe estar aprobado todavía para estas máquinas
 *         tipo_cambio:
 *           type: string
 *           enum: [Daño, Falla recurrente, Actualización de equipo, Solicitud del cliente, Otro]
 *         razon_cambio:
 *           type: string
 *           minLength: 5
 *           maxLength: 500
 *         contador_final_saliente_bn:
 *           type: integer
 *           minimum: 0
 *           description: No menor que la última lectura aprobada de la saliente
 *         contador_final_saliente_color:
 *           type: integer
 *           minimum: 0
 *         contador_inicial_entrante_bn:
 *           type: integer
 *           minimum: 0
 *         contador_inicial_entrante_color:
 *           type: integer
 *           minimum: 0
 *         ip_address:
 *           type: string
 *           nullable: true
 *           description: Opcional; si no viene, la entrante usa la IP de la saliente
 *     Reemplazo:
 *       type: object
 *       properties:
 *         id_maquina_cambio: { type: integer }
 *         periodo_afectado: { type: string, example: '2026-11' }
 *         fecha_danio: { type: string, format: date }
 *         fecha_instalacion_entrante: { type: string, format: date }
 *         tipo_cambio: { type: string }
 *         razon_cambio: { type: string }
 *         activo: { type: boolean }
 *         fecha_registro: { type: string, format: date-time }
 *         area_id: { type: integer }
 *         area_nombre: { type: string }
 *         cliente_id: { type: integer }
 *         cliente_nombre: { type: string }
 *         maquina_saliente_id: { type: integer }
 *         saliente_serie: { type: string }
 *         saliente_modelo: { type: string, nullable: true }
 *         instalacion_saliente_id: { type: integer }
 *         maquina_entrante_id: { type: integer }
 *         entrante_serie: { type: string }
 *         entrante_modelo: { type: string, nullable: true }
 *         instalacion_entrante_id: { type: integer }
 *         entrante_ip: { type: string }
 *         saliente_contador_final_bn: { type: integer }
 *         saliente_contador_final_color: { type: integer }
 *         entrante_contador_inicial_bn: { type: integer }
 *         entrante_contador_inicial_color: { type: integer }
 *         periodo_aprobado:
 *           type: boolean
 *           description: true cuando el lote del período ya se aprobó y sus reportes quedaron enlazados al cambio
 */

// Rutas fijas: van ANTES de /:id para que Express no las tome como un id.

/**
 * @swagger
 * /api/maquinas-cambio:
 *   get:
 *     summary: Listar los reemplazos de máquinas registrados
 *     tags: [Reemplazos]
 *     parameters:
 *       - in: query
 *         name: cliente_id
 *         schema: { type: integer }
 *       - in: query
 *         name: periodo
 *         schema: { type: string, example: '2026-11' }
 *       - in: query
 *         name: maquina_id
 *         description: Reemplazos donde la máquina salió o entró
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Lista de reemplazos, del período más reciente al más antiguo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Reemplazo'
 *                 count: { type: integer }
 *       400:
 *         description: Filtro inválido
 *       401:
 *         description: Sin token o token inválido
 *   post:
 *     summary: Registrar el reemplazo de una máquina (solo admin)
 *     description: >
 *       En una sola transacción guarda el cambio y los contadores de las dos máquinas,
 *       retira la asignación de la saliente (fecha de retiro = fecha del daño) y asigna la
 *       entrante en la misma área, contrato e IP. Al aprobar el lote del período afectado,
 *       los reportes de las dos máquinas quedan enlazados al cambio y el consolidado muestra
 *       una sola fila con el consumo de ambas.
 *     tags: [Reemplazos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReemplazoInput'
 *     responses:
 *       201:
 *         description: Reemplazo registrado
 *       400:
 *         description: Datos inválidos (fechas, período, contadores menores que la última lectura, etc.)
 *       403:
 *         description: Solo un administrador puede registrar reemplazos
 *       404:
 *         description: Alguna de las máquinas no existe
 *       409:
 *         description: >
 *           La saliente no tiene asignación vigente, la entrante ya está asignada o inactiva,
 *           el período ya tiene lecturas aprobadas, el contrato no está vigente o la IP está en uso
 */
router.get('/', listarReemplazosController);
router.post('/', requireRole('admin'), registrarReemplazoController);

/**
 * @swagger
 * /api/maquinas-cambio/tipos:
 *   get:
 *     summary: Tipos de cambio admitidos
 *     tags: [Reemplazos]
 *     responses:
 *       200:
 *         description: Lista de tipos
 */
router.get('/tipos', tiposCambioController);

/**
 * @swagger
 * /api/maquinas-cambio/ultima-lectura/{maquinaId}:
 *   get:
 *     summary: Última lectura aprobada de una máquina antes de un período
 *     description: Sirve para llenar el contador final de la saliente (no puede ser menor).
 *     tags: [Reemplazos]
 *     parameters:
 *       - in: path
 *         name: maquinaId
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: periodo
 *         required: true
 *         schema: { type: string, example: '2026-11' }
 *     responses:
 *       200:
 *         description: "{ periodo, bn, color } o null si la máquina no tiene lecturas aprobadas"
 *       400:
 *         description: Parámetros inválidos
 *       404:
 *         description: Máquina no encontrada
 */
router.get('/ultima-lectura/:maquinaId', ultimaLecturaController);

/**
 * @swagger
 * /api/maquinas-cambio/{id}:
 *   get:
 *     summary: Ver un reemplazo
 *     tags: [Reemplazos]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Reemplazo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/Reemplazo'
 *       400:
 *         description: ID inválido
 *       404:
 *         description: Reemplazo no encontrado
 */
router.get('/:id', getReemplazoController);

module.exports = router;
