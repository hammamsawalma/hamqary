/**
 * Utility function to generate artificial candle data from existing 1-minute candles
 * This function is designed to be run by a cron job at regular intervals
 */

const { detectReversalCandle } = require('./reversalCandleDetector');
const { saveReversalCandle } = require('../models/database');
const { fetchReversalCandleTickData } = require('./fetchHistoricalTickData');
const { calculateReversalVolumeFootprint } = require('./volumeFootprintCalculator');
const { getGlobalTickCollector } = require('./websocketTickCollector');
const { validateTradeSignal } = require('./tradeSignalValidator');

/**
 * Generates artificial candle data by aggregating 1-minute candles into specified intervals
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {number} interval - Artificial candle interval (in minutes, e.g., 3, 4, 5, 6, 10, 12, 15, 20)
 * @returns {Promise<Object>} Results summary
 */
async function generateArtificialCandleData(client, dbName, interval) {
  console.log(`🔄 Starting artificial ${interval}m candle data generation...`);
  
  // Validate input
  if (!Number.isInteger(interval) || interval < 1) {
    throw new Error('Interval must be a positive integer representing minutes');
  }
  
  // Define cycle times for each interval (in minutes) for proper alignment
  const INTERVAL_CYCLES = {
    2: 60, 3: 60, 4: 60, 5: 60, 6: 60,
    7: 420, 8: 120, 9: 360, 10: 60, 11: 660,
    12: 60, 13: 780, 14: 420, 15: 60, 16: 240,
    17: 1020, 18: 360, 19: 1140, 20: 60
  };
  
  const cycleMinutes = INTERVAL_CYCLES[interval];
  if (!cycleMinutes) {
    throw new Error(`Unsupported interval: ${interval}m. Only 2-20 minute intervals are supported.`);
  }
  
  const results = {
    symbolsProcessed: 0,
    candlesGenerated: 0,
    reversalPatternsDetected: 0,
    reversalPatternsSaved: 0,
    errors: [],
    startTime: new Date(),
    endTime: null
  };

  try {
    // Make sure we have a valid MongoDB client
    if (!client) {
      throw new Error('MongoDB client is not available');
    }

    // Access the database
    const db = client.db(dbName);
    
    // Step 1: Get selected symbols from the database
    console.log('📋 Fetching selected symbols from database...');
    const selectedSymbols = await getSelectedSymbols(db);
    
    if (selectedSymbols.length === 0) {
      console.log('⚠️ No symbols selected. Job completed with no data generated.');
      results.endTime = new Date();
      return results;
    }

    console.log(`📊 Found ${selectedSymbols.length} selected symbols: ${selectedSymbols.join(', ')}`);
    results.symbolsProcessed = selectedSymbols.length;

    // Step 2: Process each symbol
    const candleCollection = db.collection('candleData');
    
    // Create a compound index for efficient querying if it doesn't exist
    await ensureIndexes(candleCollection);
    
    // Calculate the time range for aggregation
    // Use a reasonable time range to ensure we have enough data
    const endDate = new Date();
    const lookbackMinutes = Math.max(interval * 10, 120); // At least 2 hours or 10x the interval length
    const startDate = new Date(endDate.getTime() - (lookbackMinutes * 60 * 1000));
    
    for (const symbol of selectedSymbols) {
      try {
        console.log(`📈 Processing ${symbol} for ${interval}m candle generation`);
        
        // Step 3: Get the 1-minute candles for this symbol within our time range
        const oneMinuteCandles = await candleCollection.find({
          symbol: symbol,
          interval: '1m',
          openTime: { $gte: startDate, $lte: endDate }
        }).sort({ openTime: 1 }).toArray();
        
        if (oneMinuteCandles.length === 0) {
          console.log(`⚠️ No 1-minute candles found for ${symbol} in the specified time range`);
          results.errors.push(`No data for ${symbol}`);
          continue;
        }
        
        console.log(`📊 Found ${oneMinuteCandles.length} 1-minute candles for ${symbol}`);
        
        // Step 4: Group the 1-minute candles into the target interval
        const groupedCandles = groupCandlesByInterval(oneMinuteCandles, interval, cycleMinutes);
        
        if (Object.keys(groupedCandles).length === 0) {
          console.log(`⚠️ No complete ${interval}m candles could be formed for ${symbol}`);
          continue;
        }
        
        // Step 5: Generate artificial candles from the grouped data
        const artificialCandles = generateCandlesFromGroups(groupedCandles, symbol, interval);
        
        // Step 6: Store the artificial candles and detect reversal patterns
        let reversalPatternsForSymbol = 0;
        let reversalPatternsSavedForSymbol = 0;
        
        for (const candle of artificialCandles) {
          // Store the artificial candle
          await candleCollection.updateOne(
            { 
              symbol: candle.symbol, 
              interval: candle.interval,
              openTime: candle.openTime 
            },
            { $set: candle },
            { upsert: true }
          );
          
          // Detect reversal pattern for this artificial candle
          try {
            const reversalPattern = detectReversalCandle(candle);
            
            if (reversalPattern) {
              reversalPatternsForSymbol++;
              results.reversalPatternsDetected++;
              
              // Check if this reversal pattern already exists
              const reversalCollection = db.collection('reversalCandles');
              const existingReversal = await reversalCollection.findOne({
                symbol: candle.symbol,
                interval: candle.interval,
                openTime: candle.openTime
              });
              
              if (!existingReversal) {
                // Prepare base reversal data
                const reversalData = {
                  symbol: candle.symbol,
                  interval: candle.interval,
                  openTime: candle.openTime,
                  closeTime: candle.closeTime,
                  candleData: {
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                    volume: candle.volume,
                    numberOfTrades: candle.numberOfTrades
                  },
                  reversalPattern: reversalPattern
                };

                // Calculate volume footprint for ALL 1-20 minute intervals using 1-minute tick aggregation
                const validIntervals = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '10m', 
                                       '11m', '12m', '13m', '14m', '15m', '16m', '17m', '18m', '19m', '20m'];
                
                if (validIntervals.includes(candle.interval)) {
                  try {
                    console.log(`🎯 Calculating volume footprint for ${candle.symbol} ${candle.interval} artificial reversal candle`);
                    
                    const openTime = candle.openTime instanceof Date ? candle.openTime.getTime() : candle.openTime;
                    const closeTime = candle.closeTime instanceof Date ? candle.closeTime.getTime() : candle.closeTime;
                    
                    // Fetch 1-minute tick data for the artificial candle's time period and calculate volume footprint
                    console.log(`📊 Fetching 1-minute tick data for volume footprint calculation`);
                    const tickDataResult = await fetchReversalCandleTickData(
                      candle.symbol,
                      openTime,
                      closeTime,
                      candle.interval
                    );

                    if (tickDataResult.success && tickDataResult.trades.length > 0) {
                      const volumeFootprint = calculateReversalVolumeFootprint(
                        tickDataResult.trades,
                        candle.symbol,
                        openTime,
                        closeTime
                      );

                      if (!volumeFootprint.error) {
                        // Add volume footprint data to reversal
                        reversalData.volumeFootprint = {
                          poc: volumeFootprint.poc,
                          vah: volumeFootprint.vah,
                          val: volumeFootprint.val,
                          totalVolume: volumeFootprint.totalVolume,
                          valueAreaVolume: volumeFootprint.valueAreaVolume,
                          valueAreaPercentage: volumeFootprint.valueAreaPercentage,
                          tickDataSource: 'historical',
                          calculatedAt: new Date(),
                          tradesProcessed: volumeFootprint.tradesProcessed,
                          executionTime: tickDataResult.executionTime
                        };

                        console.log(`✅ Volume footprint calculated - POC: ${volumeFootprint.poc}, VAH: ${volumeFootprint.vah}, VAL: ${volumeFootprint.val}`);
                        
                        // Validate trade signal based on volume footprint and candle data
                        try {
                          console.log(`🎯 Validating trade signal for ${candle.symbol} ${candle.interval} artificial reversal`);
                          const tradeSignalValidation = validateTradeSignal(
                            reversalData.candleData,
                            reversalData.volumeFootprint,
                            reversalPattern.type
                          );
                          
                          // Add trade signal validation to reversal data
                          reversalData.tradeSignal = {
                            isValidSignal: tradeSignalValidation.isValidSignal,
                            signalType: tradeSignalValidation.signalType,
                            reason: tradeSignalValidation.reason,
                            score: tradeSignalValidation.score || 0,
                            criteria: tradeSignalValidation.criteria,
                            validatedAt: new Date()
                          };
                          
                          console.log(`🚦 Trade signal: ${tradeSignalValidation.isValidSignal ? '✅ VALID' : '❌ INVALID'} (${tradeSignalValidation.signalType || 'none'})`);
                        } catch (signalError) {
                          console.error(`❌ Error validating trade signal for ${candle.symbol} ${candle.interval}:`, signalError.message);
                          // Continue without trade signal validation
                        }
                      } else {
                        console.log(`⚠️ Volume footprint calculation failed: ${volumeFootprint.error}`);
                      }
                    } else {
                      console.log(`⚠️ Could not fetch tick data: ${tickDataResult.error || 'No trades found'}`);
                    }
                  } catch (footprintError) {
                    console.error(`❌ Error calculating volume footprint for ${candle.symbol} ${candle.interval}:`, footprintError.message);
                    // Continue without volume footprint data
                  }
                } else {
                  console.log(`ℹ️ Skipping volume footprint for ${candle.interval} - only processing 1-20 minute intervals`);
                }
                
                await saveReversalCandle(client, dbName, reversalData);
                reversalPatternsSavedForSymbol++;
                results.reversalPatternsSaved++;
              }
            }
          } catch (reversalError) {
            console.error(`⚠️ Error detecting reversal pattern for ${symbol} ${interval}m at ${candle.openTime}:`, reversalError);
            // Continue processing even if reversal detection fails
          }
        }
        
        results.candlesGenerated += artificialCandles.length;
        console.log(`✅ Successfully generated and stored ${artificialCandles.length} ${interval}m candles for ${symbol}${reversalPatternsForSymbol > 0 ? ` (${reversalPatternsForSymbol} reversal patterns detected, ${reversalPatternsSavedForSymbol} saved)` : ''}`);
        
      } catch (symbolError) {
        console.error(`❌ Error processing ${symbol}:`, symbolError);
        results.errors.push(`Error for ${symbol}: ${symbolError.message}`);
      }
    }
    
    console.log(`🏁 Artificial ${interval}m candle generation completed. Generated ${results.candlesGenerated} candles for ${results.symbolsProcessed} symbols.`);
    if (results.reversalPatternsDetected > 0) {
      console.log(`📈 Reversal patterns: ${results.reversalPatternsDetected} detected, ${results.reversalPatternsSaved} saved for ${interval}m timeframe`);
    }
    
  } catch (error) {
    console.error(`❌ Artificial ${interval}m candle generation job failed:`, error);
    results.errors.push(`Main job error: ${error.message}`);
  }

  results.endTime = new Date();
  return results;
}

