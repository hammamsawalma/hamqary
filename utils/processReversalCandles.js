/**
 * Batch processor for detecting reversal candle patterns in existing data
 * This utility processes all existing candle data and identifies reversal patterns
 */

const { detectReversalCandle } = require('./reversalCandleDetector');
const { saveReversalCandle, ensureReversalCandleIndexes } = require('../models/database');
const { getSelectedSymbols } = require('../config/database');

/**
 * Process all existing candles for reversal patterns
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processing results
 */
async function processAllReversalCandles(client, dbName, options = {}) {
    console.log('🔄 Starting batch reversal candle detection...');
    
    const results = {
        totalCandlesProcessed: 0,
        reversalPatternsFound: 0,
        reversalPatternsSaved: 0,
        buyReversals: 0,
        sellReversals: 0,
        errors: [],
        symbolsProcessed: [],
        startTime: new Date(),
        endTime: null
    };

    try {
        if (!client) {
            throw new Error('MongoDB client is not available');
        }

        const db = client.db(dbName);
        
        // Ensure indexes exist for reversal candles collection
        await ensureReversalCandleIndexes(client, dbName);
        
        // Get selected symbols
        const selectedSymbols = await getSelectedSymbols(db);
        
        if (selectedSymbols.length === 0) {
            console.log('⚠️ No symbols selected. Processing completed with no data.');
            results.endTime = new Date();
            return results;
        }

        console.log(`📊 Processing reversal patterns for ${selectedSymbols.length} symbols: ${selectedSymbols.join(', ')}`);
        
        // Get all available intervals from existing candle data
        const intervals = await getAvailableIntervals(db);
        console.log(`⏰ Found intervals: ${intervals.join(', ')}`);
        
        // Process each symbol and interval combination
        for (const symbol of selectedSymbols) {
            for (const interval of intervals) {
                try {
                    console.log(`🔍 Processing ${symbol} - ${interval}...`);
                    
                    const symbolResults = await processSymbolInterval(
                        client, 
                        dbName, 
                        symbol, 
                        interval, 
                        options
                    );
                    
                    results.totalCandlesProcessed += symbolResults.candlesProcessed;
                    results.reversalPatternsFound += symbolResults.patternsFound;
                    results.reversalPatternsSaved += symbolResults.patternsSaved;
                    results.buyReversals += symbolResults.buyReversals;
                    results.sellReversals += symbolResults.sellReversals;
                    results.errors.push(...symbolResults.errors);
                    
                    if (!results.symbolsProcessed.includes(symbol)) {
                        results.symbolsProcessed.push(symbol);
                    }
                    
                    console.log(`✅ ${symbol} - ${interval}: Processed ${symbolResults.candlesProcessed} candles, found ${symbolResults.patternsFound} reversals`);
                    
                } catch (symbolError) {
                    console.error(`❌ Error processing ${symbol} - ${interval}:`, symbolError);
                    results.errors.push(`Error for ${symbol} - ${interval}: ${symbolError.message}`);
                }
            }
        }
        
        console.log(`🏁 Batch reversal detection completed!`);
        console.log(`📊 Summary: Processed ${results.totalCandlesProcessed} candles, found ${results.reversalPatternsFound} reversal patterns`);
        console.log(`📈 Buy reversals: ${results.buyReversals}, Sell reversals: ${results.sellReversals}`);
        
    } catch (error) {
        console.error('❌ Batch reversal detection failed:', error);
        results.errors.push(`Main processing error: ${error.message}`);
    }

    results.endTime = new Date();
    return results;
}

/**
 * Process a specific symbol and interval for reversal patterns
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {string} symbol - Trading symbol
 * @param {string} interval - Time interval
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processing results for this symbol/interval
 */
