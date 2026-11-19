const express = require('express');
const router = express.Router();
const { requireRole } = require('@middlewares/role.middleware');
const { registrarLecturaManualController } = require('@controllers/lectura/lectura.controller');

/**
 * @swagger
 * /api/lecturas/manual:
 *   post:
 *     summary: Registrar una lectura manual (S3-04)
 *     description: >
 *       Para una impresora que no envió su correo. La lectura va a los reportes oficiales del mes de
 *       fecha_lectura con origen MANUAL. Pasa por validarLectura (S3-01): si la rechaza, responde 400
 *       con su motivo tal cual. Solo admin y operador.
 *     tags: [Lecturas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [instalacion_id, fecha_lectura, contador_bn, contador_color, observacion]
 *             properties:
 *               instalacion_id: { type: integer, description: Asignación vigente de la máquina }
 *               fecha_lectura: { type: string, example: '2026-11-18' }
 *               contador_bn: { type: integer, description: Total B/N acumulado (impresiones + copias) }
 *               contador_color: { type: integer, description: Total color acumulado (impresiones + copias) }
 *               observacion: { type: string, maxLength: 500 }
 *     responses:
 *       201:
 *         description: Lectura registrada
 *       400:
 *         description: Datos inválidos, asignación no vigente o lectura rechazada por validarLectura (message = motivo, codigo)
 *       401:
 *         description: Sin token
 *       403:
 *         description: El rol no puede registrar lecturas (auditor)
 */
router.post('/manual', requireRole('admin', 'operador'), registrarLecturaManualController);

module.exports = router;
