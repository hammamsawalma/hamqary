/**
 * Fetches perpetual candle/kline data from Binance Futures for one or multiple symbols
 * @param {string|string[]} symbols - Single symbol or array of symbols (e.g., "BTCUSDT" or ["BTCUSDT", "ETHUSDT"])
 * @param {string} interval - Kline/candlestick interval (1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M)
 * @param {Object} [options] - Optional parameters
 * @param {number} [options.startTime] - Start time in milliseconds
 * @param {number} [options.endTime] - End time in milliseconds
 * @param {number} [options.limit] - Number of candles to return (default 500, max 1500)
 * @returns {Promise<Object>} Object with symbols as keys and arrays of candle data as values
 */
async function getPerpetualCandleData(symbols, interval, options = {}) {
  // Normalize symbols to array if a single string is provided
  const symbolsArray = Array.isArray(symbols) ? symbols : [symbols];
  
  if (symbolsArray.length === 0) {
    throw new Error('At least one symbol must be provided');
  }
  
  if (!interval) {
    throw new Error('Interval parameter is required');
  }
  
  try {
    console.log(`Fetching perpetual candle data for ${symbolsArray.length} symbol(s) with interval ${interval}...`);
    
    // Build URL parameters
    const urlParams = new URLSearchParams({
      interval: interval
    });
    
    // Add optional parameters if provided
    if (options.startTime) urlParams.append('startTime', options.startTime);
    if (options.endTime) urlParams.append('endTime', options.endTime);
    if (options.limit) urlParams.append('limit', options.limit);
    
    // Create a map to store the results for each symbol
    const results = {};
    
    // Fetch data for each symbol in parallel using Promise.all
    await Promise.all(
      symbolsArray.map(async (symbol) => {
        try {
          // Create a copy of the URL parameters and add the symbol
          const params = new URLSearchParams(urlParams);
          params.append('symbol', symbol);
          
          // Make the API request
          const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?${params}`);
          
          // Check if response is ok
          if (!response.ok) {
            throw new Error(`Binance API error for ${symbol}: ${response.status} - ${response.statusText}`);
          }
          
          const data = await response.json();
          
          // Process candle data - Binance returns an array of arrays with the following format:
          // [
          //   [
          //     1499040000000,      // Open time
          //     "0.01634790",       // Open
          //     "0.80000000",       // High
          //     "0.01575800",       // Low
          //     "0.01577100",       // Close
          //     "148976.11427815",  // Volume
          //     1499644799999,      // Close time
          //     "2434.19055334",    // Quote asset volume
          //     308,                // Number of trades
          //     "1756.87402397",    // Taker buy base asset volume
          //     "28.46694368",      // Taker buy quote asset volume
          //     "0"                 // Ignore
          //   ],
          //   ...
          // ]
          
          // Transform the raw data into a more usable format
          const processedData = data.map(candle => ({
            openTime: candle[0],
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            closeTime: candle[6],
            quoteAssetVolume: parseFloat(candle[7]),
            numberOfTrades: candle[8],
            takerBuyBaseAssetVolume: parseFloat(candle[9]),
            takerBuyQuoteAssetVolume: parseFloat(candle[10])
          }));
          
          // Store the processed data in the results object
          results[symbol] = processedData;
          
          console.log(`✅ Successfully fetched ${processedData.length} candles for ${symbol}`);
        } catch (symbolError) {
          // Log the error but continue with other symbols
          console.error(`Error fetching data for ${symbol}:`, symbolError.message);
          results[symbol] = { error: symbolError.message };
        }
      })
    );
    
    // Return the combined results
    return results;
    
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      // Network error
      throw new Error('Network error: Unable to reach Binance API');
    } else {
      // Other error
      throw new Error(`Failed to fetch candle data: ${error.message}`);
    }
  }
}

module.exports = getPerpetualCandleData;