async function processSymbolInterval(client, dbName, symbol, interval, options = {}) {
    const db = client.db(dbName);
    const candleCollection = db.collection('candleData');
    const reversalCollection = db.collection('reversalCandles');
    
    const results = {
        candlesProcessed: 0,
        patternsFound: 0,
        patternsSaved: 0,
        buyReversals: 0,
        sellReversals: 0,
        errors: []
    };
    
    const batchSize = options.batchSize || 1000;
    let skip = 0;
    let hasMoreData = true;
    
    while (hasMoreData) {
        try {
            // Get batch of candles
            const candles = await candleCollection.find({
                symbol: symbol,
                interval: interval
            })
            .sort({ openTime: 1 })
            .skip(skip)
            .limit(batchSize)
            .toArray();
            
            if (candles.length === 0) {
                hasMoreData = false;
                break;
            }
            
            // Process each candle in the batch
            for (const candle of candles) {
                try {
                    results.candlesProcessed++;
                    
                    // Detect reversal pattern
                    const reversalPattern = detectReversalCandle(candle);
                    
                    if (reversalPattern) {
                        results.patternsFound++;
                        
                        if (reversalPattern.type === 'buy_reversal') {
                            results.buyReversals++;
                        } else {
                            results.sellReversals++;
                        }
                        
                        // Check if this reversal pattern already exists
                        const existingReversal = await reversalCollection.findOne({
                            symbol: symbol,
                            interval: interval,
                            openTime: candle.openTime
                        });
                        
                        if (!existingReversal) {
                            // Save the reversal pattern
                            const reversalData = {
                                symbol: symbol,
                                interval: interval,
                                openTime: candle.openTime,
                                closeTime: candle.closeTime,
                                candleData: {
                                    open: candle.open,
                                    high: candle.high,
                                    low: candle.low,
                                    close: candle.close,
                                    volume: candle.volume,
                                    numberOfTrades: candle.numberOfTrades
                                },
                                reversalPattern: reversalPattern
                            };
                            
                            await saveReversalCandle(client, dbName, reversalData);
                            results.patternsSaved++;
                        }
                    }
                    
                } catch (candleError) {
                    results.errors.push(`Error processing candle at ${candle.openTime}: ${candleError.message}`);
                }
            }
            
            skip += batchSize;
            
            // If we got less than the batch size, we're done
            if (candles.length < batchSize) {
                hasMoreData = false;
            }
            
            // Small delay to prevent overwhelming the database
            if (hasMoreData && options.delay) {
                await new Promise(resolve => setTimeout(resolve, options.delay));
            }
            
        } catch (batchError) {
            results.errors.push(`Error processing batch starting at ${skip}: ${batchError.message}`);
            hasMoreData = false;
        }
    }
    
    return results;
}

/**
 * Get all available intervals from the candle data
 * @param {Object} db - MongoDB database instance
 * @returns {Promise<Array>} Array of available intervals
 */
async function getAvailableIntervals(db) {
    try {
        const candleCollection = db.collection('candleData');
        const intervals = await candleCollection.distinct('interval');
        return intervals.sort();
    } catch (error) {
        console.error('Error getting available intervals:', error);
        return ['1h']; // Default interval
    }
}


/**
 * Process reversal patterns for specific symbols and intervals
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Array} symbols - Array of symbols to process
 * @param {Array} intervals - Array of intervals to process
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processing results
 */
async function processSpecificReversalCandles(client, dbName, symbols, intervals, options = {}) {
    console.log(`🔄 Starting targeted reversal candle detection for ${symbols.length} symbols and ${intervals.length} intervals...`);
    
    const results = {
        totalCandlesProcessed: 0,
        reversalPatternsFound: 0,
        reversalPatternsSaved: 0,
        buyReversals: 0,
        sellReversals: 0,
        errors: [],
        symbolsProcessed: [],
        startTime: new Date(),
        endTime: null
    };

    try {
        if (!client) {
            throw new Error('MongoDB client is not available');
        }

        // Ensure indexes exist for reversal candles collection
        await ensureReversalCandleIndexes(client, dbName);
        
        // Process each symbol and interval combination
        for (const symbol of symbols) {
            for (const interval of intervals) {
                try {
                    console.log(`🔍 Processing ${symbol} - ${interval}...`);
                    
                    const symbolResults = await processSymbolInterval(
                        client, 
                        dbName, 
                        symbol, 
                        interval, 
                        options
                    );
                    
                    results.totalCandlesProcessed += symbolResults.candlesProcessed;
                    results.reversalPatternsFound += symbolResults.patternsFound;
                    results.reversalPatternsSaved += symbolResults.patternsSaved;
                    results.buyReversals += symbolResults.buyReversals;
                    results.sellReversals += symbolResults.sellReversals;
                    results.errors.push(...symbolResults.errors);
                    
                    if (!results.symbolsProcessed.includes(symbol)) {
                        results.symbolsProcessed.push(symbol);
                    }
                    
                    console.log(`✅ ${symbol} - ${interval}: Processed ${symbolResults.candlesProcessed} candles, found ${symbolResults.patternsFound} reversals`);
                    
                } catch (symbolError) {
                    console.error(`❌ Error processing ${symbol} - ${interval}:`, symbolError);
                    results.errors.push(`Error for ${symbol} - ${interval}: ${symbolError.message}`);
                }
            }
        }
        
        console.log(`🏁 Targeted reversal detection completed!`);
        
    } catch (error) {
        console.error('❌ Targeted reversal detection failed:', error);
        results.errors.push(`Main processing error: ${error.message}`);
    }

    results.endTime = new Date();
    return results;
}

module.exports = {
    processAllReversalCandles,
    processSymbolInterval,
    processSpecificReversalCandles,
    getAvailableIntervals
};
