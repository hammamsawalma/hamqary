const cron = require('node-cron');
const { initializeGlobalHybridManager, getGlobalHybridManager, cleanupGlobalHybridManager } = require('../utils/hybridCandleDataManager');
const { performDataCleanup } = require('../controllers/systemController');
const { getTopMoversSymbols, getTopMoversSummary } = require('../utils/getTopMoversSymbols');
const { saveSelectedSymbols, getSelectedSymbols } = require('../models/database');
const { handleNewSymbolAddition } = require('../controllers/symbolController');

// Job execution tracking
const jobStatus = {
    hybridSystem: { 
        running: false, 
        initialized: false, 
        lastInitialization: null, 
        initializationDuration: 0,
        stats: null
    },
    topMoversJob: { 
        running: false, 
        lastRun: null, 
        lastDuration: 0, 
        lastUpdate: null 
    },
    dataCleanupJob: { 
        running: false, 
        lastRun: null, 
        lastDuration: 0 
    }
};

/**
 * Initialize the Hybrid Candle Data System on application startup
 * This replaces all the old cron-based data fetching with WebSocket real-time approach
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 */
async function initializeHybridCandleSystem(client, dbName) {
    if (!client) {
        console.error('❌ Cannot initialize hybrid system: MongoDB client is not available');
        return false;
    }

    console.log('🚀 Initializing Hybrid Candle Data System...');
    
    const startTime = new Date();
    jobStatus.hybridSystem.running = true;
    jobStatus.hybridSystem.lastInitialization = startTime;
    
    try {
        // Get current selected symbols
        const selectedSymbols = await getSelectedSymbols(client, dbName);
        
        if (selectedSymbols.length === 0) {
            console.log('⚠️ No symbols selected yet. Hybrid system will initialize when symbols are available.');
            jobStatus.hybridSystem.running = false;
            return true; // Not an error, just waiting for symbol selection
        }
        
        console.log(`📊 Initializing hybrid system for ${selectedSymbols.length} symbols: ${selectedSymbols.slice(0, 5).join(', ')}${selectedSymbols.length > 5 ? '...' : ''}`);
        
        // Initialize the hybrid manager (historical API + real-time WebSocket)
        const hybridManager = await initializeGlobalHybridManager(client, dbName, selectedSymbols);
        
        if (hybridManager) {
            jobStatus.hybridSystem.initialized = true;
            jobStatus.hybridSystem.stats = hybridManager.getStatus();
            
            const endTime = new Date();
            jobStatus.hybridSystem.initializationDuration = endTime - startTime;
            
            console.log('✅ Hybrid Candle Data System initialized successfully');
            console.log(`🎯 System Features:`);
            console.log(`   📡 Real-time WebSocket: 1-minute candles with 'x' closed flag detection`);
            console.log(`   📊 Historical API: Backfills last 180 minutes of data`);
            console.log(`   🔧 Artificial Candles: Auto-generated 2m-60m intervals from 1m base data`);
            console.log(`   ⚡ Event-Driven: Instant processing when candles close (no polling)`);
            console.log(`   🚫 Zero Rate Limits: WebSocket data doesn't count toward API limits`);
            console.log(`⏱️  Initialization completed in ${jobStatus.hybridSystem.initializationDuration}ms`);
            
            return true;
        } else {
            throw new Error('Failed to initialize hybrid manager');
        }
        
    } catch (error) {
        console.error('❌ Failed to initialize Hybrid Candle Data System:', error);
        jobStatus.hybridSystem.initialized = false;
        return false;
    } finally {
        jobStatus.hybridSystem.running = false;
    }
}

/**
 * Update symbols in the hybrid system
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Array} newSymbols - Array of new symbols
 */
