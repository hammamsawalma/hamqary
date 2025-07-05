/**
 * WebSocket Tick Data Collector for Real-time Volume Footprint Calculation
 * Connects to Binance Futures WebSocket streams to collect tick data
 */

const WebSocket = require('ws');
const { calculateReversalVolumeFootprint } = require('./volumeFootprintCalculator');

class WebSocketTickCollector {
    constructor(options = {}) {
        this.baseUrl = 'wss://fstream.binance.com/ws/';
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
        this.reconnectDelay = options.reconnectDelay || 5000;
        
        // Track subscribed symbols
        this.subscribedSymbols = new Set();
        
        // Store active candle data collection
        this.activeCandles = new Map(); // symbol -> { startTime, endTime, trades[], interval }
        
        // Event callbacks
        this.onTradeCallback = options.onTrade || null;
        this.onErrorCallback = options.onError || null;
        this.onConnectCallback = options.onConnect || null;
        this.onDisconnectCallback = options.onDisconnect || null;
        
        // Heartbeat
        this.heartbeatInterval = null;
        this.heartbeatTimeout = options.heartbeatTimeout || 30000;
        
        console.log('📡 WebSocket Tick Collector initialized');
    }

    /**
     * Connect to Binance WebSocket
     */
    async connect() {
        try {
            console.log('🔗 Connecting to Binance WebSocket...');
            
            this.ws = new WebSocket(this.baseUrl);
            
            this.ws.on('open', () => {
                console.log('✅ WebSocket connected to Binance');
                this.isConnected = true;
                this.reconnectAttempts = 0;
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
                this.stopHeartbeat();
                
                if (this.onDisconnectCallback) {
                    this.onDisconnectCallback(code, reason);
                }
                
                // Attempt reconnection
                this.handleReconnection();
            });
            
            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                
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
            
            // Handle aggregated trade data
            if (message.e === 'aggTrade') {
                this.handleAggTrade(message);
            }
            
        } catch (error) {
            console.error('❌ Error parsing WebSocket message:', error);
        }
    }

    /**
     * Handle aggregated trade data
     */
    handleAggTrade(trade) {
        const symbol = trade.s;
        const timestamp = trade.T;
        
        // Check if we're collecting data for this symbol
        const activeCandle = this.activeCandles.get(symbol);
        if (!activeCandle) {
            return;
        }

        // Check if trade is within our collection timeframe
        if (timestamp >= activeCandle.startTime && timestamp <= activeCandle.endTime) {
            const tradeData = {
                id: trade.a,
                price: parseFloat(trade.p),
                quantity: parseFloat(trade.q),
                timestamp: timestamp,
                isBuyerMaker: trade.m,
                firstTradeId: trade.f,
                lastTradeId: trade.l
            };
            
            activeCandle.trades.push(tradeData);
            
            // Call trade callback if provided
            if (this.onTradeCallback) {
                this.onTradeCallback(symbol, tradeData, activeCandle);
            }
        }
    }

    /**
     * Subscribe to aggTrade stream for a symbol
     */
    subscribeToSymbol(symbol) {
        if (!this.isConnected) {
            console.warn(`⚠️ Cannot subscribe to ${symbol} - WebSocket not connected`);
            return false;
        }

        if (this.subscribedSymbols.has(symbol)) {
            console.log(`📡 Already subscribed to ${symbol}`);
            return true;
        }

        try {
            const stream = `${symbol.toLowerCase()}@aggTrade`;
            const subscribeMessage = {
                method: "SUBSCRIBE",
                params: [stream],
                id: Date.now()
            };
            
            this.ws.send(JSON.stringify(subscribeMessage));
            this.subscribedSymbols.add(symbol);
            
            console.log(`📡 Subscribed to ${symbol} aggTrade stream`);
            return true;
            
        } catch (error) {
            console.error(`❌ Failed to subscribe to ${symbol}:`, error);
            return false;
        }
    }

    /**
     * Unsubscribe from aggTrade stream for a symbol
     */
    unsubscribeFromSymbol(symbol) {
        if (!this.isConnected) {
            console.warn(`⚠️ Cannot unsubscribe from ${symbol} - WebSocket not connected`);
            return false;
        }

        if (!this.subscribedSymbols.has(symbol)) {
            console.log(`📡 Not subscribed to ${symbol}`);
            return true;
        }

        try {
            const stream = `${symbol.toLowerCase()}@aggTrade`;
            const unsubscribeMessage = {
                method: "UNSUBSCRIBE",
                params: [stream],
                id: Date.now()
            };
            
            this.ws.send(JSON.stringify(unsubscribeMessage));
            this.subscribedSymbols.delete(symbol);
            
            console.log(`📡 Unsubscribed from ${symbol} aggTrade stream`);
            return true;
            
        } catch (error) {
            console.error(`❌ Failed to unsubscribe from ${symbol}:`, error);
            return false;
        }
    }

