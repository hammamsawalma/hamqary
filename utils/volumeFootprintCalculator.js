/**
 * Volume Footprint Calculator for Reversal Candles
 * Calculates POC (Point of Control), VAH (Value Area High), and VAL (Value Area Low)
 * from tick-by-tick trade data
 */

/**
 * Calculate volume footprint metrics from tick data
 * @param {Array} trades - Array of trade objects with {price, quantity, timestamp}
 * @param {number} tickSize - Minimum price movement (e.g., 0.01 for BTCUSDT)
 * @returns {Object} Volume footprint data with POC, VAH, VAL
 */
function calculateVolumeFootprint(trades, tickSize = 0.01) {
    if (!trades || trades.length === 0) {
        return {
            poc: null,
            vah: null,
            val: null,
            totalVolume: 0,
            valueAreaVolume: 0,
            priceVolumeMap: {},
            error: 'No trade data available'
        };
    }

    try {
        // Step 1: Aggregate volume by price levels
        const priceVolumeMap = {};
        let totalVolume = 0;
        let minPrice = Infinity;
        let maxPrice = -Infinity;

        trades.forEach(trade => {
            const price = parseFloat(trade.price);
            const quantity = parseFloat(trade.quantity);
            
            if (isNaN(price) || isNaN(quantity) || quantity <= 0) {
                return; // Skip invalid trades
            }

            // Round price to tick size
            const roundedPrice = Math.round(price / tickSize) * tickSize;
            const priceKey = roundedPrice.toFixed(getDecimalPlaces(tickSize));
            
            if (!priceVolumeMap[priceKey]) {
                priceVolumeMap[priceKey] = 0;
            }
            
            priceVolumeMap[priceKey] += quantity;
            totalVolume += quantity;
            
            minPrice = Math.min(minPrice, roundedPrice);
            maxPrice = Math.max(maxPrice, roundedPrice);
        });

        if (totalVolume === 0) {
            return {
                poc: null,
                vah: null,
                val: null,
                totalVolume: 0,
                valueAreaVolume: 0,
                priceVolumeMap: {},
                error: 'No valid trades found'
            };
        }

        // Step 2: Find POC (Point of Control) - price level with highest volume
        let poc = null;
        let maxVolumeAtPrice = 0;
        
        Object.entries(priceVolumeMap).forEach(([price, volume]) => {
            if (volume > maxVolumeAtPrice) {
                maxVolumeAtPrice = volume;
                poc = parseFloat(price);
            }
        });

        // Step 3: Calculate Value Area (70% of total volume)
        const valueAreaThreshold = totalVolume * 0.70;
        const { vah, val, valueAreaVolume } = calculateValueArea(
            priceVolumeMap, 
            poc, 
            valueAreaThreshold,
            tickSize
        );

        return {
            poc: poc,
            vah: vah,
            val: val,
            totalVolume: Math.round(totalVolume * 100) / 100,
            valueAreaVolume: Math.round(valueAreaVolume * 100) / 100,
            valueAreaPercentage: Math.round((valueAreaVolume / totalVolume) * 10000) / 100,
            priceRange: {
                min: minPrice,
                max: maxPrice,
                spread: maxPrice - minPrice
            },
            priceVolumeMap: priceVolumeMap,
            tickSize: tickSize,
            tradesCount: trades.length
        };

    } catch (error) {
        return {
            poc: null,
            vah: null,
            val: null,
            totalVolume: 0,
            valueAreaVolume: 0,
            priceVolumeMap: {},
            error: `Calculation error: ${error.message}`
        };
    }
}

/**
 * Calculate Value Area High (VAH) and Value Area Low (VAL) using correct Market Profile methodology
 * @param {Object} priceVolumeMap - Price to volume mapping
 * @param {number} poc - Point of Control price
 * @param {number} valueAreaThreshold - 70% of total volume
 * @param {number} tickSize - Minimum price movement
 * @returns {Object} VAH, VAL, and value area volume
 */
function calculateValueArea(priceVolumeMap, poc, valueAreaThreshold, tickSize) {
    // Create array of all price levels with their volumes, sorted by volume (descending)
    const priceVolumeArray = Object.entries(priceVolumeMap).map(([priceStr, volume]) => ({
        price: parseFloat(priceStr),
        volume: volume
    })).sort((a, b) => b.volume - a.volume); // Sort by volume descending
    
    if (priceVolumeArray.length === 0) {
        return { vah: poc, val: poc, valueAreaVolume: 0 };
    }

    // Start with POC (should be first in sorted array, but let's be explicit)
    const valueAreaPrices = [poc];
    let valueAreaVolume = priceVolumeMap[poc.toFixed(getDecimalPlaces(tickSize))] || 0;
    
    // Add price levels in order of highest volume until we reach 70% threshold
    for (const priceVol of priceVolumeArray) {
        // Skip POC since we already added it
        if (priceVol.price === poc) {
            continue;
        }
        
        // If adding this price level would exceed threshold, we're done
        if (valueAreaVolume >= valueAreaThreshold) {
            break;
        }
        
        // Add this price level to value area
        valueAreaPrices.push(priceVol.price);
        valueAreaVolume += priceVol.volume;
    }
    
    // VAH = highest price in value area, VAL = lowest price in value area
    const sortedValueAreaPrices = valueAreaPrices.sort((a, b) => a - b);
    
    return {
        vah: sortedValueAreaPrices[sortedValueAreaPrices.length - 1], // Highest price
        val: sortedValueAreaPrices[0], // Lowest price  
        valueAreaVolume: valueAreaVolume
    };
}

