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
  createStagingController,
  updateStagingController,
  deleteStagingController,
  limpiarAprobadosController,
  limpiarRechazadosController,
  getEstadisticasStagingController,
  approveStagingBatchController,
  rejectStagingBatchController,
  getConsolidadoConDetallesByLoteController,
  updateConsolidadoStagingController,
  updateDetalleStagingController,
  updateMultiplesDetallesStagingController,
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

router.post('/', requireRole('admin', 'operador'), createStagingController);
router.post('/approve-batch', requireRole('admin', 'operador'), approveStagingBatchController);
router.post('/reject-batch', requireRole('admin', 'operador'), rejectStagingBatchController);

router.put('/:id', requireRole('admin', 'operador'), updateStagingController);
router.put('/consolidado/:id', requireRole('admin', 'operador'), updateConsolidadoStagingController);
router.put('/detalle/:id', requireRole('admin', 'operador'), updateDetalleStagingController);
router.put('/detalles/batch', requireRole('admin', 'operador'), updateMultiplesDetallesStagingController);

router.delete('/:id', requireRole('admin'), deleteStagingController);
router.delete('/limpiar/aprobados', requireRole('admin'), limpiarAprobadosController);
router.delete('/limpiar/rechazados', requireRole('admin'), limpiarRechazadosController);
router.post('/validar-csv', requireRole('admin', 'operador'), validarCSVController);
router.get('/lote/:lote/validar', getValidacionLoteController);
router.get('/lotes/:loteId/alertas', obtenerAlertasLoteController);
module.exports = router;