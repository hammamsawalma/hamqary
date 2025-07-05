/**
 * Trade Signal Validator for Reversal Candles
 * Validates whether a reversal candle with volume footprint data represents a valid trade signal
 */

/**
 * Validate trade signal based on candle and volume footprint data
 * @param {Object} candleData - OHLC data for the candle
 * @param {Object} volumeFootprint - Volume footprint data (POC, VAH, VAL)
 * @param {string} reversalType - Type of reversal ('buy_reversal' or 'sell_reversal')
 * @returns {Object} Trade signal validation result
 */
function validateTradeSignal(candleData, volumeFootprint, reversalType) {
    try {
        // Validate input data
        if (!candleData || !volumeFootprint || !reversalType) {
            return {
                isValidSignal: false,
                signalType: null,
                reason: 'Missing required data',
                details: {
                    hasCandle: !!candleData,
                    hasVolumeFootprint: !!volumeFootprint,
                    hasReversalType: !!reversalType
                }
            };
        }

        const { open, high, low, close } = candleData;
        const { poc, vah, val } = volumeFootprint;

        // Validate required price data
        if (!isValidPrice(open) || !isValidPrice(high) || !isValidPrice(low) || !isValidPrice(close)) {
            return {
                isValidSignal: false,
                signalType: null,
                reason: 'Invalid candle OHLC data',
                details: { open, high, low, close }
            };
        }

        // Validate volume footprint data
        if (!isValidPrice(poc) || !isValidPrice(vah) || !isValidPrice(val)) {
            return {
                isValidSignal: false,
                signalType: null,
                reason: 'Invalid volume footprint data',
                details: { poc, vah, val }
            };
        }

        // Determine candle body range
        const bodyHigh = Math.max(open, close);
        const bodyLow = Math.min(open, close);

        // Validate based on reversal type
        if (reversalType === 'buy_reversal') {
            return validateBuySignal(candleData, volumeFootprint, bodyHigh, bodyLow);
        } else if (reversalType === 'sell_reversal') {
            return validateSellSignal(candleData, volumeFootprint, bodyHigh, bodyLow);
        } else {
            return {
                isValidSignal: false,
                signalType: null,
                reason: 'Unknown reversal type',
                details: { reversalType }
            };
        }

    } catch (error) {
        return {
            isValidSignal: false,
            signalType: null,
            reason: `Validation error: ${error.message}`,
            details: { error: error.toString() }
        };
    }
}

/**
 * Validate buy signal criteria
 * @param {Object} candleData - OHLC data
 * @param {Object} volumeFootprint - Volume footprint data
 * @param {number} bodyHigh - Higher of open/close
 * @param {number} bodyLow - Lower of open/close
 * @returns {Object} Buy signal validation result
 */
function validateBuySignal(candleData, volumeFootprint, bodyHigh, bodyLow) {
    const { open, high, low, close } = candleData;
    const { poc, vah, val } = volumeFootprint;

    // Buy Signal Criteria:
    // 1. Body completely above VAH (both open AND close > VAH)
    // 2. POC in lower tail (POC < min(open, close))
    // 3. POC below VAH (POC < VAH)

    const criteria = {
        bodyAboveVAH: open > vah && close > vah,
        pocInLowerTail: poc < bodyLow,
        pocBelowVAH: poc < vah
    };

    const isValidSignal = criteria.bodyAboveVAH && criteria.pocInLowerTail && criteria.pocBelowVAH;

    // Calculate signal score (1-10 scale)
    // For buy signals: POC closer to low (further from VAH) = higher score
    const score = isValidSignal ? calculateBuySignalScore(candleData, volumeFootprint) : 0;

    return {
        isValidSignal,
        signalType: isValidSignal ? 'buy' : null,
        reason: isValidSignal ? 'Valid buy signal detected' : 'Buy signal criteria not met',
        score: Math.round(score * 10) / 10, // Round to 1 decimal place
        criteria,
        details: {
            candleType: 'buy_reversal',
            bodyRange: { high: bodyHigh, low: bodyLow },
            volumeFootprint: { poc, vah, val },
            candleOHLC: { open, high, low, close },
            analysis: {
                openVsVAH: `${open} ${open > vah ? '>' : '<='} ${vah}`,
                closeVsVAH: `${close} ${close > vah ? '>' : '<='} ${vah}`,
                pocVsBodyLow: `${poc} ${poc < bodyLow ? '<' : '>='} ${bodyLow}`,
                pocVsVAH: `${poc} ${poc < vah ? '<' : '>='} ${vah}`
            }
        }
    };
}

/**
 * Validate sell signal criteria
 * @param {Object} candleData - OHLC data
 * @param {Object} volumeFootprint - Volume footprint data
 * @param {number} bodyHigh - Higher of open/close
 * @param {number} bodyLow - Lower of open/close
 * @returns {Object} Sell signal validation result
 */
