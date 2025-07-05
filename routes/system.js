const express = require('express');
const router = express.Router();
const { 
    systemControlPanel, 
    stopSystem, 
    resetSystem, 
    cleanOldData 
} = require('../controllers/systemController');

// System control panel
router.get('/system', systemControlPanel);

// System control endpoints
router.post('/system/stop', stopSystem);
router.post('/system/reset', resetSystem);
router.post('/system/clean-data', cleanOldData);

module.exports = router;
