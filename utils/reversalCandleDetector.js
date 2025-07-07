/**
 * Reversal Candle Pattern Detection Utility
 * Detects reversal candle patterns based on specific criteria:
 * 1. Body size must not exceed 38% of total candle length
 * 2. Long tail on opposite side of reversal direction
 * 3. Short tail (≤10%) on reversal direction side
 */

/**
 * Detects if a candle is a reversal pattern
 * @param {Object} candle - Candle data with OHLC values
 * @returns {Object|null} Reversal pattern data or null if not a reversal
 */
function detectReversalCandle(candle) {
    // Validate input
    if (!candle || typeof candle.open !== 'number' || typeof candle.high !== 'number' || 
        typeof candle.low !== 'number' || typeof candle.close !== 'number') {
        return null;
    }

    const { open, high, low, close } = candle;
    
    // Calculate candle metrics
    const totalLength = high - low;
    const bodySize = Math.abs(close - open);
    const upperTail = high - Math.max(open, close);
    const lowerTail = Math.min(open, close) - low;
    
    // Ensure tails are non-negative
    const upperTailCorrected = Math.max(0, upperTail);
    const lowerTailCorrected = Math.max(0, lowerTail);
    
    // Avoid division by zero
    if (totalLength === 0) {
        return null;
    }
    
    // Calculate percentages using corrected tail values
    const bodyPercentage = (bodySize / totalLength) * 100;
    const upperTailPercentage = (upperTailCorrected / totalLength) * 100;
    const lowerTailPercentage = (lowerTailCorrected / totalLength) * 100;
    
    // Check if body size is 23% or greater - if so, not a reversal candle
    if (bodyPercentage >= 23) {
        return null;
    }
    
    // Determine candle color
    const isBullish = close > open;
    const isBearish = close < open;
    const isDoji = close === open;
    
    // Check for buy reversal pattern
    // Buy reversal: body above, long tail below, short upper tail (≤5%)
    // Buy reversals can only be green (bullish) or doji candles
    if (lowerTailPercentage > upperTailPercentage && upperTailPercentage <= 5 && (isBullish || isDoji)) {
        // Body should be in the upper portion of the candle
        const bodyPosition = ((Math.min(open, close) - low) / totalLength) * 100;
        
        // For a buy reversal, we want the body to be positioned higher
        // and the lower tail to be significantly longer
        if (bodyPosition >= 50 && lowerTailPercentage >= 30) {
            // Calculate stoploss risk percentage for buy signal
            // Buy stoploss = low, so risk = ((close - low) / close) * 100
            const stopLossRisk = ((close - low) / close) * 100;
            
            // Apply 0.4% minimum threshold - skip if risk is too low
            if (stopLossRisk < 0.4) {
                console.log(`🚫 Buy reversal skipped for ${close}: Risk ${stopLossRisk.toFixed(3)}% < 0.4% threshold`);
                return null;
            }
            
            return {
                type: 'buy_reversal',
                bodyPercentage: Math.round(bodyPercentage * 100) / 100,
                upperTailPercentage: Math.round(upperTailPercentage * 100) / 100,
                lowerTailPercentage: Math.round(lowerTailPercentage * 100) / 100,
                totalLength,
                bodySize,
                upperTail: upperTailCorrected,
                lowerTail: lowerTailCorrected,
                candleColor: isBullish ? 'green' : isBearish ? 'red' : 'doji',
                bodyPosition: Math.round(bodyPosition * 100) / 100,
                confidence: calculateConfidence('buy', bodyPercentage, upperTailPercentage, lowerTailPercentage, bodyPosition),
                stopLossPrice: low,
                stopLossRisk: Math.round(stopLossRisk * 100) / 100
            };
        }
    }
    
    // Check for sell reversal pattern
    // Sell reversal: body below, long tail above, short lower tail (≤5%)
    // Sell reversals can only be red (bearish) or doji candles
    if (upperTailPercentage > lowerTailPercentage && lowerTailPercentage <= 5 && (isBearish || isDoji)) {
        // Body should be in the lower portion of the candle
        const bodyPosition = ((Math.max(open, close) - low) / totalLength) * 100;
        
        // For a sell reversal, we want the body to be positioned lower
        // and the upper tail to be significantly longer
        if (bodyPosition <= 50 && upperTailPercentage >= 30) {
            // Calculate stoploss risk percentage for sell signal
            // Sell stoploss = high, so risk = ((high - close) / close) * 100
            const stopLossRisk = ((high - close) / close) * 100;
            
            // Apply 0.4% minimum threshold - skip if risk is too low
            if (stopLossRisk < 0.4) {
                console.log(`🚫 Sell reversal skipped for ${close}: Risk ${stopLossRisk.toFixed(3)}% < 0.4% threshold`);
                return null;
            }
            
            return {
                type: 'sell_reversal',
                bodyPercentage: Math.round(bodyPercentage * 100) / 100,
                upperTailPercentage: Math.round(upperTailPercentage * 100) / 100,
                lowerTailPercentage: Math.round(lowerTailPercentage * 100) / 100,
                totalLength,
                bodySize,
                upperTail: upperTailCorrected,
                lowerTail: lowerTailCorrected,
                candleColor: isBullish ? 'green' : isBearish ? 'red' : 'doji',
                bodyPosition: Math.round(bodyPosition * 100) / 100,
                confidence: calculateConfidence('sell', bodyPercentage, upperTailPercentage, lowerTailPercentage, bodyPosition),
                stopLossPrice: high,
                stopLossRisk: Math.round(stopLossRisk * 100) / 100
            };
        }
    }
    
    return null;
}

