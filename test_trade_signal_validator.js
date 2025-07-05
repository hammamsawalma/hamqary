/**
 * Test Trade Signal Validator
 * Tests the trade signal validation logic with sample data
 */

const { validateTradeSignal } = require('./utils/tradeSignalValidator');

console.log('🧪 Testing Trade Signal Validator');
console.log('=================================\n');

// Test Case 1: Valid Buy Signal
console.log('📈 Test Case 1: Valid Buy Signal');
const validBuyCandle = {
    open: 100.50,   // Above VAH
    high: 101.00,
    low: 99.00,     // Lower tail extends below POC
    close: 100.80   // Above VAH
};

const validBuyFootprint = {
    poc: 99.20,     // In lower tail (< bodyLow) and below VAH
    vah: 100.00,    // Below candle body
    val: 98.50
};

const buyResult = validateTradeSignal(validBuyCandle, validBuyFootprint, 'buy_reversal');
console.log('Result:', buyResult.isValidSignal ? '✅ VALID' : '❌ INVALID');
console.log('Reason:', buyResult.reason);
console.log('Criteria:', JSON.stringify(buyResult.criteria, null, 2));
console.log('Analysis:', JSON.stringify(buyResult.details.analysis, null, 2));

console.log('\n' + '='.repeat(50) + '\n');

// Test Case 2: Valid Sell Signal  
console.log('📉 Test Case 2: Valid Sell Signal');
const validSellCandle = {
    open: 98.20,    // Below VAL
    high: 99.50,    // Upper tail extends above POC
    low: 97.80,
    close: 98.00    // Below VAL
};

const validSellFootprint = {
    poc: 99.30,     // In upper tail (> bodyHigh) and above VAL
    vah: 100.00,
    val: 98.50      // Above candle body
};

const sellResult = validateTradeSignal(validSellCandle, validSellFootprint, 'sell_reversal');
console.log('Result:', sellResult.isValidSignal ? '✅ VALID' : '❌ INVALID');
console.log('Reason:', sellResult.reason);
console.log('Criteria:', JSON.stringify(sellResult.criteria, null, 2));
console.log('Analysis:', JSON.stringify(sellResult.details.analysis, null, 2));

console.log('\n' + '='.repeat(50) + '\n');

// Test Case 3: Invalid Buy Signal (Body not above VAH)
console.log('❌ Test Case 3: Invalid Buy Signal (Body not above VAH)');
const invalidBuyCandle = {
    open: 99.50,    // Below VAH
    high: 101.00,
    low: 98.00,
    close: 100.20   // Above VAH but open is not
};

const invalidBuyFootprint = {
    poc: 98.50,
    vah: 100.00,
    val: 97.50
};

const invalidBuyResult = validateTradeSignal(invalidBuyCandle, invalidBuyFootprint, 'buy_reversal');
console.log('Result:', invalidBuyResult.isValidSignal ? '✅ VALID' : '❌ INVALID');
console.log('Reason:', invalidBuyResult.reason);
console.log('Criteria:', JSON.stringify(invalidBuyResult.criteria, null, 2));

console.log('\n' + '='.repeat(50) + '\n');

// Test Case 4: Invalid Sell Signal (POC not in upper tail)
console.log('❌ Test Case 4: Invalid Sell Signal (POC not in upper tail)');
const invalidSellCandle = {
    open: 97.50,    // Below VAL
    high: 98.80,
    low: 97.00,
    close: 97.20    // Below VAL
};

const invalidSellFootprint = {
    poc: 97.60,     // Not in upper tail (< bodyHigh)
    vah: 99.00,
    val: 98.00      // Above candle body (correct)
};

const invalidSellResult = validateTradeSignal(invalidSellCandle, invalidSellFootprint, 'sell_reversal');
console.log('Result:', invalidSellResult.isValidSignal ? '✅ VALID' : '❌ INVALID');
console.log('Reason:', invalidSellResult.reason);
console.log('Criteria:', JSON.stringify(invalidSellResult.criteria, null, 2));

console.log('\n' + '='.repeat(50) + '\n');

// Test Case 5: Real market example with precise values
console.log('📊 Test Case 5: Real Market Example (BTCUSDT-like)');
const realMarketCandle = {
    open: 95001.25,
    high: 95015.50,
    low: 94980.00,
    close: 95008.75
};

const realMarketFootprint = {
    poc: 94985.50,  // In lower tail, below VAH - should be valid buy
    vah: 95000.00,
    val: 94975.25
};

const realResult = validateTradeSignal(realMarketCandle, realMarketFootprint, 'buy_reversal');
console.log('Result:', realResult.isValidSignal ? '✅ VALID BUY' : '❌ INVALID');
console.log('Reason:', realResult.reason);
console.log('Detailed Analysis:');
console.log('- Body Range:', `${Math.min(realMarketCandle.open, realMarketCandle.close)} - ${Math.max(realMarketCandle.open, realMarketCandle.close)}`);
console.log('- POC vs Body Low:', `${realMarketFootprint.poc} ${realMarketFootprint.poc < Math.min(realMarketCandle.open, realMarketCandle.close) ? '<' : '>='} ${Math.min(realMarketCandle.open, realMarketCandle.close)}`);
console.log('- Body vs VAH:', `Open(${realMarketCandle.open}) > VAH(${realMarketFootprint.vah}): ${realMarketCandle.open > realMarketFootprint.vah}`);
console.log('- Body vs VAH:', `Close(${realMarketCandle.close}) > VAH(${realMarketFootprint.vah}): ${realMarketCandle.close > realMarketFootprint.vah}`);
console.log('- POC vs VAH:', `${realMarketFootprint.poc} ${realMarketFootprint.poc < realMarketFootprint.vah ? '<' : '>='} ${realMarketFootprint.vah}`);

console.log('\n✅ Trade Signal Validator Tests Completed!');
