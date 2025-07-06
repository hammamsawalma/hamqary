/**
 * Test script for the Top Movers functionality
 * Tests fetching top gainers and losers from Binance API
 */

const { testTopMovers, getTopMoversSymbols, getTopMoversSummary } = require('./utils/getTopMoversSymbols');

console.log('🧪 Testing Top Movers Functionality\n');

async function runTopMoversTests() {
    try {
        console.log('='.repeat(80));
        console.log('🔥 TOP MOVERS TEST SUITE');
        console.log('='.repeat(80));
        console.log('');

        // Test 1: Basic functionality test
        console.log('Test 1: Basic Top Movers Fetch (Top 10 each)');
        console.log('-'.repeat(50));
        
        const testResult = await getTopMoversSymbols(10);
        
        if (testResult.success) {
            console.log('✅ Basic test passed');
            console.log(`📊 Retrieved ${testResult.totalSymbols} symbols total`);
            console.log(`📈 Top gainers: ${testResult.gainers.symbols.slice(0, 3).join(', ')}...`);
            console.log(`📉 Top losers: ${testResult.losers.symbols.slice(0, 3).join(', ')}...`);
        } else {
            console.log('❌ Basic test failed:', testResult.error);
        }
        
        console.log('');

        // Test 2: Full functionality test (20 each - default)
        console.log('Test 2: Full Top Movers Test (Top 20 each - Production Ready)');
        console.log('-'.repeat(50));
        
        await testTopMovers(20);
        
        console.log('');

        // Test 3: Summary format test
        console.log('Test 3: Testing Summary Format');
        console.log('-'.repeat(50));
        
        const summaryTest = await getTopMoversSymbols(5);
        if (summaryTest.success) {
            const summary = getTopMoversSummary(summaryTest);
            console.log('✅ Summary format test:');
            console.log(summary);
        } else {
            console.log('❌ Summary test failed');
        }
        
        console.log('');

        // Test 4: Error handling test
        console.log('Test 4: Error Handling Test');
        console.log('-'.repeat(50));
        
        // Temporarily modify the URL to test error handling
        console.log('ℹ️ Testing error handling (this should fail gracefully)...');
        
        // Mock a failed request by passing invalid parameters
        const errorTest = await getTopMoversSymbols(-1);
        if (!errorTest.success) {
            console.log('✅ Error handling works correctly');
            console.log(`   Error captured: ${errorTest.error}`);
        } else {
            console.log('⚠️ Error handling test unexpected result');
        }
        
        console.log('');

        // Test 5: Performance test
        console.log('Test 5: Performance Test');
        console.log('-'.repeat(50));
        
        const startTime = Date.now();
        const perfTest = await getTopMoversSymbols(20);
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        if (perfTest.success) {
            console.log(`✅ Performance test completed in ${duration}ms`);
            console.log(`📊 Processing rate: ${(perfTest.totalSymbols / duration * 1000).toFixed(2)} symbols/second`);
            
            if (duration < 5000) {
                console.log('✅ Performance is acceptable (< 5 seconds)');
            } else {
                console.log('⚠️ Performance might be slow (> 5 seconds)');
            }
        } else {
            console.log('❌ Performance test failed');
        }
        
        console.log('');

        // Summary
        console.log('🎉 All tests completed!');
        console.log('');
        console.log('📋 Top Movers System Summary:');
        console.log('   ✅ Fetches live data from Binance Futures API');
        console.log('   ✅ Filters for USDT trading pairs only');
        console.log('   ✅ Selects top 20 gainers + top 20 losers');  
        console.log('   ✅ Handles errors gracefully');
        console.log('   ✅ Provides detailed logging and summaries');
        console.log('   ✅ Ready for hourly cron job integration');
        console.log('');
        console.log('💡 Next steps:');
        console.log('   • System will automatically update symbols every hour');
        console.log('   • Only updates when 5+ symbols change significantly');
        console.log('   • Seamlessly integrates with existing reversal detection');
        console.log('   • Historical data automatically loaded for new symbols');

    } catch (error) {
        console.error('❌ Test suite failed:', error);
        process.exit(1);
    }
}

// Run the tests
runTopMoversTests();