/**
 * Calculate confidence score for reversal pattern (0-100)
 * @param {string} type - 'buy' or 'sell'
 * @param {number} bodyPercentage - Body size percentage
 * @param {number} upperTailPercentage - Upper tail percentage
 * @param {number} lowerTailPercentage - Lower tail percentage
 * @param {number} bodyPosition - Body position percentage
 * @returns {number} Confidence score (0-100)
 */
function calculateConfidence(type, bodyPercentage, upperTailPercentage, lowerTailPercentage, bodyPosition) {
    let confidence = 50; // Base confidence
    
    // Lower body percentage = higher confidence (more doji-like)
    confidence += (38 - bodyPercentage) * 0.8;
    
    if (type === 'buy') {
        // Longer lower tail = higher confidence
        confidence += Math.min(lowerTailPercentage * 0.5, 25);
        
        // Shorter upper tail = higher confidence
        confidence += (10 - upperTailPercentage) * 2;
        
        // Higher body position = higher confidence
        confidence += (bodyPosition - 50) * 0.3;
    } else { // sell
        // Longer upper tail = higher confidence
        confidence += Math.min(upperTailPercentage * 0.5, 25);
        
        // Shorter lower tail = higher confidence
        confidence += (10 - lowerTailPercentage) * 2;
        
        // Lower body position = higher confidence
        confidence += (50 - bodyPosition) * 0.3;
    }
    
    return Math.max(0, Math.min(100, Math.round(confidence)));
}

/**
 * Batch process multiple candles for reversal patterns
 * @param {Array} candles - Array of candle data
 * @returns {Array} Array of reversal patterns found
 */
function batchDetectReversalCandles(candles) {
    if (!Array.isArray(candles)) {
        return [];
    }
    
    const reversalCandles = [];
    
    candles.forEach((candle, index) => {
        const reversalPattern = detectReversalCandle(candle);
        if (reversalPattern) {
            reversalCandles.push({
                index,
                candle,
                reversalPattern
            });
        }
    });
    
    return reversalCandles;
}

/**
 * Get statistics about reversal patterns in a dataset
 * @param {Array} candles - Array of candle data
 * @returns {Object} Statistics object
 */
function getReversalStatistics(candles) {
    const reversalCandles = batchDetectReversalCandles(candles);
    
    const stats = {
        totalCandles: candles.length,
        totalReversals: reversalCandles.length,
        buyReversals: 0,
        sellReversals: 0,
        reversalPercentage: 0,
        averageConfidence: 0,
        confidenceDistribution: {
            high: 0, // >80
            medium: 0, // 60-80
            low: 0 // <60
        }
    };
    
    if (reversalCandles.length === 0) {
        return stats;
    }
    
    let totalConfidence = 0;
    
    reversalCandles.forEach(({ reversalPattern }) => {
        if (reversalPattern.type === 'buy_reversal') {
            stats.buyReversals++;
        } else {
            stats.sellReversals++;
        }
        
        totalConfidence += reversalPattern.confidence;
        
        if (reversalPattern.confidence > 80) {
            stats.confidenceDistribution.high++;
        } else if (reversalPattern.confidence >= 60) {
            stats.confidenceDistribution.medium++;
        } else {
            stats.confidenceDistribution.low++;
        }
    });
    
    stats.reversalPercentage = Math.round((reversalCandles.length / candles.length) * 10000) / 100;
    stats.averageConfidence = Math.round(totalConfidence / reversalCandles.length);
    
    return stats;
}

module.exports = {
    detectReversalCandle,
    batchDetectReversalCandles,
    getReversalStatistics,
    calculateConfidence
};
