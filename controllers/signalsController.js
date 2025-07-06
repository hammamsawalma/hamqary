/**
 * Signals Controller - Modern Trading Signals Dashboard
 * Shows valid trade signals with filtering, sorting, and real-time updates
 */

const { getSelectedSymbols } = require('../config/database');
const { deleteReversalSignal } = require('../models/database');

/**
 * Display trading signals dashboard (new home page)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function signalsController(req, res) {
    try {
        // Get MongoDB client
        const client = req.app.locals.client;
        const dbName = req.app.locals.dbName;
        
        // Check MongoDB connection
        if (!client) {
            return res.status(500).send('Database connection not available');
        }
        
        // Get selected symbols
        const selectedSymbols = await getSelectedSymbols(client);
        
        // Get query parameters for filtering
        const symbol = req.query.symbol || 'all';
        const minTimeframe = parseInt(req.query.minTimeframe || '3', 10);
        const maxTimeframe = parseInt(req.query.maxTimeframe || '60', 10);
        const specificTimeframe = req.query.specificTimeframe ? parseInt(req.query.specificTimeframe, 10) : null;
        const minScore = parseFloat(req.query.minScore || '0');
        const signalType = req.query.signalType || 'both'; // both, buy, sell
        const sortBy = req.query.sortBy || 'closeTime'; // closeTime, score, symbol
        const sortOrder = req.query.sortOrder || 'desc'; // asc, desc
        const limit = parseInt(req.query.limit || '50', 10);
        
        // Generate intervals based on range or specific timeframe
        let selectedIntervals = [];
        if (specificTimeframe && specificTimeframe >= 1 && specificTimeframe <= 60) {
            selectedIntervals = [`${specificTimeframe}m`];
        } else {
            // Generate range of intervals
            const validMin = Math.max(1, Math.min(minTimeframe, 60));
            const validMax = Math.max(validMin, Math.min(maxTimeframe, 60));
            for (let i = validMin; i <= validMax; i++) {
                selectedIntervals.push(`${i}m`);
            }
        }
        
        // All available timeframes (from backend processing)
        const allTimeframes = [
            '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '10m',
            '11m', '12m', '13m', '14m', '15m', '16m', '17m', '18m', '19m', '20m',
            '21m', '22m', '23m', '24m', '25m', '26m', '27m', '28m', '29m', '30m',
            '31m', '32m', '33m', '34m', '35m', '36m', '37m', '38m', '39m', '40m',
            '41m', '42m', '43m', '44m', '45m', '46m', '47m', '48m', '49m', '50m',
            '51m', '52m', '53m', '54m', '55m', '56m', '57m', '58m', '59m', '60m'
        ];
        
        // Prepare view data
        const viewData = {
            selectedSymbols,
            currentSymbol: symbol,
            currentMinTimeframe: specificTimeframe ? null : minTimeframe,
            currentMaxTimeframe: specificTimeframe ? null : maxTimeframe,
            currentSpecificTimeframe: specificTimeframe,
            selectedIntervals: selectedIntervals,
            currentMinScore: minScore,
            currentSignalType: signalType,
            currentSortBy: sortBy,
            currentSortOrder: sortOrder,
            currentLimit: limit,
            allTimeframes: allTimeframes,
            signals: [],
            statistics: null,
            error: null,
            hasSymbols: selectedSymbols.length > 0
        };
        
        // Only fetch signals if symbols are selected
        if (selectedSymbols.length > 0) {
            try {
                // Get valid trade signals
                const { signals, statistics } = await getValidTradeSignals(client, dbName, {
                    symbol: symbol !== 'all' ? symbol : null,
                    intervals: selectedIntervals,
                    minScore,
                    signalType,
                    sortBy,
                    sortOrder,
                    limit
                });
                
                viewData.signals = signals;
                viewData.statistics = statistics;
                
            } catch (dbError) {
                console.error('Error fetching signals data:', dbError);
                viewData.error = `Error fetching signals: ${dbError.message}`;
            }
        }
        
        // Render the signals dashboard using EJS template
        res.render('signals', {
            title: 'Trading Signals Dashboard',
            ...viewData,
            calculateStopLoss: calculateStopLoss
        });
        
    } catch (error) {
        console.error('Error in signals dashboard:', error);
        res.status(500).send('An error occurred while loading the trading signals dashboard');
    }
}

/**
 * Get valid trade signals from database
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} Signals and statistics
 */
