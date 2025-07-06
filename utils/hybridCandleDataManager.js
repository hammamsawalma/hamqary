/**
 * Hybrid Candle Data Manager
 * Combines REST API (historical) + WebSocket (real-time) for 1-minute OHLC data
 * Manages the complete data flow from historical backfill to real-time processing
 */

const { getGlobalCandleCollector, initializeGlobalCandleCollector } = require('./websocketCandleCollector');
const { detectReversalCandle } = require('./reversalCandleDetector');
const { saveReversalCandle } = require('../models/database');
const { fetchReversalCandleTickData } = require('./fetchHistoricalTickData');
const { calculateReversalVolumeFootprint } = require('./volumeFootprintCalculator');
const { validateTradeSignal } = require('./tradeSignalValidator');
const { getGlobalGapRecoverySystem } = require('./gapRecoverySystem');
const getPerpetualCandleData = require('./getPerpetualCandleData');

class HybridCandleDataManager {
    constructor(client, dbName) {
        this.client = client;
        this.dbName = dbName;
        this.db = client.db(dbName);
        
        // WebSocket collector instance
        this.candleCollector = null;
        this.isWebSocketActive = false;
        this.webSocketStartTime = null;
        
        // Time cycle definitions for artificial candle generation
        this.TIME_CYCLES = {
            2: 60, 3: 60, 4: 60, 5: 60, 6: 60,
            7: 420, 8: 120, 9: 360, 10: 60, 11: 660,
            12: 60, 13: 780, 14: 420, 15: 60, 16: 240,
            17: 1020, 18: 360, 19: 1140, 20: 60,
            21: 420, 22: 660, 23: 1380, 24: 120, 25: 300,
            26: 780, 27: 540, 28: 420, 29: 1740, 30: 60,
            31: 1860, 32: 480, 33: 660, 34: 1020, 35: 420,
            36: 180, 37: 2220, 38: 1140, 39: 780, 40: 120,
            41: 2460, 42: 420, 43: 2580, 44: 660, 45: 180,
            46: 1380, 47: 2820, 48: 240, 49: 2940, 50: 300,
            51: 1020, 52: 780, 53: 3180, 54: 540, 55: 660,
            56: 840, 57: 1140, 58: 1740, 59: 3540, 60: 60
        };
        
        // All intervals we support (2-60 minutes)
        this.supportedIntervals = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
                                   21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
                                   41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60];
        
        // Statistics
        this.stats = {
            historicalCandlesLoaded: 0,
            realtimeCandlesProcessed: 0,
            artificialCandlesGenerated: 0,
            reversalPatternsDetected: 0,
            lastProcessedCandle: null,
            startTime: new Date()
        };
        
