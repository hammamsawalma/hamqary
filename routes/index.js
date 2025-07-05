const express = require('express');
const router = express.Router();
const homeRoutes = require('./home');
const symbolsRoutes = require('./symbols');
const candleDataRoutes = require('./candleData');
const reversalCandlesRoutes = require('./reversalCandles');
const systemRoutes = require('./system');

// Combine all routes
router.use('/', homeRoutes);
router.use('/', symbolsRoutes);
router.use('/', candleDataRoutes);
router.use('/', reversalCandlesRoutes);
router.use('/', systemRoutes);

module.exports = router;
