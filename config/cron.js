const cron = require('node-cron');
const fetchAndStoreCandleData = require('../utils/fetchAndStoreCandleData');
const generateArtificialCandleData = require('../utils/generateArtificialCandleData');
const loadHistoricalCandleData = require('../utils/loadHistoricalCandleData');
const { performDataCleanup } = require('../controllers/systemController');
const { getTopMoversSymbols, getTopMoversSummary } = require('../utils/getTopMoversSymbols');
const { saveSelectedSymbols, getSelectedSymbols } = require('../models/database');
const { handleNewSymbolAddition } = require('../controllers/symbolController');

// Job execution tracking
const jobStatus = {
    candleDataJob: { running: false, lastRun: null, lastDuration: 0 },
    artificialCandleJobs: { running: false, lastRun: null, lastDuration: 0 },
    topMoversJob: { running: false, lastRun: null, lastDuration: 0, lastUpdate: null }
};

// Job queue for artificial candle generation
let artificialCandleQueue = [];
let processingQueue = false;

/**
 * Determines if a candle should be generated at the current time for the given interval
 * Uses simple minute-boundary alignment for reliability
 * @param {Date} currentTime - Current time
 * @param {number} intervalMinutes - Candle interval in minutes
 * @returns {boolean} True if a candle should be generated
 */
function shouldGenerateCandle(currentTime, intervalMinutes) {
    // Get current time components
    const minutes = currentTime.getUTCMinutes();
    const seconds = currentTime.getUTCSeconds();
    
    // Check if current minute is divisible by interval (candle boundary)
    const isIntervalBoundary = (minutes % intervalMinutes) === 0;
    
    // Only generate at 10-15 seconds after the minute to ensure:
    // 1. The previous interval has ended
    // 2. 1-minute base data is available for aggregation
    const isCorrectSecond = seconds >= 10 && seconds <= 15;
    
    const shouldGenerate = isIntervalBoundary && isCorrectSecond;
    
    if (shouldGenerate) {
        console.log(`🕒 Artificial candle generation time for ${intervalMinutes}m: ${currentTime.toISOString()} (minute: ${minutes}, second: ${seconds})`);
    }
    
    return shouldGenerate;
}

/**
 * Sets up a cron job to fetch and store candle data at regular intervals
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 */
function setupCandleDataCronJob(client, dbName) {
    if (!client) {
        console.error('❌ Cannot setup cron job: MongoDB client is not available');
        return;
    }

    console.log('⏰ Setting up candle data cron job...');
    
    // Define all intervals 1-20 minutes (mix of real and artificial data)
    const realDataIntervals = ['1m', '3m', '5m', '15m']; // Binance-supported intervals
    const artificialDataIntervals = ['2m', '4m', '6m', '7m', '8m', '9m', '10m', '11m', '12m', '13m', '14m', '16m', '17m', '18m', '19m', '20m']; // Custom intervals
    
    // Schedule the job to run every minute with execution guard
    const candleDataJob = cron.schedule('* * * * *', async () => {
        // Check if previous job is still running
        if (jobStatus.candleDataJob.running) {
            console.log('⚠️ Candle data job is still running, skipping this execution');
            return;
        }

        const startTime = new Date();
        jobStatus.candleDataJob.running = true;
        jobStatus.candleDataJob.lastRun = startTime;

        console.log(`\n🕒 Running scheduled candle data job at ${startTime.toISOString()}`);
        
        try {
            const options = {
                limit: 3 // Fetch last 3 candles to ensure we have closed ones
            };
            
            // Process all real data intervals
            for (const interval of realDataIntervals) {
                try {
                    console.log(`📊 Fetching ${interval} candle data...`);
                    await fetchAndStoreCandleData(client, dbName, interval, options);
                    console.log(`✅ Successfully processed ${interval} data`);
                } catch (intervalError) {
                    console.error(`❌ Error processing ${interval} data:`, intervalError.message);
                    // Continue with other intervals even if one fails
                }
            }
            
            const endTime = new Date();
            jobStatus.candleDataJob.lastDuration = endTime - startTime;
            console.log(`✅ Candle data job completed in ${jobStatus.candleDataJob.lastDuration}ms`);
            
        } catch (error) {
            console.error('❌ Scheduled candle data job failed:', error);
        } finally {
            jobStatus.candleDataJob.running = false;
        }
    }, {
        scheduled: false // Don't start immediately
    });
    
    // Register the job with system state for proper cleanup
    if (global.systemState) {
        global.systemState.cronJobs.set('candleDataJob', candleDataJob);
    }
    
    // Start the job
    candleDataJob.start();
    
    console.log(`✅ Candle data cron job scheduled to run every minute for intervals: ${realDataIntervals.join(', ')}`);
}