    /**
     * Start collecting tick data for a reversal candle
     */
    startCandleCollection(symbol, startTime, endTime, interval) {
        console.log(`🎯 Starting tick collection for ${symbol} ${interval} candle`);
        console.log(`📅 Collection period: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);
        
        // Subscribe to symbol if not already subscribed
        this.subscribeToSymbol(symbol);
        
        // Initialize collection data
        this.activeCandles.set(symbol, {
            startTime: startTime,
            endTime: endTime,
            interval: interval,
            trades: [],
            collectionStarted: new Date()
        });
        
        // Set timeout to automatically stop collection and calculate footprint
        const collectionDuration = endTime - startTime;
        const timeout = setTimeout(() => {
            this.finalizeCandleCollection(symbol);
        }, collectionDuration);
        
        // Store timeout reference
        this.activeCandles.get(symbol).timeout = timeout;
        
        return true;
    }

    /**
     * Stop collecting tick data for a symbol and calculate volume footprint
     */
    async finalizeCandleCollection(symbol) {
        const activeCandle = this.activeCandles.get(symbol);
        if (!activeCandle) {
            console.warn(`⚠️ No active collection found for ${symbol}`);
            return null;
        }

        console.log(`🏁 Finalizing tick collection for ${symbol} ${activeCandle.interval}`);
        console.log(`📊 Collected ${activeCandle.trades.length} trades`);

        try {
            // Clear timeout if it exists
            if (activeCandle.timeout) {
                clearTimeout(activeCandle.timeout);
            }

            // Calculate volume footprint
            const volumeFootprint = calculateReversalVolumeFootprint(
                activeCandle.trades,
                symbol,
                activeCandle.startTime,
                activeCandle.endTime
            );

            // Add collection metadata
            volumeFootprint.tickDataSource = 'websocket';
            volumeFootprint.collectionDuration = Date.now() - activeCandle.collectionStarted.getTime();

            // Clean up active collection
            this.activeCandles.delete(symbol);

            console.log(`✅ Volume footprint calculated for ${symbol}: POC=${volumeFootprint.poc}, VAH=${volumeFootprint.vah}, VAL=${volumeFootprint.val}`);
            
            return volumeFootprint;

        } catch (error) {
            console.error(`❌ Error finalizing collection for ${symbol}:`, error);
            this.activeCandles.delete(symbol);
            return {
                error: `Failed to calculate volume footprint: ${error.message}`,
                symbol: symbol,
                tickDataSource: 'websocket'
            };
        }
    }

    /**
     * Get current collection status
     */
    getCollectionStatus() {
        const activeCollections = Array.from(this.activeCandles.entries()).map(([symbol, data]) => ({
            symbol: symbol,
            interval: data.interval,
            startTime: data.startTime,
            endTime: data.endTime,
            tradesCollected: data.trades.length,
            timeRemaining: Math.max(0, data.endTime - Date.now()),
            collectionStarted: data.collectionStarted
        }));

        return {
            isConnected: this.isConnected,
            subscribedSymbols: Array.from(this.subscribedSymbols),
            activeCollections: activeCollections,
            totalActiveCollections: activeCollections.length
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
            console.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
        
        console.log(`🔄 Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);
        
        setTimeout(async () => {
            try {
                await this.connect();
                
                // Resubscribe to all symbols
                for (const symbol of this.subscribedSymbols) {
                    this.subscribeToSymbol(symbol);
                }
                
            } catch (error) {
                console.error('❌ Reconnection failed:', error);
                this.handleReconnection();
            }
        }, delay);
    }

    /**
     * Disconnect from WebSocket
     */
    disconnect() {
        console.log('🔌 Disconnecting WebSocket...');
        
        this.stopHeartbeat();
        
        // Clear all active collections
        for (const [symbol, data] of this.activeCandles) {
            if (data.timeout) {
                clearTimeout(data.timeout);
            }
        }
        this.activeCandles.clear();
        
        // Close WebSocket connection
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.isConnected = false;
        this.subscribedSymbols.clear();
        
        console.log('✅ WebSocket disconnected');
    }

    /**
     * Force cleanup - useful for testing or emergency situations
     */
    forceCleanup() {
        console.log('🧹 Force cleaning up WebSocket collector...');
        
        // Clear all timeouts
        for (const [symbol, data] of this.activeCandles) {
            if (data.timeout) {
                clearTimeout(data.timeout);
            }
        }
        
        this.activeCandles.clear();
        this.subscribedSymbols.clear();
        this.stopHeartbeat();
        
        if (this.ws) {
            this.ws.terminate(); // Force close
            this.ws = null;
        }
        
        this.isConnected = false;
        console.log('✅ Force cleanup completed');
    }
}

// Singleton instance for global use
let globalTickCollector = null;

/**
 * Get or create global WebSocket tick collector instance
 */
function getGlobalTickCollector(options = {}) {
    if (!globalTickCollector) {
        globalTickCollector = new WebSocketTickCollector(options);
    }
    return globalTickCollector;
}

/**
 * Initialize and connect global tick collector
 */
async function initializeGlobalTickCollector(options = {}) {
    const collector = getGlobalTickCollector(options);
    
    if (!collector.isConnected) {
        await collector.connect();
    }
    
    return collector;
}

/**
 * Disconnect and cleanup global tick collector
 */
function cleanupGlobalTickCollector() {
    if (globalTickCollector) {
        globalTickCollector.disconnect();
        globalTickCollector = null;
    }
}

module.exports = {
    WebSocketTickCollector,
    getGlobalTickCollector,
    initializeGlobalTickCollector,
    cleanupGlobalTickCollector
};
