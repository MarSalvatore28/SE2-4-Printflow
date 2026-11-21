const express = require('express');
const router = express.Router();
const { requireRole } = require('@middlewares/role.middleware');
const {
  fetchAllStaging,
  getStagingByIdController,
  getStagingByLoteController,
  getStagingPendientesController,
  getStagingByEstadoController,
  getStagingByClienteController,
  getStagingByPeriodoController,
  limpiarAprobadosController,
  limpiarRechazadosController,
  getEstadisticasStagingController,
  approveStagingBatchController,
  rejectStagingBatchController,
  getConsolidadoConDetallesByLoteController,
  validarCSVController,
  getValidacionLoteController,
  obtenerAlertasLoteController
} = require('@controllers/reportemes_staging/reportemes_staging.controller');

router.get('/', fetchAllStaging);
router.get('/estadisticas', getEstadisticasStagingController);
router.get('/pendientes', getStagingPendientesController);
router.get('/estado/:estado', getStagingByEstadoController);
router.get('/lote/:lote', getStagingByLoteController);
router.get('/lote/:lote/completo', getConsolidadoConDetallesByLoteController);
router.get('/cliente/:clienteId', getStagingByClienteController);
router.get('/periodo/:periodo', getStagingByPeriodoController);
router.get('/:id', getStagingByIdController);

router.post('/approve-batch', requireRole('admin', 'operador'), approveStagingBatchController);
router.post('/reject-batch', requireRole('admin', 'operador'), rejectStagingBatchController);

// Los contadores de un lote no se editan a mano antes de aprobarlo (PLAN.md §9, decisión 17): se
// quitaron POST /, PUT /:id, PUT /consolidado/:id, PUT /detalle/:id, PUT /detalles/batch y
// DELETE /:id. Un reporte en ERROR se reprocesa o se reemplaza con una lectura manual (auditadas).
router.delete('/limpiar/aprobados', requireRole('admin'), limpiarAprobadosController);
router.delete('/limpiar/rechazados', requireRole('admin'), limpiarRechazadosController);
router.post('/validar-csv', requireRole('admin', 'operador'), validarCSVController);
router.get('/lote/:lote/validar', getValidacionLoteController);
router.get('/lotes/:loteId/alertas', obtenerAlertasLoteController);
module.exports = router;