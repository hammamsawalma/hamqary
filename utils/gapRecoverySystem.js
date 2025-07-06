/**
 * Gap Recovery System for Missing 1-minute Candle Data
 * Recovers missing candles during WebSocket disconnections using Binance REST API
 * Ensures data integrity for artificial candle generation
 */

const getPerpetualCandleData = require('./getPerpetualCandleData');
const { detectReversalCandle } = require('./reversalCandleDetector');
const { saveReversalCandle } = require('../models/database');
const { fetchReversalCandleTickData } = require('./fetchHistoricalTickData');
const { calculateReversalVolumeFootprint } = require('./volumeFootprintCalculator');
const { validateTradeSignal } = require('./tradeSignalValidator');

class GapRecoverySystem {
    constructor(client, dbName) {
        this.client = client;
        this.dbName = dbName;
        this.db = client.db(dbName);
        
        // Recovery statistics
        this.stats = {
            totalGapsDetected: 0,
            totalCandlesRecovered: 0,
            totalSymbolsProcessed: 0,
            reversalPatternsDetected: 0,
            lastRecoveryTime: null,
            recoveryDuration: 0,
            errors: []
        };
        
        console.log('🔧 Gap Recovery System initialized');
    }
    
    /**
     * Process detected gaps and recover missing data
     */
    async processDetectedGaps(gaps) {
        console.log('🚑 Starting gap recovery process...');
        const startTime = Date.now();
        
        this.stats.totalGapsDetected = gaps.length;
        this.stats.totalSymbolsProcessed = gaps.length;
        this.stats.lastRecoveryTime = new Date();
        this.stats.errors = [];
        
        let totalRecovered = 0;
        
        for (const { symbol, gaps: symbolGaps } of gaps) {
            try {
                console.log(`🔄 Recovering ${symbolGaps.length} missing candles for ${symbol}...`);
                
                const recovered = await this.recoverGapsForSymbol(symbol, symbolGaps);
                totalRecovered += recovered.candlesRecovered;
                this.stats.reversalPatternsDetected += recovered.reversalPatternsDetected;
                
                console.log(`✅ ${symbol}: Recovered ${recovered.candlesRecovered} candles, detected ${recovered.reversalPatternsDetected} reversals`);
                
            } catch (error) {
                console.error(`❌ Error recovering gaps for ${symbol}:`, error);
                this.stats.errors.push({
                    symbol,
                    error: error.message,
                    timestamp: new Date()
                });
            }
        }
        
        this.stats.totalCandlesRecovered = totalRecovered;
        this.stats.recoveryDuration = Date.now() - startTime;
        
        console.log(`🎯 Gap recovery summary:`);
        console.log(`   └── Symbols processed: ${this.stats.totalSymbolsProcessed}`);
        console.log(`   └── Candles recovered: ${this.stats.totalCandlesRecovered}`);
        console.log(`   └── Reversals detected: ${this.stats.reversalPatternsDetected}`);
        console.log(`   └── Duration: ${this.stats.recoveryDuration}ms`);
        console.log(`   └── Errors: ${this.stats.errors.length}`);
        
        // Regenerate affected artificial candles
        if (totalRecovered > 0) {
            await this.regenerateAffectedArtificialCandles(gaps);
        }
        
        return this.stats;
    }
    
    /**
     * Recover gaps for a specific symbol
     */
    async recoverGapsForSymbol(symbol, gaps) {
        if (gaps.length === 0) {
            return { candlesRecovered: 0, reversalPatternsDetected: 0 };
        }
        
        // Group consecutive gaps for efficient API calls
        const gapGroups = this.groupConsecutiveGaps(gaps);
        
        let candlesRecovered = 0;
        let reversalPatternsDetected = 0;
        
        for (const group of gapGroups) {
            try {
                const recovered = await this.recoverGapGroup(symbol, group);
                candlesRecovered += recovered.candlesRecovered;
                reversalPatternsDetected += recovered.reversalPatternsDetected;
                
            } catch (error) {
                console.error(`❌ Error recovering gap group for ${symbol}:`, error);
                throw error;
            }
        }
        
        return { candlesRecovered, reversalPatternsDetected };
    }
    