function validateSellSignal(candleData, volumeFootprint, bodyHigh, bodyLow) {
    const { open, high, low, close } = candleData;
    const { poc, vah, val } = volumeFootprint;

    // Sell Signal Criteria:
    // 1. Body completely below VAL (both open AND close < VAL)
    // 2. POC in upper tail (POC > max(open, close))
    // 3. POC above VAL (POC > VAL)

    const criteria = {
        bodyBelowVAL: open < val && close < val,
        pocInUpperTail: poc > bodyHigh,
        pocAboveVAL: poc > val
    };

    const isValidSignal = criteria.bodyBelowVAL && criteria.pocInUpperTail && criteria.pocAboveVAL;

    // Calculate signal score (1-10 scale)
    // For sell signals: POC closer to high (further from VAL) = higher score
    const score = isValidSignal ? calculateSellSignalScore(candleData, volumeFootprint) : 0;

    return {
        isValidSignal,
        signalType: isValidSignal ? 'sell' : null,
        reason: isValidSignal ? 'Valid sell signal detected' : 'Sell signal criteria not met',
        score: Math.round(score * 10) / 10, // Round to 1 decimal place
        criteria,
        details: {
            candleType: 'sell_reversal',
            bodyRange: { high: bodyHigh, low: bodyLow },
            volumeFootprint: { poc, vah, val },
            candleOHLC: { open, high, low, close },
            analysis: {
                openVsVAL: `${open} ${open < val ? '<' : '>='} ${val}`,
                closeVsVAL: `${close} ${close < val ? '<' : '>='} ${val}`,
                pocVsBodyHigh: `${poc} ${poc > bodyHigh ? '>' : '<='} ${bodyHigh}`,
                pocVsVAL: `${poc} ${poc > val ? '>' : '<='} ${val}`
            }
        }
    };
}

/**
 * Calculate buy signal score based on POC position
 * @param {Object} candleData - OHLC data
 * @param {Object} volumeFootprint - Volume footprint data
 * @returns {number} Score from 1-10
 */
function calculateBuySignalScore(candleData, volumeFootprint) {
    const { low } = candleData;
    const { poc, vah } = volumeFootprint;
    
    // For buy signals: POC closer to low (further from VAH) = higher score
    // Score = 10 - (9 * (poc - low) / (vah - low))
    // This gives 10 when poc = low, and approaches 1 when poc approaches vah
    
    const vahLowRange = vah - low;
    if (vahLowRange <= 0) {
        return 5; // Default score if range is invalid
    }
    
    const pocLowDistance = poc - low;
    const normalizedDistance = pocLowDistance / vahLowRange;
    
    // Calculate score: 10 when POC is at low, 1 when POC is at VAH
    const score = 10 - (9 * normalizedDistance);
    
    // Ensure score is between 1 and 10
    return Math.max(1, Math.min(10, score));
}

/**
 * Calculate sell signal score based on POC position
 * @param {Object} candleData - OHLC data
 * @param {Object} volumeFootprint - Volume footprint data
 * @returns {number} Score from 1-10
 */
function calculateSellSignalScore(candleData, volumeFootprint) {
    const { high } = candleData;
    const { poc, val } = volumeFootprint;
    
    // For sell signals: POC closer to high (further from VAL) = higher score
    // Score = 10 - (9 * (high - poc) / (high - val))
    // This gives 10 when poc = high, and approaches 1 when poc approaches val
    
    const highValRange = high - val;
    if (highValRange <= 0) {
        return 5; // Default score if range is invalid
    }
    
    const highPocDistance = high - poc;
    const normalizedDistance = highPocDistance / highValRange;
    
    // Calculate score: 10 when POC is at high, 1 when POC is at VAL
    const score = 10 - (9 * normalizedDistance);
    
    // Ensure score is between 1 and 10
    return Math.max(1, Math.min(10, score));
}

/**
 * Check if a price value is valid
 * @param {any} price - Price value to validate
 * @returns {boolean} True if valid price
 */
function isValidPrice(price) {
    return typeof price === 'number' && !isNaN(price) && price > 0 && isFinite(price);
}

/**
 * Batch validate trade signals for multiple reversal candles
 * @param {Array} reversalCandles - Array of reversal candle objects
 * @returns {Array} Array of validation results
 */
function batchValidateTradeSignals(reversalCandles) {
    if (!Array.isArray(reversalCandles)) {
        return [];
    }

    return reversalCandles.map(candle => {
        try {
            const validation = validateTradeSignal(
                candle.candleData,
                candle.volumeFootprint,
                candle.reversalPattern?.type
            );

            return {
                candleId: candle._id,
                symbol: candle.symbol,
                interval: candle.interval,
                openTime: candle.openTime,
                validation
            };
        } catch (error) {
            return {
                candleId: candle._id,
                symbol: candle.symbol,
                interval: candle.interval,
                openTime: candle.openTime,
                validation: {
                    isValidSignal: false,
                    signalType: null,
                    reason: `Batch validation error: ${error.message}`,
                    details: { error: error.toString() }
                }
            };
        }
    });
}

/**
 * Get summary statistics for trade signal validation results
 * @param {Array} validationResults - Array of validation results
 * @returns {Object} Summary statistics
 */
function getTradeSignalStatistics(validationResults) {
    if (!Array.isArray(validationResults)) {
        return { total: 0, validSignals: 0, buySignals: 0, sellSignals: 0, invalidSignals: 0 };
    }

    const stats = {
        total: validationResults.length,
        validSignals: 0,
        buySignals: 0,
        sellSignals: 0,
        invalidSignals: 0,
        validationRate: 0
    };

    validationResults.forEach(result => {
        const validation = result.validation;
        
        if (validation.isValidSignal) {
            stats.validSignals++;
            
            if (validation.signalType === 'buy') {
                stats.buySignals++;
            } else if (validation.signalType === 'sell') {
                stats.sellSignals++;
            }
        } else {
            stats.invalidSignals++;
        }
    });

    stats.validationRate = stats.total > 0 ? Math.round((stats.validSignals / stats.total) * 100) : 0;

    return stats;
}

module.exports = {
    validateTradeSignal,
    validateBuySignal,
    validateSellSignal,
    batchValidateTradeSignals,
    getTradeSignalStatistics,
    isValidPrice
};
