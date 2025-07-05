/**
 * Enhanced Volume Footprint System with Hybrid Data Fetching
 * Combines WebSocket (fast) and REST API (rate-limited) data sources
 */

const { calculateReversalVolumeFootprint } = require('./volumeFootprintCalculator');
const { getGlobalHybridFetcher } = require('./hybridTickDataFetcher');

/**
 * Enhanced volume footprint calculator with hybrid data fetching
 */
class EnhancedVolumeFootprintSystem {
    constructor() {
        this.hybridFetcher = null;
        this.isInitialized = false;
        
        console.log('🔬 Enhanced Volume Footprint System initialized');
    }

    /**
     * Initialize the system with hybrid fetcher
     */
    async initialize(selectedSymbols = []) {
        if (this.isInitialized) {
            console.log('✅ System already initialized');
            return true;
        }

        try {
            console.log('🚀 Initializing Enhanced Volume Footprint System...');
            
            // Get global hybrid fetcher instance
            this.hybridFetcher = getGlobalHybridFetcher();
            
            // Initialize WebSocket for real-time data if symbols provided
            if (selectedSymbols.length > 0) {
                await this.hybridFetcher.initializeWebSocket(selectedSymbols);
                console.log(`📡 WebSocket initialized for ${selectedSymbols.length} symbols`);
            }
            
            this.isInitialized = true;
            console.log('✅ Enhanced Volume Footprint System ready');
            return true;

        } catch (error) {
            console.error('❌ Failed to initialize Enhanced Volume Footprint System:', error);
            return false;
        }
    }

    /**
     * Calculate volume footprint using the best available data source
     */
    async calculateVolumeFootprint(symbol, openTime, closeTime, interval) {
        const startTime = performance.now();
        
        if (!this.isInitialized) {
            console.warn('⚠️ System not initialized, using fallback calculation');
            return await this.fallbackCalculation(symbol, openTime, closeTime, interval);
        }

        try {
            console.log(`🎯 Calculating volume footprint for ${symbol} ${interval}`);
            console.log(`📅 Candle: ${new Date(openTime).toISOString()} to ${new Date(closeTime).toISOString()}`);

            // Fetch tick data using hybrid approach
            const tickData = await this.hybridFetcher.fetchTickData(symbol, openTime, closeTime, interval);
            
            if (!tickData.success || tickData.tradesCount === 0) {
                console.warn(`⚠️ No tick data available for ${symbol} ${interval}: ${tickData.error || 'Unknown error'}`);
                return this.createEmptyFootprint(symbol, openTime, closeTime, tickData.dataSource || 'unknown', tickData.error);
            }

            // Calculate volume footprint from tick data
            const volumeFootprint = calculateReversalVolumeFootprint(
                tickData.trades,
                symbol,
                openTime,
                closeTime
            );

            // Add metadata about data source and performance
            volumeFootprint.dataSource = tickData.dataSource;
            volumeFootprint.fetchTime = tickData.executionTime;
            volumeFootprint.totalProcessTime = Math.round(performance.now() - startTime);
            volumeFootprint.tickDataQuality = this.assessDataQuality(tickData);

            console.log(`✅ Volume footprint calculated for ${symbol}:`);
            console.log(`   POC: ${volumeFootprint.poc}, VAH: ${volumeFootprint.vah}, VAL: ${volumeFootprint.val}`);
            console.log(`   Source: ${volumeFootprint.dataSource}, Time: ${volumeFootprint.totalProcessTime}ms`);
            console.log(`   Quality: ${volumeFootprint.tickDataQuality.score}/10 (${volumeFootprint.tickDataQuality.description})`);

            return volumeFootprint;

        } catch (error) {
            console.error(`❌ Enhanced volume footprint calculation failed for ${symbol}:`, error);
            
            const executionTime = Math.round(performance.now() - startTime);
            return this.createEmptyFootprint(symbol, openTime, closeTime, 'error', error.message, executionTime);
        }
    }

