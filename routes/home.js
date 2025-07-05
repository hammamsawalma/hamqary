const express = require('express');
const router = express.Router();
const { signalsController } = require('../controllers/signalsController');

// Home route - displays trading signals dashboard
router.get('/', signalsController);

module.exports = router;
