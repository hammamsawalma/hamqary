const express = require('express');
const router = express.Router();
const { candleDataController } = require('../controllers/candleController');

// Candle data route
router.get('/candle-data', candleDataController);

module.exports = router;
