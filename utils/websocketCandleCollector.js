/**
 * WebSocket Candlestick Data Collector for Real-time 1-minute OHLC Data
 * Connects to Binance Futures WebSocket kline streams to get closed 1-minute candles
 * Uses the 'x' flag to detect when candles are finalized/closed
 */

const WebSocket = require('ws');

class WebSocketCandleCollector {
    constructor(options = {}) {
        this.baseUrl = 'wss://fstream.binance.com/ws/';
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
        this.reconnectDelay = options.reconnectDelay || 5000;
        
        // Track subscribed symbols
        this.subscribedSymbols = new Set();
        
        // Track last received candle timestamps per symbol (for gap detection)
        this.lastCandleTimestamps = new Map();
        this.disconnectionTime = null;
        this.reconnectionTime = null;
        
        // Event callbacks
        this.onClosedCandleCallback = options.onClosedCandle || null;
        this.onErrorCallback = options.onError || null;
        this.onConnectCallback = options.onConnect || null;
        this.onDisconnectCallback = options.onDisconnect || null;
        this.onGapDetectedCallback = options.onGapDetected || null;
        
        // Heartbeat
        this.heartbeatInterval = null;
        this.heartbeatTimeout = options.heartbeatTimeout || 30000;
        
        // Statistics
        this.stats = {
            connectedAt: null,
            candlesReceived: 0,
            closedCandlesProcessed: 0,
            lastCandleTime: null,
            errors: 0,
            gapsDetected: 0,
            gapsRecovered: 0
        };
        
        console.log('📊 WebSocket Candlestick Collector initialized');
    }

