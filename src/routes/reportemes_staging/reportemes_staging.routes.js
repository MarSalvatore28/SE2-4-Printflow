const express = require('express');
const router = express.Router();
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

router.post('/', createStagingController);
router.post('/approve-batch', approveStagingBatchController);
router.post('/reject-batch', rejectStagingBatchController);

router.put('/:id', updateStagingController);
router.put('/consolidado/:id', updateConsolidadoStagingController);
router.put('/detalle/:id', updateDetalleStagingController);
router.put('/detalles/batch', updateMultiplesDetallesStagingController);

router.delete('/:id', deleteStagingController);
router.delete('/limpiar/aprobados', limpiarAprobadosController);
router.delete('/limpiar/rechazados', limpiarRechazadosController);
router.post('/validar-csv', validarCSVController);
router.get('/lote/:lote/validar', getValidacionLoteController);
router.get('/lotes/:loteId/alertas', obtenerAlertasLoteController);
module.exports = router;