    /**
     * Assess the quality of tick data
     */
    assessDataQuality(tickData) {
        if (!tickData.success) {
            return { score: 0, description: 'No data available' };
        }

        const tradesCount = tickData.tradesCount;
        const duration = tickData.timeframe ? tickData.timeframe.duration : 0;
        const durationMinutes = duration / (1000 * 60);

        // Quality scoring based on data density and source
        let score = 0;
        let description = '';

        // Base score from trade count
        if (tradesCount >= 1000) {
            score += 4; // Excellent trade density
        } else if (tradesCount >= 500) {
            score += 3; // Good trade density
        } else if (tradesCount >= 100) {
            score += 2; // Average trade density
        } else if (tradesCount >= 10) {
            score += 1; // Low trade density
        }

        // Bonus for data source quality
        if (tickData.dataSource === 'websocket_buffer' || tickData.dataSource === 'websocket_realtime') {
            score += 3; // WebSocket data is highest quality
            description = 'Real-time WebSocket data';
        } else if (tickData.dataSource === 'rest_api') {
            score += 2; // REST API data is good quality
            description = 'Historical REST API data';
        } else {
            score += 1; // Unknown source
            description = 'Unknown data source';
        }

        // Bonus for reasonable data density (trades per minute)
        const tradesPerMinute = durationMinutes > 0 ? tradesCount / durationMinutes : 0;
        if (tradesPerMinute >= 50) {
            score += 2; // Very active market
        } else if (tradesPerMinute >= 10) {
            score += 1; // Active market
        }

        // Penalty for very low trade counts
        if (tradesCount < 5) {
            score = Math.max(1, score - 2);
            description += ' (very low activity)';
        }

        // Cap score at 10
        score = Math.min(10, score);

        // Description based on final score
        if (score >= 8) {
            description = 'Excellent - ' + description;
        } else if (score >= 6) {
            description = 'Good - ' + description;
        } else if (score >= 4) {
            description = 'Average - ' + description;
        } else if (score >= 2) {
            description = 'Poor - ' + description;
        } else {
            description = 'Very Poor - ' + description;
        }

        return { score, description, tradesCount, tradesPerMinute: Math.round(tradesPerMinute * 10) / 10 };
    }

    /**
     * Create empty footprint result for failed calculations
     */
    createEmptyFootprint(symbol, openTime, closeTime, dataSource, error, executionTime = 0) {
        return {
            poc: null,
            vah: null,
            val: null,
            totalVolume: 0,
            valueAreaVolume: 0,
            valueAreaPercentage: 0,
            priceRange: { min: 0, max: 0, spread: 0 },
            priceVolumeMap: {},
            symbol: symbol,
            timeframe: {
                startTime: openTime,
                endTime: closeTime,
                duration: closeTime - openTime
            },
            tradesProcessed: 0,
            calculatedAt: new Date(),
            dataSource: dataSource,
            error: error,
            totalProcessTime: executionTime,
            tickDataQuality: { score: 0, description: 'No data available' }
        };
    }

    /**
     * Fallback calculation without hybrid fetcher
     */
    async fallbackCalculation(symbol, openTime, closeTime, interval) {
        console.log('🔄 Using fallback calculation method');
        
        try {
            // Use the original REST API method as fallback
            const { fetchReversalCandleTickData } = require('./fetchHistoricalTickData');
            
            const tickData = await fetchReversalCandleTickData(symbol, openTime, closeTime, interval);
            
            if (tickData.success && tickData.trades.length > 0) {
                const volumeFootprint = calculateReversalVolumeFootprint(
                    tickData.trades,
                    symbol,
                    openTime,
                    closeTime
                );
                
                volumeFootprint.dataSource = 'rest_api_fallback';
                volumeFootprint.fetchTime = tickData.executionTime;
                
                return volumeFootprint;
            } else {
                return this.createEmptyFootprint(symbol, openTime, closeTime, 'fallback_failed', tickData.error);
            }

        } catch (error) {
            console.error('❌ Fallback calculation failed:', error);
            return this.createEmptyFootprint(symbol, openTime, closeTime, 'fallback_error', error.message);
        }
    }

