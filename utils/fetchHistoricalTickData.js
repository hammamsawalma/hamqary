/**
 * Historical Tick Data Fetcher for Binance Futures - Rate Limited Edition
 * Fetches aggregated trade data with comprehensive rate limiting to prevent IP bans
 */

/**
 * Binance Rate Limiter - Prevents IP bans with intelligent request management
 */
class BinanceRateLimiter {
    constructor() {
        this.lastRequest = 0;
        this.minDelay = 2000; // 2 seconds minimum between requests
        this.requestCount = 0;
        this.hourlyLimit = 1200; // Conservative hourly limit
        this.hourlyReset = Date.now() + (60 * 60 * 1000); // Next hour
        this.isBanned = false;
        this.banExpiry = 0;
        this.consecutiveErrors = 0;
        this.backoffDelay = 1000; // Start with 1 second
        this.maxBackoff = 60000; // Max 60 seconds
        
        console.log('🚦 BinanceRateLimiter initialized with conservative limits');
    }
    
    /**
     * Check if we're currently banned
     */
    isBannedNow() {
        if (this.isBanned && Date.now() < this.banExpiry) {
            return true;
        } else if (this.isBanned && Date.now() >= this.banExpiry) {
            // Ban expired, reset state
            this.isBanned = false;
            this.banExpiry = 0;
            this.consecutiveErrors = 0;
            this.backoffDelay = 1000;
            console.log('✅ IP ban has expired, resuming requests with caution');
        }
        return false;
    }
    
    /**
     * Set ban status from API error
     */
    setBanned(banUntilTimestamp) {
        this.isBanned = true;
        this.banExpiry = banUntilTimestamp;
        const banDuration = Math.round((banUntilTimestamp - Date.now()) / 1000 / 60);
        console.log(`🚫 IP BANNED until ${new Date(banUntilTimestamp).toISOString()} (${banDuration} minutes)`);
    }
    