async function getValidTradeSignals(client, dbName, filters) {
    const db = client.db(dbName);
    const collection = db.collection('reversalCandles');
    
    // Build query for valid signals only
    const query = {
        'tradeSignal.isValidSignal': true,
        'volumeFootprint.poc': { $exists: true }
    };
    
    // Add symbol filter
    if (filters.symbol) {
        query.symbol = filters.symbol;
    }
    
    // Add intervals filter (array of selected timeframes)
    if (filters.intervals && Array.isArray(filters.intervals) && filters.intervals.length > 0) {
        query.interval = { $in: filters.intervals };
    }
    
    // Add score filter
    if (filters.minScore > 0) {
        query['tradeSignal.score'] = { $gte: filters.minScore };
    }
    
    // Add signal type filter
    if (filters.signalType && filters.signalType !== 'both') {
        query['tradeSignal.signalType'] = filters.signalType;
    }
    
    // Build sort criteria - default to closeTime descending (newest first)
    let sortCriteria = {};
    switch (filters.sortBy) {
        case 'score':
            sortCriteria['tradeSignal.score'] = filters.sortOrder === 'asc' ? 1 : -1;
            break;
        case 'symbol':
            sortCriteria.symbol = filters.sortOrder === 'asc' ? 1 : -1;
            break;
        case 'closeTime':
        default:
            sortCriteria.closeTime = filters.sortOrder === 'asc' ? 1 : -1;
            break;
    }
    
    // Get signals
    const rawSignals = await collection.find(query)
        .sort(sortCriteria)
        .limit(filters.limit)
        .toArray();
    
    // Filter out any signals with future close times (critical safety check)
    const now = Date.now();
    const signals = rawSignals.filter(signal => {
        const closeTime = signal.closeTime instanceof Date ? signal.closeTime.getTime() : signal.closeTime;
        const isClosed = closeTime < now;
        
        if (!isClosed) {
            console.log(`⚠️ Filtered out signal with future close time: ${signal.symbol} ${signal.interval} - close: ${new Date(closeTime).toISOString()}, current: ${new Date(now).toISOString()}`);
        }
        
        return isClosed;
    });
    
    // Get statistics (use original query, not filtered signals)
    const statistics = await getSignalsStatistics(collection, query);
    
    return { signals, statistics };
}

/**
 * Get statistics for signals
 * @param {Object} collection - MongoDB collection
 * @param {Object} baseQuery - Base query filters
 * @returns {Promise<Object>} Statistics
 */
async function getSignalsStatistics(collection, baseQuery) {
    const [
        totalSignals,
        buySignals,
        sellSignals,
        highScoreSignals
    ] = await Promise.all([
        collection.countDocuments(baseQuery),
        collection.countDocuments({ ...baseQuery, 'tradeSignal.signalType': 'buy' }),
        collection.countDocuments({ ...baseQuery, 'tradeSignal.signalType': 'sell' }),
        collection.countDocuments({ ...baseQuery, 'tradeSignal.score': { $gte: 8 } })
    ]);
    
    // Get average score
    const avgScorePipeline = [
        { $match: baseQuery },
        { $group: { _id: null, avgScore: { $avg: '$tradeSignal.score' } } }
    ];
    
    const avgScoreResult = await collection.aggregate(avgScorePipeline).toArray();
    const avgScore = avgScoreResult.length > 0 ? avgScoreResult[0].avgScore : 0;
    
    return {
        totalSignals,
        buySignals,
        sellSignals,
        highScoreSignals,
        avgScore: Math.round(avgScore * 10) / 10
    };
}

