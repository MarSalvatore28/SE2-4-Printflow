const express = require('express');
const router = express.Router();
const { exigirTokenIngesta } = require('@middlewares/ingesta.middleware');

const {
  processIngestaController
} = require('@controllers/ingesta/ingesta.controller');


router.post('/cargar', exigirTokenIngesta, processIngestaController);

module.exports = router;