    /**
     * Wait for rate limit compliance
     */
    async waitForRateLimit() {
        if (this.isBannedNow()) {
            const waitTime = this.banExpiry - Date.now();
            throw new Error(`IP banned for ${Math.round(waitTime / 1000 / 60)} more minutes. Please wait.`);
        }
        
        // Reset hourly counter if needed
        if (Date.now() > this.hourlyReset) {
            this.requestCount = 0;
            this.hourlyReset = Date.now() + (60 * 60 * 1000);
            console.log('🔄 Hourly request counter reset');
        }
        
        // Check hourly limit
        if (this.requestCount >= this.hourlyLimit) {
            const waitTime = this.hourlyReset - Date.now();
            throw new Error(`Hourly limit reached. Please wait ${Math.round(waitTime / 1000 / 60)} minutes.`);
        }
        
        // Calculate delay based on consecutive errors (exponential backoff)
        const errorDelay = this.consecutiveErrors > 0 ? this.backoffDelay : 0;
        const totalDelay = Math.max(this.minDelay + errorDelay, this.minDelay);
        
        // Wait since last request
        const timeSinceLastRequest = Date.now() - this.lastRequest;
        if (timeSinceLastRequest < totalDelay) {
            const waitTime = totalDelay - timeSinceLastRequest;
            console.log(`⏳ Rate limiting: waiting ${waitTime}ms before next request`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastRequest = Date.now();
        this.requestCount++;
    }
    
    /**
     * Handle successful request
     */
    onSuccess() {
        this.consecutiveErrors = 0;
        this.backoffDelay = 1000; // Reset backoff
    }
    
    /**
     * Handle failed request with exponential backoff
     */
    onError(error) {
        this.consecutiveErrors++;
        this.backoffDelay = Math.min(this.backoffDelay * 2, this.maxBackoff);
        
        // Check for ban error codes
        if (error.message.includes('-1003') || error.message.includes('418')) {
            // Extract ban timestamp if available
            const banMatch = error.message.match(/until (\d+)/);
            if (banMatch) {
                this.setBanned(parseInt(banMatch[1]));
            } else {
                // Default ban duration if not specified
                this.setBanned(Date.now() + (24 * 60 * 60 * 1000)); // 24 hours
            }
        }
    }
    
    /**
     * Get current status
     */
    getStatus() {
        return {
            isBanned: this.isBannedNow(),
            banExpiry: this.banExpiry,
            requestCount: this.requestCount,
            hourlyLimit: this.hourlyLimit,
            consecutiveErrors: this.consecutiveErrors,
            nextRequest: this.lastRequest + this.minDelay
        };
    }
}

// Global rate limiter instance
const rateLimiter = new BinanceRateLimiter();

/**
 * Initialize rate limiter with current ban status (if any)
 * Call this on startup if you know the IP is currently banned
 * @param {number} banUntilTimestamp - Ban expiry timestamp (optional)
 */
function initializeCurrentBanStatus(banUntilTimestamp = null) {
    if (banUntilTimestamp && banUntilTimestamp > Date.now()) {
        rateLimiter.setBanned(banUntilTimestamp);
        console.log(`🚫 Initialized with current IP ban until ${new Date(banUntilTimestamp).toISOString()}`);
    } else {
        console.log('✅ Rate limiter initialized without any active bans');
    }
}

/**
 * Get rate limiter status for external use
 * @returns {Object} Current rate limiter status
 */
function getRateLimiterStatus() {
    return rateLimiter.getStatus();
}

/**
 * Check if currently banned (for external use)
 * @returns {boolean} True if currently banned
 */
function isCurrentlyBanned() {
    return rateLimiter.isBannedNow();
}

// Initialize rate limiter clean (no hardcoded bans)
initializeCurrentBanStatus();

/**
 * Fetch historical aggregated trade data from Binance Futures API - Rate Limited
 * @param {string} symbol - Trading symbol (e.g., 'BTCUSDT')
 * @param {number} startTime - Start time in milliseconds
 * @param {number} endTime - End time in milliseconds
 * @param {number} limit - Maximum number of trades to fetch (default 1000, max 1000)
 * @returns {Promise<Array>} Array of trade objects
 */
async function fetchHistoricalAggTrades(symbol, startTime, endTime, limit = 1000) {
    if (!symbol || !startTime || !endTime) {
        throw new Error('Symbol, startTime, and endTime are required');
    }

    if (endTime <= startTime) {
        throw new Error('End time must be after start time');
    }

    const maxLimit = Math.min(limit, 1000); // Binance API limit
    const baseUrl = 'https://fapi.binance.com/fapi/v1/aggTrades';
    
    try {
        // 🚦 RATE LIMITING - Wait for permission to make request
        await rateLimiter.waitForRateLimit();
        
        console.log(`📊 Fetching historical trades for ${symbol} from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);
        
        const params = new URLSearchParams({
            symbol: symbol,
            startTime: startTime.toString(),
            endTime: endTime.toString(),
            limit: maxLimit.toString()
        });

        const response = await fetch(`${baseUrl}?${params}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            const error = new Error(`Binance API error ${response.status}: ${errorText}`);
            
            // 🚦 Handle rate limit errors
            rateLimiter.onError(error);
            throw error;
        }

        const trades = await response.json();
        
        if (!Array.isArray(trades)) {
            throw new Error('Invalid response format from Binance API');
        }

        // 🚦 Mark successful request
        rateLimiter.onSuccess();

        // Transform Binance aggTrades format to our internal format
        const processedTrades = trades.map(trade => ({
            id: trade.a,                    // Aggregate trade ID
            price: parseFloat(trade.p),     // Price
            quantity: parseFloat(trade.q),  // Quantity
            timestamp: parseInt(trade.T),   // Trade time
            isBuyerMaker: trade.m,         // Is buyer maker
            firstTradeId: trade.f,         // First trade ID
            lastTradeId: trade.l           // Last trade ID
        }));

        console.log(`✅ Retrieved ${processedTrades.length} trades for ${symbol} (Requests: ${rateLimiter.getStatus().requestCount}/${rateLimiter.getStatus().hourlyLimit})`);
        return processedTrades;

    } catch (error) {
        console.error(`❌ Error fetching historical trades for ${symbol}:`, error.message);
        
        // 🚦 Handle errors in rate limiter
        rateLimiter.onError(error);
        throw error;
    }
}

/**
 * Fetch all trades for a time range with pagination support - Rate Limited
 * @param {string} symbol - Trading symbol
 * @param {number} startTime - Start time in milliseconds
 * @param {number} endTime - End time in milliseconds
 * @param {number} maxTrades - Maximum total trades to fetch (default 2000 - reduced)
 * @returns {Promise<Array>} Complete array of trades for the time period
 */
async function fetchAllHistoricalTrades(symbol, startTime, endTime, maxTrades = 2000) {
    const allTrades = [];
    let currentStartTime = startTime;
    let requestCount = 0;
    const maxRequests = Math.min(Math.ceil(maxTrades / 1000), 3); // Limit to max 3 requests

    try {
        while (currentStartTime < endTime && requestCount < maxRequests) {
            // Each call to fetchHistoricalAggTrades already has rate limiting built in
            const trades = await fetchHistoricalAggTrades(symbol, currentStartTime, endTime, 1000);
            
            if (trades.length === 0) {
                console.log(`📝 No more trades found for ${symbol} after ${new Date(currentStartTime).toISOString()}`);
                break;
            }

            // Filter trades to ensure they're within our time range
            const filteredTrades = trades.filter(trade => 
                trade.timestamp >= startTime && trade.timestamp <= endTime
            );

            allTrades.push(...filteredTrades);
            
            // Update start time for next request (use last trade timestamp + 1)
            const lastTrade = trades[trades.length - 1];
            currentStartTime = lastTrade.timestamp + 1;
            
            requestCount++;

            console.log(`📈 Progress: ${allTrades.length} trades collected for ${symbol} (Request ${requestCount}/${maxRequests})`);
        }

        // Remove duplicates and sort by timestamp
        const uniqueTrades = removeDuplicateTrades(allTrades);
        uniqueTrades.sort((a, b) => a.timestamp - b.timestamp);

        console.log(`🏁 Completed: ${uniqueTrades.length} unique trades for ${symbol}`);
        return uniqueTrades;

    } catch (error) {
        console.error(`❌ Error in fetchAllHistoricalTrades for ${symbol}:`, error.message);
        
        // Return partial results if we have some data
        if (allTrades.length > 0) {
            console.log(`⚠️ Returning partial data: ${allTrades.length} trades`);
            const uniqueTrades = removeDuplicateTrades(allTrades);
            uniqueTrades.sort((a, b) => a.timestamp - b.timestamp);
            return uniqueTrades;
        }
        
        throw error;
    }
}

/**
 * Remove duplicate trades based on trade ID
 * @param {Array} trades - Array of trade objects
 * @returns {Array} Array of unique trades
 */
function removeDuplicateTrades(trades) {
    const seen = new Set();
    return trades.filter(trade => {
        if (seen.has(trade.id)) {
            return false;
        }
        seen.add(trade.id);
        return true;
    });
}

/**
 * Fetch tick data for a specific reversal candle
 * @param {string} symbol - Trading symbol
 * @param {number} openTime - Candle open time (milliseconds)
 * @param {number} closeTime - Candle close time (milliseconds)
 * @param {string} interval - Candle interval for context
 * @returns {Promise<Object>} Trade data and metadata
 */
async function fetchReversalCandleTickData(symbol, openTime, closeTime, interval) {
    const startTime = performance.now();
    
    try {
        console.log(`🔍 Fetching tick data for ${symbol} ${interval} reversal candle`);
        console.log(`📅 Time range: ${new Date(openTime).toISOString()} to ${new Date(closeTime).toISOString()}`);
        
        // Calculate appropriate max trades based on candle duration
        const durationMinutes = (closeTime - openTime) / (1000 * 60);
        const maxTrades = Math.min(Math.max(durationMinutes * 100, 1000), 10000); // Estimate trades per minute
        
        const trades = await fetchAllHistoricalTrades(symbol, openTime, closeTime, maxTrades);
        
        const executionTime = Math.round(performance.now() - startTime);
        
        return {
            symbol: symbol,
            interval: interval,
            timeframe: {
                openTime: openTime,
                closeTime: closeTime,
                duration: closeTime - openTime
            },
            trades: trades,
            tradesCount: trades.length,
            executionTime: executionTime,
            fetchedAt: new Date(),
            success: true
        };

    } catch (error) {
        const executionTime = Math.round(performance.now() - startTime);
        
        return {
            symbol: symbol,
            interval: interval,
            timeframe: {
                openTime: openTime,
                closeTime: closeTime,
                duration: closeTime - openTime
            },
            trades: [],
            tradesCount: 0,
            executionTime: executionTime,
            fetchedAt: new Date(),
            success: false,
            error: error.message
        };
    }
}

/**
 * Batch fetch tick data for multiple reversal candles - SEQUENTIAL (No Concurrency)
 * @param {Array} reversalCandles - Array of reversal candle objects
 * @param {number} maxCandles - Maximum candles to process (default 10 - very conservative)
 * @param {boolean} skipOnBan - Skip processing if IP is banned (default true)
 * @returns {Promise<Array>} Array of tick data results
 */
async function batchFetchReversalTickData(reversalCandles, maxCandles = 10, skipOnBan = true) {
    if (!Array.isArray(reversalCandles) || reversalCandles.length === 0) {
        return [];
    }

    // Check ban status first
    if (skipOnBan && rateLimiter.isBannedNow()) {
        const status = rateLimiter.getStatus();
        const waitMinutes = Math.round((status.banExpiry - Date.now()) / 1000 / 60);
        console.log(`🚫 Skipping batch fetch: IP banned for ${waitMinutes} more minutes`);
        return [];
    }

    // Limit the number of candles to process
    const limitedCandles = reversalCandles.slice(0, maxCandles);
    console.log(`🚀 Starting SEQUENTIAL batch fetch for ${limitedCandles.length} reversal candles (max ${maxCandles})`);
    
    const results = [];
    const failed = [];
    
    // Process ONE AT A TIME to prevent rate limiting
    for (let i = 0; i < limitedCandles.length; i++) {
        const candle = limitedCandles[i];
        
        console.log(`📦 Processing candle ${i + 1}/${limitedCandles.length}: ${candle.symbol} ${candle.interval}`);
        
        try {
            // Check if we got banned during processing
            if (skipOnBan && rateLimiter.isBannedNow()) {
                console.log(`🚫 Stopping batch processing: IP banned during execution`);
                break;
            }
            
            const result = await fetchReversalCandleTickData(
                candle.symbol,
                candle.openTime instanceof Date ? candle.openTime.getTime() : candle.openTime,
                candle.closeTime instanceof Date ? candle.closeTime.getTime() : candle.closeTime,
                candle.interval
            );
            
            results.push(result);
            
            // Show rate limiter status
            const status = rateLimiter.getStatus();
            console.log(`📊 Rate Limit Status: ${status.requestCount}/${status.hourlyLimit} requests used`);
            
        } catch (error) {
            failed.push({
                candle: candle,
                error: error.message
            });
            console.error(`❌ Failed to fetch tick data for ${candle.symbol}:`, error.message);
            
            // If we get banned, stop processing
            if (error.message.includes('IP banned')) {
                console.log(`🚫 Stopping batch processing due to IP ban`);
                break;
            }
        }
    }
    
    console.log(`✅ Sequential batch fetch completed: ${results.length} successful, ${failed.length} failed`);
    
    if (failed.length > 0) {
        console.log(`⚠️ Failed candles:`, failed.map(f => `${f.candle.symbol} (${f.error})`).join(', '));
    }
    
    return results;
}

/**
 * Validate if historical data is available for a given time range
 * @param {string} symbol - Trading symbol
 * @param {number} timestamp - Timestamp to check (milliseconds)
 * @returns {Promise<boolean>} True if data is likely available
 */
async function isHistoricalDataAvailable(symbol, timestamp) {
    try {
        // Binance Futures launched in 2019, but let's be conservative
        const minTimestamp = new Date('2020-01-01').getTime();
        
        if (timestamp < minTimestamp) {
            return false;
        }
        
        // Try to fetch a small sample
        const endTime = timestamp + (5 * 60 * 1000); // 5 minutes after
        const testTrades = await fetchHistoricalAggTrades(symbol, timestamp, endTime, 10);
        
        return testTrades.length > 0;
        
    } catch (error) {
        console.warn(`⚠️ Could not verify historical data availability for ${symbol}:`, error.message);
        return false;
    }
}

module.exports = {
    fetchHistoricalAggTrades,
    fetchAllHistoricalTrades,
    fetchReversalCandleTickData,
    batchFetchReversalTickData,
    isHistoricalDataAvailable,
    removeDuplicateTrades,
    getRateLimiterStatus,
    isCurrentlyBanned,
    initializeCurrentBanStatus
};
