/**
 * System Controller - Handles system control operations
 * Stop/Start system, Reset database, System status
 */

const { MongoClient } = require('mongodb');

/**
 * Display system control panel
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function systemControlPanel(req, res) {
    try {
        // Get MongoDB client
        const client = req.app.locals.client;
        const dbName = req.app.locals.dbName;
        
        // Get system status
        const systemStatus = await getSystemStatus(client, dbName);
        
        res.send(generateSystemControlHTML(systemStatus));
        
    } catch (error) {
        console.error('Error in system control panel:', error);
        res.status(500).send('An error occurred while loading the system control panel');
    }
}

/**
 * Stop system operations
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function stopSystem(req, res) {
    try {
        console.log('🛑 System stop requested');
        
        // Stop all cron jobs by clearing intervals
        // Note: In a production system, you'd want to implement proper job management
        if (global.cronJobs) {
            Object.values(global.cronJobs).forEach(job => {
                if (job && job.stop) {
                    job.stop();
                }
            });
        }
        
        // Clear any active intervals
        if (global.activeIntervals) {
            global.activeIntervals.forEach(intervalId => {
                clearInterval(intervalId);
            });
            global.activeIntervals = [];
        }
        
        console.log('✅ System stopped successfully');
        res.json({ success: true, message: 'System stopped successfully' });
        
    } catch (error) {
        console.error('❌ Error stopping system:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}

/**
 * Reset system - Drop all database collections
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function resetSystem(req, res) {
    try {
        console.log('🔄 System reset requested');
        
        // Get MongoDB client
        const client = req.app.locals.client;
        const dbName = req.app.locals.dbName;
        
        if (!client) {
            throw new Error('Database connection not available');
        }
        
        const db = client.db(dbName);
        
        // Get all collections
        const collections = await db.listCollections().toArray();
        console.log(`📊 Found ${collections.length} collections to drop`);
        
        // Drop all collections
        for (const collection of collections) {
            try {
                await db.collection(collection.name).drop();
                console.log(`🗑️ Dropped collection: ${collection.name}`);
            } catch (error) {
                if (error.message.includes('ns not found')) {
                    // Collection already doesn't exist, ignore
                    console.log(`ℹ️ Collection ${collection.name} already doesn't exist`);
                } else {
                    console.error(`❌ Error dropping collection ${collection.name}:`, error.message);
                }
            }
        }
        
        console.log('✅ Database reset completed successfully');
        res.json({ 
            success: true, 
            message: `Successfully reset database. Dropped ${collections.length} collections.` 
        });
        
    } catch (error) {
        console.error('❌ Error resetting system:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}

/**
 * Clean old OHLC data (>2 hours old)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function cleanOldData(req, res) {
    try {
        console.log('🧹 Data cleanup requested');
        
        // Get MongoDB client
        const client = req.app.locals.client;
        const dbName = req.app.locals.dbName;
        
        if (!client) {
            throw new Error('Database connection not available');
        }
        
        const result = await performDataCleanup(client, dbName);
        
        console.log('✅ Data cleanup completed');
        res.json({ 
            success: true, 
            message: `Cleanup completed. Removed ${result.deletedCount} old candle records.`,
            details: result
        });
        
    } catch (error) {
        console.error('❌ Error cleaning old data:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}

/**
 * Get system status information
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @returns {Promise<Object>} System status
 */
async function getSystemStatus(client, dbName) {
    try {
        if (!client) {
            return {
                database: 'disconnected',
                collections: [],
                totalDocuments: 0,
                systemUptime: process.uptime()
            };
        }
        
        const db = client.db(dbName);
        
        // Get collection stats
        const collections = await db.listCollections().toArray();
        const collectionStats = [];
        let totalDocuments = 0;
        
        for (const collection of collections) {
            try {
                const count = await db.collection(collection.name).countDocuments();
                collectionStats.push({
                    name: collection.name,
                    documents: count
                });
                totalDocuments += count;
            } catch (error) {
                collectionStats.push({
                    name: collection.name,
                    documents: 0,
                    error: error.message
                });
            }
        }
        
        return {
            database: 'connected',
            collections: collectionStats,
            totalDocuments,
            systemUptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            nodeVersion: process.version
        };
        
    } catch (error) {
        return {
            database: 'error',
            error: error.message,
            systemUptime: process.uptime()
        };
    }
}

