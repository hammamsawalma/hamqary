/**
 * Utility function to fetch candle data for selected symbols and store in database
 * This function is designed to be run by a cron job at regular intervals
 */

const getPerpetualCandleData = require('./getPerpetualCandleData');
const { detectReversalCandle } = require('./reversalCandleDetector');
const { saveReversalCandle } = require('../models/database');
const { fetchReversalCandleTickData } = require('./fetchHistoricalTickData');
const { calculateReversalVolumeFootprint } = require('./volumeFootprintCalculator');
const { getGlobalTickCollector } = require('./websocketTickCollector');
const { validateTradeSignal } = require('./tradeSignalValidator');

/**
 * Fetches candle data for selected symbols and stores it in the database
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {string} interval - Candle interval (1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M)
 * @param {Object} [options] - Optional parameters for candle data fetching
 * @returns {Promise<Object>} Results summary
 */
async function fetchAndStoreCandleData(client, dbName, interval = '1m', options = {}) {
  console.log('🔄 Starting candle data fetch and store job...');
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

    // Step 2: Fetch candle data for selected symbols
    console.log(`🔍 Fetching candle data with interval ${interval}...`);
    const candleData = await getPerpetualCandleData(selectedSymbols, interval, options);

    // Step 3: Store the data in the candleData collection
    console.log('💾 Storing candle data in database...');
    const candleCollection = db.collection('candleData');

    // Process each symbol's data
    for (const symbol of selectedSymbols) {
      try {
        // Check if we have valid data for this symbol
        if (!candleData[symbol] || !Array.isArray(candleData[symbol])) {
          console.error(`❌ No valid data received for ${symbol}`);
          results.errors.push(`Failed to get data for ${symbol}`);
          continue;
        }

        const symbolCandles = candleData[symbol];
        console.log(`📈 Processing ${symbolCandles.length} candles for ${symbol}`);

        // Validate candle close times - reject any future-dated candles
        const currentTime = Date.now();
        const validCandles = symbolCandles.filter(candle => {
          const candleCloseTime = candle.closeTime;
          const isClosed = candleCloseTime < currentTime;
          
          if (!isClosed) {
            console.log(`⚠️ Rejecting future candle for ${symbol}: close time ${new Date(candleCloseTime).toISOString()} >= current ${new Date(currentTime).toISOString()}`);
          }
          
          return isClosed;
        });

        if (validCandles.length !== symbolCandles.length) {
          console.log(`⚠️ Filtered out ${symbolCandles.length - validCandles.length} future-dated candles for ${symbol}`);
        }

        if (validCandles.length === 0) {
          console.log(`⚠️ No valid closed candles found for ${symbol}, skipping signal processing`);
          continue;
        }

        console.log(`✅ Processing ${validCandles.length} validated closed candles for ${symbol}`);

        // Prepare documents for insertion (using validated candles only)
        const documents = validCandles.map(candle => ({
          symbol,
          interval,
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

        // Upsert the candle data (to avoid duplicates) and detect reversal patterns
        let reversalPatternsDetected = 0;
        for (const doc of documents) {
          // Store the candle data
          await candleCollection.updateOne(
            { 
              symbol: doc.symbol, 
              interval: doc.interval,
              openTime: doc.openTime 
            },
            { $set: doc },
            { upsert: true }
          );
          
          // Detect reversal pattern for this candle
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

                // Calculate volume footprint for 1-60 minute intervals
                const validIntervals = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '10m', 
                                       '11m', '12m', '13m', '14m', '15m', '16m', '17m', '18m', '19m', '20m',
                                       '21m', '22m', '23m', '24m', '25m', '26m', '27m', '28m', '29m', '30m',
                                       '31m', '32m', '33m', '34m', '35m', '36m', '37m', '38m', '39m', '40m',
                                       '41m', '42m', '43m', '44m', '45m', '46m', '47m', '48m', '49m', '50m',
                                       '51m', '52m', '53m', '54m', '55m', '56m', '57m', '58m', '59m', '60m'];
                
                if (validIntervals.includes(doc.interval)) {
                  try {
                    console.log(`🎯 Calculating volume footprint for ${doc.symbol} ${doc.interval} reversal candle`);
                    
                    const openTime = doc.openTime instanceof Date ? doc.openTime.getTime() : doc.openTime;
                    const closeTime = doc.closeTime instanceof Date ? doc.closeTime.getTime() : doc.closeTime;
                    
                    // Try WebSocket data first if collector is available and connected
                    let volumeFootprint = null;
                    const tickCollector = getGlobalTickCollector();
                    
                    if (tickCollector && tickCollector.isConnected) {
                      console.log(`📡 Attempting real-time volume footprint calculation via WebSocket`);
                      // For real-time processing, we would typically start collection before the candle closes
                      // Since this is historical processing, we'll fall back to historical data
                    }
                    
                    // Fetch historical tick data and calculate volume footprint
                    console.log(`📊 Fetching historical tick data for volume footprint`);
                    const tickDataResult = await fetchReversalCandleTickData(
                      doc.symbol,
                      openTime,
                      closeTime,
                      doc.interval
                    );

                    if (tickDataResult.success && tickDataResult.trades.length > 0) {
                      volumeFootprint = calculateReversalVolumeFootprint(
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
                          console.log(`🎯 Validating trade signal for ${doc.symbol} ${doc.interval} reversal`);
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
                          console.error(`❌ Error validating trade signal for ${doc.symbol} ${doc.interval}:`, signalError.message);
                          // Continue without trade signal validation
                        }
                      } else {
                        console.log(`⚠️ Volume footprint calculation failed: ${volumeFootprint.error}`);
                      }
                    } else {
                      console.log(`⚠️ Could not fetch tick data: ${tickDataResult.error || 'No trades found'}`);
                    }
                  } catch (footprintError) {
                    console.error(`❌ Error calculating volume footprint for ${doc.symbol} ${doc.interval}:`, footprintError.message);
                    // Continue without volume footprint data
                  }
                } else {
                  console.log(`ℹ️ Skipping volume footprint for ${doc.interval} - only processing 1-60 minute intervals`);
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
        console.log(`✅ Successfully stored ${documents.length} candles for ${symbol}${reversalPatternsDetected > 0 ? ` (${reversalPatternsDetected} reversal patterns detected)` : ''}`);
      } catch (symbolError) {
        console.error(`❌ Error processing ${symbol}:`, symbolError);
        results.errors.push(`Error for ${symbol}: ${symbolError.message}`);
      }
    }

    console.log(`🏁 Candle data job completed. Stored ${results.candlesStored} candles for ${results.symbolsProcessed} symbols.`);
    
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
