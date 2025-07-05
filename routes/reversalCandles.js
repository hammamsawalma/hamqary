const express = require('express');
const router = express.Router();
const { reversalCandleController } = require('../controllers/reversalController');

// Route for reversal candles page
router.get('/reversal-candles', reversalCandleController);

module.exports = router;
