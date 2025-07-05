/**
 * Hybrid Tick Data Fetcher - WebSocket + REST API
 * Intelligently chooses between WebSocket (fast) and REST API (rate-limited) based on data availability
 */

const { getGlobalTickCollector, initializeGlobalTickCollector } = require('./websocketTickCollector');
const { 
    fetchReversalCandleTickData, 
    isCurrentlyBanned, 
    getRateLimiterStatus 
} = require('./fetchHistoricalTickData');

class HybridTickDataFetcher {
    constructor() {
        this.webSocketStartTime = Date.now(); // Track when WebSocket started
        this.webSocketCollector = null;
        this.isWebSocketActive = false;
        
        // Buffer for collecting real-time tick data
        this.tickDataBuffer = new Map(); // symbol -> { [startTime-endTime]: trades[] }
        
        console.log('🚀 HybridTickDataFetcher initialized');
    }

    /**
     * Initialize WebSocket collector for real-time data
     */
    async initializeWebSocket(selectedSymbols = []) {
        if (this.isWebSocketActive) {
            console.log('📡 WebSocket already active');
            return true;
        }

        try {
            console.log('🔗 Initializing WebSocket for real-time tick data...');
            
            this.webSocketCollector = await initializeGlobalTickCollector({
                onTrade: (symbol, trade, candleData) => {
                    this.bufferTickData(symbol, trade, candleData);
                },
                onConnect: () => {
                    console.log('✅ WebSocket connected - real-time data collection active');
                    this.webSocketStartTime = Date.now();
                    this.subscribeToSymbols(selectedSymbols);
                },
                onError: (error) => {
                    console.error('❌ WebSocket error:', error);
                },
                maxReconnectAttempts: 10,
                reconnectDelay: 5000
            });

            this.isWebSocketActive = true;
            console.log('🎯 WebSocket collector ready for real-time tick data');
            return true;

        } catch (error) {
            console.error('❌ Failed to initialize WebSocket:', error);
            return false;
        }
    }

    /**
     * Subscribe WebSocket to symbols for real-time data collection
     */
    subscribeToSymbols(symbols) {
        if (!this.webSocketCollector || !Array.isArray(symbols)) {
            return;
        }

        console.log(`📡 Subscribing to ${symbols.length} symbols for real-time data...`);
        
        symbols.forEach(symbol => {
            this.webSocketCollector.subscribeToSymbol(symbol);
        });

        console.log('✅ WebSocket subscriptions active');
    }

    /**
     * Buffer tick data from WebSocket for later use
     */
    bufferTickData(symbol, trade, candleData) {
        const bufferKey = `${symbol}_${candleData.startTime}_${candleData.endTime}`;
        
        if (!this.tickDataBuffer.has(bufferKey)) {
            this.tickDataBuffer.set(bufferKey, {
                symbol: symbol,
                startTime: candleData.startTime,
                endTime: candleData.endTime,
                interval: candleData.interval,
                trades: [],
                dataSource: 'websocket'
            });
        }

        this.tickDataBuffer.get(bufferKey).trades.push(trade);
    }

    /**
     * Intelligently fetch tick data using the best available method
     */
    async fetchTickData(symbol, openTime, closeTime, interval) {
        const startTime = performance.now();
        
        console.log(`🎯 Fetching tick data for ${symbol} ${interval} candle`);
        console.log(`📅 Time range: ${new Date(openTime).toISOString()} to ${new Date(closeTime).toISOString()}`);

        // Decision logic: WebSocket vs REST API
        const useWebSocket = this.shouldUseWebSocket(openTime, closeTime);
        
        if (useWebSocket) {
            console.log('⚡ Using WebSocket data (FAST) - no rate limits!');
            return await this.fetchFromWebSocket(symbol, openTime, closeTime, interval, startTime);
        } else {
            console.log('🐌 Using REST API (SLOW) - rate limited but necessary for historical data');
            return await this.fetchFromRestAPI(symbol, openTime, closeTime, interval, startTime);
        }
    }

