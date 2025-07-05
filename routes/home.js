const express = require('express');
const router = express.Router();
const { signalsController, deleteSignalController } = require('../controllers/signalsController');

// Home route - displays trading signals dashboard
router.get('/', signalsController);

// API route for deleting individual signals
router.delete('/api/signals/:id', deleteSignalController);

module.exports = router;
