/**
 * Utility function to load historical 1-minute candle data and generate all artificial candles
 * This function is designed to be called when symbols are selected for the first time
 * ONLY loads 1-minute data - all other timeframes are generated artificially
 */

const fetchAndStoreCandleData = require('./fetchAndStoreCandleData');
const generateArtificialCandleData = require('./generateArtificialCandleData');

/**
 * Loads historical 1-minute candle data and generates all artificial candles (2m-60m)
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Array} symbols - Array of symbols to load data for
 * @returns {Promise<Object>} Results summary
 */
async function loadHistoricalCandleData(client, dbName, symbols) {
  console.log('🔄 Starting historical 1-minute candle data loading and artificial candle generation...');
  
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
    
    // Step 1: Calculate time range for historical data (last 180 minutes)
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (180 * 60 * 1000)); // 180 minutes ago
    
    console.log(`🕒 Loading historical 1-minute candle data from ${startTime.toISOString()} to ${endTime.toISOString()}`);
    
    // Step 2: Fetch ONLY 1-minute historical data
    const options = {
      startTime: startTime.getTime(),
      endTime: endTime.getTime(),
      limit: 180 // Up to 180 candles (1 per minute)
    };
    
    console.log('📊 Fetching 1-minute historical data for all symbols...');
    const fetchResults = await fetchAndStoreCandleData(client, dbName, options);
    results.candlesStored = fetchResults.candlesStored;
    
    if (fetchResults.errors.length > 0) {
      results.errors = results.errors.concat(fetchResults.errors);
    }
    
    console.log(`✅ Successfully loaded ${results.candlesStored} 1-minute historical candles`);
    
    // Step 3: Generate ALL artificial candle data for intervals 2-60 minutes from the 1-minute base data
    console.log('🔧 Generating artificial candles from 1-minute base data...');
    const intervals = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
                      21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
                      41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60];
    
    let totalArtificialCandles = 0;
    
    for (const interval of intervals) {
      try {
        console.log(`📊 Generating ${interval}m artificial candles from 1-minute historical data...`);
        const artificialResults = await generateArtificialCandleData(client, dbName, interval);
        results.artificialCandlesGenerated += artificialResults.candlesGenerated;
        totalArtificialCandles += artificialResults.candlesGenerated;
        
        if (artificialResults.errors.length > 0) {
          results.errors = results.errors.concat(artificialResults.errors);
        }
        
        console.log(`✅ Generated ${artificialResults.candlesGenerated} ${interval}m candles (${artificialResults.reversalPatternsDetected} reversal patterns)`);
      } catch (intervalError) {
        console.error(`❌ Error generating ${interval}m artificial candles:`, intervalError);
        results.errors.push(`Error for ${interval}m interval: ${intervalError.message}`);
      }
    }
    
    console.log(`🎯 Artificial candle generation summary:`);
    console.log(`   📈 Total artificial candles generated: ${totalArtificialCandles}`);
    console.log(`   ⏰ Time frames: 2m-60m intervals`);
    console.log(`   🔍 All generated from 1-minute base data`);
    
    console.log('✅ Historical data loading and artificial candle generation completed');
    
  } catch (error) {
    console.error('❌ Historical data loading job failed:', error);
    results.errors.push(`Main job error: ${error.message}`);
  }

  results.endTime = new Date();
  return results;
}

module.exports = loadHistoricalCandleData;