    /**
     * Determine whether to use WebSocket or REST API based on timing
     */
    shouldUseWebSocket(openTime, closeTime) {
        // Use WebSocket if:
        // 1. WebSocket is active
        // 2. Candle period is after WebSocket started collecting data
        // 3. Not currently banned (fallback to WebSocket if banned)
        
        if (!this.isWebSocketActive) {
            return false;
        }

        // If currently banned, prefer WebSocket
        if (isCurrentlyBanned()) {
            console.log('🚫 REST API banned - using WebSocket');
            return true;
        }

        // Use WebSocket for candles that occurred after WebSocket started
        if (openTime >= this.webSocketStartTime) {
            return true;
        }

        // Use REST API for historical data (before WebSocket started)
        return false;
    }

    /**
     * Fetch tick data from WebSocket buffer or collect in real-time
     */
    async fetchFromWebSocket(symbol, openTime, closeTime, interval, startTime) {
        try {
            const bufferKey = `${symbol}_${openTime}_${closeTime}`;
            
            // Check if data is already in buffer
            if (this.tickDataBuffer.has(bufferKey)) {
                const bufferedData = this.tickDataBuffer.get(bufferKey);
                const executionTime = Math.round(performance.now() - startTime);
                
                console.log(`✅ Retrieved ${bufferedData.trades.length} trades from WebSocket buffer (${executionTime}ms)`);
                
                return {
                    symbol: symbol,
                    interval: interval,
                    timeframe: {
                        openTime: openTime,
                        closeTime: closeTime,
                        duration: closeTime - openTime
                    },
                    trades: bufferedData.trades,
                    tradesCount: bufferedData.trades.length,
                    executionTime: executionTime,
                    fetchedAt: new Date(),
                    success: true,
                    dataSource: 'websocket_buffer'
                };
            }

            // If not in buffer, start real-time collection
            console.log(`📡 Starting real-time collection for ${symbol} ${interval}`);
            
            const collector = this.webSocketCollector;
            if (!collector) {
                throw new Error('WebSocket collector not available');
            }

            // Start collection and wait for completion
            collector.startCandleCollection(symbol, openTime, closeTime, interval);
            
            // Wait for collection to complete
            const volumeFootprint = await this.waitForWebSocketCollection(symbol, closeTime - openTime);
            
            if (volumeFootprint && volumeFootprint.trades) {
                const executionTime = Math.round(performance.now() - startTime);
                
                return {
                    symbol: symbol,
                    interval: interval,
                    timeframe: {
                        openTime: openTime,
                        closeTime: closeTime,
                        duration: closeTime - openTime
                    },
                    trades: volumeFootprint.trades,
                    tradesCount: volumeFootprint.trades.length,
                    executionTime: executionTime,
                    fetchedAt: new Date(),
                    success: true,
                    dataSource: 'websocket_realtime'
                };
            } else {
                throw new Error('WebSocket collection failed or returned no data');
            }

        } catch (error) {
            console.error(`❌ WebSocket fetch failed for ${symbol}:`, error.message);
            
            // Fallback to REST API if WebSocket fails
            console.log('🔄 Falling back to REST API...');
            return await this.fetchFromRestAPI(symbol, openTime, closeTime, interval, startTime);
        }
    }