/**
 * Sets up a single consolidated cron job for generating artificial candle data
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 */
function setupArtificialCandleDataCronJobs(client, dbName) {
    if (!client) {
        console.error('❌ Cannot setup artificial candle data cron jobs: MongoDB client is not available');
        return;
    }

    console.log('⏰ Setting up consolidated artificial candle data cron job...');
    
    // Define the intervals for which we want to generate artificial candles (2-20 minutes)
    const intervals = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    
    // Single cron job that checks all intervals and queues them for processing
    const artificialCandleJob = cron.schedule('* * * * *', async () => {
        // Check if artificial candle jobs are already running
        if (jobStatus.artificialCandleJobs.running) {
            console.log('⚠️ Artificial candle jobs are still running, skipping this execution');
            return;
        }

        const now = new Date();
        const intervalsToProcess = [];
        
        // Check which intervals need processing
        for (const interval of intervals) {
            if (shouldGenerateCandle(now, interval)) {
                intervalsToProcess.push(interval);
            }
        }
        
        // If no intervals need processing, return early
        if (intervalsToProcess.length === 0) {
            return;
        }
        
        // Add intervals to queue
        artificialCandleQueue.push(...intervalsToProcess);
        
        // Process the queue if not already processing
        if (!processingQueue) {
            processArtificialCandleQueue(client, dbName);
        }
    }, {
        scheduled: false // Don't start immediately
    });
    
    // Register the job with system state for proper cleanup
    if (global.systemState) {
        global.systemState.cronJobs.set('artificialCandleJob', artificialCandleJob);
    }
    
    // Start the job
    artificialCandleJob.start();
    
    console.log(`✅ Consolidated artificial candle data cron job scheduled for intervals: ${intervals.join(', ')}`);
}

/**
 * Processes the artificial candle generation queue
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 */
async function processArtificialCandleQueue(client, dbName) {
    if (processingQueue || artificialCandleQueue.length === 0) {
        return;
    }
    
    processingQueue = true;
    jobStatus.artificialCandleJobs.running = true;
    const startTime = new Date();
    jobStatus.artificialCandleJobs.lastRun = startTime;
    
    console.log(`\n🔄 Processing artificial candle queue with ${artificialCandleQueue.length} intervals...`);
    
    try {
        // Process intervals in batches to avoid overwhelming the system
        const batchSize = 3; // Process 3 intervals at a time
        
        while (artificialCandleQueue.length > 0) {
            const batch = artificialCandleQueue.splice(0, batchSize);
            console.log(`📊 Processing batch: ${batch.join('m, ')}m intervals`);
            
            // Process batch sequentially to control resource usage
            for (const interval of batch) {
                try {
                    console.log(`🕒 Generating ${interval}m artificial candles at ${new Date().toISOString()}`);
                    await generateArtificialCandleData(client, dbName, interval);
                    console.log(`✅ Successfully generated ${interval}m candles`);
                } catch (error) {
                    console.error(`❌ Failed to generate ${interval}m candles:`, error);
                }
            }
            
            // Add a small delay between batches to prevent overwhelming the system
            if (artificialCandleQueue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
            }
        }
        
        const endTime = new Date();
        jobStatus.artificialCandleJobs.lastDuration = endTime - startTime;
        console.log(`✅ Artificial candle queue processing completed in ${jobStatus.artificialCandleJobs.lastDuration}ms`);
        
    } catch (error) {
        console.error('❌ Error processing artificial candle queue:', error);
    } finally {
        processingQueue = false;
        jobStatus.artificialCandleJobs.running = false;
    }
}