async function updateHybridSystemSymbols(client, dbName, newSymbols) {
    try {
        const hybridManager = getGlobalHybridManager(client, dbName);
        
        if (hybridManager) {
            console.log(`🔄 Updating hybrid system with ${newSymbols.length} symbols...`);
            const success = await hybridManager.updateSymbols(newSymbols);
            
            if (success) {
                jobStatus.hybridSystem.stats = hybridManager.getStatus();
                console.log('✅ Hybrid system symbols updated successfully');
                return true;
            } else {
                console.error('❌ Failed to update hybrid system symbols');
                return false;
            }
        } else {
            // Initialize if not already initialized
            console.log('🚀 Hybrid system not initialized, initializing now...');
            return await initializeHybridCandleSystem(client, dbName);
        }
        
    } catch (error) {
        console.error('❌ Error updating hybrid system symbols:', error);
        return false;
    }
}

/**
 * Sets up a cron job to automatically update symbols with top movers (gainers/losers)
 * This is the only remaining cron job - everything else is now event-driven via WebSocket
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 */
function setupTopMoversCronJob(client, dbName) {
    if (!client) {
        console.error('❌ Cannot setup top movers cron job: MongoDB client is not available');
        return;
    }

    console.log('🔥 Setting up top movers automatic selection cron job...');
    
    // Schedule to run every hour at minute 0
    const topMoversJob = cron.schedule('0 * * * *', async () => {
        // Check if previous job is still running
        if (jobStatus.topMoversJob.running) {
            console.log('⚠️ Top movers job is still running, skipping this execution');
            return;
        }

        const startTime = new Date();
        jobStatus.topMoversJob.running = true;
        jobStatus.topMoversJob.lastRun = startTime;

        console.log(`\n🔥 Running scheduled top movers selection at ${startTime.toISOString()}`);
        
        try {
            // Fetch top movers (top 20 gainers + top 20 losers)
            const topMoversData = await getTopMoversSymbols(20);
            
            if (!topMoversData.success) {
                console.error('❌ Failed to fetch top movers, keeping current symbols');
                return;
            }
            
            // Get current selected symbols
            const currentSymbols = await getSelectedSymbols(client, dbName);
            
            // Check if symbols have significantly changed
            const newSymbols = topMoversData.symbols;
            const addedSymbols = newSymbols.filter(symbol => !currentSymbols.includes(symbol));
            const removedSymbols = currentSymbols.filter(symbol => !newSymbols.includes(symbol));
            const unchangedSymbols = newSymbols.filter(symbol => currentSymbols.includes(symbol));
            
            console.log(`📊 Top Movers Analysis:`);
            console.log(`   🔄 Total new symbols: ${newSymbols.length}`);
            console.log(`   ➕ Added: ${addedSymbols.length} symbols`);
            console.log(`   ➖ Removed: ${removedSymbols.length} symbols`);
            console.log(`   ✅ Unchanged: ${unchangedSymbols.length} symbols`);
            
            // Only update if there are significant changes (avoid unnecessary updates)
            const changeThreshold = 5; // Only update if 5+ symbols changed
            const totalChanges = addedSymbols.length + removedSymbols.length;
            
            if (totalChanges >= changeThreshold) {
                console.log(`🎯 Significant changes detected (${totalChanges} changes), updating symbols...`);
                
                // Log the summary
                console.log(getTopMoversSummary(topMoversData));
                
                // Save new symbols
                await saveSelectedSymbols(client, dbName, newSymbols);
                
                // Update the hybrid system with new symbols
                const updateSuccess = await updateHybridSystemSymbols(client, dbName, newSymbols);
                
                if (updateSuccess) {
                    console.log('✅ Hybrid system updated with new symbols');
                    
                    if (addedSymbols.length > 0) {
                        console.log(`🆕 Added symbols: ${addedSymbols.slice(0, 5).join(', ')}${addedSymbols.length > 5 ? '...' : ''}`);
                    }
                    
                    if (removedSymbols.length > 0) {
                        console.log(`🗑️ Removed symbols: ${removedSymbols.slice(0, 5).join(', ')}${removedSymbols.length > 5 ? '...' : ''}`);
                        console.log('   💡 Note: Historical data preserved, real-time processing stopped');
                    }
                    
                    jobStatus.topMoversJob.lastUpdate = startTime;
                    
                } else {
                    console.error('❌ Failed to update hybrid system, keeping previous symbol selection');
                }
                
            } else {
                console.log(`ℹ️ Minor changes detected (${totalChanges} changes), keeping current symbols`);
                console.log('   💡 Threshold for updates: 5+ symbol changes');
            }
            
            const endTime = new Date();
            jobStatus.topMoversJob.lastDuration = endTime - startTime;
            console.log(`✅ Top movers job completed in ${jobStatus.topMoversJob.lastDuration}ms`);
            
        } catch (error) {
            console.error('❌ Scheduled top movers job failed:', error);
        } finally {
            jobStatus.topMoversJob.running = false;
        }
    }, {
        scheduled: false // Don't start immediately
    });
    
    // Register the job with system state for proper cleanup
    if (global.systemState) {
        global.systemState.cronJobs.set('topMoversJob', topMoversJob);
    }
    
    // Start the job
    topMoversJob.start();
    
    console.log('✅ Top movers cron job scheduled to run every hour');
    console.log('   🎯 Will select top 20 gainers + top 20 losers');
    console.log('   🔄 Updates hybrid system when 5+ symbols change significantly');
}