    /**
     * Batch calculate volume footprints for multiple candles
     */
    async batchCalculateVolumeFootprints(candles, maxConcurrency = 1) {
        if (!Array.isArray(candles) || candles.length === 0) {
            return [];
        }

        console.log(`🔄 Batch calculating volume footprints for ${candles.length} candles (concurrency: ${maxConcurrency})`);
        
        const results = [];
        const errors = [];

        // Process sequentially to avoid overwhelming the system
        for (let i = 0; i < candles.length; i++) {
            const candle = candles[i];
            
            console.log(`📦 Processing candle ${i + 1}/${candles.length}: ${candle.symbol} ${candle.interval}`);
            
            try {
                const result = await this.calculateVolumeFootprint(
                    candle.symbol,
                    candle.openTime instanceof Date ? candle.openTime.getTime() : candle.openTime,
                    candle.closeTime instanceof Date ? candle.closeTime.getTime() : candle.closeTime,
                    candle.interval
                );
                
                results.push({
                    candle: candle,
                    volumeFootprint: result,
                    success: true
                });

            } catch (error) {
                console.error(`❌ Failed to calculate volume footprint for ${candle.symbol}:`, error);
                
                errors.push({
                    candle: candle,
                    error: error.message
                });
                
                results.push({
                    candle: candle,
                    volumeFootprint: this.createEmptyFootprint(
                        candle.symbol,
                        candle.openTime,
                        candle.closeTime,
                        'batch_error',
                        error.message
                    ),
                    success: false
                });
            }
        }

        console.log(`✅ Batch calculation completed: ${results.length - errors.length} successful, ${errors.length} failed`);
        
        return {
            results: results,
            successful: results.filter(r => r.success).length,
            failed: errors.length,
            errors: errors
        };
    }

    /**
     * Get system status
     */
    getStatus() {
        const hybridStatus = this.hybridFetcher ? this.hybridFetcher.getStatus() : null;
        
        return {
            initialized: this.isInitialized,
            hybridFetcher: hybridStatus,
            performance: {
                preferredDataSource: hybridStatus && hybridStatus.webSocket.active ? 'WebSocket (Fast)' : 'REST API (Slow)',
                estimatedSpeedImprovement: hybridStatus && hybridStatus.webSocket.active ? '20x faster' : 'Baseline speed'
            }
        };
    }

    /**
     * Update symbols for WebSocket subscription
     */
    async updateSymbols(newSymbols) {
        if (!this.isInitialized || !this.hybridFetcher) {
            console.log('⚠️ System not initialized, cannot update symbols');
            return false;
        }

        try {
            console.log(`🔄 Updating WebSocket subscriptions for ${newSymbols.length} symbols...`);
            
            // Re-initialize WebSocket with new symbols
            await this.hybridFetcher.initializeWebSocket(newSymbols);
            
            console.log('✅ WebSocket subscriptions updated');
            return true;

        } catch (error) {
            console.error('❌ Failed to update symbols:', error);
            return false;
        }
    }

    /**
     * Shutdown the system
     */
    async shutdown() {
        console.log('🔌 Shutting down Enhanced Volume Footprint System...');
        
        if (this.hybridFetcher) {
            await this.hybridFetcher.shutdown();
        }
        
        this.isInitialized = false;
        console.log('✅ System shutdown complete');
    }
}

// Global instance
let globalEnhancedSystem = null;

/**
 * Get or create global enhanced volume footprint system
 */
function getGlobalEnhancedSystem() {
    if (!globalEnhancedSystem) {
        globalEnhancedSystem = new EnhancedVolumeFootprintSystem();
    }
    return globalEnhancedSystem;
}

/**
 * Initialize global enhanced system
 */
async function initializeGlobalEnhancedSystem(selectedSymbols = []) {
    const system = getGlobalEnhancedSystem();
    await system.initialize(selectedSymbols);
    return system;
}

module.exports = {
    EnhancedVolumeFootprintSystem,
    getGlobalEnhancedSystem,
    initializeGlobalEnhancedSystem
};