/**
 * Runs the candle data fetch job immediately on application startup
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 */
async function runInitialCandleDataFetch(client, dbName) {
    if (!client) {
        console.error('❌ Cannot run initial fetch: MongoDB client is not available');
        return;
    }

    console.log('🚀 Running initial candle data fetch on startup...');
    
    // Use same intervals as the cron job for consistency
    const realDataIntervals = ['1m', '3m', '5m', '15m']; // Only Binance-supported intervals
    
    try {
        const options = {
            limit: 3 // Fetch last 3 candles to ensure we have closed ones
        };
        
        // Process all intervals
        for (const interval of realDataIntervals) {
            try {
                console.log(`📊 Initial fetch for ${interval} interval...`);
                await fetchAndStoreCandleData(client, dbName, interval, options);
                console.log(`✅ Successfully fetched ${interval} data`);
            } catch (intervalError) {
                console.error(`❌ Error fetching ${interval} data:`, intervalError.message);
                // Continue with other intervals even if one fails
            }
        }
        
        console.log('✅ Initial candle data fetch completed for all intervals');
    } catch (error) {
        console.error('❌ Initial candle data fetch failed:', error);
    }
}

/**
 * Runs the initial artificial candle data generation on application startup
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 */
async function runInitialArtificialCandleDataGeneration(client, dbName) {
    if (!client) {
        console.error('❌ Cannot run initial artificial candle generation: MongoDB client is not available');
        return;
    }

    console.log('🚀 Running initial artificial candle data generation on startup...');
    
    // Define the intervals for which we want to generate artificial candles (2-20 minutes)
    const intervals = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    
    for (const interval of intervals) {
        try {
            console.log(`📊 Generating initial ${interval}m artificial candles...`);
            await generateArtificialCandleData(client, dbName, interval);
        } catch (error) {
            console.error(`❌ Initial ${interval}m artificial candle generation failed:`, error);
        }
    }
    
    console.log('✅ Initial artificial candle data generation completed');
}