/**
 * Run initial top movers selection and initialize hybrid system
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 */
async function runInitialTopMoversAndHybridInitialization(client, dbName) {
    if (!client) {
        console.error('❌ Cannot run initial setup: MongoDB client is not available');
        return;
    }

    console.log('🔥 Running initial top movers selection and hybrid system initialization...');
    
    try {
        // Fetch top movers (top 20 gainers + top 20 losers)
        const topMoversData = await getTopMoversSymbols(20);
        
        if (!topMoversData.success) {
            console.error('❌ Failed to fetch initial top movers:', topMoversData.error);
            console.log('💡 System will try again during the next hourly update');
            
            // Try to initialize with existing symbols if any
            const existingSymbols = await getSelectedSymbols(client, dbName);
            if (existingSymbols.length > 0) {
                console.log(`🔄 Found ${existingSymbols.length} existing symbols, initializing hybrid system...`);
                await initializeHybridCandleSystem(client, dbName);
            }
            return;
        }
        
        // Get current selected symbols (if any)
        const currentSymbols = await getSelectedSymbols(client, dbName);
        
        // Log the fetched top movers
        console.log(getTopMoversSummary(topMoversData));
        
        console.log(`📊 Initial Top Movers Analysis:`);
        console.log(`   🎯 New symbols to select: ${topMoversData.symbols.length}`);
        console.log(`   📈 Top gainers: ${topMoversData.gainers.symbols.slice(0, 3).join(', ')}...`);
        console.log(`   📉 Top losers: ${topMoversData.losers.symbols.slice(0, 3).join(', ')}...`);
        
        // Save the new symbols (no change threshold for initial selection)
        await saveSelectedSymbols(client, dbName, topMoversData.symbols);
        console.log('✅ Initial symbol selection saved to database');
        
        // Initialize the hybrid system with selected symbols
        console.log('🚀 Initializing hybrid candle data system with selected symbols...');
        const hybridSuccess = await initializeHybridCandleSystem(client, dbName);
        
        if (hybridSuccess) {
            console.log(`✅ Initial setup completed successfully`);
            console.log(`🎯 Selected ${topMoversData.symbols.length} most volatile symbols for optimal trading`);
            console.log(`📡 Real-time WebSocket monitoring active for all selected symbols`);
            console.log(`⏰ Next automatic update will occur at the next hour boundary`);
        } else {
            console.error('❌ Failed to initialize hybrid system, but symbols are saved');
            console.log('   💡 Will retry initialization during next top movers update');
        }
        
    } catch (error) {
        console.error('❌ Initial setup failed:', error);
        console.log('💡 System will continue and try again during the next hourly update');
    }
}