/**
 * Groups 1-minute candles into the specified interval using cycle-based alignment
 * @param {Array} candles - Array of 1-minute candle data
 * @param {number} intervalMinutes - Target interval in minutes
 * @param {number} cycleMinutes - Cycle period in minutes
 * @returns {Object} Grouped candles by interval start time
 */
function groupCandlesByInterval(candles, intervalMinutes, cycleMinutes) {
  const groupedCandles = {};
  
  // Sort candles by openTime to ensure chronological order
  candles.sort((a, b) => a.openTime - b.openTime);
  
  for (const candle of candles) {
    // Calculate the proper interval start time using cycle-based alignment
    const intervalStart = calculateCandleStartTime(new Date(candle.openTime), intervalMinutes, cycleMinutes);
    
    // Use the interval start time as key
    const key = intervalStart.getTime();
    
    // Initialize the group if it doesn't exist
    if (!groupedCandles[key]) {
      groupedCandles[key] = [];
    }
    
    // Add the candle to its group
    groupedCandles[key].push(candle);
  }
  
  // Filter out incomplete intervals (those that don't have enough candles)
  // A complete interval should have close to 'intervalMinutes' candles
  // We'll use a threshold of 80% of the expected count to account for possible missing data
  const minCandlesRequired = Math.floor(intervalMinutes * 0.8);
  
  const completeIntervals = {};
  for (const [key, intervalCandles] of Object.entries(groupedCandles)) {
    if (intervalCandles.length >= minCandlesRequired) {
      completeIntervals[key] = intervalCandles;
    }
  }
  
  return completeIntervals;
}