/**
 * Calculate stop loss price and risk percentage for a signal
 * @param {Object} signal - Signal data with OHLC values
 * @returns {Object} Stop loss information
 */
function calculateStopLoss(signal) {
    // First, let's find where the OHLC data is stored
    let open, high, low, close;
    
    // Try different possible locations for OHLC data
    if (signal.open !== undefined) {
        // Direct properties
        ({ open, high, low, close } = signal);
    } else if (signal.candleData) {
        // Nested in candleData
        ({ open, high, low, close } = signal.candleData);
    } else if (signal.ohlc) {
        // Nested in ohlc object
        ({ open, high, low, close } = signal.ohlc);
    } else {
        // Try alternative property names
        open = signal.openPrice || signal.open_price;
        high = signal.highPrice || signal.high_price;
        low = signal.lowPrice || signal.low_price;
        close = signal.closePrice || signal.close_price;
    }
    
    // Debug logging - remove after fixing
    if (open === undefined || high === undefined || low === undefined || close === undefined) {
        console.log('🚨 OHLC Data Debug - Signal Object Structure:');
        console.log('Signal keys:', Object.keys(signal));
        console.log('OHLC Values:', { open, high, low, close });
        console.log('Sample signal object (first few properties):', JSON.stringify(signal, null, 2).substring(0, 500) + '...');
    }
    
    const signalType = signal.tradeSignal?.signalType;
    
    // Validate data before calculation
    if (!signalType || typeof open !== 'number' || typeof high !== 'number' || 
        typeof low !== 'number' || typeof close !== 'number') {
        return {
            stopLossPrice: 'N/A',
            riskPercentage: 0,
            formattedStopLoss: 'N/A',
            formattedRiskPercentage: 'N/A'
        };
    }
    
    let stopLossPrice;
    let riskPercentage;
    
    if (signalType === 'buy') {
        // For buy signals: Stop Loss = Low of the candle
        stopLossPrice = low;
        // Risk percentage = ((close - low) / close) * 100
        riskPercentage = ((close - low) / close) * 100;
    } else { // sell
        // For sell signals: Stop Loss = High of the candle
        stopLossPrice = high;
        // Risk percentage = ((high - close) / close) * 100
        riskPercentage = ((high - close) / close) * 100;
    }
    
    // Ensure valid numbers
    if (isNaN(riskPercentage) || !isFinite(riskPercentage)) {
        riskPercentage = 0;
    }
    
    return {
        stopLossPrice: stopLossPrice,
        riskPercentage: Math.round(riskPercentage * 100) / 100, // Round to 2 decimal places
        formattedStopLoss: typeof stopLossPrice === 'number' ? stopLossPrice.toFixed(8).replace(/\.?0+$/, '') : 'N/A',
        formattedRiskPercentage: isNaN(riskPercentage) ? 'N/A' : `${Math.round(riskPercentage * 100) / 100}%`
    };
}

/**
 * Delete a specific signal
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function deleteSignalController(req, res) {
    try {
        const client = req.app.locals.client;
        const dbName = req.app.locals.dbName;
        const signalId = req.params.id;
        
        // Check MongoDB connection
        if (!client) {
            return res.status(500).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        if (!signalId) {
            return res.status(400).json({
                success: false,
                message: 'Signal ID is required'
            });
        }
        
        console.log(`🗑️ Deleting signal with ID: ${signalId}`);
        
        // Delete the signal
        const result = await deleteReversalSignal(client, dbName, signalId);
        
        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                deletedCount: result.deletedCount
            });
        } else {
            res.status(404).json({
                success: false,
                message: result.message
            });
        }
        
    } catch (error) {
        console.error('Error deleting signal:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred while deleting the signal: ' + error.message
        });
    }
}

module.exports = {
    signalsController,
    deleteSignalController
};
