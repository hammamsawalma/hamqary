/**
 * Database models and operations
 */

/**
 * Save selected symbols to the database
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Array} selectedSymbols - Array of selected symbols
 * @returns {Promise<Object>} Result of the database operation
 */
async function saveSelectedSymbols(client, dbName, selectedSymbols) {
    if (!client) {
        throw new Error('Database connection not available');
    }
    
    const db = client.db(dbName);
    const collection = db.collection('selectedSymbols');
    
    // Check if this is the first time symbols are being selected
    const existingSelections = await collection.countDocuments({});
    const isFirstSelection = existingSelections === 0;
    
    const result = await collection.insertOne({
        symbols: selectedSymbols,
        timestamp: new Date()
    });
    
    console.log(`✅ Saved ${selectedSymbols.length} selected symbols`);
    
    return {
        result,
        isFirstSelection
    };
}

/**
 * Get the currently selected symbols from the database
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @returns {Promise<Array>} Array of currently selected symbols
 */
async function getSelectedSymbols(client, dbName) {
    if (!client) {
        throw new Error('Database connection not available');
    }
    
    const db = client.db(dbName);
    const collection = db.collection('selectedSymbols');
    
    // Get the most recent symbol selection
    const latestSelection = await collection.findOne(
        {},
        { sort: { timestamp: -1 } }
    );
    
    if (!latestSelection) {
        // No symbols selected yet, return empty array
        return [];
    }
    
    return latestSelection.symbols || [];
}

/**
 * Get candle data for a specific symbol and interval
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {string} symbol - Trading symbol
 * @param {string} interval - Time interval
 * @param {number} limit - Maximum number of candles to return
 * @param {number} skip - Number of candles to skip (for pagination)
 * @param {Date|null} startDate - Start date for filtering (optional)
 * @param {Date|null} endDate - End date for filtering (optional)
 * @returns {Promise<Array>} Array of candles
 */
async function getCandleData(client, dbName, symbol, interval, limit = 50, skip = 0, startDate = null, endDate = null) {
    if (!client) {
        throw new Error('Database connection not available');
    }
    
    const db = client.db(dbName);
    const candleCollection = db.collection('candleData');
    
    // Build the query
    const query = {
        symbol: symbol,
        interval: interval
    };
    
    // Add date range filter if provided
    if (startDate || endDate) {
        query.openTime = {};
        
        if (startDate) {
            query.openTime.$gte = startDate;
        }
        
        if (endDate) {
            query.openTime.$lte = endDate;
        }
    }
    
    // Query the candles for the selected symbol and interval with pagination and date filtering
    const candles = await candleCollection.find(query)
        .sort({ openTime: -1 })  // Sort by open time descending (newest first)
        .skip(skip)              // Skip for pagination
        .limit(limit)            // Limit the number of results
        .toArray();
    
    // Reverse to show oldest first
    return candles.reverse();
}

/**
 * Get the total count of candles for a specific symbol and interval
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {string} symbol - Trading symbol
 * @param {string} interval - Time interval
 * @param {Date|null} startDate - Start date for filtering (optional)
 * @param {Date|null} endDate - End date for filtering (optional)
 * @returns {Promise<number>} Total count of candles
 */
async function getCandleCount(client, dbName, symbol, interval, startDate = null, endDate = null) {
    if (!client) {
        throw new Error('Database connection not available');
    }
    
    const db = client.db(dbName);
    const candleCollection = db.collection('candleData');
    
    // Build the query
    const query = {
        symbol: symbol,
        interval: interval
    };
    
    // Add date range filter if provided
    if (startDate || endDate) {
        query.openTime = {};
        
        if (startDate) {
            query.openTime.$gte = startDate;
        }
        
        if (endDate) {
            query.openTime.$lte = endDate;
        }
    }
    
    // Count the total number of candles for the selected symbol and interval with date filtering
    const count = await candleCollection.countDocuments(query);
    
    return count;
}

/**
 * Get the last update time for candle data
 * @param {Array} candles - Array of candles
 * @returns {Date|null} Last update time or null if no candles
 */
function getLastUpdateTime(candles) {
    if (candles.length === 0) {
        return null;
    }
    
    return candles.reduce((latest, candle) => {
        return candle.fetchedAt > latest ? candle.fetchedAt : latest;
    }, new Date(0));
}

/**
 * Save reversal candle pattern to the database
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Object} reversalData - Reversal candle data
 * @returns {Promise<Object>} Result of the database operation
 */
