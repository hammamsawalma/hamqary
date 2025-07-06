/**
 * Hybrid Candle Data Manager
 * Combines REST API (historical) + WebSocket (real-time) for 1-minute OHLC data
 * Manages the complete data flow from historical backfill to real-time processing
 */

const { getGlobalCandleCollector, initializeGlobalCandleCollector } = require('./websocketCandleCollector');
const { detectReversalCandle } = require('./reversalCandleDetector');
const { saveReversalCandle } = require('../models/database');
const { fetchReversalCandleTickData, isCurrentlyBanned } = require('./fetchHistoricalTickData');
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
        
        // Generation tracking to prevent duplicates
        this.generatedCandles = new Map(); // Format: "symbol-interval-timestamp" -> true
        this.generationLocks = new Map(); // Format: "symbol-interval-timestamp" -> Promise
        
        // Statistics
        this.stats = {
            historicalCandlesLoaded: 0,
            realtimeCandlesProcessed: 0,
            artificialCandlesGenerated: 0,
            reversalPatternsDetected: 0,
            duplicatesPrevented: 0,
            volumeFootprintSkipped: 0,
            lastProcessedCandle: null,
            startTime: new Date()
        };
        
        console.log('🔄 Hybrid Candle Data Manager initialized with duplicate prevention and IP ban protection');
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
            }, selectedSymbols); // Pass symbols for immediate connection
            
            // Initialize last candle timestamps for gap detection
            if (selectedSymbols.length > 0) {
                console.log('📊 Initializing gap detection timestamps...');
                await this.candleCollector.initializeLastCandleTimestamps(selectedSymbols);
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Failed to initialize WebSocket:', error);
            throw error;
        }
    }
    
    /**
     * Handle real-time candle data from WebSocket with proper timing synchronization
     */
    async handleRealtimeCandle(candleData) {
        console.log(`⚡ Real-time 1-minute candle: ${candleData.symbol} at ${candleData.closeTime.toISOString()}`);
        
        try {
            // Process the 1-minute candle first
            await this.processOneMinuteCandle(candleData);
            
            this.stats.realtimeCandlesProcessed++;
            this.stats.lastProcessedCandle = new Date();
            
            // 🕐 TIMING FIX: Add delay to ensure database storage is complete
            // This prevents the race condition where artificial generation happens
            // before the 1-minute candle is fully stored in database
            console.log(`⏳ Waiting 3 seconds for storage completion before checking artificial generation...`);
            setTimeout(async () => {
                try {
                    await this.checkAndGenerateArtificialCandlesWithVerification(candleData);
                } catch (delayedError) {
                    console.error(`❌ Error in delayed artificial candle generation:`, delayedError);
                }
            }, 3000); // 3 second delay
            
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
     * Process reversal candle with IP ban protection and smart volume footprint calculation
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
            
            // 🚫 IP BAN PROTECTION - Check if API is banned before attempting tick data fetch
            const isBanned = isCurrentlyBanned();
            
            if (isBanned) {
                console.log(`🚫 Skipping volume footprint for ${candleData.symbol} ${candleData.interval} - IP banned`);
                this.stats.volumeFootprintSkipped++;
                
                // Create a basic trade signal validation without volume footprint
                const basicTradeSignalValidation = this.createBasicTradeSignal(reversalData.candleData, reversalPattern.type);
                
                reversalData.tradeSignal = {
                    isValidSignal: basicTradeSignalValidation.isValidSignal,
                    signalType: basicTradeSignalValidation.signalType,
                    reason: `${basicTradeSignalValidation.reason} (Volume footprint skipped - IP banned)`,
                    score: basicTradeSignalValidation.score || 0,
                    criteria: basicTradeSignalValidation.criteria,
                    validatedAt: new Date(),
                    fallbackMode: true
                };
                
                console.log(`🚦 Basic trade signal: ${basicTradeSignalValidation.isValidSignal ? '✅ VALID' : '❌ INVALID'} (${basicTradeSignalValidation.signalType || 'none'}) - IP ban fallback`);
                
            } else {
                // Try to calculate volume footprint normally
                try {
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
                            
                            // Validate trade signal with volume footprint
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
                        } else {
                            throw new Error(`Volume footprint calculation failed: ${volumeFootprint.error}`);
                        }
                    } else {
                        throw new Error(`Tick data fetch failed: ${tickDataResult.error || 'No trades found'}`);
                    }
                    
                } catch (volumeError) {
                    console.log(`⚠️ Volume footprint failed for ${candleData.symbol} ${candleData.interval}: ${volumeError.message}`);
                    this.stats.volumeFootprintSkipped++;
                    
                    // Fallback to basic trade signal
                    const basicTradeSignalValidation = this.createBasicTradeSignal(reversalData.candleData, reversalPattern.type);
                    
                    reversalData.tradeSignal = {
                        isValidSignal: basicTradeSignalValidation.isValidSignal,
                        signalType: basicTradeSignalValidation.signalType,
                        reason: `${basicTradeSignalValidation.reason} (Volume footprint failed)`,
                        score: basicTradeSignalValidation.score || 0,
                        criteria: basicTradeSignalValidation.criteria,
                        validatedAt: new Date(),
                        fallbackMode: true
                    };
                    
                    console.log(`🚦 Fallback trade signal: ${basicTradeSignalValidation.isValidSignal ? '✅ VALID' : '❌ INVALID'} (${basicTradeSignalValidation.signalType || 'none'})`);
                }
            }
            
            // Save reversal candle
            await saveReversalCandle(this.client, this.dbName, reversalData);
            
        } catch (error) {
            console.error(`❌ Error processing reversal candle:`, error);
        }
    }
    
    /**
     * Create basic trade signal validation without volume footprint
     */
    createBasicTradeSignal(candleData, reversalType) {
        // Simple validation based on candle properties only
        const bodySize = Math.abs(candleData.close - candleData.open);
        const range = candleData.high - candleData.low;
        const bodyRatio = range > 0 ? bodySize / range : 0;
        
        // Basic scoring based on candle strength
        let score = 0;
        let isValid = false;
        let signalType = 'WEAK';
        
        // Strong candle body (>60% of range)
        if (bodyRatio > 0.6) {
            score += 30;
        }
        
        // High volume relative to recent average (approximation)
        if (candleData.volume > 0) {
            score += 20;
        }
        
        // Reversal type specific scoring
        if (reversalType === 'hammer' || reversalType === 'inverted_hammer') {
            score += 25;
            signalType = 'REVERSAL';
        } else if (reversalType === 'doji') {
            score += 15;
            signalType = 'INDECISION';
        }
        
        // Determine validity
        if (score >= 50) {
            isValid = true;
            signalType = score >= 70 ? 'STRONG' : 'MODERATE';
        }
        
        return {
            isValidSignal: isValid,
            signalType: signalType,
            reason: `Basic candle analysis - Body ratio: ${(bodyRatio * 100).toFixed(1)}%`,
            score: score,
            criteria: {
                bodyRatio: bodyRatio,
                volumePresent: candleData.volume > 0,
                reversalType: reversalType
            }
        };
    }
    
    /**
     * Check if artificial candles need to be generated based on time boundaries
     */
    async checkAndGenerateArtificialCandles(currentTime) {
        const currentMinute = new Date(currentTime);
        // Normalize to minute boundary for consistent processing
        currentMinute.setSeconds(0, 0);
        
        console.log(`🔍 Checking artificial candle generation at ${currentMinute.toISOString()}`);
        
        for (const interval of this.supportedIntervals) {
            try {
                if (this.shouldGenerateArtificialCandle(currentMinute, interval)) {
                    // Calculate the completed candle boundaries
                    const { candleStart, candleEnd } = this.calculateCompletedCandleBoundaries(
                        currentMinute, interval, this.TIME_CYCLES[interval]
                    );
                    
                    console.log(`🔧 Generating ${interval}m candle: ${candleStart.toISOString()} → ${candleEnd.toISOString()}`);
                    
                    const result = await this.generateArtificialCandleForSpecificTime(
                        interval, candleStart, candleEnd
                    );
                    
                    this.stats.artificialCandlesGenerated += result.candlesGenerated;
                    
                    if (result.candlesGenerated > 0) {
                        console.log(`✅ Generated ${result.candlesGenerated} ${interval}m artificial candles (${result.reversalPatternsDetected || 0} reversals)`);
                    } else {
                        console.log(`⚠️ No ${interval}m candles generated - insufficient 1-minute data`);
                    }
                }
            } catch (error) {
                console.error(`❌ Error generating ${interval}m artificial candles:`, error);
            }
        }
    }
    
    /**
     * Check and generate artificial candles with storage verification and duplicate prevention
     * This method solves the timing issues by ensuring 1-minute candles are stored before artificial generation
     */
    async checkAndGenerateArtificialCandlesWithVerification(candleData) {
        const currentMinute = new Date(candleData.closeTime);
        currentMinute.setSeconds(0, 0);
        
        // 🚫 DUPLICATE PREVENTION: Create a unique key for this generation check
        const generationCheckKey = `generation-check-${currentMinute.getTime()}`;
        
        // Check if we've already processed this minute boundary
        if (this.generatedCandles.has(generationCheckKey)) {
            console.log(`🔄 Generation check already processed for ${currentMinute.toISOString()}`);
            return;
        }
        
        // Mark this minute boundary as processed
        this.generatedCandles.set(generationCheckKey, true);
        
        console.log(`🔍 Verified artificial candle generation check at ${currentMinute.toISOString()}`);
        
        // 📊 STORAGE VERIFICATION: Check if the trigger 1-minute candle is actually stored
        const triggerCandleStored = await this.verifyOneMinuteCandleStored(candleData);
        
        if (!triggerCandleStored) {
            console.log(`⚠️ Trigger 1-minute candle not yet stored for ${candleData.symbol}, retrying in 2 seconds...`);
            
            // Wait and retry once
            setTimeout(async () => {
                const retryStored = await this.verifyOneMinuteCandleStored(candleData);
                if (retryStored) {
                    console.log(`✅ Retry successful - trigger candle now stored for ${candleData.symbol}`);
                    await this.processArtificialCandleGeneration(currentMinute);
                } else {
                    console.log(`❌ Retry failed - skipping artificial generation for ${candleData.symbol} at ${currentMinute.toISOString()}`);
                }
            }, 2000);
            
            return;
        }
        
        // Proceed with artificial candle generation
        await this.processArtificialCandleGeneration(currentMinute);
    }
    
    /**
     * Verify that a 1-minute candle is actually stored in the database
     */
    async verifyOneMinuteCandleStored(candleData) {
        try {
            const candleCollection = this.db.collection('candleData');
            
            const storedCandle = await candleCollection.findOne({
                symbol: candleData.symbol,
                interval: '1m',
                openTime: candleData.openTime
            });
            
            return storedCandle !== null;
            
        } catch (error) {
            console.error(`❌ Error verifying stored candle for ${candleData.symbol}:`, error);
            return false;
        }
    }
    
    /**
     * Process artificial candle generation for all applicable intervals
     */
    async processArtificialCandleGeneration(currentMinute) {
        for (const interval of this.supportedIntervals) {
            try {
                if (this.shouldGenerateArtificialCandle(currentMinute, interval)) {
                    // Calculate the completed candle boundaries
                    const { candleStart, candleEnd } = this.calculateCompletedCandleBoundaries(
                        currentMinute, interval, this.TIME_CYCLES[interval]
                    );
                    
                    console.log(`🔧 [Verified] Generating ${interval}m candle: ${candleStart.toISOString()} → ${candleEnd.toISOString()}`);
                    
                    // 📊 ENHANCED STORAGE VERIFICATION: Check if we have sufficient 1-minute data before generation
                    const hasEnoughData = await this.verifyEnoughOneMinuteData(
                        candleStart, candleEnd, interval
                    );
                    
                    if (!hasEnoughData.sufficient) {
                        console.log(`⚠️ Insufficient verified 1-minute data for ${interval}m generation:`);
                        console.log(`   └── Required: ${hasEnoughData.required}, Available: ${hasEnoughData.available}`);
                        console.log(`   └── Missing candles likely still being processed, will retry next cycle`);
                        continue;
                    }
                    
                    const result = await this.generateArtificialCandleForSpecificTime(
                        interval, candleStart, candleEnd
                    );
                    
                    this.stats.artificialCandlesGenerated += result.candlesGenerated;
                    
                    if (result.candlesGenerated > 0) {
                        console.log(`✅ [Verified] Generated ${result.candlesGenerated} ${interval}m artificial candles (${result.reversalPatternsDetected || 0} reversals)`);
                    } else {
                        console.log(`⚠️ [Verified] No ${interval}m candles generated despite verification - check data quality`);
                    }
                }
            } catch (error) {
                console.error(`❌ Error in verified ${interval}m artificial candle generation:`, error);
            }
        }
    }
    
    /**
     * Verify that enough 1-minute data exists for artificial candle generation
     */
    async verifyEnoughOneMinuteData(startTime, endTime, intervalMinutes) {
        try {
            const candleCollection = this.db.collection('candleData');
            const selectedSymbols = await this.getSelectedSymbols();
            
            if (selectedSymbols.length === 0) {
                return { sufficient: false, required: 0, available: 0 };
            }
            
            // Check data availability across all symbols
            let totalRequired = 0;
            let totalAvailable = 0;
            
            for (const symbol of selectedSymbols.slice(0, 3)) { // Check first 3 symbols as sample
                const oneMinuteCandles = await candleCollection.find({
                    symbol: symbol,
                    interval: '1m',
                    openTime: { $gte: startTime },
                    closeTime: { $lt: endTime },
                    closeTime: { $lt: new Date(Date.now() - 5000) } // Only candles at least 5 seconds old
                }).count();
                
                totalRequired += intervalMinutes;
                totalAvailable += oneMinuteCandles;
            }
            
            const minRequired = Math.floor(totalRequired * 0.8); // 80% threshold
            const sufficient = totalAvailable >= minRequired;
            
            return {
                sufficient: sufficient,
                required: totalRequired,
                available: totalAvailable,
                threshold: minRequired
            };
            
        } catch (error) {
            console.error(`❌ Error verifying 1-minute data availability:`, error);
            return { sufficient: false, required: 0, available: 0 };
        }
    }
    
    /**
     * Check if an artificial candle should be generated for the given interval
     * Uses simplified modulo-based approach while preserving cycle alignment
     */
    shouldGenerateArtificialCandle(currentTime, intervalMinutes) {
        const cycleMinutes = this.TIME_CYCLES[intervalMinutes];
        
        // Get current minute of day (0-1439)
        const minuteOfDay = currentTime.getUTCHours() * 60 + currentTime.getUTCMinutes();
        
        // Check if we're at a cycle boundary and interval boundary
        const cyclePosition = minuteOfDay % cycleMinutes;
        const intervalPosition = cyclePosition % intervalMinutes;
        
        // Generate when we complete an interval within the cycle
        const shouldGenerate = intervalPosition === 0 && cyclePosition < cycleMinutes;
        
        if (shouldGenerate) {
            console.log(`🎯 Triggering ${intervalMinutes}m generation: minute ${minuteOfDay}, cycle pos ${cyclePosition}, interval pos ${intervalPosition}`);
        }
        
        return shouldGenerate;
    }
    
    /**
     * Calculate the boundaries of the just-completed candle
     */
    calculateCompletedCandleBoundaries(currentTime, intervalMinutes, cycleMinutes) {
        const minuteOfDay = currentTime.getUTCHours() * 60 + currentTime.getUTCMinutes();
        
        // Find current position within cycle
        const cycleStart = Math.floor(minuteOfDay / cycleMinutes) * cycleMinutes;
        const intervalIndex = Math.floor((minuteOfDay - cycleStart) / intervalMinutes);
        
        // Calculate the PREVIOUS (completed) candle boundaries
        const completedCandleStartMinute = cycleStart + ((intervalIndex - 1) * intervalMinutes);
        const completedCandleEndMinute = completedCandleStartMinute + intervalMinutes;
        
        // Convert back to Date objects
        const candleStart = new Date(currentTime);
        candleStart.setUTCHours(Math.floor(completedCandleStartMinute / 60));
        candleStart.setUTCMinutes(completedCandleStartMinute % 60);
        candleStart.setUTCSeconds(0, 0);
        
        const candleEnd = new Date(candleStart);
        candleEnd.setUTCMinutes(candleEnd.getUTCMinutes() + intervalMinutes);
        candleEnd.setUTCMilliseconds(-1); // End just before next candle
        
        return { candleStart, candleEnd };
    }
    
    /**
     * Generate artificial candles for a specific interval (legacy method - maintained for compatibility)
     */
    async generateArtificialCandleForInterval(intervalMinutes) {
        const generateArtificialCandleData = require('./generateArtificialCandleData');
        return await generateArtificialCandleData(this.client, this.dbName, intervalMinutes);
    }
    
    /**
     * Generate artificial candles for a specific time range with duplicate prevention
     * This method is optimized for real-time processing
     */
    async generateArtificialCandleForSpecificTime(intervalMinutes, startTime, endTime) {
        const startTimeKey = startTime.getTime();
        console.log(`📊 Generating ${intervalMinutes}m candle for period: ${startTime.toISOString()} → ${endTime.toISOString()}`);
        
        const results = {
            candlesGenerated: 0,
            reversalPatternsDetected: 0,
            reversalPatternsSaved: 0,
            symbolsProcessed: 0,
            duplicatesPrevented: 0,
            errors: []
        };
        
        try {
            // Get selected symbols
            const selectedSymbols = await this.getSelectedSymbols();
            if (selectedSymbols.length === 0) {
                console.log('⚠️ No symbols selected for artificial candle generation');
                return results;
            }
            
            results.symbolsProcessed = selectedSymbols.length;
            const candleCollection = this.db.collection('candleData');
            
            // Process each symbol with duplicate prevention
            for (const symbol of selectedSymbols) {
                try {
                    // 🚫 DUPLICATE PREVENTION - Create unique key for this candle
                    const candleKey = `${symbol}-${intervalMinutes}m-${startTimeKey}`;
                    
                    // Check if we've already generated this candle
                    if (this.generatedCandles.has(candleKey)) {
                        console.log(`🔄 Duplicate prevented: ${symbol} ${intervalMinutes}m at ${startTime.toISOString()}`);
                        results.duplicatesPrevented++;
                        this.stats.duplicatesPrevented++;
                        continue;
                    }
                    
                    // Check if there's already a generation lock for this candle
                    if (this.generationLocks.has(candleKey)) {
                        console.log(`⏳ Generation already in progress: ${symbol} ${intervalMinutes}m at ${startTime.toISOString()}`);
                        results.duplicatesPrevented++;
                        this.stats.duplicatesPrevented++;
                        continue;
                    }
                    
                    // Create generation lock
                    const generationPromise = this.generateSingleArtificialCandle(
                        symbol, intervalMinutes, startTime, endTime, candleCollection
                    );
                    this.generationLocks.set(candleKey, generationPromise);
                    
                    try {
                        const candleResult = await generationPromise;
                        
                        if (candleResult.success) {
                            // Mark as generated
                            this.generatedCandles.set(candleKey, true);
                            results.candlesGenerated++;
                            
                            if (candleResult.reversalDetected) {
                                results.reversalPatternsDetected++;
                                if (candleResult.reversalSaved) {
                                    results.reversalPatternsSaved++;
                                }
                            }
                        }
                        
                    } finally {
                        // Always remove the lock
                        this.generationLocks.delete(candleKey);
                    }
                    
                } catch (symbolError) {
                    console.error(`❌ Error processing ${symbol} for ${intervalMinutes}m:`, symbolError);
                    results.errors.push(`${symbol}: ${symbolError.message}`);
                }
            }
            
            // Clean up old generation tracking (keep only last hour)
            this.cleanupGenerationTracking();
            
        } catch (error) {
            console.error(`❌ Error in generateArtificialCandleForSpecificTime:`, error);
            results.errors.push(`Main error: ${error.message}`);
        }
        
        return results;
    }
    
    /**
     * Generate a single artificial candle for a symbol with proper error handling
     */
    async generateSingleArtificialCandle(symbol, intervalMinutes, startTime, endTime, candleCollection) {
        const result = {
            success: false,
            reversalDetected: false,
            reversalSaved: false
        };
        
        try {
            // Check if artificial candle already exists in database
            const existingCandle = await candleCollection.findOne({
                symbol: symbol,
                interval: `${intervalMinutes}m`,
                openTime: startTime
            });
            
            if (existingCandle) {
                console.log(`📋 Artificial candle already exists: ${symbol} ${intervalMinutes}m at ${startTime.toISOString()}`);
                result.success = true;
                return result;
            }
            
            // Get ALL closed 1-minute candles for this symbol within the exact time range
            const oneMinuteCandles = await candleCollection.find({
                symbol: symbol,
                interval: '1m',
                openTime: { $gte: startTime },
                closeTime: { $lt: endTime },
                // Only candles that are confirmed closed (at least 10 seconds old)
                closeTime: { $lt: new Date(Date.now() - 10000) }
            }).sort({ openTime: 1 }).toArray();
            
            // Check if we have sufficient data (at least 80% of expected candles)
            const minCandlesRequired = Math.floor(intervalMinutes * 0.8);
            
            if (oneMinuteCandles.length < minCandlesRequired) {
                console.log(`⚠️ Insufficient data for ${symbol} ${intervalMinutes}m candle: ${oneMinuteCandles.length}/${intervalMinutes} 1-minute candles`);
                return result;
            }
            
            // Create the artificial candle from 1-minute data
            const artificialCandle = this.createArtificialCandle(
                oneMinuteCandles, symbol, intervalMinutes, startTime, endTime
            );
            
            // Store the artificial candle
            await candleCollection.updateOne(
                { 
                    symbol: symbol, 
                    interval: `${intervalMinutes}m`,
                    openTime: startTime 
                },
                { $set: artificialCandle },
                { upsert: true }
            );
            
            result.success = true;
            
            // Detect reversal pattern for this artificial candle
            const reversalPattern = detectReversalCandle(artificialCandle);
            
            if (reversalPattern) {
                result.reversalDetected = true;
                console.log(`🔄 Reversal pattern detected in ${symbol} ${intervalMinutes}m artificial candle: ${reversalPattern.type}`);
                
                // Check if this reversal already exists
                const reversalCollection = this.db.collection('reversalCandles');
                const existingReversal = await reversalCollection.findOne({
                    symbol: symbol,
                    interval: `${intervalMinutes}m`,
                    openTime: startTime
                });
                
                if (!existingReversal) {
                    await this.processReversalCandle(artificialCandle, reversalPattern);
                    result.reversalSaved = true;
                }
            }
            
        } catch (error) {
            console.error(`❌ Error generating single artificial candle for ${symbol} ${intervalMinutes}m:`, error);
            throw error;
        }
        
        return result;
    }
    
    /**
     * Clean up old generation tracking entries to prevent memory leaks
     */
    cleanupGenerationTracking() {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        
        // Clean up generated candles map
        for (const [key, value] of this.generatedCandles.entries()) {
            try {
                // Extract timestamp from key (format: symbol-interval-timestamp)
                const timestamp = parseInt(key.split('-').pop());
                if (timestamp < oneHourAgo) {
                    this.generatedCandles.delete(key);
                }
            } catch (error) {
                // If we can't parse, delete it to be safe
                this.generatedCandles.delete(key);
            }
        }
        
        // Clean up generation locks map (shouldn't have old entries, but just in case)
        for (const [key, promise] of this.generationLocks.entries()) {
            try {
                const timestamp = parseInt(key.split('-').pop());
                if (timestamp < oneHourAgo) {
                    this.generationLocks.delete(key);
                }
            } catch (error) {
                this.generationLocks.delete(key);
            }
        }
    }
    
    /**
     * Create an artificial candle from 1-minute candles
     */
    createArtificialCandle(oneMinuteCandles, symbol, intervalMinutes, startTime, endTime) {
        // Sort candles by openTime to ensure correct order
        oneMinuteCandles.sort((a, b) => a.openTime - b.openTime);
        
        const firstCandle = oneMinuteCandles[0];
        const lastCandle = oneMinuteCandles[oneMinuteCandles.length - 1];
        
        // Calculate OHLCV by aggregating all 1-minute candles
        const high = Math.max(...oneMinuteCandles.map(c => c.high));
        const low = Math.min(...oneMinuteCandles.map(c => c.low));
        const volume = oneMinuteCandles.reduce((sum, c) => sum + c.volume, 0);
        const quoteAssetVolume = oneMinuteCandles.reduce((sum, c) => sum + c.quoteAssetVolume, 0);
        const numberOfTrades = oneMinuteCandles.reduce((sum, c) => sum + c.numberOfTrades, 0);
        const takerBuyBaseAssetVolume = oneMinuteCandles.reduce((sum, c) => sum + c.takerBuyBaseAssetVolume, 0);
        const takerBuyQuoteAssetVolume = oneMinuteCandles.reduce((sum, c) => sum + c.takerBuyQuoteAssetVolume, 0);
        
        return {
            symbol,
            interval: `${intervalMinutes}m`,
            openTime: startTime,
            closeTime: endTime,
            open: firstCandle.open,
            high,
            low,
            close: lastCandle.close,
            volume,
            quoteAssetVolume,
            numberOfTrades,
            takerBuyBaseAssetVolume,
            takerBuyQuoteAssetVolume,
            artificiallyGenerated: true,
            sourceInterval: '1m',
            sourceCandles: oneMinuteCandles.length,
            fetchedAt: new Date(),
            dataSource: 'websocket_realtime_artificial'
        };
    }
    
    /**
     * Get selected symbols from database
     */
    async getSelectedSymbols() {
        try {
            const collection = this.db.collection('selectedSymbols');
            
            // Get the most recent document
            const latestSelection = await collection.findOne(
                {}, 
                { sort: { timestamp: -1 } }
            );
            
            if (latestSelection && latestSelection.symbols) {
                return latestSelection.symbols;
            }
            
            return [];
        } catch (error) {
            console.error('Error fetching selected symbols:', error);
            return [];
        }
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
