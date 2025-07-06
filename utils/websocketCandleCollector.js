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
        this.maxReconnectAttempts = options.maxReconnectAttempts || 50; // Increased for better resilience
        this.reconnectDelay = options.reconnectDelay || 1000; // Start with 1s, not 5s
        this.maxReconnectDelay = options.maxReconnectDelay || 30000; // Cap at 30s
        
        // Track subscribed symbols with persistence
        this.subscribedSymbols = new Set();
        this.persistedSymbols = []; // Store symbols for reconnection independence
        
        // Track last received candle timestamps per symbol (for gap detection)
        this.lastCandleTimestamps = new Map();
        this.disconnectionTime = null;
        this.reconnectionTime = null;
        
        // Connection health monitoring
        this.lastMessageTime = null;
        this.connectionHealthTimer = null;
        this.healthCheckInterval = options.healthCheckInterval || 60000; // 1 minute
        this.maxSilentTime = options.maxSilentTime || 120000; // 2 minutes before considering unhealthy
        
        // Event callbacks
        this.onClosedCandleCallback = options.onClosedCandle || null;
        this.onErrorCallback = options.onError || null;
        this.onConnectCallback = options.onConnect || null;
        this.onDisconnectCallback = options.onDisconnect || null;
        this.onGapDetectedCallback = options.onGapDetected || null;
        
        // Heartbeat with improved handling
        this.heartbeatInterval = null;
        this.heartbeatTimeout = options.heartbeatTimeout || 20000; // More frequent heartbeat
        this.pongReceived = true; // Track pong responses
        
        // Reconnection state management
        this.isReconnecting = false;
        this.reconnectTimer = null;
        this.shouldReconnect = true; // Flag to control reconnection behavior
        
        // Statistics
        this.stats = {
            connectedAt: null,
            candlesReceived: 0,
            closedCandlesProcessed: 0,
            lastCandleTime: null,
            errors: 0,
            gapsDetected: 0,
            gapsRecovered: 0,
            reconnectionCount: 0,
            totalDowntime: 0,
            lastHealthCheck: null
        };
        
        console.log('📊 WebSocket Candlestick Collector initialized with enhanced reliability');
    }

    /**
     * Connect to Binance WebSocket with initial symbols
     */
    async connect(initialSymbols = []) {
        try {
            // Validate that we have symbols to subscribe to
            if (initialSymbols.length === 0) {
                console.log('⚠️ No symbols provided for WebSocket connection, skipping connection');
                return false;
            }
            
            console.log(`🔗 Connecting to Binance WebSocket for ${initialSymbols.length} symbols...`);
            
            this.ws = new WebSocket(this.baseUrl);
            
            this.ws.on('open', () => {
                console.log('✅ WebSocket connected to Binance for candlestick streams');
                this.isConnected = true;
                this.isReconnecting = false;
                this.reconnectAttempts = 0;
                this.stats.connectedAt = new Date();
                this.lastMessageTime = new Date(); // Initialize message tracking
                this.startHeartbeat();
                
                // Persist symbols for reconnection reliability
                if (initialSymbols && initialSymbols.length > 0) {
                    this.persistedSymbols = [...initialSymbols];
                    console.log(`📊 Immediately subscribing to ${initialSymbols.length} streams after connection...`);
                    
                    // Subscribe to all symbols right after connection
                    setTimeout(() => {
                        this.subscribeToSymbols(initialSymbols);
                        // Start health monitoring after subscriptions
                        this.startConnectionHealthMonitoring();
                    }, 100); // Small delay to ensure connection is fully established
                }
                
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
            // Update last message time for health monitoring
            this.lastMessageTime = new Date();
            
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
        
        // Update persisted symbols for reconnection reliability
        this.persistedSymbols = [...newSymbols];
        console.log(`📊 Updated persisted symbols: ${this.persistedSymbols.length} symbols`);
        
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
     * Handle reconnection logic - FIXED to prevent infinite recursion
     */
    async handleReconnection() {
        // Prevent multiple concurrent reconnection attempts
        if (this.isReconnecting) {
            console.log('🔄 Reconnection already in progress, skipping duplicate attempt');
            return;
        }

        if (!this.shouldReconnect) {
            console.log('🛑 Reconnection disabled, not attempting to reconnect');
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached for candlestick WebSocket`);
            console.log('🔄 Will retry in 5 minutes...');
            
            // Reset attempts after 5 minutes for long-term resilience
            setTimeout(() => {
                console.log('🔄 Resetting reconnection attempts for long-term resilience');
                this.reconnectAttempts = 0;
                if (this.shouldReconnect && !this.isConnected) {
                    this.handleReconnection();
                }
            }, 300000); // 5 minutes
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;
        this.stats.reconnectionCount++;
        
        // Calculate delay with exponential backoff but cap it
        const delay = Math.min(
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );
        
        console.log(`🔄 Attempting candlestick WebSocket reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);
        
        // Clear any existing reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectTimer = setTimeout(async () => {
            try {
                await this.attemptReconnection();
            } catch (error) {
                console.error('❌ Reconnection attempt failed:', error);
            } finally {
                this.isReconnecting = false;
                
                // Schedule next attempt if still not connected
                if (!this.isConnected && this.shouldReconnect) {
                    this.handleReconnection();
                }
            }
        }, delay);
    }

    /**
     * Attempt to reconnect with improved logic
     */
    async attemptReconnection() {
        console.log('🔗 Starting reconnection attempt...');
        
        try {
            // Use persisted symbols first, then try database
            let symbolsToReconnect = [...this.persistedSymbols];
            
            if (symbolsToReconnect.length === 0) {
                console.log('📊 No persisted symbols found, trying database...');
                symbolsToReconnect = await this.getCurrentSymbolsFromDatabase();
            }
            
            if (symbolsToReconnect.length === 0) {
                console.log('⚠️ No symbols available for reconnection - will retry later');
                // Don't call handleReconnection() again here - let the timeout in handleReconnection() handle it
                return;
            }
            
            console.log(`📊 Reconnecting with ${symbolsToReconnect.length} symbols: ${symbolsToReconnect.slice(0, 3).join(', ')}${symbolsToReconnect.length > 3 ? '...' : ''}`);
            
            // Store symbols for this reconnection attempt
            this.persistedSymbols = symbolsToReconnect;
            
            // Clean up existing connection
            if (this.ws) {
                this.ws.removeAllListeners();
                this.ws.terminate();
                this.ws = null;
            }
            
            // Attempt new connection
            await this.connect(symbolsToReconnect);
            
            if (this.isConnected) {
                console.log(`✅ Successfully reconnected with ${this.subscribedSymbols.size} active subscriptions`);
                
                // Reset reconnection tracking on success
                this.isReconnecting = false;
                this.reconnectAttempts = 0;
                
                // Mark reconnection time and detect gaps
                this.reconnectionTime = new Date();
                await this.detectAndHandleDataGaps(symbolsToReconnect);
                
                // Start connection health monitoring
                this.startConnectionHealthMonitoring();
                
            } else {
                throw new Error('Connection established but not marked as connected');
            }
            
        } catch (error) {
            console.error('❌ Reconnection attempt failed:', error);
            this.stats.errors++;
            throw error; // Re-throw to trigger retry logic
        }
    }

    /**
     * Start connection health monitoring
     */
    startConnectionHealthMonitoring() {
        if (this.connectionHealthTimer) {
            clearInterval(this.connectionHealthTimer);
        }

        this.connectionHealthTimer = setInterval(() => {
            this.checkConnectionHealth();
        }, this.healthCheckInterval);
        
        this.stats.lastHealthCheck = new Date();
        console.log('💗 Connection health monitoring started');
    }

    /**
     * Check connection health and force reconnection if needed
     */
    checkConnectionHealth() {
        const now = new Date();
        this.stats.lastHealthCheck = now;

        if (!this.isConnected) {
            console.log('💔 Health check: Connection not active');
            return;
        }

        // Check if we've received messages recently
        if (this.lastMessageTime) {
            const timeSinceLastMessage = now.getTime() - this.lastMessageTime.getTime();
            
            if (timeSinceLastMessage > this.maxSilentTime) {
                console.warn(`⚠️ Connection health issue: No messages for ${Math.floor(timeSinceLastMessage / 1000)}s`);
                console.log('🔄 Forcing reconnection due to silent connection...');
                
                this.forceReconnection('Silent connection detected');
                return;
            }
        }

        // Check WebSocket state
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
            console.warn('⚠️ Connection health issue: WebSocket not in OPEN state');
            this.forceReconnection('WebSocket state not OPEN');
            return;
        }

        console.log('💚 Connection health check passed');
    }

    /**
     * Force reconnection (for health issues)
     */
    forceReconnection(reason) {
        console.log(`🚨 Forcing reconnection: ${reason}`);
        
        this.isConnected = false;
        this.disconnectionTime = new Date();
        
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.terminate();
            this.ws = null;
        }
        
        this.stopHeartbeat();
        
        // Reset attempts for forced reconnection
        this.reconnectAttempts = 0;
        this.handleReconnection();
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
     * Stop connection health monitoring
     */
    stopConnectionHealthMonitoring() {
        if (this.connectionHealthTimer) {
            clearInterval(this.connectionHealthTimer);
            this.connectionHealthTimer = null;
            console.log('💔 Connection health monitoring stopped');
        }
    }

    /**
     * Disconnect from WebSocket
     */
    disconnect() {
        console.log('🔌 Disconnecting candlestick WebSocket...');
        
        // Stop all monitoring and timers
        this.shouldReconnect = false; // Disable reconnection
        this.stopHeartbeat();
        this.stopConnectionHealthMonitoring();
        
        // Clear reconnection timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        // Close WebSocket connection
        if (this.ws) {
            this.ws.close(1000, 'Normal closure'); // Use normal closure code
            this.ws = null;
        }
        
        this.isConnected = false;
        this.isReconnecting = false;
        this.subscribedSymbols.clear();
        
        console.log('✅ Candlestick WebSocket disconnected');
    }

    /**
     * Force cleanup - useful for testing or emergency situations
     */
    forceCleanup() {
        console.log('🧹 Force cleaning up candlestick WebSocket collector...');
        
        // Stop all monitoring and timers
        this.shouldReconnect = false;
        this.stopHeartbeat();
        this.stopConnectionHealthMonitoring();
        
        // Clear all timers
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        // Clear state
        this.subscribedSymbols.clear();
        this.persistedSymbols = [];
        this.lastCandleTimestamps.clear();
        
        // Force close WebSocket
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.terminate(); // Force close
            this.ws = null;
        }
        
        this.isConnected = false;
        this.isReconnecting = false;
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
async function initializeGlobalCandleCollector(options = {}, initialSymbols = []) {
    const collector = getGlobalCandleCollector(options);
    
    if (!collector.isConnected) {
        await collector.connect(initialSymbols);
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