async function saveReversalCandle(client, dbName, reversalData) {
    if (!client) {
        throw new Error('Database connection not available');
    }
    
    const db = client.db(dbName);
    const collection = db.collection('reversalCandles');
    
    const result = await collection.insertOne({
        ...reversalData,
        detectedAt: new Date()
    });
    
    return result;
}

/**
 * Get reversal candle data with filtering and pagination
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Object} filters - Filter options
 * @param {number} limit - Maximum number of candles to return
 * @param {number} skip - Number of candles to skip (for pagination)
 * @returns {Promise<Array>} Array of reversal candles
 */
async function getReversalCandles(client, dbName, filters = {}, limit = 50, skip = 0) {
    if (!client) {
        throw new Error('Database connection not available');
    }
    
    const db = client.db(dbName);
    const collection = db.collection('reversalCandles');
    
    // Build the query from filters
    const query = {};
    
    if (filters.symbol) {
        query.symbol = filters.symbol;
    }
    
    if (filters.interval) {
        query.interval = filters.interval;
    }
    
    if (filters.reversalType) {
        query['reversalPattern.type'] = filters.reversalType;
    }
    
    if (filters.minConfidence) {
        query['reversalPattern.confidence'] = { $gte: filters.minConfidence };
    }
    
    if (filters.startDate || filters.endDate) {
        query.openTime = {};
        
        if (filters.startDate) {
            query.openTime.$gte = filters.startDate;
        }
        
        if (filters.endDate) {
            query.openTime.$lte = filters.endDate;
        }
    }
    
    const candles = await collection.find(query)
        .sort({ openTime: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
    
    return candles.reverse();
}

/**
 * Get the total count of reversal candles with filtering
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Object} filters - Filter options
 * @returns {Promise<number>} Total count of reversal candles
 */
async function getReversalCandleCount(client, dbName, filters = {}) {
    if (!client) {
        throw new Error('Database connection not available');
    }
    
    const db = client.db(dbName);
    const collection = db.collection('reversalCandles');
    
    // Build the query from filters
    const query = {};
    
    if (filters.symbol) {
        query.symbol = filters.symbol;
    }
    
    if (filters.interval) {
        query.interval = filters.interval;
    }
    
    if (filters.reversalType) {
        query['reversalPattern.type'] = filters.reversalType;
    }
    
    if (filters.minConfidence) {
        query['reversalPattern.confidence'] = { $gte: filters.minConfidence };
    }
    
    if (filters.startDate || filters.endDate) {
        query.openTime = {};
        
        if (filters.startDate) {
            query.openTime.$gte = filters.startDate;
        }
        
        if (filters.endDate) {
            query.openTime.$lte = filters.endDate;
        }
    }
    
    const count = await collection.countDocuments(query);
    return count;
}

/**
 * Get reversal pattern statistics
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} Statistics object
 */
async function getReversalStatistics(client, dbName, filters = {}) {
    if (!client) {
        throw new Error('Database connection not available');
    }
    
    const db = client.db(dbName);
    const collection = db.collection('reversalCandles');
    
    // Build the match query from filters
    const matchQuery = {};
    
    if (filters.symbol) {
        matchQuery.symbol = filters.symbol;
    }
    
    if (filters.interval) {
        matchQuery.interval = filters.interval;
    }
    
    if (filters.startDate || filters.endDate) {
        matchQuery.openTime = {};
        
        if (filters.startDate) {
            matchQuery.openTime.$gte = filters.startDate;
        }
        
        if (filters.endDate) {
            matchQuery.openTime.$lte = filters.endDate;
        }
    }
    
    const pipeline = [
        { $match: matchQuery },
        {
            $group: {
                _id: null,
                totalReversals: { $sum: 1 },
                buyReversals: {
                    $sum: {
                        $cond: [{ $eq: ["$reversalPattern.type", "buy_reversal"] }, 1, 0]
                    }
                },
                sellReversals: {
                    $sum: {
                        $cond: [{ $eq: ["$reversalPattern.type", "sell_reversal"] }, 1, 0]
                    }
                },
                averageConfidence: { $avg: "$reversalPattern.confidence" },
                highConfidence: {
                    $sum: {
                        $cond: [{ $gt: ["$reversalPattern.confidence", 80] }, 1, 0]
                    }
                },
                mediumConfidence: {
                    $sum: {
                        $cond: [
                            { $and: [
                                { $gte: ["$reversalPattern.confidence", 60] },
                                { $lte: ["$reversalPattern.confidence", 80] }
                            ]}, 1, 0
                        ]
                    }
                },
                lowConfidence: {
                    $sum: {
                        $cond: [{ $lt: ["$reversalPattern.confidence", 60] }, 1, 0]
                    }
                }
            }
        }
    ];
    
    const result = await collection.aggregate(pipeline).toArray();
    
    if (result.length === 0) {
        return {
            totalReversals: 0,
            buyReversals: 0,
            sellReversals: 0,
            averageConfidence: 0,
            confidenceDistribution: {
                high: 0,
                medium: 0,
                low: 0
            }
        };
    }
    
    const stats = result[0];
    return {
        totalReversals: stats.totalReversals,
        buyReversals: stats.buyReversals,
        sellReversals: stats.sellReversals,
        averageConfidence: Math.round(stats.averageConfidence || 0),
        confidenceDistribution: {
            high: stats.highConfidence,
            medium: stats.mediumConfidence,
            low: stats.lowConfidence
        }
    };
}

/**
 * Delete a specific reversal signal from the database
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {string} signalId - ID of the signal to delete
 * @returns {Promise<Object>} Result of the deletion operation
 */
async function deleteReversalSignal(client, dbName, signalId) {
    if (!client) {
        throw new Error('Database connection not available');
    }
    
    const db = client.db(dbName);
    const collection = db.collection('reversalCandles');
    
    try {
        // Convert string ID to MongoDB ObjectId
        const { ObjectId } = require('mongodb');
        const objectId = new ObjectId(signalId);
        
        // Delete the signal
        const result = await collection.deleteOne({ _id: objectId });
        
        if (result.deletedCount === 1) {
            console.log(`✅ Successfully deleted signal with ID: ${signalId}`);
            return {
                success: true,
                deletedCount: result.deletedCount,
                message: 'Signal deleted successfully'
            };
        } else {
            console.log(`⚠️ No signal found with ID: ${signalId}`);
            return {
                success: false,
                deletedCount: 0,
                message: 'Signal not found'
            };
        }
        
    } catch (error) {
        console.error(`❌ Error deleting signal ${signalId}:`, error);
        return {
            success: false,
            deletedCount: 0,
            message: `Error deleting signal: ${error.message}`
        };
    }
}

/**
 * Delete multiple reversal signals from the database
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Array} signalIds - Array of signal IDs to delete
 * @returns {Promise<Object>} Result of the deletion operation
 */
async function deleteMultipleReversalSignals(client, dbName, signalIds) {
    if (!client) {
        throw new Error('Database connection not available');
    }
    
    const db = client.db(dbName);
    const collection = db.collection('reversalCandles');
    
    try {
        // Convert string IDs to MongoDB ObjectIds
        const { ObjectId } = require('mongodb');
        const objectIds = signalIds.map(id => new ObjectId(id));
        
        // Delete the signals
        const result = await collection.deleteMany({ _id: { $in: objectIds } });
        
        console.log(`✅ Successfully deleted ${result.deletedCount} signals`);
        return {
            success: true,
            deletedCount: result.deletedCount,
            message: `Successfully deleted ${result.deletedCount} signals`
        };
        
    } catch (error) {
        console.error(`❌ Error deleting multiple signals:`, error);
        return {
            success: false,
            deletedCount: 0,
            message: `Error deleting signals: ${error.message}`
        };
    }
}

/**
 * Ensure reversal candles collection has proper indexes
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 */
async function ensureReversalCandleIndexes(client, dbName) {
    if (!client) {
        throw new Error('Database connection not available');
    }
    
    const db = client.db(dbName);
    const collection = db.collection('reversalCandles');
    
    try {
        // Create compound index for unique reversal candles
        await collection.createIndex(
            { symbol: 1, interval: 1, openTime: 1 },
            { unique: true }
        );
        
        // Additional indexes for common query patterns
        await collection.createIndex({ symbol: 1 });
        await collection.createIndex({ interval: 1 });
        await collection.createIndex({ 'reversalPattern.type': 1 });
        await collection.createIndex({ 'reversalPattern.confidence': 1 });
        await collection.createIndex({ openTime: 1 });
        await collection.createIndex({ detectedAt: 1 });
        
        console.log('✅ Reversal candle indexes created successfully');
    } catch (error) {
        console.error('Error creating reversal candle indexes:', error);
    }
}

module.exports = {
    saveSelectedSymbols,
    getSelectedSymbols,
    getCandleData,
    getCandleCount,
    getLastUpdateTime,
    saveReversalCandle,
    getReversalCandles,
    getReversalCandleCount,
    getReversalStatistics,
    deleteReversalSignal,
    deleteMultipleReversalSignals,
    ensureReversalCandleIndexes
};