/**
 * Sets up a data cleanup cron job to remove old OHLC data
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 */
function setupDataCleanupCronJob(client, dbName) {
    if (!client) {
        console.error('❌ Cannot setup data cleanup cron job: MongoDB client is not available');
        return;
    }

    console.log('🧹 Setting up data cleanup cron job...');
    
    // Schedule cleanup to run every 6 hours at minute 30 (offset from top movers job)
    const cleanupJob = cron.schedule('30 */6 * * *', async () => {
        // Check if previous job is still running
        if (jobStatus.dataCleanupJob.running) {
            console.log('⚠️ Data cleanup job is still running, skipping this execution');
            return;
        }

        const startTime = new Date();
        jobStatus.dataCleanupJob.running = true;
        jobStatus.dataCleanupJob.lastRun = startTime;
        
        try {
            console.log('\n🧹 Running scheduled data cleanup...');
            const result = await performDataCleanup(client, dbName);
            
            const endTime = new Date();
            jobStatus.dataCleanupJob.lastDuration = endTime - startTime;
            
            if (result.deletedCount > 0) {
                console.log(`✅ Data cleanup completed in ${jobStatus.dataCleanupJob.lastDuration}ms. Removed ${result.deletedCount} old OHLC records.`);
            } else {
                console.log(`ℹ️ Data cleanup completed in ${jobStatus.dataCleanupJob.lastDuration}ms. No old records found to remove.`);
            }
        } catch (error) {
            console.error('❌ Scheduled data cleanup failed:', error);
        } finally {
            jobStatus.dataCleanupJob.running = false;
        }
    }, {
        scheduled: false // Don't start immediately
    });
    
    // Register the job with system state for proper cleanup
    if (global.systemState) {
        global.systemState.cronJobs.set('dataCleanupJob', cleanupJob);
    }
    
    // Start the job
    cleanupJob.start();
    
    console.log('✅ Data cleanup cron job scheduled to run every 6 hours at :30');
}

/**
 * Gets the current status of the hybrid system and all cron jobs
 * @returns {Object} Comprehensive system status
 */
function getSystemStatus() {
    const hybridManager = getGlobalHybridManager();
    const hybridStatus = hybridManager ? hybridManager.getStatus() : null;
    
    return {
        hybridSystem: {
            ...jobStatus.hybridSystem,
            currentStatus: hybridStatus
        },
        topMoversJob: jobStatus.topMoversJob,
        dataCleanupJob: jobStatus.dataCleanupJob,
        systemHealth: {
            hybridSystemActive: jobStatus.hybridSystem.initialized,
            webSocketConnected: hybridStatus ? hybridStatus.isActive : false,
            totalActiveJobs: (jobStatus.topMoversJob.running ? 1 : 0) + (jobStatus.dataCleanupJob.running ? 1 : 0),
            lastHealthCheck: new Date()
        }
    };
}

/**
 * Logs the current system status for monitoring
 */