/**
 * Perform data cleanup - remove OHLC data older than 2 hours
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @returns {Promise<Object>} Cleanup results
 */
async function performDataCleanup(client, dbName) {
    const db = client.db(dbName);
    const collection = db.collection('candleData');
    
    // Calculate cutoff time (2 hours ago)
    const cutoffTime = new Date(Date.now() - (2 * 60 * 60 * 1000));
    
    console.log(`🧹 Cleaning OHLC data older than: ${cutoffTime.toISOString()}`);
    
    // Delete old candle data
    const result = await collection.deleteMany({
        openTime: { $lt: cutoffTime }
    });
    
    return {
        deletedCount: result.deletedCount,
        cutoffTime: cutoffTime.toISOString(),
        cleanupTime: new Date().toISOString()
    };
}

/**
 * Generate system control panel HTML
 * @param {Object} systemStatus - System status data
 * @returns {string} HTML content
 */
function generateSystemControlHTML(systemStatus) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>System Control - Hamqary</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    background: linear-gradient(135deg, #2c3e50 0%, #4a69bd 100%);
                    min-height: 100vh;
                    color: #333;
                    padding: 20px;
                }
                .container { max-width: 1200px; margin: 0 auto; }
                
                .header {
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(10px);
                    border-radius: 20px;
                    padding: 30px;
                    margin-bottom: 30px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .header h1 {
                    color: #2c3e50;
                    font-size: 2.5em;
                    font-weight: 700;
                }
                .home-btn {
                    background: linear-gradient(135deg, #3498db, #2980b9);
                    color: white;
                    padding: 12px 24px;
                    border-radius: 10px;
                    text-decoration: none;
                    font-weight: 600;
                    transition: all 0.3s ease;
                }
                .home-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 15px rgba(52, 152, 219, 0.4);
                }
                
                .grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 30px;
                    margin-bottom: 30px;
                }
                
                .card {
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(10px);
                    border-radius: 20px;
                    padding: 30px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                }
                .card h2 {
                    color: #2c3e50;
                    margin-bottom: 20px;
                    font-size: 1.5em;
                }
                
                .status-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 15px;
                    margin-bottom: 20px;
                }
                .status-item {
                    background: rgba(248, 249, 250, 0.8);
                    padding: 15px;
                    border-radius: 10px;
                    text-align: center;
                }
                .status-value {
                    font-size: 1.5em;
                    font-weight: 700;
                    margin-bottom: 5px;
                }
                .status-label {
                    font-size: 0.9em;
                    color: #7f8c8d;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                
                .btn {
                    padding: 15px 30px;
                    border: none;
                    border-radius: 10px;
                    font-size: 1em;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    margin: 10px;
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                }
                .btn-danger {
                    background: linear-gradient(135deg, #e74c3c, #c0392b);
                    color: white;
                }
                .btn-danger:hover {
                    background: linear-gradient(135deg, #c0392b, #a93226);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 15px rgba(231, 76, 60, 0.4);
                }
                .btn-warning {
                    background: linear-gradient(135deg, #f39c12, #e67e22);
                    color: white;
                }
                .btn-warning:hover {
                    background: linear-gradient(135deg, #e67e22, #d35400);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 15px rgba(243, 156, 18, 0.4);
                }
                .btn-success {
                    background: linear-gradient(135deg, #27ae60, #229954);
                    color: white;
                }
                
                .collections-list {
                    max-height: 300px;
                    overflow-y: auto;
                    background: rgba(248, 249, 250, 0.5);
                    border-radius: 10px;
                    padding: 15px;
                }
                .collection-item {
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 0;
                    border-bottom: 1px solid rgba(0,0,0,0.1);
                }
                
                .alert {
                    padding: 15px;
                    border-radius: 10px;
                    margin: 15px 0;
                    display: none;
                }
                .alert-success {
                    background: linear-gradient(135deg, #d4edda, #c3e6cb);
                    color: #155724;
                    border-left: 4px solid #28a745;
                }
                .alert-error {
                    background: linear-gradient(135deg, #f8d7da, #f1c2c7);
                    color: #721c24;
                    border-left: 4px solid #dc3545;
                }
                
                /* Confirmation Modal */
                .modal {
                    display: none;
                    position: fixed;
                    z-index: 1000;
                    left: 0;
                    top: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0,0,0,0.5);
                    backdrop-filter: blur(5px);
                }
                .modal-content {
                    background: white;
                    margin: 15% auto;
                    padding: 30px;
                    border-radius: 20px;
                    width: 90%;
                    max-width: 500px;
                    text-align: center;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                }
                .modal h3 {
                    color: #e74c3c;
                    margin-bottom: 15px;
                    font-size: 1.5em;
                }
                .modal p {
                    margin-bottom: 25px;
                    color: #7f8c8d;
                    line-height: 1.6;
                }
                
                @media (max-width: 768px) {
                    .grid { grid-template-columns: 1fr; }
                    .header { flex-direction: column; gap: 20px; text-align: center; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <!-- Header -->
                <div class="header">
                    <h1>⚙️ System Control Panel</h1>
                    <a href="/" class="home-btn">🏠 Home</a>
                </div>
                
                <!-- Main Grid -->
                <div class="grid">
                    <!-- System Status -->
                    <div class="card">
                        <h2>📊 System Status</h2>
                        <div class="status-grid">
                            <div class="status-item">
                                <div class="status-value" style="color: ${systemStatus.database === 'connected' ? '#27ae60' : '#e74c3c'};">
                                    ${systemStatus.database === 'connected' ? '🟢' : '🔴'}
                                </div>
                                <div class="status-label">Database</div>
                            </div>
                            <div class="status-item">
                                <div class="status-value" style="color: #3498db;">${systemStatus.collections?.length || 0}</div>
                                <div class="status-label">Collections</div>
                            </div>
                            <div class="status-item">
                                <div class="status-value" style="color: #f39c12;">${systemStatus.totalDocuments?.toLocaleString() || 0}</div>
                                <div class="status-label">Total Documents</div>
                            </div>
                            <div class="status-item">
                                <div class="status-value" style="color: #9b59b6;">${Math.round(systemStatus.systemUptime / 60)}m</div>
                                <div class="status-label">Uptime</div>
                            </div>
                        </div>
                        
                        ${systemStatus.collections && systemStatus.collections.length > 0 ? `
                            <h3 style="margin: 20px 0 15px 0; color: #2c3e50;">Database Collections:</h3>
                            <div class="collections-list">
                                ${systemStatus.collections.map(collection => `
                                    <div class="collection-item">
                                        <span><strong>${collection.name}</strong></span>
                                        <span>${collection.documents?.toLocaleString() || 0} docs</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                    
                    <!-- System Controls -->
                    <div class="card">
                        <h2>🎛️ System Controls</h2>
                        <p style="margin-bottom: 25px; color: #7f8c8d;">
                            Manage system operations and database cleanup
                        </p>
                        
                        <div>
                            <button id="cleanDataBtn" class="btn btn-warning">
                                🧹 Clean Old Data (>2h)
                            </button>
                            <br>
                            <button id="stopSystemBtn" class="btn btn-danger">
                                🛑 Stop System
                            </button>
                            <br>
                            <button id="resetSystemBtn" class="btn btn-danger">
                                ⚠️ Reset Database
                            </button>
                        </div>
                        
                        <div id="alertSuccess" class="alert alert-success"></div>
                        <div id="alertError" class="alert alert-error"></div>
                    </div>
                </div>
            </div>
            
            <!-- Confirmation Modal -->
            <div id="confirmModal" class="modal">
                <div class="modal-content">
                    <h3 id="modalTitle">⚠️ Confirm Action</h3>
                    <p id="modalMessage">Are you sure you want to perform this action?</p>
                    <button id="confirmBtn" class="btn btn-danger">Confirm</button>
                    <button id="cancelBtn" class="btn" style="background: #95a5a6; color: white; margin-left: 10px;">Cancel</button>
                </div>
            </div>
            
            <script>
                let currentAction = null;
                
                // Modal elements
                const modal = document.getElementById('confirmModal');
                const modalTitle = document.getElementById('modalTitle');
                const modalMessage = document.getElementById('modalMessage');
                const confirmBtn = document.getElementById('confirmBtn');
                const cancelBtn = document.getElementById('cancelBtn');
                
                // Alert elements
                const alertSuccess = document.getElementById('alertSuccess');
                const alertError = document.getElementById('alertError');
                
                // Button event listeners
                document.getElementById('cleanDataBtn').addEventListener('click', () => {
                    showConfirmation('clean', '🧹 Clean Old Data', 
                        'This will remove all OHLC candle data older than 2 hours. Reversal patterns and volume footprints will be preserved.');
                });
                
                document.getElementById('stopSystemBtn').addEventListener('click', () => {
                    showConfirmation('stop', '🛑 Stop System', 
                        'This will stop all data collection and processing. You can restart by refreshing the page.');
                });
                
                document.getElementById('resetSystemBtn').addEventListener('click', () => {
                    showConfirmation('reset', '⚠️ Reset Database', 
                        'This will permanently delete ALL data including symbols, candles, reversal patterns, and volume footprints. This action cannot be undone!');
                });
                
                // Modal event listeners
                confirmBtn.addEventListener('click', performAction);
                cancelBtn.addEventListener('click', closeModal);
                
                // Close modal when clicking outside
                window.addEventListener('click', (e) => {
                    if (e.target === modal) closeModal();
                });
                
                function showConfirmation(action, title, message) {
                    currentAction = action;
                    modalTitle.textContent = title;
                    modalMessage.textContent = message;
                    modal.style.display = 'block';
                }
                
                function closeModal() {
                    modal.style.display = 'none';
                    currentAction = null;
                }
                
                function showAlert(type, message) {
                    hideAlerts();
                    const alert = type === 'success' ? alertSuccess : alertError;
                    alert.textContent = message;
                    alert.style.display = 'block';
                    
                    // Auto-hide after 5 seconds
                    setTimeout(() => {
                        alert.style.display = 'none';
                    }, 5000);
                }
                
                function hideAlerts() {
                    alertSuccess.style.display = 'none';
                    alertError.style.display = 'none';
                }
                
                async function performAction() {
                    if (!currentAction) return;
                    
                    const endpoints = {
                        clean: '/system/clean-data',
                        stop: '/system/stop',
                        reset: '/system/reset'
                    };
                    
                    try {
                        confirmBtn.textContent = 'Processing...';
                        confirmBtn.disabled = true;
                        
                        const response = await fetch(endpoints[currentAction], {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' }
                        });
                        
                        const result = await response.json();
                        
                        closeModal();
                        
                        if (result.success) {
                            showAlert('success', result.message);
                            if (currentAction === 'reset' || currentAction === 'clean') {
                                // Refresh page after successful reset/clean
                                setTimeout(() => location.reload(), 2000);
                            }
                        } else {
                            showAlert('error', result.message);
                        }
                        
                    } catch (error) {
                        closeModal();
                        showAlert('error', 'Error: ' + error.message);
                    } finally {
                        confirmBtn.textContent = 'Confirm';
                        confirmBtn.disabled = false;
                    }
                }
            </script>
        </body>
        </html>
    `;
}

module.exports = {
    systemControlPanel,
    stopSystem,
    resetSystem,
    cleanOldData,
    performDataCleanup
};
