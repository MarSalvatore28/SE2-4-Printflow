const express = require('express');
const router = express.Router();

const {
  getReporteConsolidadoController,
  getReporteDetalladoController,
} = require('@controllers/reportemes/reportemes.controller');

// Informes de lecturas ya aprobadas (reportes oficiales). Los reportes de un cliente se ven con el
// consolidado por cliente y período; las lecturas sin aprobar están en /api/staging. Las rutas que
// respondían 501 se quitaron (PLAN.md, sección 9).

/**
 * @swagger
 * /api/reportes/consolidado/{clienteId}/{periodo}:
 *   get:
 *     summary: Consolidado mensual de un cliente (consumo por máquina y facturación por contrato)
 *     tags: [Reportes]
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
 *           example: '2026-10'
 *       - in: query
 *         name: area_id
 *         schema:
 *           type: integer
 *         description: Solo las máquinas de esa área (la facturación sigue siendo la del contrato completo)
 *       - in: query
 *         name: maquina_id
 *         schema:
 *           type: integer
 *         description: Solo esa máquina (la facturación sigue siendo la del contrato completo)
 *     responses:
 *       200:
 *         description: data.detalles (una fila por máquina o por reemplazo) y data.resumen (con facturacion y monto_total_general)
 *       400:
 *         description: Período con formato inválido (se espera YYYY-MM)
 */
router.get('/consolidado/:clienteId/:periodo', getReporteConsolidadoController);

/**
 * @swagger
 * /api/reportes/detallado/{clienteId}/{periodo}:
 *   get:
 *     summary: Informe por usuario (consumo de cada cuenta en el período)
 *     tags: [Reportes]
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
 *           example: '2026-10'
 *       - in: query
 *         name: area_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: maquina_id
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: data.detalles (una fila por cuenta y máquina) y data.resumen
 */
router.get('/detallado/:clienteId/:periodo', getReporteDetalladoController);

module.exports = router;
