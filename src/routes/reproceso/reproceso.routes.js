// Se monta en /api/staging, después de las rutas de staging (ninguna de ellas atiende POST /:id/reprocesar)
const express = require('express');
const router = express.Router();
const { requireRole } = require('@middlewares/role.middleware');
const { reprocesarReporteController } = require('@controllers/reproceso/reproceso.controller');

/**
 * @swagger
 * /api/staging/{id}/reprocesar:
 *   post:
 *     summary: Reprocesar un reporte de staging en ERROR (S3-05)
 *     description: >
 *       Vuelve a buscar la máquina por serie y su asignación vigente (la misma regla de la ingesta) y,
 *       si está autorizada, pasa la lectura por validarLectura (S3-01). Si todo está bien, el reporte
 *       deja de bloquear el lote. Máximo 3 intentos por reporte. Solo admin y operador.
 *     tags: [Staging]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: id_staging_consolidado
 *     responses:
 *       200:
 *         description: >
 *           { reporte, intentos, max_intentos, intentos_texto ('2 de 3'), corregido, motivo, codigo, aviso }.
 *           corregido = false si sigue en error (motivo nuevo).
 *       400:
 *         description: ID inválido
 *       401:
 *         description: Sin token
 *       403:
 *         description: El rol no puede reprocesar (auditor)
 *       404:
 *         description: Reporte no encontrado en staging
 *       409:
 *         description: El reporte no está en error, o ya tiene 3 intentos («Máximo de intentos alcanzado …»)
 */
router.post('/:id/reprocesar', requireRole('admin', 'operador'), reprocesarReporteController);

module.exports = router;
