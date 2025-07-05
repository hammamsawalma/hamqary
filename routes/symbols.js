const express = require('express');
const router = express.Router();
const { symbolsListController, symbolsSelectController, symbolsResetController } = require('../controllers/symbolController');

// Symbols routes
router.get('/symbols', symbolsListController);
router.post('/symbols/select', symbolsSelectController);
router.post('/symbols/reset', symbolsResetController);

module.exports = router;