function logSystemStatus() {
    const status = getSystemStatus();
    
    console.log('\n📊 Hybrid System Health Report:');
    console.log(`├── Hybrid System: ${status.hybridSystem.initialized ? '🟢 Initialized' : '🔴 Not Initialized'}`);
    
    if (status.hybridSystem.currentStatus) {
        const current = status.hybridSystem.currentStatus;
        console.log(`├── WebSocket Status: ${current.isActive ? '🟢 Connected' : '🔴 Disconnected'}`);
        console.log(`├── Subscribed Symbols: ${current.webSocketStatus ? current.webSocketStatus.subscribedCount : 0}`);
        console.log(`├── Historical Candles: ${current.stats.historicalCandlesLoaded}`);
        console.log(`├── Real-time Candles: ${current.stats.realtimeCandlesProcessed}`);
        console.log(`├── Artificial Candles: ${current.stats.artificialCandlesGenerated}`);
        console.log(`├── Reversal Patterns: ${current.stats.reversalPatternsDetected}`);
        console.log(`├── System Uptime: ${Math.round(current.stats.uptime / 1000 / 60)} minutes`);
    }
    
    console.log(`├── Top Movers Job: ${status.topMoversJob.running ? '🟢 Running' : '🔴 Idle'}`);
    console.log(`├── Last Top Movers Run: ${status.topMoversJob.lastRun ? status.topMoversJob.lastRun.toISOString() : 'Never'}`);
    console.log(`├── Last Symbol Update: ${status.topMoversJob.lastUpdate ? status.topMoversJob.lastUpdate.toISOString() : 'Never'}`);
    console.log(`├── Data Cleanup Job: ${status.dataCleanupJob.running ? '🟢 Running' : '🔴 Idle'}`);
    console.log(`├── Last Cleanup: ${status.dataCleanupJob.lastRun ? status.dataCleanupJob.lastRun.toISOString() : 'Never'}`);
    console.log(`└── Total Active Jobs: ${status.systemHealth.totalActiveJobs}`);
    
    // Warnings for potential issues
    if (!status.hybridSystem.initialized) {
        console.log(`⚠️  WARNING: Hybrid system not initialized - no real-time data processing`);
    }
    
    if (status.hybridSystem.initialized && !status.systemHealth.webSocketConnected) {
        console.log(`⚠️  WARNING: WebSocket disconnected - only historical data available`);
    }
}

/**
 * Sets up a monitoring cron job to log system status periodically
 */
function setupMonitoringCronJob() {
    // Log status every 10 minutes (less frequent since we have fewer jobs now)
    const monitoringJob = cron.schedule('*/10 * * * *', () => {
        logSystemStatus();
    }, {
        scheduled: false // Don't start immediately
    });
    
    // Register the job with system state for proper cleanup
    if (global.systemState) {
        global.systemState.cronJobs.set('monitoringJob', monitoringJob);
    }
    
    // Start the job
    monitoringJob.start();
    
    console.log('✅ Monitoring cron job scheduled to run every 10 minutes');
}

/**
 * Cleanup all hybrid system resources
 */
async function cleanupHybridSystem() {
    console.log('🧹 Cleaning up Hybrid Candle Data System...');
    
    try {
        await cleanupGlobalHybridManager();
        jobStatus.hybridSystem.initialized = false;
        jobStatus.hybridSystem.stats = null;
        console.log('✅ Hybrid system cleanup completed');
    } catch (error) {
        console.error('❌ Error during hybrid system cleanup:', error);
    }
}

module.exports = {
    // Main initialization functions
    initializeHybridCandleSystem,
    runInitialTopMoversAndHybridInitialization,
    updateHybridSystemSymbols,
    
    // Cron job setup functions
    setupTopMoversCronJob,
    setupDataCleanupCronJob,
    setupMonitoringCronJob,
    
    // Status and monitoring functions
    getSystemStatus,
    logSystemStatus,
    
    // Cleanup functions
    cleanupHybridSystem,
    
    // Legacy function names for compatibility (these now do nothing or redirect)
    setupCandleDataCronJob: () => console.log('ℹ️ Legacy candle data cron job replaced by hybrid WebSocket system'),
    setupArtificialCandleDataCronJobs: () => console.log('ℹ️ Legacy artificial candle cron jobs replaced by hybrid real-time generation'),
    runInitialCandleDataFetch: () => console.log('ℹ️ Legacy initial fetch replaced by hybrid system initialization'),
    runInitialArtificialCandleDataGeneration: () => console.log('ℹ️ Legacy artificial candle generation integrated into hybrid system'),
    getCronJobStatus: getSystemStatus, // Redirect to new function
    logCronJobStatus: logSystemStatus  // Redirect to new function
};
