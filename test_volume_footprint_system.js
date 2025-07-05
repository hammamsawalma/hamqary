/**
 * Test Volume Footprint System
 * Comprehensive testing utility for the volume footprint functionality
 */

const { calculateVolumeFootprint, calculateReversalVolumeFootprint } = require('./utils/volumeFootprintCalculator');
const { fetchHistoricalAggTrades, fetchReversalCandleTickData } = require('./utils/fetchHistoricalTickData');
const { backfillVolumeFootprints, getBackfillStatus } = require('./utils/backfillVolumeFootprints');
const { initializeGlobalTickCollector, cleanupGlobalTickCollector } = require('./utils/websocketTickCollector');

// Sample trade data for testing
const sampleTrades = [
    { price: 95000.00, quantity: 0.1, timestamp: 1704067200000 },
    { price: 95000.50, quantity: 0.2, timestamp: 1704067210000 },
    { price: 95001.00, quantity: 0.15, timestamp: 1704067220000 },
    { price: 95000.75, quantity: 0.3, timestamp: 1704067230000 },
    { price: 95000.25, quantity: 0.25, timestamp: 1704067240000 },
    { price: 95000.00, quantity: 0.4, timestamp: 1704067250000 },
    { price: 94999.50, quantity: 0.2, timestamp: 1704067260000 },
    { price: 94999.00, quantity: 0.35, timestamp: 1704067270000 },
    { price: 94999.25, quantity: 0.1, timestamp: 1704067280000 },
    { price: 95000.00, quantity: 0.5, timestamp: 1704067290000 }
];

/**
 * Test 1: Volume Footprint Calculator
 */
async function testVolumeFootprintCalculator() {
    console.log('\n🧪 TEST 1: Volume Footprint Calculator');
    console.log('=====================================');

    try {
        const result = calculateVolumeFootprint(sampleTrades, 0.01);
        
        console.log('✅ Volume Footprint Calculation Results:');
        console.log(`📊 POC (Point of Control): $${result.poc}`);
        console.log(`📈 VAH (Value Area High): $${result.vah}`);
        console.log(`📉 VAL (Value Area Low): $${result.val}`);
        console.log(`💰 Total Volume: ${result.totalVolume}`);
        console.log(`🎯 Value Area Volume: ${result.valueAreaVolume} (${result.valueAreaPercentage}%)`);
        console.log(`📊 Price Range: $${result.priceRange.min} - $${result.priceRange.max} (Spread: $${result.priceRange.spread})`);
        console.log(`🔢 Trades Processed: ${result.tradesCount}`);
        
        if (result.error) {
            console.error('❌ Error in calculation:', result.error);
        }

        return result;
        
    } catch (error) {
        console.error('❌ Test 1 Failed:', error.message);
        return null;
    }
}

/**
 * Test 2: Historical Tick Data Fetcher
 */