    /**
     * Connect to Binance WebSocket
     */
    async connect() {
        try {
            console.log('🔗 Connecting to Binance WebSocket for candlestick data...');
            
            this.ws = new WebSocket(this.baseUrl);
            
            this.ws.on('open', () => {
                console.log('✅ WebSocket connected to Binance for candlestick streams');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.stats.connectedAt = new Date();
                this.startHeartbeat();
                
                if (this.onConnectCallback) {
                    this.onConnectCallback();
                }
            });
            
            this.ws.on('message', (data) => {
                this.handleMessage(data);
            });
            
            this.ws.on('close', (code, reason) => {
                console.log(`🔌 WebSocket disconnected: ${code} - ${reason}`);
                this.isConnected = false;
                this.disconnectionTime = new Date(); // Track disconnection time for gap detection
                this.stopHeartbeat();
                
                if (this.onDisconnectCallback) {
                    this.onDisconnectCallback(code, reason);
                }
                
                // Attempt reconnection if not intentional disconnect
                if (code !== 1000) {
                    this.handleReconnection();
                }
            });
            
            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                this.stats.errors++;
                
                if (this.onErrorCallback) {
                    this.onErrorCallback(error);
                }
            });
            
        } catch (error) {
            console.error('❌ Failed to connect WebSocket:', error);
            throw error;
        }
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            
            // Handle kline/candlestick data
            if (message.e === 'kline') {
                this.handleKlineData(message);
            }
            
        } catch (error) {
            console.error('❌ Error parsing WebSocket message:', error);
            this.stats.errors++;
        }
    }

    /**
     * Handle kline/candlestick data
     */
    handleKlineData(message) {
        const kline = message.k;
        const symbol = kline.s;
        const isClosed = kline.x; // KEY: Is this kline closed?
        
        this.stats.candlesReceived++;
        this.stats.lastCandleTime = new Date();
        
        // Only process closed candles (finalized 1-minute candles)
        if (isClosed) {
            const candleCloseTime = new Date(kline.T);
            console.log(`📊 Closed 1-minute candle received for ${symbol} at ${candleCloseTime.toISOString()}`);
            
            // Update last candle timestamp for this symbol (for gap detection)
            this.lastCandleTimestamps.set(symbol, candleCloseTime);
            
            const candleData = {
                symbol: symbol,
                interval: '1m',
                openTime: new Date(kline.t),
                closeTime: candleCloseTime,
                open: parseFloat(kline.o),
                high: parseFloat(kline.h),
                low: parseFloat(kline.l),
                close: parseFloat(kline.c),
                volume: parseFloat(kline.v),
                quoteAssetVolume: parseFloat(kline.q),
                numberOfTrades: kline.n,
                takerBuyBaseAssetVolume: parseFloat(kline.V),
                takerBuyQuoteAssetVolume: parseFloat(kline.Q),
                fetchedAt: new Date(),
                dataSource: 'websocket_realtime'
            };
            
            this.stats.closedCandlesProcessed++;
            
            // Call closed candle callback
            if (this.onClosedCandleCallback) {
                try {
                    this.onClosedCandleCallback(candleData);
                } catch (callbackError) {
                    console.error(`❌ Error in closed candle callback for ${symbol}:`, callbackError);
                }
            }
        }
    }

    /**
     * Subscribe to kline stream for a symbol (1-minute interval)
     */
    subscribeToSymbol(symbol) {
        if (!this.isConnected) {
            console.warn(`⚠️ Cannot subscribe to ${symbol} - WebSocket not connected`);
            return false;
        }

        if (this.subscribedSymbols.has(symbol)) {
            console.log(`📊 Already subscribed to ${symbol} candlestick stream`);
            return true;
        }

        try {
            const stream = `${symbol.toLowerCase()}@kline_1m`;
            const subscribeMessage = {
                method: "SUBSCRIBE",
                params: [stream],
                id: Date.now()
            };
            
            this.ws.send(JSON.stringify(subscribeMessage));
            this.subscribedSymbols.add(symbol);
            
            console.log(`📊 Subscribed to ${symbol} 1-minute candlestick stream`);
            return true;
            
        } catch (error) {
            console.error(`❌ Failed to subscribe to ${symbol}:`, error);
            return false;
        }
    }

    /**
     * Unsubscribe from kline stream for a symbol
     */
    unsubscribeFromSymbol(symbol) {
        if (!this.isConnected) {
            console.warn(`⚠️ Cannot unsubscribe from ${symbol} - WebSocket not connected`);
            return false;
        }

        if (!this.subscribedSymbols.has(symbol)) {
            console.log(`📊 Not subscribed to ${symbol} candlestick stream`);
            return true;
        }

        try {
            const stream = `${symbol.toLowerCase()}@kline_1m`;
            const unsubscribeMessage = {
                method: "UNSUBSCRIBE",
                params: [stream],
                id: Date.now()
            };
            
            this.ws.send(JSON.stringify(unsubscribeMessage));
            this.subscribedSymbols.delete(symbol);
            
            console.log(`📊 Unsubscribed from ${symbol} 1-minute candlestick stream`);
            return true;
            
        } catch (error) {
            console.error(`❌ Failed to unsubscribe from ${symbol}:`, error);
            return false;
        }
    }

    /**
     * Subscribe to multiple symbols at once
     */
    subscribeToSymbols(symbols) {
        const results = [];
        
        for (const symbol of symbols) {
            const success = this.subscribeToSymbol(symbol);
            results.push({ symbol, success });
        }
        
        const successCount = results.filter(r => r.success).length;
        console.log(`📊 Subscribed to ${successCount}/${symbols.length} candlestick streams`);
        
        return results;
    }

    /**
     * Update symbol subscriptions (unsubscribe from old, subscribe to new)
     */
    updateSymbolSubscriptions(newSymbols) {
        const currentSymbols = Array.from(this.subscribedSymbols);
        const symbolsToAdd = newSymbols.filter(symbol => !currentSymbols.includes(symbol));
        const symbolsToRemove = currentSymbols.filter(symbol => !newSymbols.includes(symbol));
        
        console.log(`🔄 Updating candlestick subscriptions: +${symbolsToAdd.length} -${symbolsToRemove.length}`);
        
        // Unsubscribe from removed symbols
        for (const symbol of symbolsToRemove) {
            this.unsubscribeFromSymbol(symbol);
        }
        
        // Subscribe to new symbols
        for (const symbol of symbolsToAdd) {
            this.subscribeToSymbol(symbol);
        }
        
        return {
            added: symbolsToAdd.length,
            removed: symbolsToRemove.length,
            total: this.subscribedSymbols.size
        };
    }

    /**
     * Get current connection and subscription status
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            subscribedSymbols: Array.from(this.subscribedSymbols),
            subscribedCount: this.subscribedSymbols.size,
            reconnectAttempts: this.reconnectAttempts,
            stats: {
                ...this.stats,
                uptime: this.stats.connectedAt ? Date.now() - this.stats.connectedAt.getTime() : 0
            }
        };
    }

    /**
     * Start heartbeat mechanism
     */
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
                // Send ping to keep connection alive
                this.ws.ping();
            }
        }, this.heartbeatTimeout);
    }

    /**
     * Stop heartbeat mechanism
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Handle reconnection logic
     */
    async handleReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached for candlestick WebSocket`);
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
        
        console.log(`🔄 Attempting candlestick WebSocket reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);
        
        setTimeout(async () => {
            try {
                // Get current symbols from database before reconnecting
                const currentSymbols = await this.getCurrentSymbolsFromDatabase();
                
                if (currentSymbols.length === 0) {
                    console.log(`⚠️ No symbols found in database, skipping WebSocket reconnection attempt ${this.reconnectAttempts}`);
                    // Still continue trying in case symbols are added later
                    this.handleReconnection();
                    return;
                }
                
                console.log(`📊 Found ${currentSymbols.length} symbols in database for reconnection: ${currentSymbols.slice(0, 3).join(', ')}${currentSymbols.length > 3 ? '...' : ''}`);
                
                await this.connect();
                
                // Update our symbol set and resubscribe to current symbols
                this.subscribedSymbols.clear(); // Clear old symbols
                
                for (const symbol of currentSymbols) {
                    this.subscribeToSymbol(symbol);
                }
                
                console.log(`✅ Reconnected and resubscribed to ${this.subscribedSymbols.size} candlestick streams`);
                
                // Mark reconnection time and detect gaps
                this.reconnectionTime = new Date();
                await this.detectAndHandleDataGaps(currentSymbols);
                
            } catch (error) {
                console.error('❌ Candlestick WebSocket reconnection failed:', error);
                this.handleReconnection();
            }
        }, delay);
    }

    /**
     * Detect data gaps for symbols during disconnection period
     */
    async detectAndHandleDataGaps(symbols) {
        if (!this.disconnectionTime || !this.reconnectionTime) {
            console.log('📊 No disconnection period to check for gaps');
            return;
        }

        console.log('🔍 Checking for data gaps during disconnection period...');
        console.log(`   └── Disconnected: ${this.disconnectionTime.toISOString()}`);
        console.log(`   └── Reconnected: ${this.reconnectionTime.toISOString()}`);
        
        const downtime = this.reconnectionTime.getTime() - this.disconnectionTime.getTime();
        const downtimeMinutes = Math.floor(downtime / (60 * 1000));
        
        console.log(`   └── Downtime: ${downtimeMinutes} minutes`);
        
        if (downtimeMinutes < 1) {
            console.log('📊 Downtime less than 1 minute, no gaps expected');
            return;
        }
        
        const gaps = [];
        
        for (const symbol of symbols) {
            const symbolGaps = await this.detectGapsForSymbol(symbol);
            if (symbolGaps.length > 0) {
                gaps.push({ symbol, gaps: symbolGaps });
            }
        }
        
        if (gaps.length > 0) {
            console.log(`🚨 Data gaps detected for ${gaps.length} symbols!`);
            
            let totalMissingCandles = 0;
            gaps.forEach(({ symbol, gaps: symbolGaps }) => {
                totalMissingCandles += symbolGaps.length;
                console.log(`   └── ${symbol}: ${symbolGaps.length} missing candles`);
            });
            
            this.stats.gapsDetected += gaps.length;
            
            // Trigger gap recovery callback
            if (this.onGapDetectedCallback) {
                try {
                    await this.onGapDetectedCallback(gaps);
                    console.log(`✅ Gap recovery initiated for ${totalMissingCandles} missing candles`);
                } catch (error) {
                    console.error('❌ Error in gap recovery callback:', error);
                }
            } else {
                console.log('⚠️ No gap recovery callback configured - gaps not recovered');
            }
        } else {
            console.log('✅ No data gaps detected during reconnection');
        }
        
        // Reset disconnection tracking
        this.disconnectionTime = null;
        this.reconnectionTime = null;
    }

    /**
     * Detect gaps for a specific symbol
     */
    async detectGapsForSymbol(symbol) {
        try {
            // Get last known candle timestamp for this symbol
            const lastKnownTime = this.lastCandleTimestamps.get(symbol);
            
            if (!lastKnownTime) {
                // No previous timestamp, check database for last candle
                const lastDbTime = await this.getLastCandleTimeFromDatabase(symbol);
                if (!lastDbTime) {
                    console.log(`⚠️ No previous candle data found for ${symbol}, skipping gap detection`);
                    return [];
                }
                this.lastCandleTimestamps.set(symbol, lastDbTime);
            }
            
            const lastTime = this.lastCandleTimestamps.get(symbol);
            const currentTime = new Date();
            
            // Calculate expected candles between last known time and now
            const missingCandles = this.calculateMissingCandles(lastTime, currentTime);
            
            if (missingCandles.length > 0) {
                console.log(`🔍 ${symbol} gap analysis:`);
                console.log(`   └── Last candle: ${lastTime.toISOString()}`);
                console.log(`   └── Current time: ${currentTime.toISOString()}`);
                console.log(`   └── Missing: ${missingCandles.length} candles`);
                
                return missingCandles;
            }
            
            return [];
            
        } catch (error) {
            console.error(`❌ Error detecting gaps for ${symbol}:`, error);
            return [];
        }
    }

    /**
     * Calculate missing 1-minute candles between two timestamps
     */
    calculateMissingCandles(startTime, endTime) {
        const missingCandles = [];
        const start = new Date(startTime);
        const end = new Date(endTime);
        
        // Round start time to next minute boundary
        const nextMinute = new Date(start);
        nextMinute.setSeconds(0, 0);
        nextMinute.setMinutes(nextMinute.getMinutes() + 1);
        
        // Round end time down to minute boundary  
        const lastMinute = new Date(end);
        lastMinute.setSeconds(0, 0);
        
        // Calculate all missing 1-minute intervals
        const current = new Date(nextMinute);
        while (current <= lastMinute) {
            const openTime = new Date(current);
            const closeTime = new Date(current.getTime() + 60000 - 1); // 59.999 seconds later
            
            missingCandles.push({
                openTime: openTime,
                closeTime: closeTime,
                interval: '1m'
            });
            
            current.setMinutes(current.getMinutes() + 1);
        }
        
        return missingCandles;
    }

    /**
     * Get last candle timestamp from database for a symbol
     */
    async getLastCandleTimeFromDatabase(symbol) {
        try {
            const { getGlobalHybridManager } = require('./hybridCandleDataManager');
            const hybridManager = getGlobalHybridManager();
            
            if (!hybridManager || !hybridManager.client) {
                return null;
            }
            
            const db = hybridManager.client.db(hybridManager.dbName);
            const collection = db.collection('candleData');
            
            // Find the most recent 1-minute candle for this symbol
            const lastCandle = await collection.findOne(
                { 
                    symbol: symbol, 
                    interval: '1m' 
                },
                { 
                    sort: { closeTime: -1 },
                    projection: { closeTime: 1 }
                }
            );
            
            return lastCandle ? lastCandle.closeTime : null;
            
        } catch (error) {
            console.error(`❌ Error getting last candle time from database for ${symbol}:`, error);
            return null;
        }
    }

    /**
     * Initialize last candle timestamps from database (for gap detection setup)
     */
    async initializeLastCandleTimestamps(symbols) {
        console.log('📊 Initializing last candle timestamps for gap detection...');
        
        for (const symbol of symbols) {
            try {
                const lastTime = await this.getLastCandleTimeFromDatabase(symbol);
                if (lastTime) {
                    this.lastCandleTimestamps.set(symbol, lastTime);
                    console.log(`   └── ${symbol}: ${lastTime.toISOString()}`);
                } else {
                    console.log(`   └── ${symbol}: No previous data found`);
                }
            } catch (error) {
                console.error(`   └── ${symbol}: Error - ${error.message}`);
            }
        }
        
        console.log(`✅ Initialized timestamps for ${this.lastCandleTimestamps.size} symbols`);
    }

    /**
     * Get current symbols from database (for reconnection purposes)
     */
    async getCurrentSymbolsFromDatabase() {
        try {
            // Try to get symbols from global hybrid manager first
            const { getGlobalHybridManager } = require('./hybridCandleDataManager');
            const hybridManager = getGlobalHybridManager();
            
            if (hybridManager && hybridManager.client) {
                const { getSelectedSymbols } = require('../config/database');
                const symbols = await getSelectedSymbols(hybridManager.client);
                return symbols || [];
            }
            
            // If no hybrid manager, return empty array
            console.log('⚠️ No hybrid manager available to fetch symbols for reconnection');
            return [];
            
        } catch (error) {
            console.error('❌ Error fetching symbols from database for reconnection:', error);
            return [];
        }
    }

    /**
     * Disconnect from WebSocket
     */
    disconnect() {
        console.log('🔌 Disconnecting candlestick WebSocket...');
        
        this.stopHeartbeat();
        
        // Close WebSocket connection
        if (this.ws) {
            this.ws.close(1000, 'Normal closure'); // Use normal closure code
            this.ws = null;
        }
        
        this.isConnected = false;
        this.subscribedSymbols.clear();
        
        console.log('✅ Candlestick WebSocket disconnected');
    }

    /**
     * Force cleanup - useful for testing or emergency situations
     */
    forceCleanup() {
        console.log('🧹 Force cleaning up candlestick WebSocket collector...');
        
        this.subscribedSymbols.clear();
        this.stopHeartbeat();
        
        if (this.ws) {
            this.ws.terminate(); // Force close
            this.ws = null;
        }
        
        this.isConnected = false;
        console.log('✅ Candlestick WebSocket force cleanup completed');
    }
}

// Singleton instance for global use
let globalCandleCollector = null;

/**
 * Get or create global WebSocket candlestick collector instance
 */
function getGlobalCandleCollector(options = {}) {
    if (!globalCandleCollector) {
        globalCandleCollector = new WebSocketCandleCollector(options);
    }
    return globalCandleCollector;
}

/**
 * Initialize and connect global candlestick collector
 */
async function initializeGlobalCandleCollector(options = {}) {
    const collector = getGlobalCandleCollector(options);
    
    if (!collector.isConnected) {
        await collector.connect();
    }
    
    return collector;
}

/**
 * Disconnect and cleanup global candlestick collector
 */
function cleanupGlobalCandleCollector() {
    if (globalCandleCollector) {
        globalCandleCollector.disconnect();
        globalCandleCollector = null;
    }
}

module.exports = {
    WebSocketCandleCollector,
    getGlobalCandleCollector,
    initializeGlobalCandleCollector,
    cleanupGlobalCandleCollector
};