/**
 * Calculates the proper candle start time using cycle-based alignment
 * This matches TradingView and exchange standards exactly
 * @param {Date} currentTime - Current time
 * @param {number} intervalMinutes - Candle interval in minutes
 * @param {number} cycleMinutes - Cycle period in minutes
 * @returns {Date} Aligned candle start time
 */
function calculateCandleStartTime(currentTime, intervalMinutes, cycleMinutes) {
  // Use daily midnight UTC as the base reference - FIXED VERSION
  const date = new Date(currentTime);
  
  // Create proper UTC midnight using Date.UTC (this was the bug!)
  const midnightUTC = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  
  // Calculate time since midnight in milliseconds
  const msSinceMidnight = currentTime.getTime() - midnightUTC.getTime();
  const cycleMs = cycleMinutes * 60 * 1000;
  const intervalMs = intervalMinutes * 60 * 1000;
  
  // Find which cycle we're in (cycles repeat throughout the day)
  const currentCycleIndex = Math.floor(msSinceMidnight / cycleMs);
  
  // Calculate the start of the current cycle
  const currentCycleStart = midnightUTC.getTime() + (currentCycleIndex * cycleMs);
  
  // Calculate time since current cycle start
  const msSinceCycleStart = currentTime.getTime() - currentCycleStart;
  
  // Find which interval within the cycle
  const intervalIndex = Math.floor(msSinceCycleStart / intervalMs);
  
  // Calculate the candle start time
  const candleStart = currentCycleStart + (intervalIndex * intervalMs);
  
  return new Date(candleStart);
}