    /**
     * Group consecutive gaps to minimize API calls
     */
    groupConsecutiveGaps(gaps) {
        if (gaps.length === 0) return [];
        
        // Sort gaps by time
        const sortedGaps = gaps.sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
        
        const groups = [];
        let currentGroup = [sortedGaps[0]];
        
        for (let i = 1; i < sortedGaps.length; i++) {
            const prevGap = currentGroup[currentGroup.length - 1];
            const currentGap = sortedGaps[i];
            
            // Check if gaps are consecutive (within 1 minute)
            const timeDiff = currentGap.openTime.getTime() - prevGap.closeTime.getTime();
            
            if (timeDiff <= 1000) { // 1 second tolerance
                currentGroup.push(currentGap);
            } else {
                groups.push(currentGroup);
                currentGroup = [currentGap];
            }
        }
        
        groups.push(currentGroup);
        return groups;
    }
    
    /**
     * Recover a group of consecutive gaps using single API call
     */
    async recoverGapGroup(symbol, gapGroup) {
        const startTime = gapGroup[0].openTime;
        const endTime = gapGroup[gapGroup.length - 1].closeTime;
        
        console.log(`📊 Fetching missing data for ${symbol} from ${startTime.toISOString()} to ${endTime.toISOString()}`);
        
        const options = {
            startTime: startTime.getTime(),
            endTime: endTime.getTime() + 1000, // Add 1 second to include end time
            limit: gapGroup.length + 5 // Extra buffer for safety
        };
        
        try {
            // Fetch missing candles via API
            const candleData = await getPerpetualCandleData([symbol], '1m', options);
            
            if (!candleData[symbol] || !Array.isArray(candleData[symbol])) {
                console.warn(`⚠️ No API data returned for ${symbol} gap recovery`);
                return { candlesRecovered: 0, reversalPatternsDetected: 0 };
            }
            
            const apiCandles = candleData[symbol];
            let candlesRecovered = 0;
            let reversalPatternsDetected = 0;
            
            console.log(`📈 Processing ${apiCandles.length} API candles for gap recovery`);
            
            for (const apiCandle of apiCandles) {
                // Verify this candle fills a gap
                const candleOpenTime = new Date(apiCandle.openTime);
                const matchingGap = gapGroup.find(gap => 
                    Math.abs(gap.openTime.getTime() - candleOpenTime.getTime()) < 1000
                );
                
                if (matchingGap) {
                    const candleData = {
                        symbol: symbol,
                        interval: '1m',
                        openTime: new Date(apiCandle.openTime),
                        closeTime: new Date(apiCandle.closeTime),
                        open: apiCandle.open,
                        high: apiCandle.high,
                        low: apiCandle.low,
                        close: apiCandle.close,
                        volume: apiCandle.volume,
                        quoteAssetVolume: apiCandle.quoteAssetVolume,
                        numberOfTrades: apiCandle.numberOfTrades,
                        takerBuyBaseAssetVolume: apiCandle.takerBuyBaseAssetVolume,
                        takerBuyQuoteAssetVolume: apiCandle.takerBuyQuoteAssetVolume,
                        fetchedAt: new Date(),
                        dataSource: 'api_gap_recovery'
                    };
                    
                    // Store recovered candle
                    await this.storeRecoveredCandle(candleData);
                    candlesRecovered++;
                    
                    // Check for reversal patterns
                    const reversalPattern = detectReversalCandle(candleData);
                    if (reversalPattern) {
                        console.log(`🔄 Reversal pattern detected in recovered ${symbol} candle: ${reversalPattern.type}`);
                        await this.processRecoveredReversalCandle(candleData, reversalPattern);
                        reversalPatternsDetected++;
                    }
                }
            }
            
            console.log(`✅ Gap recovery for ${symbol}: ${candlesRecovered} candles stored`);
            return { candlesRecovered, reversalPatternsDetected };
            
        } catch (error) {
            console.error(`❌ API error during gap recovery for ${symbol}:`, error);
            throw error;
        }
    }
    