        console.log('🔄 Hybrid Candle Data Manager initialized');
    }
    
    /**
     * Initialize the hybrid system
     */
    async initialize(selectedSymbols = []) {
        console.log('🚀 Initializing Hybrid Candle Data System...');
        
        try {
            // Step 1: Load historical 1-minute data via API
            if (selectedSymbols.length > 0) {
                console.log(`📊 Loading historical 1-minute data for ${selectedSymbols.length} symbols...`);
                await this.loadHistoricalData(selectedSymbols);
            }
            
            // Step 2: Initialize WebSocket for real-time data
            console.log('📡 Initializing WebSocket for real-time 1-minute data...');
            await this.initializeWebSocket(selectedSymbols);
            
            // Step 3: Generate initial artificial candles from historical data
            if (selectedSymbols.length > 0) {
                console.log('🔧 Generating artificial candles from historical data...');
                await this.generateInitialArtificialCandles();
            }
            
            console.log('✅ Hybrid Candle Data System initialized successfully');
            return true;
            
        } catch (error) {
            console.error('❌ Failed to initialize Hybrid Candle Data System:', error);
            throw error;
        }
    }
    
    /**
     * Load historical 1-minute data via REST API
     */
    async loadHistoricalData(selectedSymbols) {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - (180 * 60 * 1000)); // 180 minutes ago
        
        console.log(`🕒 Loading historical 1-minute data from ${startTime.toISOString()} to ${endTime.toISOString()}`);
        
        const options = {
            startTime: startTime.getTime(),
            endTime: endTime.getTime(),
            limit: 180
        };
        
        try {
            // Fetch 1-minute data via API
            const candleData = await getPerpetualCandleData(selectedSymbols, '1m', options);
            
            let totalStored = 0;
            
            // Process each symbol's historical data
            for (const symbol of selectedSymbols) {
                if (!candleData[symbol] || !Array.isArray(candleData[symbol])) {
                    console.warn(`⚠️ No historical data for ${symbol}`);
                    continue;
                }
                
                const symbolCandles = candleData[symbol];
                const validCandles = symbolCandles.filter(candle => candle.closeTime < Date.now());
                
                console.log(`📈 Processing ${validCandles.length} historical 1-minute candles for ${symbol}`);
                
                for (const candle of validCandles) {
                    await this.processOneMinuteCandle({
                        symbol: symbol,
                        interval: '1m',
                        openTime: new Date(candle.openTime),
                        closeTime: new Date(candle.closeTime),
                        open: candle.open,
                        high: candle.high,
                        low: candle.low,
                        close: candle.close,
                        volume: candle.volume,
                        quoteAssetVolume: candle.quoteAssetVolume,
                        numberOfTrades: candle.numberOfTrades,
                        takerBuyBaseAssetVolume: candle.takerBuyBaseAssetVolume,
                        takerBuyQuoteAssetVolume: candle.takerBuyQuoteAssetVolume,
                        fetchedAt: new Date(),
                        dataSource: 'api_historical'
                    });
                    
                    totalStored++;
                }
            }
            
            this.stats.historicalCandlesLoaded = totalStored;
            console.log(`✅ Loaded ${totalStored} historical 1-minute candles`);
            
        } catch (error) {
            console.error('❌ Error loading historical data:', error);
            throw error;
        }
    }
    
    /**
     * Initialize WebSocket for real-time data with gap recovery
     */
    async initializeWebSocket(selectedSymbols) {
        try {
            // Initialize gap recovery system
            const gapRecoverySystem = getGlobalGapRecoverySystem(this.client, this.dbName);
            
            this.candleCollector = await initializeGlobalCandleCollector({
                onClosedCandle: (candleData) => this.handleRealtimeCandle(candleData),
                onConnect: () => {
                    console.log('✅ WebSocket connected - real-time 1-minute data active');
                    this.isWebSocketActive = true;
                    this.webSocketStartTime = Date.now();
                },
                onDisconnect: (code, reason) => {
                    console.log(`🔌 WebSocket disconnected: ${code} - ${reason}`);
                    this.isWebSocketActive = false;
                },
                onError: (error) => {
                    console.error('❌ WebSocket error:', error);
                },
                onGapDetected: async (gaps) => {
                    console.log(`🚨 Gap recovery triggered for ${gaps.length} symbols`);
                    try {
                        const recoveryStats = await gapRecoverySystem.processDetectedGaps(gaps);
                        console.log(`✅ Gap recovery completed: ${recoveryStats.totalCandlesRecovered} candles recovered`);
                        
                        // Update stats
                        this.stats.gapsRecovered = (this.stats.gapsRecovered || 0) + recoveryStats.totalCandlesRecovered;
                        this.stats.lastGapRecovery = recoveryStats.lastRecoveryTime;
                        
                    } catch (error) {
                        console.error('❌ Gap recovery failed:', error);
                    }
                }
            });
            
            // Initialize last candle timestamps for gap detection
            if (selectedSymbols.length > 0) {
                console.log('📊 Initializing gap detection timestamps...');
                await this.candleCollector.initializeLastCandleTimestamps(selectedSymbols);
            }
            
            // Subscribe to selected symbols
            if (selectedSymbols.length > 0) {
                const results = this.candleCollector.subscribeToSymbols(selectedSymbols);
                const successCount = results.filter(r => r.success).length;
                console.log(`📊 Subscribed to ${successCount}/${selectedSymbols.length} real-time candlestick streams`);
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Failed to initialize WebSocket:', error);
            throw error;
        }
    }
    
    /**
     * Handle real-time candle data from WebSocket
     */
    async handleRealtimeCandle(candleData) {
        console.log(`⚡ Real-time 1-minute candle: ${candleData.symbol} at ${candleData.closeTime.toISOString()}`);
        
        try {
            // Process the 1-minute candle
            await this.processOneMinuteCandle(candleData);
            
            this.stats.realtimeCandlesProcessed++;
            this.stats.lastProcessedCandle = new Date();
            
            // Check if we need to generate artificial candles
            await this.checkAndGenerateArtificialCandles(candleData.closeTime);
            
        } catch (error) {
            console.error(`❌ Error handling real-time candle for ${candleData.symbol}:`, error);
        }
    }
    
    /**
     * Process a single 1-minute candle (store and detect reversals)
     */
    async processOneMinuteCandle(candleData) {
        try {
            const candleCollection = this.db.collection('candleData');
            
            // Store the 1-minute candle
            await candleCollection.updateOne(
                { 
                    symbol: candleData.symbol, 
                    interval: candleData.interval,
                    openTime: candleData.openTime 
                },
                { $set: candleData },
                { upsert: true }
            );
            
            // Detect reversal pattern for 1-minute candles
            const reversalPattern = detectReversalCandle(candleData);
            
            if (reversalPattern) {
                console.log(`🔄 Reversal pattern detected in ${candleData.symbol} 1m candle: ${reversalPattern.type}`);
                
                // Check if this reversal already exists
                const reversalCollection = this.db.collection('reversalCandles');
                const existingReversal = await reversalCollection.findOne({
                    symbol: candleData.symbol,
                    interval: candleData.interval,
                    openTime: candleData.openTime
                });
                
                if (!existingReversal) {
                    await this.processReversalCandle(candleData, reversalPattern);
                    this.stats.reversalPatternsDetected++;
                }
            }
            
        } catch (error) {
            console.error(`❌ Error processing 1-minute candle for ${candleData.symbol}:`, error);
        }
    }
    
    /**
     * Process reversal candle with volume footprint and trade signal validation
     */
    async processReversalCandle(candleData, reversalPattern) {
        try {
            const reversalData = {
                symbol: candleData.symbol,
                interval: candleData.interval,
                openTime: candleData.openTime,
                closeTime: candleData.closeTime,
                candleData: {
                    open: candleData.open,
                    high: candleData.high,
                    low: candleData.low,
                    close: candleData.close,
                    volume: candleData.volume,
                    numberOfTrades: candleData.numberOfTrades
                },
                reversalPattern: reversalPattern
            };
            
            // Calculate volume footprint
            const openTime = candleData.openTime instanceof Date ? candleData.openTime.getTime() : candleData.openTime;
            const closeTime = candleData.closeTime instanceof Date ? candleData.closeTime.getTime() : candleData.closeTime;
            
            const tickDataResult = await fetchReversalCandleTickData(
                candleData.symbol,
                openTime,
                closeTime,
                candleData.interval
            );
            
            if (tickDataResult.success && tickDataResult.trades.length > 0) {
                const volumeFootprint = calculateReversalVolumeFootprint(
                    tickDataResult.trades,
                    candleData.symbol,
                    openTime,
                    closeTime
                );
                
                if (!volumeFootprint.error) {
                    reversalData.volumeFootprint = {
                        poc: volumeFootprint.poc,
                        vah: volumeFootprint.vah,
                        val: volumeFootprint.val,
                        totalVolume: volumeFootprint.totalVolume,
                        valueAreaVolume: volumeFootprint.valueAreaVolume,
                        valueAreaPercentage: volumeFootprint.valueAreaPercentage,
                        tickDataSource: candleData.dataSource === 'websocket_realtime' ? 'realtime' : 'historical',
                        calculatedAt: new Date(),
                        tradesProcessed: volumeFootprint.tradesProcessed,
                        executionTime: tickDataResult.executionTime
                    };
                    
                    // Validate trade signal
                    const tradeSignalValidation = validateTradeSignal(
                        reversalData.candleData,
                        reversalData.volumeFootprint,
                        reversalPattern.type
                    );
                    
                    reversalData.tradeSignal = {
                        isValidSignal: tradeSignalValidation.isValidSignal,
                        signalType: tradeSignalValidation.signalType,
                        reason: tradeSignalValidation.reason,
                        score: tradeSignalValidation.score || 0,
                        criteria: tradeSignalValidation.criteria,
                        validatedAt: new Date()
                    };
                    
                    console.log(`🚦 Trade signal: ${tradeSignalValidation.isValidSignal ? '✅ VALID' : '❌ INVALID'} (${tradeSignalValidation.signalType || 'none'})`);
                }
            }
            
            // Save reversal candle
            await saveReversalCandle(this.client, this.dbName, reversalData);
            
        } catch (error) {
            console.error(`❌ Error processing reversal candle:`, error);
        }
    }
    
    /**
     * Check if artificial candles need to be generated based on time boundaries
     */
    async checkAndGenerateArtificialCandles(currentTime) {
        const currentMinute = new Date(currentTime);
        
        for (const interval of this.supportedIntervals) {
            if (this.shouldGenerateArtificialCandle(currentMinute, interval)) {
                console.log(`🔧 Generating ${interval}m artificial candles at ${currentMinute.toISOString()}`);
                
                try {
                    const result = await this.generateArtificialCandleForInterval(interval);
                    this.stats.artificialCandlesGenerated += result.candlesGenerated;
                    
                    console.log(`✅ Generated ${result.candlesGenerated} ${interval}m artificial candles (${result.reversalPatternsDetected} reversals)`);
                } catch (error) {
                    console.error(`❌ Error generating ${interval}m artificial candles:`, error);
                }
            }
        }
    }
    
    /**
     * Check if an artificial candle should be generated for the given interval
     */
    shouldGenerateArtificialCandle(currentTime, intervalMinutes) {
        const cycleMinutes = this.TIME_CYCLES[intervalMinutes];
        
        // Calculate midnight UTC
        const midnightUTC = new Date(Date.UTC(currentTime.getUTCFullYear(), currentTime.getUTCMonth(), currentTime.getUTCDate(), 0, 0, 0, 0));
        
        // Calculate time since midnight
        const msSinceMidnight = currentTime.getTime() - midnightUTC.getTime();
        const cycleMs = cycleMinutes * 60 * 1000;
        const intervalMs = intervalMinutes * 60 * 1000;
        
        // Find current cycle and interval
        const currentCycleIndex = Math.floor(msSinceMidnight / cycleMs);
        const currentCycleStart = midnightUTC.getTime() + (currentCycleIndex * cycleMs);
        const msSinceCycleStart = currentTime.getTime() - currentCycleStart;
        const currentIntervalIndex = Math.floor(msSinceCycleStart / intervalMs);
        
        // Calculate interval boundaries
        const intervalStart = currentCycleStart + (currentIntervalIndex * intervalMs);
        const intervalEnd = intervalStart + intervalMs;
        
        // Check if the current time aligns with interval end (within 1 minute tolerance)
        const timeSinceIntervalEnd = currentTime.getTime() - intervalEnd;
        
        // Should generate if we're within 1 minute after interval end
        return timeSinceIntervalEnd >= 0 && timeSinceIntervalEnd < 60000;
    }
    
    /**
     * Generate artificial candles for a specific interval
     */
    async generateArtificialCandleForInterval(intervalMinutes) {
        // This is a simplified version - in practice, you'd import generateArtificialCandleData
        // For now, return mock results
        const generateArtificialCandleData = require('./generateArtificialCandleData');
        return await generateArtificialCandleData(this.client, this.dbName, intervalMinutes);
    }
    
    /**
     * Generate initial artificial candles from historical data
     */
    async generateInitialArtificialCandles() {
        let totalGenerated = 0;
        
        for (const interval of this.supportedIntervals) {
            try {
                console.log(`📊 Generating initial ${interval}m artificial candles...`);
                const result = await this.generateArtificialCandleForInterval(interval);
                totalGenerated += result.candlesGenerated;
                console.log(`✅ Generated ${result.candlesGenerated} ${interval}m candles`);
            } catch (error) {
                console.error(`❌ Error generating initial ${interval}m candles:`, error);
            }
        }
        
        console.log(`🎯 Generated ${totalGenerated} total artificial candles from historical data`);
        return totalGenerated;
    }
    
    /**
     * Update symbol subscriptions
     */
    async updateSymbols(newSymbols) {
        console.log(`🔄 Updating symbols for hybrid system...`);
        
        try {
            // Update WebSocket subscriptions
            if (this.candleCollector && this.isWebSocketActive) {
                const result = this.candleCollector.updateSymbolSubscriptions(newSymbols);
                console.log(`📊 Updated WebSocket subscriptions: +${result.added} -${result.removed} = ${result.total} total`);
            }
            
            // Load historical data for new symbols
            const currentSymbols = this.candleCollector ? Array.from(this.candleCollector.subscribedSymbols) : [];
            const newSymbolsToLoad = newSymbols.filter(symbol => !currentSymbols.includes(symbol));
            
            if (newSymbolsToLoad.length > 0) {
                console.log(`🆕 Loading historical data for ${newSymbolsToLoad.length} new symbols...`);
                await this.loadHistoricalData(newSymbolsToLoad);
                
                // Generate artificial candles for new symbols
                await this.generateInitialArtificialCandles();
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Error updating symbols:', error);
            return false;
        }
    }
    
    /**
     * Get system status
     */
    getStatus() {
        const wsStatus = this.candleCollector ? this.candleCollector.getStatus() : null;
        
        return {
            isActive: this.isWebSocketActive,
            webSocketStartTime: this.webSocketStartTime,
            webSocketStatus: wsStatus,
            stats: {
                ...this.stats,
                uptime: Date.now() - this.stats.startTime.getTime()
            },
            supportedIntervals: this.supportedIntervals
        };
    }
    
    /**
     * Cleanup and disconnect
     */
    async cleanup() {
        console.log('🧹 Cleaning up Hybrid Candle Data Manager...');
        
        if (this.candleCollector) {
            this.candleCollector.disconnect();
            this.candleCollector = null;
        }
        
        this.isWebSocketActive = false;
        console.log('✅ Hybrid Candle Data Manager cleaned up');
    }
}

// Singleton instance for global use
let globalHybridManager = null;

/**
 * Get or create global hybrid manager instance
 */
function getGlobalHybridManager(client, dbName) {
    if (!globalHybridManager && client && dbName) {
        globalHybridManager = new HybridCandleDataManager(client, dbName);
    }
    return globalHybridManager;
}

/**
 * Initialize global hybrid manager
 */
async function initializeGlobalHybridManager(client, dbName, selectedSymbols = []) {
    const manager = getGlobalHybridManager(client, dbName);
    
    if (manager) {
        await manager.initialize(selectedSymbols);
    }
    
    return manager;
}

/**
 * Cleanup global hybrid manager
 */
async function cleanupGlobalHybridManager() {
    if (globalHybridManager) {
        await globalHybridManager.cleanup();
        globalHybridManager = null;
    }
}

module.exports = {
    HybridCandleDataManager,
    getGlobalHybridManager,
    initializeGlobalHybridManager,
    cleanupGlobalHybridManager
};
