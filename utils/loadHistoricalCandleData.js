/**
 * Utility function to load historical candle data and generate artificial candles
 * This function is designed to be called when symbols are selected for the first time
 */

const fetchAndStoreCandleData = require('./fetchAndStoreCandleData');
const generateArtificialCandleData = require('./generateArtificialCandleData');

/**
 * Loads historical candle data and generates artificial candles
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Array} symbols - Array of symbols to load data for
 * @returns {Promise<Object>} Results summary
 */
async function loadHistoricalCandleData(client, dbName, symbols) {
  console.log('🔄 Starting historical candle data loading...');
  
  const results = {
    symbolsProcessed: symbols.length,
    candlesStored: 0,
    artificialCandlesGenerated: 0,
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
    
    if (symbols.length === 0) {
      console.log('⚠️ No symbols provided. Job completed with no data fetched.');
      results.endTime = new Date();
      return results;
    }

    console.log(`📊 Processing ${symbols.length} symbols: ${symbols.join(', ')}`);
    
    // Step 1: Calculate time range for historical data (last 60 minutes)
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (60 * 60 * 1000)); // 60 minutes ago
    
    console.log(`🕒 Loading historical candle data from ${startTime.toISOString()} to ${endTime.toISOString()}`);
    
    // Step 2: Fetch 1-minute historical data
    const options = {
      startTime: startTime.getTime(),
      endTime: endTime.getTime(),
      limit: 60 // Up to 60 candles (1 per minute)
    };
    
    const fetchResults = await fetchAndStoreCandleData(client, dbName, '1m', options);
    results.candlesStored = fetchResults.candlesStored;
    
    if (fetchResults.errors.length > 0) {
      results.errors = results.errors.concat(fetchResults.errors);
    }
    
    // Step 3: Generate artificial candle data for all intervals (2-20 minutes)
    const intervals = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    
    for (const interval of intervals) {
      try {
        console.log(`📊 Generating ${interval}m artificial candles from historical data...`);
        const artificalResults = await generateArtificialCandleData(client, dbName, interval);
        results.artificialCandlesGenerated += artificalResults.candlesGenerated;
        
        if (artificalResults.errors.length > 0) {
          results.errors = results.errors.concat(artificalResults.errors);
        }
      } catch (intervalError) {
        console.error(`❌ Error generating ${interval}m artificial candles:`, intervalError);
        results.errors.push(`Error for ${interval}m interval: ${intervalError.message}`);
      }
    }
    
    console.log('✅ Historical data loading and artificial candle generation completed');
    
  } catch (error) {
    console.error('❌ Historical data loading job failed:', error);
    results.errors.push(`Main job error: ${error.message}`);
  }

  results.endTime = new Date();
  return results;
}

module.exports = loadHistoricalCandleData;
