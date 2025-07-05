/**
 * Backfill Volume Footprints for Existing Reversal Candles
 * Processes existing reversal candles and adds volume footprint data
 */

const { fetchReversalCandleTickData, isHistoricalDataAvailable } = require('./fetchHistoricalTickData');
const { calculateReversalVolumeFootprint } = require('./volumeFootprintCalculator');

/**
 * Backfill volume footprints for existing reversal candles
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Object} options - Backfill options
 * @returns {Promise<Object>} Backfill results summary
 */
async function backfillVolumeFootprints(client, dbName, options = {}) {
    const {
        symbol = null,           // Process specific symbol only
        interval = null,         // Process specific interval only
        limit = 100,            // Number of candles to process per batch
        batchDelay = 500,       // Delay between batches (ms)
        maxAge = null,          // Only process candles newer than this (days)
        dryRun = false          // If true, don't save to database
    } = options;

    console.log('🚀 Starting volume footprint backfill process...');
    console.log(`📊 Options: ${JSON.stringify(options, null, 2)}`);

    const results = {
        startTime: new Date(),
        endTime: null,
        processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        errors: [],
        summary: {}
    };

    try {
        if (!client) {
            throw new Error('MongoDB client is not available');
        }

        const db = client.db(dbName);
        const collection = db.collection('reversalCandles');

        // Build query for reversal candles that need volume footprint data
        const query = {
            // Only process candles that don't have volume footprint data yet
            'volumeFootprint.poc': { $exists: false }
        };

        // Add symbol filter if specified
        if (symbol) {
            query.symbol = symbol;
        }

        // Add interval filter if specified
        if (interval) {
            query.interval = interval;
        }

        // Add timeframe filters (1-20 minutes only)
        const validIntervals = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '10m', 
                               '11m', '12m', '13m', '14m', '15m', '16m', '17m', '18m', '19m', '20m'];
        
        if (!interval) {
            query.interval = { $in: validIntervals };
        } else if (!validIntervals.includes(interval)) {
            console.log(`⚠️ Skipping interval ${interval} - only processing 1-20 minute timeframes`);
            results.endTime = new Date();
            return results;
        }

        // Add age filter if specified
        if (maxAge) {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - maxAge);
            query.openTime = { $gte: cutoffDate };
        }

        // Get total count of candles to process
        const totalCandles = await collection.countDocuments(query);
        console.log(`📋 Found ${totalCandles} reversal candles to process`);

        if (totalCandles === 0) {
            console.log('✅ No candles found that need volume footprint processing');
            results.endTime = new Date();
            return results;
        }

        // Process candles in batches
        let processed = 0;
        while (processed < totalCandles) {
            console.log(`\n📦 Processing batch ${Math.floor(processed / limit) + 1}/${Math.ceil(totalCandles / limit)}`);
            
            // Get next batch of candles
            const candles = await collection.find(query)
                .sort({ openTime: -1 }) // Process newest first
                .skip(processed)
                .limit(limit)
                .toArray();

            if (candles.length === 0) {
                break;
            }

            // Process each candle in the batch
            for (const candle of candles) {
                try {
                    results.processed++;
                    
                    console.log(`🔍 Processing ${candle.symbol} ${candle.interval} candle from ${new Date(candle.openTime).toISOString()}`);
                    
                    // Check if historical data is available
                    const openTime = candle.openTime instanceof Date ? candle.openTime.getTime() : candle.openTime;
                    const closeTime = candle.closeTime instanceof Date ? candle.closeTime.getTime() : candle.closeTime;
                    
                    const dataAvailable = await isHistoricalDataAvailable(candle.symbol, openTime);
                    if (!dataAvailable) {
                        console.log(`⚠️ Historical data not available for ${candle.symbol} at ${new Date(openTime).toISOString()}`);
                        results.skipped++;
                        continue;
                    }

                    // Fetch tick data for this candle
                    const tickDataResult = await fetchReversalCandleTickData(
                        candle.symbol,
                        openTime,
                        closeTime,
                        candle.interval
                    );

                    if (!tickDataResult.success || tickDataResult.trades.length === 0) {
                        console.log(`❌ Failed to fetch tick data: ${tickDataResult.error || 'No trades found'}`);
                        results.failed++;
                        results.errors.push({
                            candle: `${candle.symbol} ${candle.interval}`,
                            error: tickDataResult.error || 'No trades found'
                        });
                        continue;
                    }

                    // Calculate volume footprint
                    const volumeFootprint = calculateReversalVolumeFootprint(
                        tickDataResult.trades,
                        candle.symbol,
                        openTime,
                        closeTime
                    );

                    if (volumeFootprint.error) {
                        console.log(`❌ Volume footprint calculation failed: ${volumeFootprint.error}`);
                        results.failed++;
                        results.errors.push({
                            candle: `${candle.symbol} ${candle.interval}`,
                            error: volumeFootprint.error
                        });
                        continue;
                    }

                    // Update database record (unless dry run)
                    if (!dryRun) {
                        await collection.updateOne(
                            { _id: candle._id },
                            {
                                $set: {
                                    volumeFootprint: {
                                        poc: volumeFootprint.poc,
                                        vah: volumeFootprint.vah,
                                        val: volumeFootprint.val,
                                        totalVolume: volumeFootprint.totalVolume,
                                        valueAreaVolume: volumeFootprint.valueAreaVolume,
                                        valueAreaPercentage: volumeFootprint.valueAreaPercentage,
                                        tickDataSource: 'historical',
                                        calculatedAt: new Date(),
                                        tradesProcessed: volumeFootprint.tradesProcessed,
                                        executionTime: tickDataResult.executionTime
                                    }
                                }
                            }
                        );
                    }

                    console.log(`✅ ${dryRun ? 'Would update' : 'Updated'} ${candle.symbol} ${candle.interval} - POC: ${volumeFootprint.poc}, VAH: ${volumeFootprint.vah}, VAL: ${volumeFootprint.val}`);
                    results.successful++;

                } catch (error) {
                    console.error(`❌ Error processing candle ${candle.symbol} ${candle.interval}:`, error.message);
                    results.failed++;
                    results.errors.push({
                        candle: `${candle.symbol} ${candle.interval}`,
                        error: error.message
                    });
                }
            }

            processed += candles.length;
            
            // Add delay between batches to respect rate limits
            if (processed < totalCandles && batchDelay > 0) {
                console.log(`⏱️ Waiting ${batchDelay}ms before next batch...`);
                await new Promise(resolve => setTimeout(resolve, batchDelay));
            }
        }

        results.endTime = new Date();
        
        // Generate summary
        results.summary = {
            totalFound: totalCandles,
            processed: results.processed,
            successful: results.successful,
            failed: results.failed,
            skipped: results.skipped,
            successRate: results.processed > 0 ? Math.round((results.successful / results.processed) * 100) : 0,
            duration: Math.round((results.endTime - results.startTime) / 1000)
        };

        console.log('\n🏁 Volume footprint backfill completed!');
        console.log(`📊 Summary: ${JSON.stringify(results.summary, null, 2)}`);
        
        if (results.errors.length > 0) {
            console.log(`\n❌ Errors (${results.errors.length}):`);
            results.errors.forEach((error, index) => {
                console.log(`${index + 1}. ${error.candle}: ${error.error}`);
            });
        }

        return results;

    } catch (error) {
        results.endTime = new Date();
        results.errors.push({
            candle: 'SYSTEM',
            error: error.message
        });
        
        console.error('❌ Backfill process failed:', error);
        throw error;
    }
}