/**
 * Get number of decimal places for a given tick size
 * @param {number} tickSize - The tick size
 * @returns {number} Number of decimal places
 */
function getDecimalPlaces(tickSize) {
    const str = tickSize.toString();
    if (str.indexOf('.') !== -1 && str.indexOf('e-') === -1) {
        return str.split('.')[1].length;
    } else if (str.indexOf('e-') !== -1) {
        const parts = str.split('e-');
        return parseInt(parts[1], 10);
    }
    return 0;
}

/**
 * Get appropriate tick size for a symbol based on price
 * This is a simplified version - in production you might want to fetch this from exchange info
 * @param {string} symbol - Trading symbol
 * @param {number} price - Current price level
 * @returns {number} Appropriate tick size
 */
function getTickSize(symbol, price) {
    // Common tick sizes for major pairs
    const tickSizes = {
        'BTCUSDT': 0.01,
        'ETHUSDT': 0.01,
        'BNBUSDT': 0.01,
        'ADAUSDT': 0.0001,
        'XRPUSDT': 0.0001,
        'SOLUSDT': 0.001,
        'DOGEUSDT': 0.00001,
        'DOTUSDT': 0.001,
        'AVAXUSDT': 0.001,
        'MATICUSDT': 0.0001
    };

    // Return specific tick size if known
    if (tickSizes[symbol]) {
        return tickSizes[symbol];
    }

    // Fallback: determine tick size based on price level
    if (price >= 1000) return 0.1;
    if (price >= 100) return 0.01;
    if (price >= 10) return 0.001;
    if (price >= 1) return 0.0001;
    return 0.00001;
}

/**
 * Validate and filter trade data
 * @param {Array} trades - Raw trade data
 * @param {number} startTime - Start timestamp (milliseconds)
 * @param {number} endTime - End timestamp (milliseconds)
 * @returns {Array} Filtered and validated trades
 */
function validateAndFilterTrades(trades, startTime, endTime) {
    if (!Array.isArray(trades)) {
        return [];
    }

    return trades.filter(trade => {
        // Validate required fields
        if (!trade.price || !trade.quantity || !trade.timestamp) {
            return false;
        }

        const timestamp = parseInt(trade.timestamp);
        const price = parseFloat(trade.price);
        const quantity = parseFloat(trade.quantity);

        // Validate data types and ranges
        if (isNaN(timestamp) || isNaN(price) || isNaN(quantity)) {
            return false;
        }

        if (price <= 0 || quantity <= 0) {
            return false;
        }

        // Filter by time range if specified
        if (startTime && timestamp < startTime) {
            return false;
        }

        if (endTime && timestamp > endTime) {
            return false;
        }

        return true;
    });
}

/**
 * Calculate volume footprint with comprehensive error handling
 * @param {Array} trades - Array of trade objects
 * @param {string} symbol - Trading symbol
 * @param {number} startTime - Candle start time (milliseconds)
 * @param {number} endTime - Candle end time (milliseconds)
 * @returns {Object} Complete volume footprint analysis
 */
function calculateReversalVolumeFootprint(trades, symbol, startTime, endTime) {
    try {
        // Filter trades to exact candle timeframe
        const filteredTrades = validateAndFilterTrades(trades, startTime, endTime);
        
        if (filteredTrades.length === 0) {
            return {
                poc: null,
                vah: null,
                val: null,
                totalVolume: 0,
                valueAreaVolume: 0,
                error: 'No valid trades found in the specified time range',
                symbol: symbol,
                timeframe: { startTime, endTime },
                tradesProcessed: 0
            };
        }

        // Determine appropriate tick size
        const avgPrice = filteredTrades.reduce((sum, trade) => sum + parseFloat(trade.price), 0) / filteredTrades.length;
        const tickSize = getTickSize(symbol, avgPrice);

        // Calculate volume footprint
        const footprint = calculateVolumeFootprint(filteredTrades, tickSize);
        
        return {
            ...footprint,
            symbol: symbol,
            timeframe: {
                startTime: startTime,
                endTime: endTime,
                duration: endTime - startTime
            },
            tradesProcessed: filteredTrades.length,
            calculatedAt: new Date()
        };

    } catch (error) {
        return {
            poc: null,
            vah: null,
            val: null,
            totalVolume: 0,
            valueAreaVolume: 0,
            error: `Volume footprint calculation failed: ${error.message}`,
            symbol: symbol,
            timeframe: { startTime, endTime },
            tradesProcessed: 0
        };
    }
}

module.exports = {
    calculateVolumeFootprint,
    calculateValueArea,
    calculateReversalVolumeFootprint,
    validateAndFilterTrades,
    getTickSize,
    getDecimalPlaces
};
