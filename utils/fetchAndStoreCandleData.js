/**
 * Utility function to fetch 1-minute candle data for selected symbols and store in database
 * This function is designed to be run by a cron job every minute - ONLY handles 1-minute data
 * All other timeframes are generated artificially from this 1-minute base data
 */

const getPerpetualCandleData = require('./getPerpetualCandleData');
const { detectReversalCandle } = require('./reversalCandleDetector');
const { saveReversalCandle } = require('../models/database');
const { fetchReversalCandleTickData } = require('./fetchHistoricalTickData');
const { calculateReversalVolumeFootprint } = require('./volumeFootprintCalculator');
const { getGlobalTickCollector } = require('./websocketTickCollector');
const { validateTradeSignal } = require('./tradeSignalValidator');

/**
 * Fetches 1-minute candle data for selected symbols and stores it in the database
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Object} [options] - Optional parameters for candle data fetching
 * @returns {Promise<Object>} Results summary
 */
async function fetchAndStoreCandleData(client, dbName, options = {}) {
  console.log('🔄 Starting 1-minute candle data fetch and store job...');
  const results = {
    symbolsProcessed: 0,
    candlesStored: 0,
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
      console.log('⚠️ No symbols selected. Job completed with no data fetched.');
      results.endTime = new Date();
      return results;
    }

    console.log(`📊 Found ${selectedSymbols.length} selected symbols: ${selectedSymbols.join(', ')}`);
    results.symbolsProcessed = selectedSymbols.length;

    // Step 2: Fetch ONLY 1-minute candle data for selected symbols
    console.log(`🔍 Fetching 1-minute candle data...`);
    const candleData = await getPerpetualCandleData(selectedSymbols, '1m', options);

    // Step 3: Store the 1-minute data in the candleData collection
    console.log('💾 Storing 1-minute candle data in database...');
    const candleCollection = db.collection('candleData');

    // Process each symbol's data
    for (const symbol of selectedSymbols) {
      try {
        // Check if we have valid data for this symbol
        if (!candleData[symbol] || !Array.isArray(candleData[symbol])) {
          console.error(`❌ No valid 1-minute data received for ${symbol}`);
          results.errors.push(`Failed to get 1-minute data for ${symbol}`);
          continue;
        }

        const symbolCandles = candleData[symbol];
        console.log(`📈 Processing ${symbolCandles.length} 1-minute candles for ${symbol}`);

        // Validate candle close times - reject any future-dated candles
        const currentTime = Date.now();
        const validCandles = symbolCandles.filter(candle => {
          const candleCloseTime = candle.closeTime;
          const isClosed = candleCloseTime < currentTime;
          
          if (!isClosed) {
            console.log(`⚠️ Rejecting future 1-minute candle for ${symbol}: close time ${new Date(candleCloseTime).toISOString()} >= current ${new Date(currentTime).toISOString()}`);
          }
          
          return isClosed;
        });

        if (validCandles.length !== symbolCandles.length) {
          console.log(`⚠️ Filtered out ${symbolCandles.length - validCandles.length} future-dated 1-minute candles for ${symbol}`);
        }

        if (validCandles.length === 0) {
          console.log(`⚠️ No valid closed 1-minute candles found for ${symbol}, skipping processing`);
          continue;
        }

        console.log(`✅ Processing ${validCandles.length} validated closed 1-minute candles for ${symbol}`);

        // Prepare documents for insertion (using validated candles only)
        const documents = validCandles.map(candle => ({
          symbol,
          interval: '1m', // Always 1-minute interval
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
          fetchedAt: new Date()
        }));

        // Create a compound index for efficient querying if it doesn't exist
        await ensureIndexes(candleCollection);

        // Store the 1-minute candle data (NOTE: We only detect reversal patterns for 1-minute data here,
        // all other timeframes will have their reversals detected when artificially generated)
        let reversalPatternsDetected = 0;
        for (const doc of documents) {
          // Store the 1-minute candle data
          await candleCollection.updateOne(
            { 
              symbol: doc.symbol, 
              interval: doc.interval,
              openTime: doc.openTime 
            },
            { $set: doc },
            { upsert: true }
          );
          
          // Detect reversal pattern for 1-minute candles only
          try {
            const reversalPattern = detectReversalCandle(doc);
            
            if (reversalPattern) {
              // Check if this reversal pattern already exists
              const reversalCollection = db.collection('reversalCandles');
              const existingReversal = await reversalCollection.findOne({
                symbol: doc.symbol,
                interval: doc.interval,
                openTime: doc.openTime
              });
              
              if (!existingReversal) {
                // Prepare base reversal data
                const reversalData = {
                  symbol: doc.symbol,
                  interval: doc.interval,
                  openTime: doc.openTime,
                  closeTime: doc.closeTime,
                  candleData: {
                    open: doc.open,
                    high: doc.high,
                    low: doc.low,
                    close: doc.close,
                    volume: doc.volume,
                    numberOfTrades: doc.numberOfTrades
                  },
                  reversalPattern: reversalPattern
                };

                // Calculate volume footprint for 1-minute interval
                try {
                  console.log(`🎯 Calculating volume footprint for ${doc.symbol} 1m reversal candle`);
                  
                  const openTime = doc.openTime instanceof Date ? doc.openTime.getTime() : doc.openTime;
                  const closeTime = doc.closeTime instanceof Date ? doc.closeTime.getTime() : doc.closeTime;
                  
                  // Fetch historical tick data and calculate volume footprint
                  console.log(`📊 Fetching historical tick data for volume footprint`);
                  const tickDataResult = await fetchReversalCandleTickData(
                    doc.symbol,
                    openTime,
                    closeTime,
                    doc.interval
                  );

                  if (tickDataResult.success && tickDataResult.trades.length > 0) {
                    const volumeFootprint = calculateReversalVolumeFootprint(
                      tickDataResult.trades,
                      doc.symbol,
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
                        console.log(`🎯 Validating trade signal for ${doc.symbol} 1m reversal`);
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
                        console.error(`❌ Error validating trade signal for ${doc.symbol} 1m:`, signalError.message);
                        // Continue without trade signal validation
                      }
                    } else {
                      console.log(`⚠️ Volume footprint calculation failed: ${volumeFootprint.error}`);
                    }
                  } else {
                    console.log(`⚠️ Could not fetch tick data: ${tickDataResult.error || 'No trades found'}`);
                  }
                } catch (footprintError) {
                  console.error(`❌ Error calculating volume footprint for ${doc.symbol} 1m:`, footprintError.message);
                  // Continue without volume footprint data
                }
                
                await saveReversalCandle(client, dbName, reversalData);
                reversalPatternsDetected++;
              }
            }
          } catch (reversalError) {
            console.error(`⚠️ Error detecting reversal pattern for ${symbol} at ${doc.openTime}:`, reversalError);
            // Continue processing even if reversal detection fails
          }
        }

        results.candlesStored += documents.length;
        console.log(`✅ Successfully stored ${documents.length} 1-minute candles for ${symbol}${reversalPatternsDetected > 0 ? ` (${reversalPatternsDetected} reversal patterns detected)` : ''}`);
      } catch (symbolError) {
        console.error(`❌ Error processing ${symbol}:`, symbolError);
        results.errors.push(`Error for ${symbol}: ${symbolError.message}`);
      }
    }

    console.log(`🏁 1-minute candle data job completed. Stored ${results.candlesStored} candles for ${results.symbolsProcessed} symbols.`);
    
  } catch (error) {
    console.error('❌ Candle data job failed:', error);
    results.errors.push(`Main job error: ${error.message}`);
  }

  results.endTime = new Date();
  return results;
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

module.exports = fetchAndStoreCandleData;
