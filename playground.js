const getBinanceUSDTSymbols = require('./utils/getBinanceUSDTSymbols');
const getPerpetualCandleData = require('./utils/getPerpetualCandleData');

async function runSymbolsPlayground() {
  try {
    console.log('🚀 Starting Binance USDT symbols playground...\n');
    
    const startTime = Date.now();
    const usdtSymbols = await getBinanceUSDTSymbols();
    const endTime = Date.now();
    
    console.log(`\n✅ Successfully fetched ${usdtSymbols.length} active USDT trading pairs`);
    console.log(`⏱️  Execution time: ${endTime - startTime}ms\n`);
    
    // Show first 15 symbols
    console.log('📋 First 15 USDT pairs:');
    usdtSymbols.slice(0, 15).forEach((symbol, index) => {
      console.log(`${(index + 1).toString().padStart(2, ' ')}. ${symbol}`);
    });
    
    // Show some statistics
    console.log('\n📊 Statistics:');
    console.log(`Total USDT pairs: ${usdtSymbols.length}`);
    
    // Count by first letter for fun stats
    const firstLetterCounts = {};
    usdtSymbols.forEach(symbol => {
      const firstLetter = symbol[0];
      firstLetterCounts[firstLetter] = (firstLetterCounts[firstLetter] || 0) + 1;
    });
    
    const topLetters = Object.entries(firstLetterCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    
    console.log('Top 5 starting letters:');
    topLetters.forEach(([letter, count]) => {
      console.log(`  ${letter}: ${count} pairs`);
    });
    
    console.log('\n🎯 Symbols playground completed successfully!');
    
    return usdtSymbols;
  } catch (error) {
    console.error('❌ Symbols playground failed:', error.message);
    return [];
  }
}

async function runCandleDataPlayground(symbols) {
  try {
    console.log('\n\n🚀 Starting Binance perpetual candle data playground...\n');
    
    // If no symbols provided, use default examples
    const symbolsToUse = symbols && symbols.length > 0 
      ? symbols.slice(0, 2)  // Use first 2 symbols if available
      : ['BTCUSDT', 'ETHUSDT']; // Default examples
    
    console.log(`Fetching candle data for: ${symbolsToUse.join(', ')}`);
    
    // Example 1: Single symbol with 1 hour interval, last 10 candles
    console.log('\n📊 Example 1: Single symbol (1h interval, last 10 candles)');
    const startTimeSingle = Date.now();
    const singleSymbolData = await getPerpetualCandleData(symbolsToUse[0], '1h', { limit: 10 });
    const endTimeSingle = Date.now();
    
    console.log(`⏱️  Execution time: ${endTimeSingle - startTimeSingle}ms`);
    
    // Display the first candle
    const firstSymbol = symbolsToUse[0];
    if (singleSymbolData[firstSymbol] && Array.isArray(singleSymbolData[firstSymbol])) {
      const firstCandle = singleSymbolData[firstSymbol][0];
      console.log('\nSample candle data:');
      console.log(JSON.stringify(firstCandle, null, 2));
      
      // Calculate price change over the period
      const firstPrice = singleSymbolData[firstSymbol][0].close;
      const lastPrice = singleSymbolData[firstSymbol][singleSymbolData[firstSymbol].length - 1].close;
      const priceChange = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2);
      
      console.log(`\nPrice Change: ${priceChange}% over last ${singleSymbolData[firstSymbol].length} hours`);
    }
    
    // Example 2: Multiple symbols with 15 minute interval, last 20 candles
    console.log('\n\n📊 Example 2: Multiple symbols (15m interval, last 20 candles)');
    const startTimeMulti = Date.now();
    const multiSymbolData = await getPerpetualCandleData(symbolsToUse, '15m', { limit: 20 });
    const endTimeMulti = Date.now();
    
    console.log(`⏱️  Execution time: ${endTimeMulti - startTimeMulti}ms`);
    
    // Show statistics for each symbol
    for (const symbol of symbolsToUse) {
      if (multiSymbolData[symbol] && Array.isArray(multiSymbolData[symbol])) {
        const candles = multiSymbolData[symbol];
        
        // Calculate some basic statistics
        const openPrices = candles.map(c => c.open);
        const highPrices = candles.map(c => c.high);
        const lowPrices = candles.map(c => c.low);
        const closePrices = candles.map(c => c.close);
        
        const avgVolume = candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
        const maxHigh = Math.max(...highPrices);
        const minLow = Math.min(...lowPrices);
        const priceRange = (maxHigh - minLow).toFixed(4);
        
        console.log(`\n${symbol} Statistics (${candles.length} periods of 15m):`);
        console.log(`- Latest Price: ${closePrices[closePrices.length - 1]}`);
        console.log(`- Price Range: ${priceRange} (${minLow} - ${maxHigh})`);
        console.log(`- Avg Volume: ${avgVolume.toFixed(2)}`);
      } else {
        console.log(`\n❌ No valid data for ${symbol}`);
      }
    }
    
    console.log('\n🎯 Candle data playground completed successfully!');
  } catch (error) {
    console.error('❌ Candle data playground failed:', error.message);
  }
}

// Run the playground
async function runFullPlayground() {
  console.log('🔍 Starting Binance API Playground\n' + '='.repeat(50));
  
  // First get symbols
  const symbols = await runSymbolsPlayground();
  
  // Then demonstrate candle data with those symbols
  await runCandleDataPlayground(symbols);
  
  console.log('\n' + '='.repeat(50));
  console.log('🏁 Playground execution completed');
}

runFullPlayground();
