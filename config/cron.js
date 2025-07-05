const cron = require('node-cron');
const fetchAndStoreCandleData = require('../utils/fetchAndStoreCandleData');
const generateArtificialCandleData = require('../utils/generateArtificialCandleData');
const loadHistoricalCandleData = require('../utils/loadHistoricalCandleData');
const { performDataCleanup } = require('../controllers/systemController');

// Job execution tracking
const jobStatus = {
    candleDataJob: { running: false, lastRun: null, lastDuration: 0 },
    artificialCandleJobs: { running: false, lastRun: null, lastDuration: 0 }
};

// Job queue for artificial candle generation
let artificialCandleQueue = [];
let processingQueue = false;

/**
 * Determines if a candle should be generated at the current time for the given interval
 * Uses cycle-based alignment to match TradingView standards exactly
 * @param {Date} currentTime - Current time
 * @param {number} intervalMinutes - Candle interval in minutes
 * @param {number} cycleMinutes - Cycle period in minutes
 * @returns {boolean} True if a candle should be generated
 */
function shouldGenerateCandle(currentTime, intervalMinutes, cycleMinutes) {
    // Use daily midnight UTC as the base reference - FIXED VERSION
    const date = new Date(currentTime);
    
    // Create proper UTC midnight using Date.UTC
    const midnightUTC = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
    
    // Calculate time since midnight in milliseconds
    const msSinceMidnight = currentTime.getTime() - midnightUTC.getTime();
    const cycleMs = cycleMinutes * 60 * 1000;
    const intervalMs = intervalMinutes * 60 * 1000;
    
    // Find which cycle we're in (cycles repeat throughout the day)
    const currentCycleIndex = Math.floor(msSinceMidnight / cycleMs);
    
    // Calculate the start of the current cycle
    const currentCycleStart = midnightUTC.getTime() + (currentCycleIndex * cycleMs);
    
    // Calculate time since current cycle start
    const msSinceCycleStart = currentTime.getTime() - currentCycleStart;
    
    // Find which interval within the cycle
    const intervalIndex = Math.floor(msSinceCycleStart / intervalMs);
    
    // Calculate the expected end time of current interval
    const intervalEnd = currentCycleStart + ((intervalIndex + 1) * intervalMs);
    
    // Check if we're within 30 seconds after the interval should end
    const timeDiff = currentTime.getTime() - intervalEnd;
    const isTimeToGenerate = timeDiff >= 0 && timeDiff < 30000; // 30 seconds window
    
    // Additional check: make sure we're aligned to minute boundaries
    const seconds = currentTime.getUTCSeconds();
    const isMinuteBoundary = seconds <= 5;
    
    return isTimeToGenerate && isMinuteBoundary;
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
    cron.schedule('* * * * *', async () => {
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
                limit: 1 // Only fetch the most recent candle
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
    });
    
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
    
    // Define cycle times for each interval (in minutes) for proper alignment
    const INTERVAL_CYCLES = {
        2: 60, 3: 60, 4: 60, 5: 60, 6: 60,
        7: 420, 8: 120, 9: 360, 10: 60, 11: 660,
        12: 60, 13: 780, 14: 420, 15: 60, 16: 240,
        17: 1020, 18: 360, 19: 1140, 20: 60
    };
    
    // Single cron job that checks all intervals and queues them for processing
    cron.schedule('* * * * *', async () => {
        // Check if artificial candle jobs are already running
        if (jobStatus.artificialCandleJobs.running) {
            console.log('⚠️ Artificial candle jobs are still running, skipping this execution');
            return;
        }

        const now = new Date();
        const intervalsToProcess = [];
        
        // Check which intervals need processing
        for (const interval of intervals) {
            const cycleMinutes = INTERVAL_CYCLES[interval];
            if (shouldGenerateCandle(now, interval, cycleMinutes)) {
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
    });
    
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
            limit: 2 // Fetch last 2 candles to increase chance of reversal detection
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
    cron.schedule('*/5 * * * *', () => {
        logCronJobStatus();
    });
    
    console.log('✅ Monitoring cron job scheduled to run every 5 minutes');
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
    
    // Schedule cleanup to run every hour
    cron.schedule('0 * * * *', async () => {
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
    });
    
    console.log('✅ Data cleanup cron job scheduled to run every hour');
}

module.exports = {
    setupCandleDataCronJob,
    setupArtificialCandleDataCronJobs,
    runInitialCandleDataFetch,
    runInitialArtificialCandleDataGeneration,
    handleFirstTimeSymbolSelection,
    getCronJobStatus,
    logCronJobStatus,
    setupMonitoringCronJob,
    setupDataCleanupCronJob
};
