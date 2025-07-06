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
        const intervals = req.query.intervals || ['3m', '4m', '5m', '6m', '7m', '8m', '9m', '10m', '11m', '12m', '13m', '14m', '15m', '16m', '17m', '18m', '19m', '20m']; // Default to 3m+ (exclude 1m, 2m)
        const minScore = parseFloat(req.query.minScore || '0');
        const sortBy = req.query.sortBy || 'closeTime'; // closeTime, score, symbol
        const sortOrder = req.query.sortOrder || 'desc'; // asc, desc
        const limit = parseInt(req.query.limit || '50', 10);
        
        // Ensure intervals is always an array
        const selectedIntervals = Array.isArray(intervals) ? intervals : [intervals];
        
        // All available timeframes (from backend processing)
        const allTimeframes = [
            '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '10m',
            '11m', '12m', '13m', '14m', '15m', '16m', '17m', '18m', '19m', '20m'
        ];
        
        // Prepare view data
        const viewData = {
            selectedSymbols,
            currentSymbol: symbol,
            currentIntervals: selectedIntervals,
            currentMinScore: minScore,
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
        
        // Render the signals dashboard
        res.send(generateSignalsDashboard(viewData));
        
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
    const signals = await collection.find(query)
        .sort(sortCriteria)
        .limit(filters.limit)
        .toArray();
    
    // Get statistics
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
 * Generate the signals dashboard HTML
 * @param {Object} viewData - View data object
 * @returns {string} HTML content
 */
function generateSignalsDashboard(viewData) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Trading Signals Dashboard - Hamqary</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    background: linear-gradient(135deg, #1e3d5f 0%, #2c5aa0 100%);
                    min-height: 100vh;
                    color: #333;
                }
                .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
                
                /* Header */
                .header {
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(10px);
                    border-radius: 20px;
                    padding: 30px;
                    margin-bottom: 30px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                }
                .header h1 {
                    color: #2c3e50;
                    font-size: 2.5em;
                    font-weight: 700;
                    margin-bottom: 10px;
                    display: flex;
                    align-items: center;
                    gap: 15px;
                }
                .header p {
                    color: #7f8c8d;
                    font-size: 1.1em;
                    margin-bottom: 20px;
                }
                
                /* Controls */
                .controls {
                    background: rgba(255, 255, 255, 0.9);
                    backdrop-filter: blur(10px);
                    border-radius: 15px;
                    padding: 25px;
                    margin-bottom: 30px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
                }
                .controls-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    align-items: end;
                }
                .control-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .control-group label {
                    font-weight: 600;
                    color: #2c3e50;
                    font-size: 0.9em;
                }
                select, input, button {
                    padding: 12px 16px;
                    border: 2px solid #e1e8ed;
                    border-radius: 10px;
                    font-size: 1em;
                    transition: all 0.3s ease;
                }
                select:focus, input:focus {
                    outline: none;
                    border-color: #3498db;
                    box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
                }
                
                /* Buttons */
                .btn {
                    cursor: pointer;
                    font-weight: 600;
                    text-decoration: none;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    transition: all 0.3s ease;
                    border: none;
                }
                .btn-primary {
                    background: linear-gradient(135deg, #3498db, #2980b9);
                    color: white;
                }
                .btn-primary:hover {
                    background: linear-gradient(135deg, #2980b9, #1f3a93);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 15px rgba(52, 152, 219, 0.4);
                }
                .btn-success {
                    background: linear-gradient(135deg, #27ae60, #229954);
                    color: white;
                }
                .btn-danger {
                    background: linear-gradient(135deg, #e74c3c, #c0392b);
                    color: white;
                }
                
                /* Statistics */
                .stats {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                }
                .stat-card {
                    background: rgba(255, 255, 255, 0.9);
                    backdrop-filter: blur(10px);
                    border-radius: 15px;
                    padding: 25px;
                    text-align: center;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
                    transition: transform 0.3s ease;
                }
                .stat-card:hover {
                    transform: translateY(-5px);
                }
                .stat-value {
                    font-size: 2.5em;
                    font-weight: 700;
                    margin-bottom: 10px;
                }
                .stat-label {
                    color: #7f8c8d;
                    font-size: 0.9em;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                .stat-buy { color: #27ae60; }
                .stat-sell { color: #e74c3c; }
                .stat-high { color: #f39c12; }
                .stat-total { color: #3498db; }
                
                /* Signal Cards */
                .signals-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
                    gap: 25px;
                    margin-bottom: 30px;
                }
                .signal-card {
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(10px);
                    border-radius: 20px;
                    padding: 25px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                    transition: all 0.3s ease;
                    border-top: 4px solid;
                }
                .signal-card:hover {
                    transform: translateY(-8px);
                    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
                }
                .signal-card.buy { border-top-color: #27ae60; }
                .signal-card.sell { border-top-color: #e74c3c; }
                
                .signal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                }
                .signal-symbol {
                    font-size: 1.4em;
                    font-weight: 700;
                    color: #2c3e50;
                }
                .signal-type {
                    padding: 8px 16px;
                    border-radius: 20px;
                    font-size: 0.9em;
                    font-weight: 600;
                    text-transform: uppercase;
                }
                .signal-type.buy {
                    background: linear-gradient(135deg, #d4edda, #c3e6cb);
                    color: #155724;
                }
                .signal-type.sell {
                    background: linear-gradient(135deg, #f8d7da, #f1c2c7);
                    color: #721c24;
                }
                
                .signal-score {
                    text-align: center;
                    margin-bottom: 20px;
                }
                .score-value {
                    font-size: 3em;
                    font-weight: 700;
                    background: linear-gradient(135deg, #f39c12, #e67e22);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                }
                .score-label {
                    color: #7f8c8d;
                    font-size: 0.9em;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                
                .signal-details {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 15px;
                    margin-bottom: 20px;
                }
                .detail-item {
                    text-align: center;
                    padding: 15px;
                    background: rgba(248, 249, 250, 0.8);
                    border-radius: 10px;
                }
                .detail-label {
                    font-size: 0.8em;
                    color: #7f8c8d;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    margin-bottom: 5px;
                }
                .detail-value {
                    font-size: 1.1em;
                    font-weight: 600;
                    color: #2c3e50;
                }
                
                .signal-prices {
                    display: grid;
                    grid-template-columns: 1fr 1fr 1fr;
                    gap: 10px;
                    margin-bottom: 15px;
                }
                .price-item {
                    text-align: center;
                    padding: 10px;
                    border-radius: 8px;
                    font-size: 0.9em;
                }
                .price-item.poc {
                    background: rgba(52, 152, 219, 0.1);
                    color: #2980b9;
                    font-weight: 700;
                }
                .price-item.vah {
                    background: rgba(39, 174, 96, 0.1);
                    color: #27ae60;
                }
                .price-item.val {
                    background: rgba(231, 76, 60, 0.1);
                    color: #e74c3c;
                }
                
                /* Stop Loss Section */
                .stop-loss-section {
                    margin: 15px 0;
                    padding: 15px;
                    background: linear-gradient(135deg, rgba(231, 76, 60, 0.1), rgba(192, 57, 43, 0.05));
                    border-radius: 10px;
                    border-left: 4px solid #e74c3c;
                }
                .stop-loss-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 15px;
                }
                .stop-loss-item, .risk-item {
                    text-align: center;
                    padding: 12px;
                    background: rgba(255, 255, 255, 0.8);
                    border-radius: 8px;
                }
                .stop-loss-label, .risk-label {
                    font-size: 0.8em;
                    color: #e74c3c;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    margin-bottom: 5px;
                    font-weight: 600;
                }
                .stop-loss-price {
                    font-size: 1.1em;
                    font-weight: 700;
                    color: #c0392b;
                    font-family: 'Courier New', monospace;
                }
                .risk-percentage {
                    font-size: 1.2em;
                    font-weight: 700;
                    color: #e74c3c;
                    text-shadow: 0 1px 2px rgba(0,0,0,0.1);
                }
                
                .signal-time {
                    text-align: center;
                    color: #7f8c8d;
                    font-size: 0.9em;
                    border-top: 1px solid #ecf0f1;
                    padding-top: 15px;
                }
                
                /* Empty State */
                .empty-state {
                    text-align: center;
                    padding: 60px 20px;
                    background: rgba(255, 255, 255, 0.9);
                    backdrop-filter: blur(10px);
                    border-radius: 20px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                }
                .empty-state h3 {
                    color: #2c3e50;
                    font-size: 1.5em;
                    margin-bottom: 15px;
                }
                .empty-state p {
                    color: #7f8c8d;
                    margin-bottom: 25px;
                    line-height: 1.6;
                }
                
                /* Footer */
                .footer {
                    background: rgba(255, 255, 255, 0.9);
                    backdrop-filter: blur(10px);
                    border-radius: 15px;
                    padding: 25px;
                    text-align: center;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
                    margin-top: 30px;
                }
                .footer h4 {
                    color: #2c3e50;
                    margin-bottom: 15px;
                }
                .footer p {
                    color: #7f8c8d;
                    margin-bottom: 10px;
                }
                .tip-addresses {
                    display: flex;
                    justify-content: center;
                    gap: 30px;
                    margin-top: 15px;
                    flex-wrap: wrap;
                }
                .tip-item {
                    font-family: 'Courier New', monospace;
                    background: rgba(52, 152, 219, 0.1);
                    padding: 10px 15px;
                    border-radius: 8px;
                    font-size: 0.9em;
                }
                
                /* Checkbox Dropdown */
                .dropdown-container {
                    position: relative;
                }
                .dropdown-toggle {
                    width: 100%;
                    padding: 12px 16px;
                    border: 2px solid #e1e8ed;
                    border-radius: 10px;
                    background: white;
                    cursor: pointer;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 1em;
                    transition: all 0.3s ease;
                }
                .dropdown-toggle:hover, .dropdown-toggle.active {
                    border-color: #3498db;
                    box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
                }
                .dropdown-arrow {
                    transition: transform 0.3s ease;
                }
                .dropdown-toggle.active .dropdown-arrow {
                    transform: rotate(180deg);
                }
                .dropdown-menu {
                    position: absolute;
                    top: 100%;
                    left: 0;
                    right: 0;
                    background: white;
                    border: 2px solid #e1e8ed;
                    border-radius: 10px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
                    z-index: 1000;
                    display: none;
                    margin-top: 5px;
                }
                .dropdown-menu.show {
                    display: block;
                }
                .dropdown-header {
                    padding: 10px 15px;
                    border-bottom: 1px solid #ecf0f1;
                    display: flex;
                    gap: 10px;
                }
                .btn-small {
                    padding: 5px 12px;
                    font-size: 0.8em;
                    border: 1px solid #bdc3c7;
                    border-radius: 5px;
                    background: #f8f9fa;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .btn-small:hover {
                    background: #e9ecef;
                    border-color: #95a5a6;
                }
                .checkbox-list {
                    max-height: 200px;
                    overflow-y: auto;
                    padding: 10px;
                }
                .checkbox-item {
                    display: flex;
                    align-items: center;
                    padding: 8px 12px;
                    cursor: pointer;
                    border-radius: 5px;
                    transition: background-color 0.2s ease;
                }
                .checkbox-item:hover {
                    background-color: #f8f9fa;
                }
                .checkbox-item input[type="checkbox"] {
                    display: none;
                }
                .checkmark {
                    width: 18px;
                    height: 18px;
                    border: 2px solid #bdc3c7;
                    border-radius: 3px;
                    margin-right: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                }
                .checkbox-item input[type="checkbox"]:checked + .checkmark {
                    background-color: #3498db;
                    border-color: #3498db;
                }
                .checkbox-item input[type="checkbox"]:checked + .checkmark::after {
                    content: '✓';
                    color: white;
                    font-size: 12px;
                    font-weight: bold;
                }
                
                /* Delete Signal Button */
                .delete-signal-btn {
                    background: none;
                    border: none;
                    font-size: 1.2em;
                    cursor: pointer;
                    padding: 5px 8px;
                    border-radius: 6px;
                    transition: all 0.2s ease;
                    opacity: 0.6;
                }
                .delete-signal-btn:hover {
                    background: rgba(231, 76, 60, 0.1);
                    opacity: 1;
                    transform: scale(1.1);
                }
                .delete-signal-btn:active {
                    transform: scale(0.95);
                }
                
                /* Notification System */
                .notification-btn {
                    background: linear-gradient(135deg, #3498db, #2980b9);
                    color: white;
                    border: none;
                    padding: 8px 12px;
                    border-radius: 50%;
                    font-size: 1.2em;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    position: relative;
                }
                .notification-btn:hover {
                    background: linear-gradient(135deg, #2980b9, #1f3a93);
                    transform: scale(1.1);
                }
                .notification-btn.active {
                    background: linear-gradient(135deg, #e74c3c, #c0392b);
                }
                
                .notification-panel {
                    margin-top: 20px;
                    background: linear-gradient(135deg, #f8f9fa, #e9ecef);
                    border-radius: 15px;
                    padding: 20px;
                    border-left: 4px solid #3498db;
                    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                }
                .notification-panel h4 {
                    color: #2c3e50;
                    margin-bottom: 15px;
                    font-size: 1.2em;
                }
                .notification-controls {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 15px;
                }
                .control-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px;
                    background: rgba(255, 255, 255, 0.8);
                    border-radius: 8px;
                }
                
                /* Toggle Switch */
                .switch {
                    position: relative;
                    display: inline-block;
                    width: 50px;
                    height: 24px;
                }
                .switch input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }
                .slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: #ccc;
                    transition: 0.4s;
                    border-radius: 24px;
                }
                .slider:before {
                    position: absolute;
                    content: "";
                    height: 18px;
                    width: 18px;
                    left: 3px;
                    bottom: 3px;
                    background-color: white;
                    transition: 0.4s;
                    border-radius: 50%;
                }
                input:checked + .slider {
                    background-color: #3498db;
                }
                input:checked + .slider:before {
                    transform: translateX(26px);
                }
                
                /* New Signal Indicators */
                .signal-card.new-signal {
                    animation: pulse 2s infinite;
                    border-left: 4px solid #e74c3c !important;
                }
                .signal-card.new-signal::before {
                    content: 'NEW';
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: #e74c3c;
                    color: white;
                    padding: 4px 8px;
                    border-radius: 12px;
                    font-size: 0.7em;
                    font-weight: 600;
                    z-index: 10;
                }
                
                @keyframes pulse {
                    0% { box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1); }
                    50% { box-shadow: 0 8px 32px rgba(231, 76, 60, 0.3); }
                    100% { box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1); }
                }
                
                #newSignalsCount {
                    animation: bounce 1s infinite;
                }
                
                @keyframes bounce {
                    0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
                    40% { transform: translateY(-10px); }
                    60% { transform: translateY(-5px); }
                }
                
                /* Responsive */
                @media (max-width: 768px) {
                    .container { padding: 15px; }
                    .header h1 { font-size: 2em; }
                    .signals-grid { grid-template-columns: 1fr; }
                    .controls-grid { grid-template-columns: 1fr; }
                    .tip-addresses { flex-direction: column; gap: 15px; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <!-- Header -->
                <div class="header">
                    <h1>
                        🚀 Trading Signals Dashboard
                        <span style="font-size: 0.3em; margin-left: auto; display: flex; align-items: center; gap: 15px;">
                            <span id="newSignalsCount" style="color: #e74c3c; font-weight: 600; display: none; cursor: pointer;" onclick="scrollToFirstNewSignal()">
                                🔥 0 NEW SIGNALS
                            </span>
                            <button id="notificationToggle" class="notification-btn" title="Notification Settings">
                                🔔
                            </button>
                            <span id="lastUpdate" style="color: #7f8c8d;">Loading...</span>
                        </span>
                    </h1>
                    <p>Real-time volume profile trading signals with advanced scoring</p>
                    
                    <!-- Notification Settings Panel -->
                    <div id="notificationPanel" class="notification-panel" style="display: none;">
                        <h4>🔔 Notification Settings</h4>
                        <div class="notification-controls">
                            <div class="control-row">
                                <label class="switch">
                                    <input type="checkbox" id="enableNotifications" checked>
                                    <span class="slider"></span>
                                </label>
                                <span>Browser Notifications</span>
                            </div>
                            <div class="control-row">
                                <label class="switch">
                                    <input type="checkbox" id="enableSounds" checked>
                                    <span class="slider"></span>
                                </label>
                                <span>Sound Alerts</span>
                            </div>
                            <div class="control-row">
                                <label for="notificationSound">Alert Sound:</label>
                                <select id="notificationSound">
                                    <option value="ding">🔔 Ding</option>
                                    <option value="chime">🎵 Chime</option>
                                    <option value="alert">⚠️ Alert</option>
                                    <option value="success">✅ Success</option>
                                </select>
                            </div>
                            <div class="control-row">
                                <label for="volumeSlider">Volume:</label>
                                <input type="range" id="volumeSlider" min="0" max="100" value="70">
                                <span id="volumeValue">70%</span>
                            </div>
                            <div class="control-row">
                                <label class="switch">
                                    <input type="checkbox" id="onlyHighScore">
                                    <span class="slider"></span>
                                </label>
                                <span>Only High Score (8+) Signals</span>
                            </div>
                            <div class="control-row">
                                <button id="testNotification" class="btn btn-primary">🔊 Test Notification</button>
                            </div>
                        </div>
                    </div>
                    
                    ${!viewData.hasSymbols ? `
                        <div style="background: linear-gradient(135deg, #fff3cd, #ffeaa7); padding: 20px; border-radius: 10px; border-left: 4px solid #f39c12;">
                            <h4 style="color: #856404; margin-bottom: 10px;">📋 Get Started</h4>
                            <p style="color: #856404; margin-bottom: 15px;">Select symbols to track before viewing signals</p>
                            <a href="/symbols" class="btn btn-primary">Choose Symbols</a>
                        </div>
                    ` : ''}
                </div>
                
                ${viewData.hasSymbols ? `
                    <!-- Controls -->
                    <div class="controls">
                        <form id="signalsForm" class="controls-grid">
                            <div class="control-group">
                                <label for="symbol">Symbol</label>
                                <select name="symbol" id="symbol">
                                    <option value="all" ${viewData.currentSymbol === 'all' ? 'selected' : ''}>All Symbols</option>
                                    ${viewData.selectedSymbols.map(s => 
                                        `<option value="${s}" ${s === viewData.currentSymbol ? 'selected' : ''}>${s}</option>`
                                    ).join('')}
                                </select>
                            </div>
                            
                            <div class="control-group">
                                <label for="timeframes">Timeframes</label>
                                <div class="dropdown-container">
                                    <button type="button" class="dropdown-toggle" id="timeframeDropdown">
                                        <span id="selectedCount">${viewData.currentIntervals.length}</span> selected
                                        <span class="dropdown-arrow">▼</span>
                                    </button>
                                    <div class="dropdown-menu" id="timeframeMenu">
                                        <div class="dropdown-header">
                                            <button type="button" class="btn-small" id="selectAll">All</button>
                                            <button type="button" class="btn-small" id="selectNone">None</button>
                                            <button type="button" class="btn-small" id="select3mPlus">3m+</button>
                                        </div>
                                        <div class="checkbox-list">
                                            ${viewData.allTimeframes.map(tf => `
                                                <label class="checkbox-item">
                                                    <input type="checkbox" name="intervals" value="${tf}" 
                                                           ${viewData.currentIntervals.includes(tf) ? 'checked' : ''}>
                                                    <span class="checkmark"></span>
                                                    ${tf}
                                                </label>
                                            `).join('')}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="control-group">
                                <label for="minScore">Min Score</label>
                                <input type="number" name="minScore" id="minScore" min="0" max="10" step="0.1" 
                                       value="${viewData.currentMinScore}" placeholder="0.0">
                            </div>
                            
                            <div class="control-group">
                                <label for="sortBy">Sort By</label>
                                <select name="sortBy" id="sortBy">
                                    <option value="closeTime" ${viewData.currentSortBy === 'closeTime' ? 'selected' : ''}>Newest First</option>
                                    <option value="score" ${viewData.currentSortBy === 'score' ? 'selected' : ''}>Best Score</option>
                                    <option value="symbol" ${viewData.currentSortBy === 'symbol' ? 'selected' : ''}>Symbol</option>
                                </select>
                            </div>
                            
                            <div class="control-group">
                                <button type="button" id="refreshBtn" class="btn btn-success">
                                    🔄 Refresh Data
                                </button>
                            </div>
                            
                            <div class="control-group">
                                <a href="/symbols" class="btn btn-primary">
                                    ⚙️ Manage Symbols
                                </a>
                            </div>
                            
                            <div class="control-group">
                                <button type="button" id="resetSymbolsBtn" class="btn btn-danger">
                                    ⚠️ Reset System
                                </button>
                            </div>
                        </form>
                    </div>
                    
                    ${viewData.statistics ? `
                        <!-- Statistics -->
                        <div class="stats">
                            <div class="stat-card">
                                <div class="stat-value stat-total">${viewData.statistics.totalSignals}</div>
                                <div class="stat-label">Total Signals</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value stat-buy">${viewData.statistics.buySignals}</div>
                                <div class="stat-label">Buy Signals</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value stat-sell">${viewData.statistics.sellSignals}</div>
                                <div class="stat-label">Sell Signals</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value stat-high">${viewData.statistics.highScoreSignals}</div>
                                <div class="stat-label">High Score (8+)</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value">${viewData.statistics.avgScore}</div>
                                <div class="stat-label">Average Score</div>
                            </div>
                        </div>
                    ` : ''}
                ` : ''}
                
                ${viewData.error ? `
                    <div style="background: linear-gradient(135deg, #f8d7da, #f1c2c7); padding: 20px; border-radius: 10px; border-left: 4px solid #e74c3c; margin-bottom: 30px;">
                        <h4 style="color: #721c24;">❌ Error</h4>
                        <p style="color: #721c24;">${viewData.error}</p>
                    </div>
                ` : ''}
                
                <!-- Signals Grid -->
                ${viewData.signals.length > 0 ? `
                    <div class="signals-grid">
                        ${viewData.signals.map(signal => `
                            <div class="signal-card ${signal.tradeSignal.signalType}" data-signal-id="${signal._id}">
                                <div class="signal-header">
                                    <div class="signal-symbol">${signal.symbol}</div>
                                    <div style="display: flex; align-items: center; gap: 10px;">
                                        <div class="signal-type ${signal.tradeSignal.signalType}">
                                            ${signal.tradeSignal.signalType === 'buy' ? '📈 BUY' : '📉 SELL'}
                                        </div>
                                        <button class="delete-signal-btn" onclick="deleteSignal('${signal._id}')" title="Delete this signal">
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                                
                                <div class="signal-score">
                                    <div class="score-value">${signal.tradeSignal.score}</div>
                                    <div class="score-label">Signal Score</div>
                                </div>
                                
                                <div class="signal-details">
                                    <div class="detail-item">
                                        <div class="detail-label">Timeframe</div>
                                        <div class="detail-value">${signal.interval}</div>
                                    </div>
                                    <div class="detail-item">
                                        <div class="detail-label">Volume</div>
                                        <div class="detail-value">${signal.volumeFootprint.totalVolume.toLocaleString()}</div>
                                    </div>
                                </div>
                                
                                <div class="signal-prices">
                                    <div class="price-item poc">
                                        <div style="font-size: 0.8em; margin-bottom: 3px;">POC</div>
                                        <div>${signal.volumeFootprint.poc}</div>
                                    </div>
                                    <div class="price-item vah">
                                        <div style="font-size: 0.8em; margin-bottom: 3px;">VAH</div>
                                        <div>${signal.volumeFootprint.vah}</div>
                                    </div>
                                    <div class="price-item val">
                                        <div style="font-size: 0.8em; margin-bottom: 3px;">VAL</div>
                                        <div>${signal.volumeFootprint.val}</div>
                                    </div>
                                </div>
                                
                                ${(() => {
                                    const stopLoss = calculateStopLoss(signal);
                                    return `
                                        <div class="stop-loss-section">
                                            <div class="stop-loss-grid">
                                                <div class="stop-loss-item">
                                                    <div class="stop-loss-label">Stop Loss</div>
                                                    <div class="stop-loss-price">${stopLoss.formattedStopLoss}</div>
                                                </div>
                                                <div class="risk-item">
                                                    <div class="risk-label">Risk</div>
                                                    <div class="risk-percentage">${stopLoss.formattedRiskPercentage}</div>
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                })()}
                                
                                <div class="signal-time">
                                    <div style="margin-bottom: 5px;">
                                        📅 Opened: ${new Date(signal.openTime).toLocaleString()}
                                    </div>
                                    <div>
                                        🏁 Closed: ${new Date(signal.closeTime).toLocaleString()}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : (viewData.hasSymbols ? `
                    <div class="empty-state">
                        <h3>🔍 No Valid Signals Found</h3>
                        <p>Try adjusting your filters or wait for new signals to be generated.<br>
                        Signals are updated automatically every minute.</p>
                        <button id="refreshBtn2" class="btn btn-primary">🔄 Refresh Now</button>
                    </div>
                ` : '')}
                
                <!-- Footer -->
                <div class="footer">
                    <h4>💰 Support HiMonacci</h4>
                    <p>Wishing all traders successful trades! 🚀</p>
                    <p>If this tool helps you profit, consider leaving a tip:</p>
                    <div class="tip-addresses">
                        <div class="tip-item">
                            <strong>USDT (TRC20):</strong><br>
                            TNGCEh1LdUDQ4sQwqA93q8fV7fvRGzemt7
                        </div>
                        <div class="tip-item">
                            <strong>Binance ID:</strong><br>
                            1022104942
                        </div>
                    </div>
                </div>
            </div>
            
            <script>
                // Auto-refresh every 1 minute
                let autoRefreshInterval;
                
                function updateLastUpdateTime() {
                    document.getElementById('lastUpdate').textContent = 
                        'Last updated: ' + new Date().toLocaleTimeString();
                }
                
                function refreshData() {
                    location.reload();
                }
                
                function startAutoRefresh() {
                    updateLastUpdateTime();
                    autoRefreshInterval = setInterval(() => {
                        refreshData();
                    }, 60000); // 1 minute
                }
                
                // Event listeners
                document.getElementById('refreshBtn').addEventListener('click', refreshData);
                ${viewData.hasSymbols && viewData.signals.length === 0 ? `
                    document.getElementById('refreshBtn2').addEventListener('click', refreshData);
                ` : ''}
                
                // Checkbox dropdown functionality
                const dropdown = document.getElementById('timeframeDropdown');
                const menu = document.getElementById('timeframeMenu');
                const selectedCount = document.getElementById('selectedCount');
                const checkboxes = document.querySelectorAll('input[name="intervals"]');
                
                function updateSelectedCount() {
                    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
                    selectedCount.textContent = checkedCount;
                }
                
                function submitForm() {
                    const form = document.getElementById('signalsForm');
                    const formData = new FormData(form);
                    const params = new URLSearchParams();
                    
                    // Handle regular form fields
                    ['symbol', 'minScore', 'sortBy'].forEach(key => {
                        const value = formData.get(key);
                        if (value) params.set(key, value);
                    });
                    
                    // Handle intervals array
                    const selectedIntervals = Array.from(checkboxes)
                        .filter(cb => cb.checked)
                        .map(cb => cb.value);
                    selectedIntervals.forEach(interval => {
                        params.append('intervals', interval);
                    });
                    
                    window.location.search = params.toString();
                }
                
                // Dropdown toggle
                dropdown.addEventListener('click', function(e) {
                    e.preventDefault();
                    dropdown.classList.toggle('active');
                    menu.classList.toggle('show');
                });
                
                // Close dropdown when clicking outside
                document.addEventListener('click', function(e) {
                    if (!dropdown.contains(e.target) && !menu.contains(e.target)) {
                        dropdown.classList.remove('active');
                        menu.classList.remove('show');
                    }
                });
                
                // Checkbox change handlers
                checkboxes.forEach(checkbox => {
                    checkbox.addEventListener('change', function() {
                        updateSelectedCount();
                        submitForm();
                    });
                });
                
                // Quick action buttons
                document.getElementById('selectAll').addEventListener('click', function() {
                    checkboxes.forEach(cb => cb.checked = true);
                    updateSelectedCount();
                    submitForm();
                });
                
                document.getElementById('selectNone').addEventListener('click', function() {
                    checkboxes.forEach(cb => cb.checked = false);
                    updateSelectedCount();
                    submitForm();
                });
                
                document.getElementById('select3mPlus').addEventListener('click', function() {
                    const timeframes3mPlus = ['3m', '4m', '5m', '6m', '7m', '8m', '9m', '10m', '11m', '12m', '13m', '14m', '15m', '16m', '17m', '18m', '19m', '20m'];
                    checkboxes.forEach(cb => {
                        cb.checked = timeframes3mPlus.includes(cb.value);
                    });
                    updateSelectedCount();
                    submitForm();
                });
                
                // Complete system reset functionality
                document.getElementById('resetSymbolsBtn').addEventListener('click', function() {
                    if (confirm('⚠️ COMPLETE SYSTEM RESET\\n\\nThis will permanently delete ALL data including:\\n• Selected symbols\\n• Candle data\\n• Trading signals\\n• Volume footprints\\n• All historical data\\n\\nThe system will start completely fresh like a new installation.\\n\\nThis action cannot be undone!\\n\\nAre you sure you want to continue?')) {
                        // Show loading state
                        this.textContent = 'Resetting System...';
                        this.disabled = true;
                        
                        // Send complete system reset request
                        fetch('/system/reset', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                alert('✅ ' + data.message + '\\n\\nSystem has been completely reset!\\n\\nRedirecting to symbol selection to start fresh...');
                                window.location.href = '/symbols';
                            } else {
                                alert('❌ ' + data.message);
                                // Reset button state
                                this.textContent = '🔄 Reset System';
                                this.disabled = false;
                            }
                        })
                        .catch(error => {
                            console.error('Error resetting system:', error);
                            alert('❌ Error resetting system: ' + error.message);
                            // Reset button state
                            this.textContent = '🔄 Reset System';
                            this.disabled = false;
                        });
                    }
                });
                
                // Auto-submit form when other filters change
                ['symbol', 'minScore', 'sortBy'].forEach(id => {
                    const element = document.getElementById(id);
                    if (element) {
                        element.addEventListener('change', submitForm);
                    }
                });
                
                // Signal deletion function
                function deleteSignal(signalId) {
                    if (confirm('🗑️ Delete Signal\\n\\nAre you sure you want to delete this signal?\\n\\nThis action cannot be undone.')) {
                        // Find the signal card
                        const signalCard = document.querySelector('[data-signal-id="' + signalId + '"]');
                        if (signalCard) {
                            // Add loading state
                            signalCard.style.opacity = '0.5';
                            signalCard.style.pointerEvents = 'none';
                        }
                        
                        // Send delete request
                        fetch('/api/signals/' + signalId, {
                            method: 'DELETE',
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                // Remove the signal card with animation
                                if (signalCard) {
                                    signalCard.style.transform = 'scale(0.8)';
                                    signalCard.style.transition = 'all 0.3s ease';
                                    setTimeout(() => {
                                        signalCard.remove();
                                        // Check if no signals left
                                        const remainingSignals = document.querySelectorAll('.signal-card').length;
                                        if (remainingSignals === 0) {
                                            location.reload(); // Refresh to show empty state
                                        }
                                    }, 300);
                                }
                                
                                // Show success message briefly
                                const successMsg = document.createElement('div');
                                successMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #27ae60; color: white; padding: 15px 20px; border-radius: 10px; z-index: 10000; box-shadow: 0 4px 15px rgba(0,0,0,0.2);';
                                successMsg.textContent = '✅ Signal deleted successfully';
                                document.body.appendChild(successMsg);
                                setTimeout(() => successMsg.remove(), 3000);
                                
                            } else {
                                // Restore signal card
                                if (signalCard) {
                                    signalCard.style.opacity = '1';
                                    signalCard.style.pointerEvents = 'auto';
                                }
                                alert('❌ Failed to delete signal: ' + data.message);
                            }
                        })
                        .catch(error => {
                            // Restore signal card
                            if (signalCard) {
                                signalCard.style.opacity = '1';
                                signalCard.style.pointerEvents = 'auto';
                            }
                            console.error('Error deleting signal:', error);
                            alert('❌ Error deleting signal: ' + error.message);
                        });
                    }
                }
                
                // Make deleteSignal function available globally
                window.deleteSignal = deleteSignal;
                
                // ===========================================
                // NOTIFICATION SYSTEM - ENHANCED WITH DEBUGGING
                // ===========================================
                
                console.log('🔔 Initializing notification system...');
                
                // Notification system variables
                let lastSeenSignals = JSON.parse(localStorage.getItem('lastSeenSignals') || '[]');
                let notificationSettings = JSON.parse(localStorage.getItem('notificationSettings') || JSON.stringify({
                    enableNotifications: true,
                    enableSounds: true,
                    notificationSound: 'ding',
                    volume: 70,
                    onlyHighScore: false
                }));
                let audioContext = null;
                let audioContextInitialized = false;
                let lastNotificationTime = 0;
                const NOTIFICATION_COOLDOWN = 5000; // 5 seconds between notifications
                
                console.log('🔔 Loaded settings:', notificationSettings);
                console.log('🔔 Last seen signals:', lastSeenSignals.length);
                
                // Initialize notification system
                function initializeNotificationSystem() {
                    // Load settings from localStorage
                    loadNotificationSettings();
                    
                    // Set up event listeners
                    setupNotificationEventListeners();
                    
                    // Request browser notification permission
                    requestNotificationPermission();
                    
                    // Initialize audio context
                    initializeAudioContext();
                    
                    // Store current signals as seen
                    storeCurrentSignalsAsSeen();
                }
                
                // Load notification settings from localStorage
                function loadNotificationSettings() {
                    document.getElementById('enableNotifications').checked = notificationSettings.enableNotifications;
                    document.getElementById('enableSounds').checked = notificationSettings.enableSounds;
                    document.getElementById('notificationSound').value = notificationSettings.notificationSound;
                    document.getElementById('volumeSlider').value = notificationSettings.volume;
                    document.getElementById('volumeValue').textContent = notificationSettings.volume + '%';
                    document.getElementById('onlyHighScore').checked = notificationSettings.onlyHighScore;
                }
                
                // Save notification settings to localStorage
                function saveNotificationSettings() {
                    notificationSettings = {
                        enableNotifications: document.getElementById('enableNotifications').checked,
                        enableSounds: document.getElementById('enableSounds').checked,
                        notificationSound: document.getElementById('notificationSound').value,
                        volume: parseInt(document.getElementById('volumeSlider').value),
                        onlyHighScore: document.getElementById('onlyHighScore').checked
                    };
                    localStorage.setItem('notificationSettings', JSON.stringify(notificationSettings));
                }
                
                // Set up notification event listeners
                function setupNotificationEventListeners() {
                    // Notification panel toggle
                    document.getElementById('notificationToggle').addEventListener('click', function() {
                        const panel = document.getElementById('notificationPanel');
                        const button = document.getElementById('notificationToggle');
                        
                        if (panel.style.display === 'none') {
                            panel.style.display = 'block';
                            button.classList.add('active');
                        } else {
                            panel.style.display = 'none';
                            button.classList.remove('active');
                        }
                    });
                    
                    // Settings change listeners
                    ['enableNotifications', 'enableSounds', 'onlyHighScore'].forEach(id => {
                        document.getElementById(id).addEventListener('change', saveNotificationSettings);
                    });
                    
                    document.getElementById('notificationSound').addEventListener('change', saveNotificationSettings);
                    
                    // Volume slider
                    document.getElementById('volumeSlider').addEventListener('input', function() {
                        const volume = this.value;
                        document.getElementById('volumeValue').textContent = volume + '%';
                        saveNotificationSettings();
                    });
                    
                    // Test notification button
                    document.getElementById('testNotification').addEventListener('click', function() {
                        const testSignal = {
                            symbol: 'BTCUSDT',
                            tradeSignal: { signalType: 'buy', score: 8.5 },
                            interval: '5m',
                            volumeFootprint: { totalVolume: 1234567 }
                        };
                        showNotificationForSignal(testSignal, true);
                    });
                }
                
                // Request browser notification permission
                function requestNotificationPermission() {
                    if ('Notification' in window && Notification.permission === 'default') {
                        Notification.requestPermission().then(permission => {
                            if (permission === 'granted') {
                                console.log('🔔 Notification permission granted');
                            } else {
                                console.log('🔕 Notification permission denied');
                            }
                        });
                    }
                }
                
                // Initialize audio context for sound alerts - WITH DEBUGGING
                function initializeAudioContext() {
                    console.log('🔊 Initializing audio context...');
                    try {
                        // Don't create audio context immediately - wait for user interaction
                        console.log('🔊 Audio context will be initialized on first user interaction');
                    } catch (error) {
                        console.error('🔊 Audio context initialization failed:', error);
                    }
                }
                
                // Create audio context on user interaction (fixes autoplay policy)
                function ensureAudioContext() {
                    if (!audioContext && !audioContextInitialized) {
                        try {
                            audioContext = new (window.AudioContext || window.webkitAudioContext)();
                            audioContextInitialized = true;
                            console.log('🔊 Audio context created successfully');
                            
                            // Resume context if suspended
                            if (audioContext.state === 'suspended') {
                                audioContext.resume().then(() => {
                                    console.log('🔊 Audio context resumed');
                                }).catch(error => {
                                    console.error('🔊 Failed to resume audio context:', error);
                                });
                            }
                        } catch (error) {
                            console.error('🔊 Failed to create audio context:', error);
                            audioContext = null;
                        }
                    }
                    return audioContext;
                }
                
                // Generate notification sound - WITH ENHANCED ERROR HANDLING
                function playNotificationSound(soundType = 'ding') {
                    console.log('🔊 Attempting to play notification sound:', soundType);
                    
                    if (!notificationSettings.enableSounds) {
                        console.log('🔊 Sound alerts disabled in settings');
                        return;
                    }
                    
                    // Ensure audio context is created
                    const ctx = ensureAudioContext();
                    if (!ctx) {
                        console.error('🔊 No audio context available');
                        return;
                    }
                    
                    const volume = notificationSettings.volume / 100;
                    console.log('🔊 Playing sound with volume:', volume);
                    
                    try {
                        // Different sound patterns
                        const sounds = {
                            ding: [800, 0.1, 600, 0.1],
                            chime: [523, 0.15, 659, 0.15, 784, 0.2],
                            alert: [1000, 0.1, 800, 0.1, 1200, 0.15],
                            success: [523, 0.1, 659, 0.1, 784, 0.1, 1047, 0.2]
                        };
                        
                        const pattern = sounds[soundType] || sounds.ding;
                        let time = ctx.currentTime;
                        
                        for (let i = 0; i < pattern.length; i += 2) {
                            const freq = pattern[i];
                            const duration = pattern[i + 1];
                            
                            const osc = ctx.createOscillator();
                            const gain = ctx.createGain();
                            
                            osc.connect(gain);
                            gain.connect(ctx.destination);
                            
                            osc.frequency.value = freq;
                            osc.type = 'sine';
                            
                            gain.gain.setValueAtTime(0, time);
                            gain.gain.linearRampToValueAtTime(volume * 0.3, time + 0.01);
                            gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
                            
                            osc.start(time);
                            osc.stop(time + duration);
                            
                            time += duration + 0.05;
                        }
                        console.log('🔊 Sound played successfully');
                    } catch (error) {
                        console.error('🔊 Error playing sound:', error);
                    }
                }
                
                // Show browser notification for new signal
                function showBrowserNotification(signal, isTest = false) {
                    if (!notificationSettings.enableNotifications && !isTest) return;
                    if (Notification.permission !== 'granted') return;
                    
                    const title = isTest ? '🔊 Test Notification' : '🚀 New Trading Signal!';
                    const stopLoss = calculateStopLoss(signal);
                    
                    const body = isTest ? 
                        'This is a test notification. Your alerts are working!' :
                        \`\${signal.symbol} - \${signal.tradeSignal.signalType.toUpperCase()} Signal
Score: \${signal.tradeSignal.score} | Risk: \${stopLoss.formattedRiskPercentage}
\${signal.interval} timeframe\`;
                    
                    const notification = new Notification(title, {
                        body: body,
                        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🚀</text></svg>',
                        tag: isTest ? 'test' : \`signal-\${signal._id}\`,
                        requireInteraction: false
                    });
                    
                    // Auto-close after 10 seconds
                    setTimeout(() => notification.close(), 10000);
                    
                    // Click handler to focus window and scroll to signal
                    notification.onclick = function() {
                        window.focus();
                        if (!isTest) {
                            const signalCard = document.querySelector(\`[data-signal-id="\${signal._id}"]\`);
                            if (signalCard) {
                                signalCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }
                        notification.close();
                    };
                }
                
                // Show notification for signal (combines browser + sound)
                function showNotificationForSignal(signal, isTest = false) {
                    const now = Date.now();
                    
                    // Rate limiting (except for tests)
                    if (!isTest && now - lastNotificationTime < NOTIFICATION_COOLDOWN) {
                        return;
                    }
                    
                    // Check high score filter
                    if (!isTest && notificationSettings.onlyHighScore && signal.tradeSignal.score < 8) {
                        return;
                    }
                    
                    // Show browser notification
                    showBrowserNotification(signal, isTest);
                    
                    // Play sound
                    playNotificationSound(notificationSettings.notificationSound);
                    
                    lastNotificationTime = now;
                }
                
                // Store current signals as seen
                function storeCurrentSignalsAsSeen() {
                    const currentSignals = Array.from(document.querySelectorAll('.signal-card')).map(card => {
                        return card.getAttribute('data-signal-id');
                    }).filter(id => id);
                    
                    lastSeenSignals = currentSignals;
                    localStorage.setItem('lastSeenSignals', JSON.stringify(lastSeenSignals));
                }
                
                // Check for new signals and show notifications
                function checkForNewSignals() {
                    const currentSignals = Array.from(document.querySelectorAll('.signal-card'));
                    const currentSignalIds = currentSignals.map(card => card.getAttribute('data-signal-id')).filter(id => id);
                    
                    // Find new signals
                    const newSignalIds = currentSignalIds.filter(id => !lastSeenSignals.includes(id));
                    
                    if (newSignalIds.length > 0) {
                        console.log(\`🔥 Found \${newSignalIds.length} new signals:\`, newSignalIds);
                        
                        // Add visual indicators and show notifications
                        newSignalIds.forEach(signalId => {
                            const signalCard = document.querySelector(\`[data-signal-id="\${signalId}"]\`);
                            if (signalCard) {
                                // Add new signal class for animation
                                signalCard.classList.add('new-signal');
                                
                                // Extract signal data for notification
                                try {
                                    const symbolElement = signalCard.querySelector('.signal-symbol');
                                    const typeElement = signalCard.querySelector('.signal-type');
                                    const scoreElement = signalCard.querySelector('.score-value');
                                    const intervalElement = signalCard.querySelector('.detail-value');
                                    
                                    if (symbolElement && typeElement && scoreElement) {
                                        const signal = {
                                            _id: signalId,
                                            symbol: symbolElement.textContent,
                                            tradeSignal: {
                                                signalType: typeElement.textContent.includes('BUY') ? 'buy' : 'sell',
                                                score: parseFloat(scoreElement.textContent)
                                            },
                                            interval: intervalElement ? intervalElement.textContent : '5m',
                                            volumeFootprint: { totalVolume: 1000000 }
                                        };
                                        
                                        // Show notification
                                        showNotificationForSignal(signal);
                                    }
                                } catch (error) {
                                    console.log('Error extracting signal data:', error);
                                }
                            }
                        });
                        
                        // Update new signals counter
                        updateNewSignalsCounter(newSignalIds.length);
                        
                        // Auto-scroll to first new signal
                        setTimeout(() => {
                            const firstNewSignal = document.querySelector('.signal-card.new-signal');
                            if (firstNewSignal) {
                                firstNewSignal.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }, 1000);
                    }
                    
                    // Update seen signals
                    lastSeenSignals = currentSignalIds;
                    localStorage.setItem('lastSeenSignals', JSON.stringify(lastSeenSignals));
                }
                
                // Update new signals counter
                function updateNewSignalsCounter(count) {
                    const counter = document.getElementById('newSignalsCount');
                    if (count > 0) {
                        counter.textContent = \`🔥 \${count} NEW SIGNAL\${count > 1 ? 'S' : ''}\`;
                        counter.style.display = 'inline';
                    } else {
                        counter.style.display = 'none';
                    }
                }
                
                // Scroll to first new signal
                function scrollToFirstNewSignal() {
                    const firstNewSignal = document.querySelector('.signal-card.new-signal');
                    if (firstNewSignal) {
                        firstNewSignal.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        
                        // Remove new signal indicators after viewing
                        setTimeout(() => {
                            document.querySelectorAll('.signal-card.new-signal').forEach(card => {
                                card.classList.remove('new-signal');
                            });
                            updateNewSignalsCounter(0);
                        }, 2000);
                    }
                }
                
                // Make functions available globally
                window.scrollToFirstNewSignal = scrollToFirstNewSignal;
                window.calculateStopLoss = function(signal) {
                    // Simple mock calculation for notifications
                    return {
                        formattedRiskPercentage: '2.5%'
                    };
                };
                
                // Enhanced refresh function to check for new signals
                const originalRefreshData = refreshData;
                refreshData = function() {
                    // Store current signals before refresh
                    storeCurrentSignalsAsSeen();
                    originalRefreshData();
                };
                
                // Override auto-refresh to include notification check
                function startAutoRefreshWithNotifications() {
                    updateLastUpdateTime();
                    
                    // Check for new signals on initial load
                    setTimeout(checkForNewSignals, 1000);
                    
                    autoRefreshInterval = setInterval(() => {
                        // Store current signals before refresh
                        storeCurrentSignalsAsSeen();
                        
                        // Add a flag to indicate this is an auto-refresh
                        sessionStorage.setItem('autoRefresh', 'true');
                        
                        refreshData();
                    }, 60000); // 1 minute
                }
                
                // Check if this page load was from auto-refresh
                if (sessionStorage.getItem('autoRefresh') === 'true') {
                    sessionStorage.removeItem('autoRefresh');
                    // Check for new signals after page loads
                    setTimeout(checkForNewSignals, 500);
                }
                
                // Initialize notification system
                initializeNotificationSystem();
                
                // Initialize
                updateSelectedCount();
                
                // Start auto-refresh with notifications
                startAutoRefreshWithNotifications();
            </script>
        </body>
        </html>
    `;
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