/**
 * Runs the initial top movers selection on application startup
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 */
async function runInitialTopMoversSelection(client, dbName) {
    if (!client) {
        console.error('❌ Cannot run initial top movers selection: MongoDB client is not available');
        return;
    }

    console.log('🔥 Running initial top movers selection on startup...');
    
    try {
        // Fetch top movers (top 20 gainers + top 20 losers)
        const topMoversData = await getTopMoversSymbols(20);
        
        if (!topMoversData.success) {
            console.error('❌ Failed to fetch initial top movers:', topMoversData.error);
            console.log('💡 System will continue with any existing symbols or wait for hourly update');
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
        
        // Determine which symbols are new for historical data loading
        const newSymbols = topMoversData.symbols.filter(symbol => !currentSymbols.includes(symbol));
        
        if (newSymbols.length > 0) {
            console.log(`🆕 Loading historical data for ${newSymbols.length} symbols...`);
            console.log(`   Symbols: ${newSymbols.slice(0, 5).join(', ')}${newSymbols.length > 5 ? '...' : ''}`);
            
            // Load historical data for new symbols asynchronously (don't block startup)
            handleNewSymbolAddition(client, dbName, newSymbols)
                .then(() => {
                    console.log('✅ Historical data loading completed for initial top movers');
                })
                .catch(error => {
                    console.error('❌ Error loading historical data for initial symbols:', error);
                });
        } else {
            console.log('ℹ️ All symbols already have historical data');
        }
        
        console.log(`✅ Initial top movers selection completed successfully`);
        console.log(`🎯 Selected ${topMoversData.symbols.length} most volatile symbols for optimal trading`);
        console.log(`⏰ Next automatic update will occur at the next hour boundary`);
        
    } catch (error) {
        console.error('❌ Initial top movers selection failed:', error);
        console.log('💡 System will continue and try again during the next hourly update');
    }
}

/**
 * Handle first-time symbol selection and load historical data
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Array} selectedSymbols - Array of selected symbols
 */
async function handleFirstTimeSymbolSelection(client, dbName, selectedSymbols, isFirstSelection) {
    // If this is the first time symbols are selected, load historical data
    if (isFirstSelection && selectedSymbols.length > 0) {
        console.log('🔄 First time symbols selection detected. Loading historical data...');
        
        // Load the historical candle data and generate artificial candles asynchronously
        try {
            const results = await loadHistoricalCandleData(client, dbName, selectedSymbols);
            console.log(`✅ Historical data job completed. Stored ${results.candlesStored} candles and generated ${results.artificialCandlesGenerated} artificial candles.`);
        } catch (error) {
            console.error('❌ Error in historical data loading:', error);
        }
    }
}

/**
 * Gets the current status of all cron jobs
 * @returns {Object} Job status information
 */
function getCronJobStatus() {
    return {
        candleDataJob: {
            ...jobStatus.candleDataJob,
            queueLength: 0 // Always 0 for candle data job since it doesn't use a queue
        },
        artificialCandleJobs: {
            ...jobStatus.artificialCandleJobs,
            queueLength: artificialCandleQueue.length,
            processingQueue
        },
        systemHealth: {
            totalActiveJobs: (jobStatus.candleDataJob.running ? 1 : 0) + (jobStatus.artificialCandleJobs.running ? 1 : 0),
            lastHealthCheck: new Date()
        }
    };
}

/**
 * Logs the current cron job status for monitoring
 */
function logCronJobStatus() {
    const status = getCronJobStatus();
    console.log('\n📊 Cron Job Status Report:');
    console.log(`├── Candle Data Job: ${status.candleDataJob.running ? '🟢 Running' : '🔴 Idle'}`);
    console.log(`├── Last Run: ${status.candleDataJob.lastRun ? status.candleDataJob.lastRun.toISOString() : 'Never'}`);
    console.log(`├── Last Duration: ${status.candleDataJob.lastDuration}ms`);
    console.log(`├── Artificial Candle Jobs: ${status.artificialCandleJobs.running ? '🟢 Running' : '🔴 Idle'}`);
    console.log(`├── Queue Length: ${status.artificialCandleJobs.queueLength}`);
    console.log(`├── Processing Queue: ${status.artificialCandleJobs.processingQueue ? '🟢 Yes' : '🔴 No'}`);
    console.log(`└── Total Active Jobs: ${status.systemHealth.totalActiveJobs}`);
}

/**
 * Sets up a monitoring cron job to log system status periodically
 */
function setupMonitoringCronJob() {
    // Log status every 5 minutes
    const monitoringJob = cron.schedule('*/5 * * * *', () => {
        logCronJobStatus();
    }, {
        scheduled: false // Don't start immediately
    });
    
    // Register the job with system state for proper cleanup
    if (global.systemState) {
        global.systemState.cronJobs.set('monitoringJob', monitoringJob);
    }
    
    // Start the job
    monitoringJob.start();
    
    console.log('✅ Monitoring cron job scheduled to run every 5 minutes');
}

/**
 * Sets up a cron job to automatically update symbols with top movers (gainers/losers)
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
                
                // Handle new symbol addition (backfill historical data)
                if (addedSymbols.length > 0) {
                    console.log(`🆕 Loading historical data for ${addedSymbols.length} new symbols...`);
                    console.log(`   New symbols: ${addedSymbols.slice(0, 5).join(', ')}${addedSymbols.length > 5 ? '...' : ''}`);
                    
                    // Load historical data for new symbols asynchronously
                    handleNewSymbolAddition(client, dbName, addedSymbols)
                        .catch(error => {
                            console.error('❌ Error loading historical data for new symbols:', error);
                        });
                }
                
                if (removedSymbols.length > 0) {
                    console.log(`🗑️ Removed symbols: ${removedSymbols.slice(0, 5).join(', ')}${removedSymbols.length > 5 ? '...' : ''}`);
                    console.log('   💡 Note: Historical data preserved, signals will stop being generated');
                }
                
                jobStatus.topMoversJob.lastUpdate = startTime;
                console.log('✅ Symbols updated successfully with top movers');
                
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
    console.log('   🔄 Updates only when 5+ symbols change significantly');
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
    
    // Schedule cleanup to run every hour at minute 30 (offset from top movers job)
    const cleanupJob = cron.schedule('30 * * * *', async () => {
        try {
            console.log('\n🧹 Running scheduled data cleanup...');
            const result = await performDataCleanup(client, dbName);
            
            if (result.deletedCount > 0) {
                console.log(`✅ Data cleanup completed. Removed ${result.deletedCount} old OHLC records.`);
            } else {
                console.log('ℹ️ Data cleanup completed. No old records found to remove.');
            }
        } catch (error) {
            console.error('❌ Scheduled data cleanup failed:', error);
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
    
    console.log('✅ Data cleanup cron job scheduled to run every hour at :30');
}

module.exports = {
    setupCandleDataCronJob,
    setupArtificialCandleDataCronJobs,
    runInitialCandleDataFetch,
    runInitialArtificialCandleDataGeneration,
    runInitialTopMoversSelection,
    handleFirstTimeSymbolSelection,
    getCronJobStatus,
    logCronJobStatus,
    setupMonitoringCronJob,
    setupTopMoversCronJob,
    setupDataCleanupCronJob
};
