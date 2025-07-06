/**
 * Fetches top gainers and losers from Binance Futures API
 * Returns top 20 gainers + top 20 losers for maximum volatility coverage
 */

/**
 * Fetches the top moving symbols (gainers and losers) from Binance Futures
 * @param {number} topCount - Number of top gainers and losers to fetch (default: 20)
 * @returns {Promise<Object>} Object containing gainers, losers, and combined symbols
 */
async function getTopMoversSymbols(topCount = 20) {
    try {
        console.log('🔥 Fetching top movers from Binance Futures API...');
        
        // Fetch 24hr ticker statistics from Binance Futures
        const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
        
        if (!response.ok) {
            throw new Error(`Binance API error: ${response.status} - ${response.statusText}`);
        }
        
        const tickerData = await response.json();
        
        // Filter for USDT pairs only and active trading symbols
        const usdtTickers = tickerData.filter(ticker => 
            ticker.symbol.endsWith('USDT') && 
            ticker.count > 0 && // Has trading activity
            parseFloat(ticker.volume) > 0 // Has volume
        );
        
        console.log(`📊 Found ${usdtTickers.length} active USDT trading pairs`);
        
        // Sort by price change percentage for gainers (descending - highest first)
        const sortedByGains = [...usdtTickers].sort((a, b) => 
            parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent)
        );
        
        // Sort by price change percentage for losers (ascending - lowest first)
        const sortedByLosses = [...usdtTickers].sort((a, b) => 
            parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent)
        );
        
        // Get top gainers and losers
        const topGainers = sortedByGains.slice(0, topCount);
        const topLosers = sortedByLosses.slice(0, topCount);
        
        // Extract symbol names
        const gainerSymbols = topGainers.map(ticker => ticker.symbol);
        const loserSymbols = topLosers.map(ticker => ticker.symbol);
        
        // Combine both arrays (gainers first, then losers)
        const combinedSymbols = [...gainerSymbols, ...loserSymbols];
        
        // Remove duplicates (in case a symbol appears in both lists)
        const uniqueSymbols = [...new Set(combinedSymbols)];
        
        console.log(`🎯 Selected ${uniqueSymbols.length} most volatile symbols:`);
        console.log(`📈 Top ${topCount} Gainers: ${gainerSymbols.slice(0, 5).join(', ')}... (${parseFloat(topGainers[0].priceChangePercent).toFixed(2)}% to ${parseFloat(topGainers[topCount-1].priceChangePercent).toFixed(2)}%)`);
        console.log(`📉 Top ${topCount} Losers: ${loserSymbols.slice(0, 5).join(', ')}... (${parseFloat(topLosers[0].priceChangePercent).toFixed(2)}% to ${parseFloat(topLosers[topCount-1].priceChangePercent).toFixed(2)}%)`);
        
        return {
            success: true,
            symbols: uniqueSymbols,
            gainers: {
                symbols: gainerSymbols,
                data: topGainers.map(ticker => ({
                    symbol: ticker.symbol,
                    priceChangePercent: parseFloat(ticker.priceChangePercent),
                    priceChange: parseFloat(ticker.priceChange),
                    volume: parseFloat(ticker.volume),
                    count: parseInt(ticker.count)
                }))
            },
            losers: {
                symbols: loserSymbols,
                data: topLosers.map(ticker => ({
                    symbol: ticker.symbol,
                    priceChangePercent: parseFloat(ticker.priceChangePercent),
                    priceChange: parseFloat(ticker.priceChange),
                    volume: parseFloat(ticker.volume),
                    count: parseInt(ticker.count)
                }))
            },
            totalSymbols: uniqueSymbols.length,
            fetchTime: new Date(),
            source: 'binance_24hr_ticker'
        };
        
    } catch (error) {
        console.error('❌ Error fetching top movers:', error);
        
        return {
            success: false,
            symbols: [],
            error: error.message,
            gainers: { symbols: [], data: [] },
            losers: { symbols: [], data: [] },
            totalSymbols: 0,
            fetchTime: new Date(),
            source: 'error'
        };
    }
}

/**
 * Get a detailed summary of the top movers for logging
 * @param {Object} topMoversData - Data returned from getTopMoversSymbols
 * @returns {string} Formatted summary string
 */
function getTopMoversSummary(topMoversData) {
    if (!topMoversData.success) {
        return `❌ Failed to fetch top movers: ${topMoversData.error}`;
    }
    
    const { gainers, losers, totalSymbols, fetchTime } = topMoversData;
    
    let summary = `🔥 Top Movers Update (${fetchTime.toISOString()}):\n`;
    summary += `📊 Total Selected: ${totalSymbols} symbols\n`;
    
    if (gainers.data.length > 0) {
        const topGainer = gainers.data[0];
        const lastGainer = gainers.data[gainers.data.length - 1];
        summary += `📈 Top ${gainers.symbols.length} Gainers: ${topGainer.priceChangePercent.toFixed(2)}% to ${lastGainer.priceChangePercent.toFixed(2)}%\n`;
        summary += `   Best: ${topGainer.symbol} (+${topGainer.priceChangePercent.toFixed(2)}%)\n`;
    }
    
    if (losers.data.length > 0) {
        const topLoser = losers.data[0];
        const lastLoser = losers.data[losers.data.length - 1];
        summary += `📉 Top ${losers.symbols.length} Losers: ${topLoser.priceChangePercent.toFixed(2)}% to ${lastLoser.priceChangePercent.toFixed(2)}%\n`;
        summary += `   Worst: ${topLoser.symbol} (${topLoser.priceChangePercent.toFixed(2)}%)\n`;
    }
    
    return summary;
}

/**
 * Test the top movers function and display results
 * @param {number} topCount - Number of top gainers and losers to fetch
 */
async function testTopMovers(topCount = 20) {
    console.log('🧪 Testing Top Movers Function...\n');
    
    try {
        const result = await getTopMoversSymbols(topCount);
        
        if (result.success) {
            console.log(getTopMoversSummary(result));
            console.log('\n📈 Top 10 Gainers:');
            result.gainers.data.slice(0, 10).forEach((ticker, index) => {
                console.log(`   ${index + 1}. ${ticker.symbol}: +${ticker.priceChangePercent.toFixed(2)}%`);
            });
            
            console.log('\n📉 Top 10 Losers:');
            result.losers.data.slice(0, 10).forEach((ticker, index) => {
                console.log(`   ${index + 1}. ${ticker.symbol}: ${ticker.priceChangePercent.toFixed(2)}%`);
            });
            
            console.log(`\n🎯 Selected Symbols (${result.totalSymbols} total):`);
            console.log(result.symbols.join(', '));
            
        } else {
            console.log(getTopMoversSummary(result));
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

module.exports = {
    getTopMoversSymbols,
    getTopMoversSummary,
    testTopMovers
};