/**
 * Generates artificial candles from grouped 1-minute candles
 * @param {Object} groupedCandles - Object containing grouped candles by interval start time
 * @param {string} symbol - Trading symbol
 * @param {number} intervalMinutes - Target interval in minutes
 * @returns {Array} Array of generated artificial candles
 */
function generateCandlesFromGroups(groupedCandles, symbol, intervalMinutes) {
  const artificialCandles = [];
  
  for (const [timestampStr, candles] of Object.entries(groupedCandles)) {
    // Sort candles by openTime to ensure correct order
    candles.sort((a, b) => a.openTime - b.openTime);
    
    // Calculate OHLCV and other metrics
    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];
    
    const openTime = new Date(parseInt(timestampStr));
    const closeTime = new Date(openTime.getTime() + (intervalMinutes * 60 * 1000) - 1); // -1ms to not overlap with next candle
    
    // Calculate the high, low, and volume by aggregating all candles
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    const volume = candles.reduce((sum, c) => sum + c.volume, 0);
    const quoteAssetVolume = candles.reduce((sum, c) => sum + c.quoteAssetVolume, 0);
    const numberOfTrades = candles.reduce((sum, c) => sum + c.numberOfTrades, 0);
    const takerBuyBaseAssetVolume = candles.reduce((sum, c) => sum + c.takerBuyBaseAssetVolume, 0);
    const takerBuyQuoteAssetVolume = candles.reduce((sum, c) => sum + c.takerBuyQuoteAssetVolume, 0);
    
    // Create the artificial candle
    const artificialCandle = {
      symbol,
      interval: `${intervalMinutes}m`,
      openTime,
      closeTime,
      open: firstCandle.open,
      high,
      low,
      close: lastCandle.close,
      volume,
      quoteAssetVolume,
      numberOfTrades,
      takerBuyBaseAssetVolume,
      takerBuyQuoteAssetVolume,
      artificiallyGenerated: true, // Flag to indicate this is a generated candle
      sourceInterval: '1m',
      sourceCandles: candles.length,
      fetchedAt: new Date()
    };
    
    artificialCandles.push(artificialCandle);
  }
  
  return artificialCandles;
}

/**
 * Gets the currently selected symbols from the database
 * @param {Object} db - MongoDB database instance
 * @returns {Promise<string[]>} Array of selected symbols
 */
async function getSelectedSymbols(db) {
  try {
    const collection = db.collection('selectedSymbols');
    
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
 * Ensures necessary indexes exist on the candleData collection
 * @param {Object} collection - MongoDB collection
 */
async function ensureIndexes(collection) {
  try {
    // Create a compound index for symbol + interval + openTime for efficient querying
    await collection.createIndex(
      { symbol: 1, interval: 1, openTime: 1 },
      { unique: true }
    );
    
    // Additional indexes for common query patterns
    await collection.createIndex({ symbol: 1 });
    await collection.createIndex({ interval: 1 });
    await collection.createIndex({ openTime: 1 });
    
  } catch (error) {
    console.error('Error creating indexes:', error);
    // Continue execution even if index creation fails
  }
}

module.exports = generateArtificialCandleData;