    /**
     * Store recovered candle in database
     */
    async storeRecoveredCandle(candleData) {
        try {
            const candleCollection = this.db.collection('candleData');
            
            await candleCollection.updateOne(
                { 
                    symbol: candleData.symbol, 
                    interval: candleData.interval,
                    openTime: candleData.openTime 
                },
                { $set: candleData },
                { upsert: true }
            );
            
        } catch (error) {
            console.error(`❌ Error storing recovered candle for ${candleData.symbol}:`, error);
            throw error;
        }
    }
    
    /**
     * Process reversal candle with volume footprint (for recovered data)
     */
    async processRecoveredReversalCandle(candleData, reversalPattern) {
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
            
            // Calculate volume footprint for recovered reversal
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
                        tickDataSource: 'gap_recovery',
                        calculatedAt: new Date(),
                        tradesProcessed: volumeFootprint.tradesProcessed,
                        executionTime: tickDataResult.executionTime
                    };
                    
                    // Validate trade signal for recovered reversal
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
                }
            }
            
            // Save recovered reversal candle
            await saveReversalCandle(this.client, this.dbName, reversalData);
            
        } catch (error) {
            console.error(`❌ Error processing recovered reversal candle:`, error);
        }
    }
    
    /**
     * Regenerate artificial candles affected by gap recovery
     */
    async regenerateAffectedArtificialCandles(gaps) {
        console.log('🔧 Regenerating artificial candles affected by gap recovery...');
        
        try {
            // Import artificial candle generator
            const generateArtificialCandleData = require('./generateArtificialCandleData');
            
            // Determine which timeframes need regeneration based on gap periods
            const affectedTimeframes = this.determineAffectedTimeframes(gaps);
            
            let totalRegenerated = 0;
            
            for (const interval of affectedTimeframes) {
                try {
                    console.log(`🔄 Regenerating ${interval}m artificial candles...`);
                    const result = await generateArtificialCandleData(this.client, this.dbName, interval);
                    totalRegenerated += result.candlesGenerated;
                    console.log(`✅ Regenerated ${result.candlesGenerated} ${interval}m artificial candles`);
                } catch (error) {
                    console.error(`❌ Error regenerating ${interval}m candles:`, error);
                }
            }
            
            console.log(`🎯 Regenerated ${totalRegenerated} artificial candles across ${affectedTimeframes.length} timeframes`);
            
        } catch (error) {
            console.error('❌ Error during artificial candle regeneration:', error);
        }
    }
    
    /**
     * Determine which artificial timeframes are affected by gaps
     */
    determineAffectedTimeframes(gaps) {
        // All supported intervals (2-60 minutes)
        const allTimeframes = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
                              21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
                              41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60];
        
        // For gap recovery, we regenerate all timeframes to ensure consistency
        // In practice, you might optimize this to only regenerate timeframes that could be affected
        console.log(`📊 Will regenerate all ${allTimeframes.length} artificial timeframes to ensure data consistency`);
        
        return allTimeframes;
    }
    
    /**
     * Get recovery statistics
     */
    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.totalSymbolsProcessed > 0 ? 
                ((this.stats.totalSymbolsProcessed - this.stats.errors.length) / this.stats.totalSymbolsProcessed * 100).toFixed(2) + '%' : 
                'N/A'
        };
    }
    
    /**
     * Clear statistics (for fresh tracking)
     */
    clearStats() {
        this.stats = {
            totalGapsDetected: 0,
            totalCandlesRecovered: 0,
            totalSymbolsProcessed: 0,
            reversalPatternsDetected: 0,
            lastRecoveryTime: null,
            recoveryDuration: 0,
            errors: []
        };
    }
}

// Singleton instance for global use
let globalGapRecoverySystem = null;

/**
 * Get or create global gap recovery system
 */
function getGlobalGapRecoverySystem(client, dbName) {
    if (!globalGapRecoverySystem && client && dbName) {
        globalGapRecoverySystem = new GapRecoverySystem(client, dbName);
    }
    return globalGapRecoverySystem;
}

/**
 * Cleanup global gap recovery system
 */
function cleanupGlobalGapRecoverySystem() {
    if (globalGapRecoverySystem) {
        globalGapRecoverySystem = null;
    }
}

module.exports = {
    GapRecoverySystem,
    getGlobalGapRecoverySystem,
    cleanupGlobalGapRecoverySystem
};
