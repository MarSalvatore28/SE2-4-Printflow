const express = require('express');
const router = express.Router();

const {
  processIngestaController
} = require('@controllers/ingesta/ingesta.controller');


router.post('/cargar', processIngestaController);

module.exports = router;