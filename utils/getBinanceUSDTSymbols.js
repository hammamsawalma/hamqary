/**
 * Fetches all active USDT perpetual trading pairs from Binance Futures
 * @returns {Promise<string[]>} Array of symbol names (e.g., ["BTCUSDT", "ETHUSDT"])
 */
async function getBinanceUSDTSymbols() {
  try {
    console.log('Fetching perpetual symbols from Binance Futures API...');
    
    // Fetch exchange info from Binance Futures API
    const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
    
    // Check if response is ok
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status} - ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Filter for active USDT pairs
    const usdtSymbols = data.symbols
      .filter(symbol => 
        symbol.quoteAsset === 'USDT' && 
        symbol.status === 'TRADING'
      )
      .map(symbol => symbol.symbol)
      .sort(); // Sort alphabetically for consistency
    
    console.log(`Found ${usdtSymbols.length} active USDT trading pairs`);
    return usdtSymbols;
    
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      // Network error
      throw new Error('Network error: Unable to reach Binance API');
    } else {
      // Other error
      throw new Error(`Failed to fetch Binance symbols: ${error.message}`);
    }
  }
}

module.exports = getBinanceUSDTSymbols;