/**
 * Backfill volume footprints for a specific symbol
 * @param {Object} client - MongoDB client  
 * @param {string} dbName - Database name
 * @param {string} symbol - Symbol to process
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Backfill results
 */
async function backfillSymbolVolumeFootprints(client, dbName, symbol, options = {}) {
    console.log(`🎯 Starting volume footprint backfill for ${symbol}`);
    
    return await backfillVolumeFootprints(client, dbName, {
        ...options,
        symbol: symbol
    });
}

/**
 * Backfill volume footprints for a specific interval
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {string} interval - Interval to process
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Backfill results
 */
async function backfillIntervalVolumeFootprints(client, dbName, interval, options = {}) {
    console.log(`⏰ Starting volume footprint backfill for ${interval} interval`);
    
    return await backfillVolumeFootprints(client, dbName, {
        ...options,
        interval: interval
    });
}

/**
 * Get backfill status - shows how many candles need processing
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Object} filters - Optional filters
 * @returns {Promise<Object>} Status information
 */
async function getBackfillStatus(client, dbName, filters = {}) {
    try {
        if (!client) {
            throw new Error('MongoDB client is not available');
        }

        const db = client.db(dbName);
        const collection = db.collection('reversalCandles');

        // Valid intervals for volume footprint processing
        const validIntervals = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '10m', 
                               '11m', '12m', '13m', '14m', '15m', '16m', '17m', '18m', '19m', '20m'];

        const baseQuery = {
            interval: { $in: validIntervals }
        };

        // Add additional filters
        if (filters.symbol) {
            baseQuery.symbol = filters.symbol;
        }
        if (filters.interval) {
            baseQuery.interval = filters.interval;
        }

        // Count total candles
        const totalCandles = await collection.countDocuments(baseQuery);

        // Count candles with volume footprint data
        const processedCandles = await collection.countDocuments({
            ...baseQuery,
            'volumeFootprint.poc': { $exists: true }
        });

        // Count candles without volume footprint data
        const pendingCandles = await collection.countDocuments({
            ...baseQuery,
            'volumeFootprint.poc': { $exists: false }
        });

        // Get breakdown by symbol and interval
        const pipeline = [
            { $match: baseQuery },
            {
                $group: {
                    _id: {
                        symbol: '$symbol',
                        interval: '$interval',
                        hasFootprint: {
                            $cond: [
                                { $ne: ['$volumeFootprint.poc', null] },
                                'processed',
                                'pending'
                            ]
                        }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.symbol': 1, '_id.interval': 1 } }
        ];

        const breakdown = await collection.aggregate(pipeline).toArray();

        return {
            totalCandles,
            processedCandles,
            pendingCandles,
            completionPercentage: totalCandles > 0 ? Math.round((processedCandles / totalCandles) * 100) : 0,
            breakdown: breakdown.reduce((acc, item) => {
                const key = `${item._id.symbol}_${item._id.interval}`;
                if (!acc[key]) {
                    acc[key] = { symbol: item._id.symbol, interval: item._id.interval, processed: 0, pending: 0 };
                }
                acc[key][item._id.hasFootprint] = item.count;
                return acc;
            }, {}),
            validIntervals,
            timestamp: new Date()
        };

    } catch (error) {
        console.error('Error getting backfill status:', error);
        throw error;
    }
}

module.exports = {
    backfillVolumeFootprints,
    backfillSymbolVolumeFootprints,
    backfillIntervalVolumeFootprints,
    getBackfillStatus
};