async function testHistoricalTickDataFetcher() {
    console.log('\n🧪 TEST 2: Historical Tick Data Fetcher');
    console.log('======================================');

    try {
        const symbol = 'BTCUSDT';
        const endTime = Date.now();
        const startTime = endTime - (5 * 60 * 1000); // 5 minutes ago
        
        console.log(`🔍 Fetching historical tick data for ${symbol}`);
        console.log(`📅 Time range: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);
        
        const trades = await fetchHistoricalAggTrades(symbol, startTime, endTime, 100);
        
        console.log(`✅ Retrieved ${trades.length} trades`);
        
        if (trades.length > 0) {
            console.log('📊 Sample trades:');
            trades.slice(0, 3).forEach((trade, index) => {
                console.log(`  ${index + 1}. Price: $${trade.price}, Qty: ${trade.quantity}, Time: ${new Date(trade.timestamp).toISOString()}`);
            });
            
            // Calculate volume footprint from real data
            if (trades.length >= 5) {
                console.log('\n📈 Calculating volume footprint from real data...');
                const footprint = calculateReversalVolumeFootprint(trades, symbol, startTime, endTime);
                
                if (!footprint.error) {
                    console.log(`✅ POC: $${footprint.poc}, VAH: $${footprint.vah}, VAL: $${footprint.val}`);
                    console.log(`💰 Total Volume: ${footprint.totalVolume}, Trades: ${footprint.tradesProcessed}`);
                } else {
                    console.log(`❌ Volume footprint error: ${footprint.error}`);
                }
            }
        }
        
        return trades;
        
    } catch (error) {
        console.error('❌ Test 2 Failed:', error.message);
        return [];
    }
}

/**
 * Test 3: WebSocket Tick Collector (Connection Test)
 */
async function testWebSocketConnection() {
    console.log('\n🧪 TEST 3: WebSocket Connection Test');
    console.log('===================================');

    try {
        console.log('🔗 Initializing WebSocket connection...');
        
        const collector = await initializeGlobalTickCollector({
            maxReconnectAttempts: 3,
            reconnectDelay: 2000
        });
        
        // Wait for connection
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const status = collector.getCollectionStatus();
        console.log('📊 WebSocket Status:');
        console.log(`  Connected: ${status.isConnected ? '✅' : '❌'}`);
        console.log(`  Subscribed Symbols: ${status.subscribedSymbols.length}`);
        console.log(`  Active Collections: ${status.totalActiveCollections}`);
        
        if (status.isConnected) {
            console.log('🎯 Testing symbol subscription...');
            const subscribed = collector.subscribeToSymbol('BTCUSDT');
            console.log(`  BTCUSDT subscription: ${subscribed ? '✅' : '❌'}`);
            
            // Wait for some messages
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const updatedStatus = collector.getCollectionStatus();
            console.log(`  Subscribed Symbols: ${updatedStatus.subscribedSymbols.join(', ')}`);
        }
        
        console.log('🔌 Cleaning up WebSocket connection...');
        cleanupGlobalTickCollector();
        
        return status.isConnected;
        
    } catch (error) {
        console.error('❌ Test 3 Failed:', error.message);
        cleanupGlobalTickCollector();
        return false;
    }
}

/**
 * Test 4: Database Integration (if MongoDB is available)
 */
async function testDatabaseIntegration() {
    console.log('\n🧪 TEST 4: Database Integration Test');
    console.log('===================================');

    try {
        // Try to connect to MongoDB (this would require the actual connection setup)
        console.log('🔍 Checking for MongoDB connection...');
        
        // This is a placeholder - in reality you'd need the actual client
        console.log('⚠️ MongoDB client not available in test environment');
        console.log('ℹ️ This test would check:');
        console.log('  - Backfill status');
        console.log('  - Reversal candle processing');  
        console.log('  - Volume footprint storage');
        console.log('  - Database schema validation');
        
        return false;
        
    } catch (error) {
        console.error('❌ Test 4 Failed:', error.message);
        return false;
    }
}

/**
 * Test 5: End-to-End Reversal Processing
 */
async function testEndToEndProcessing() {
    console.log('\n🧪 TEST 5: End-to-End Reversal Processing');
    console.log('=========================================');

    try {
        const symbol = 'BTCUSDT';
        const interval = '5m';
        const endTime = Date.now();
        const startTime = endTime - (5 * 60 * 1000); // 5 minutes
        
        console.log(`🎯 Testing complete reversal processing for ${symbol} ${interval}`);
        
        // Step 1: Fetch tick data
        console.log('📊 Step 1: Fetching tick data...');
        const tickDataResult = await fetchReversalCandleTickData(symbol, startTime, endTime, interval);
        
        if (!tickDataResult.success) {
            console.log(`❌ Failed to fetch tick data: ${tickDataResult.error}`);
            return false;
        }
        
        console.log(`✅ Retrieved ${tickDataResult.tradesCount} trades in ${tickDataResult.executionTime}ms`);
        
        // Step 2: Calculate volume footprint
        console.log('📈 Step 2: Calculating volume footprint...');
        const volumeFootprint = calculateReversalVolumeFootprint(
            tickDataResult.trades,
            symbol,
            startTime,
            endTime
        );
        
        if (volumeFootprint.error) {
            console.log(`❌ Volume footprint calculation failed: ${volumeFootprint.error}`);
            return false;
        }
        
        console.log('✅ Volume Footprint Results:');
        console.log(`  POC: $${volumeFootprint.poc}`);
        console.log(`  VAH: $${volumeFootprint.vah}`);
        console.log(`  VAL: $${volumeFootprint.val}`);
        console.log(`  Total Volume: ${volumeFootprint.totalVolume}`);
        console.log(`  Value Area: ${volumeFootprint.valueAreaPercentage}%`);
        console.log(`  Data Source: ${volumeFootprint.tickDataSource || 'historical'}`);
        
        return true;
        
    } catch (error) {
        console.error('❌ Test 5 Failed:', error.message);
        return false;
    }
}

/**
 * Performance Benchmark
 */
async function performanceBenchmark() {
    console.log('\n🧪 PERFORMANCE BENCHMARK');
    console.log('========================');

    try {
        const iterations = 100;
        const startTime = performance.now();
        
        console.log(`🚀 Running ${iterations} volume footprint calculations...`);
        
        for (let i = 0; i < iterations; i++) {
            const result = calculateVolumeFootprint(sampleTrades, 0.01);
            if (result.error) {
                console.error(`❌ Error in iteration ${i + 1}:`, result.error);
                break;
            }
        }
        
        const endTime = performance.now();
        const totalTime = endTime - startTime;
        const avgTime = totalTime / iterations;
        
        console.log('📊 Performance Results:');
        console.log(`  Total Time: ${totalTime.toFixed(2)}ms`);
        console.log(`  Average Time: ${avgTime.toFixed(2)}ms per calculation`);
        console.log(`  Throughput: ${(1000 / avgTime).toFixed(0)} calculations per second`);
        
        return avgTime;
        
    } catch (error) {
        console.error('❌ Performance Benchmark Failed:', error.message);
        return null;
    }
}

/**
 * Main Test Runner
 */
async function runAllTests() {
    console.log('🧪 VOLUME FOOTPRINT SYSTEM TESTING');
    console.log('==================================');
    console.log(`Started at: ${new Date().toISOString()}`);
    
    const results = {
        volumeFootprintCalculator: false,
        historicalTickData: false,
        webSocketConnection: false,
        databaseIntegration: false,
        endToEndProcessing: false,
        performanceBenchmark: null
    };
    
    try {
        // Run all tests
        const test1Result = await testVolumeFootprintCalculator();
        results.volumeFootprintCalculator = !!test1Result && !test1Result.error;
        
        const test2Result = await testHistoricalTickDataFetcher();
        results.historicalTickData = test2Result.length > 0;
        
        results.webSocketConnection = await testWebSocketConnection();
        results.databaseIntegration = await testDatabaseIntegration();
        results.endToEndProcessing = await testEndToEndProcessing();
        results.performanceBenchmark = await performanceBenchmark();
        
        // Summary
        console.log('\n📋 TEST SUMMARY');
        console.log('===============');
        console.log(`Volume Footprint Calculator: ${results.volumeFootprintCalculator ? '✅' : '❌'}`);
        console.log(`Historical Tick Data: ${results.historicalTickData ? '✅' : '❌'}`);
        console.log(`WebSocket Connection: ${results.webSocketConnection ? '✅' : '❌'}`);
        console.log(`Database Integration: ${results.databaseIntegration ? '✅' : '⚠️  Not Available'}`);
        console.log(`End-to-End Processing: ${results.endToEndProcessing ? '✅' : '❌'}`);
        console.log(`Performance: ${results.performanceBenchmark ? `${results.performanceBenchmark.toFixed(2)}ms avg` : '❌'}`);
        
        const passedTests = Object.values(results).filter(r => r === true).length;
        const totalTests = Object.keys(results).length - 1; // Exclude performance benchmark
        
        console.log(`\n🎯 Overall: ${passedTests}/${totalTests} tests passed`);
        
    } catch (error) {
        console.error('❌ Test runner failed:', error);
    }
    
    console.log(`\nCompleted at: ${new Date().toISOString()}`);
    return results;
}

// Export functions for individual testing
module.exports = {
    testVolumeFootprintCalculator,
    testHistoricalTickDataFetcher,
    testWebSocketConnection,
    testDatabaseIntegration,
    testEndToEndProcessing,
    performanceBenchmark,
    runAllTests
};

// Run tests if this file is executed directly
if (require.main === module) {
    runAllTests().then(results => {
        process.exit(0);
    }).catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