    /**
     * Wait for WebSocket collection to complete
     */
    async waitForWebSocketCollection(symbol, maxWaitTime) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('WebSocket collection timeout'));
            }, maxWaitTime + 10000); // Add 10 seconds buffer

            const checkCollection = setInterval(() => {
                const status = this.webSocketCollector.getCollectionStatus();
                const activeCollection = status.activeCollections.find(c => c.symbol === symbol);
                
                if (!activeCollection) {
                    // Collection completed
                    clearInterval(checkCollection);
                    clearTimeout(timeout);
                    
                    // Get the result
                    this.webSocketCollector.finalizeCandleCollection(symbol)
                        .then(resolve)
                        .catch(reject);
                }
            }, 1000); // Check every second
        });
    }

    /**
     * Fetch tick data from REST API (rate-limited)
     */
    async fetchFromRestAPI(symbol, openTime, closeTime, interval, startTime) {
        try {
            // Check if currently banned
            if (isCurrentlyBanned()) {
                const status = getRateLimiterStatus();
                const waitTime = Math.round((status.banExpiry - Date.now()) / 1000 / 60);
                throw new Error(`REST API banned for ${waitTime} more minutes`);
            }

            console.log('🚦 Using rate-limited REST API for historical data...');
            const result = await fetchReversalCandleTickData(symbol, openTime, closeTime, interval);
            
            // Add data source metadata
            result.dataSource = 'rest_api';
            return result;

        } catch (error) {
            const executionTime = Math.round(performance.now() - startTime);
            
            return {
                symbol: symbol,
                interval: interval,
                timeframe: {
                    openTime: openTime,
                    closeTime: closeTime,
                    duration: closeTime - openTime
                },
                trades: [],
                tradesCount: 0,
                executionTime: executionTime,
                fetchedAt: new Date(),
                success: false,
                error: error.message,
                dataSource: 'rest_api_failed'
            };
        }
    }

    /**
     * Get current fetcher status
     */
    getStatus() {
        const webSocketStatus = this.webSocketCollector ? this.webSocketCollector.getCollectionStatus() : null;
        const rateLimiterStatus = getRateLimiterStatus();

        return {
            webSocket: {
                active: this.isWebSocketActive,
                startTime: this.webSocketStartTime,
                connected: webSocketStatus ? webSocketStatus.isConnected : false,
                subscribedSymbols: webSocketStatus ? webSocketStatus.subscribedSymbols : [],
                activeCollections: webSocketStatus ? webSocketStatus.activeCollections : []
            },
            restApi: {
                banned: rateLimiterStatus.isBanned,
                banExpiry: rateLimiterStatus.banExpiry,
                requestCount: rateLimiterStatus.requestCount,
                hourlyLimit: rateLimiterStatus.hourlyLimit
            },
            buffer: {
                bufferedCandles: this.tickDataBuffer.size,
                memoryUsage: this.getBufferMemoryUsage()
            }
        };
    }

    /**
     * Calculate approximate memory usage of tick data buffer
     */
    getBufferMemoryUsage() {
        let totalTrades = 0;
        for (const data of this.tickDataBuffer.values()) {
            totalTrades += data.trades.length;
        }
        return `~${Math.round(totalTrades * 0.1)}KB`; // Rough estimate
    }

    /**
     * Clean up old buffered data to manage memory
     */
    cleanupBuffer(maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
        const cutoffTime = Date.now() - maxAge;
        let cleaned = 0;

        for (const [key, data] of this.tickDataBuffer.entries()) {
            if (data.endTime < cutoffTime) {
                this.tickDataBuffer.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 Cleaned up ${cleaned} old tick data buffers`);
        }

        return cleaned;
    }

    /**
     * Shutdown and cleanup
     */
    async shutdown() {
        console.log('🔌 Shutting down hybrid tick data fetcher...');
        
        if (this.webSocketCollector) {
            this.webSocketCollector.disconnect();
        }
        
        this.tickDataBuffer.clear();
        this.isWebSocketActive = false;
        
        console.log('✅ Hybrid fetcher shutdown complete');
    }
}

// Global instance
let globalHybridFetcher = null;

/**
 * Get or create global hybrid fetcher instance
 */
function getGlobalHybridFetcher() {
    if (!globalHybridFetcher) {
        globalHybridFetcher = new HybridTickDataFetcher();
    }
    return globalHybridFetcher;
}

/**
 * Initialize global hybrid fetcher with WebSocket
 */
async function initializeGlobalHybridFetcher(selectedSymbols = []) {
    const fetcher = getGlobalHybridFetcher();
    await fetcher.initializeWebSocket(selectedSymbols);
    return fetcher;
}

module.exports = {
    HybridTickDataFetcher,
    getGlobalHybridFetcher,
    initializeGlobalHybridFetcher
};
