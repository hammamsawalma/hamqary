/**
 * Test script for reversal candle pattern detection
 * This script processes existing candle data and detects reversal patterns
 */

const { connectToMongoDB } = require('./config/database');
const { processAllReversalCandles, processSpecificReversalCandles } = require('./utils/processReversalCandles');
const { detectReversalCandle, getReversalStatistics } = require('./utils/reversalCandleDetector');

async function testReversalDetection() {
    let client;
    
    try {
        console.log('🔄 Starting reversal candle detection test...');
        
        // Connect to MongoDB
        client = await connectToMongoDB();
        const dbName = process.env.MONGODB_DB_NAME || 'hamqary';
        
        console.log('✅ Connected to MongoDB');
        
        // Test 1: Single candle detection
        console.log('\n📊 Test 1: Single Candle Detection');
        testSingleCandleDetection();
        
        // Test 2: Get some sample candle data to test
        console.log('\n📊 Test 2: Sample Data Detection');
        await testSampleDataDetection(client, dbName);
        
        // Test 3: Process all reversal candles (with a small batch size for testing)
        console.log('\n📊 Test 3: Batch Processing (Limited)');
        const results = await processSpecificReversalCandles(
            client, 
            dbName,
            ['BTCUSDT'], // Test with just BTC
            ['1h'], // Test with just 1h interval
            { 
                batchSize: 100, // Small batch for testing
                delay: 100 // Small delay between batches
            }
        );
        
        console.log('\n🏁 Batch Processing Results:');
        console.log(`📈 Total candles processed: ${results.totalCandlesProcessed}`);
        console.log(`🔍 Reversal patterns found: ${results.reversalPatternsFound}`);
        console.log(`💾 Reversal patterns saved: ${results.reversalPatternsSaved}`);
        console.log(`🟢 Buy reversals: ${results.buyReversals}`);
        console.log(`🔴 Sell reversals: ${results.sellReversals}`);
        console.log(`⏱️ Processing time: ${(results.endTime - results.startTime) / 1000}s`);
        
        if (results.errors.length > 0) {
            console.log(`❌ Errors encountered: ${results.errors.length}`);
            results.errors.slice(0, 5).forEach(error => console.log(`  - ${error}`));
        }
        
        // Test 4: Query reversal patterns from database
        console.log('\n📊 Test 4: Database Query Test');
        await testDatabaseQuery(client, dbName);
        
        console.log('\n✅ All tests completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        if (client) {
            await client.close();
            console.log('🔌 Database connection closed');
        }
    }
}

function testSingleCandleDetection() {
    // Test cases with different candle patterns
    const testCandles = [
        // Buy reversal pattern - long lower tail, small body
        {
            name: 'Buy Reversal - Hammer',
            open: 100,
            high: 105,
            low: 90,
            close: 103
        },
        // Sell reversal pattern - long upper tail, small body  
        {
            name: 'Sell Reversal - Shooting Star',
            open: 103,
            high: 115,
            low: 102,
            close: 100
        },
        // Normal candle - large body, not a reversal
        {
            name: 'Normal Candle - Large Body',
            open: 100,
            high: 110,
            low: 98,
            close: 108
        },
        // Doji-like pattern with no clear reversal
        {
            name: 'Doji - No Reversal',
            open: 100,
            high: 102,
            low: 98,
            close: 100.5
        }
    ];
    
    testCandles.forEach(testCandle => {
        console.log(`\n🧪 Testing: ${testCandle.name}`);
        console.log(`   OHLC: ${testCandle.open}/${testCandle.high}/${testCandle.low}/${testCandle.close}`);
        
        const result = detectReversalCandle(testCandle);
        
        if (result) {
            console.log(`   ✅ Reversal detected: ${result.type}`);
            console.log(`   📊 Body: ${result.bodyPercentage}%, Upper tail: ${result.upperTailPercentage}%, Lower tail: ${result.lowerTailPercentage}%`);
            console.log(`   🎯 Confidence: ${result.confidence}%`);
            console.log(`   🎨 Color: ${result.candleColor}`);
        } else {
            console.log(`   ❌ No reversal pattern detected`);
        }
    });
}

async function testSampleDataDetection(client, dbName) {
    try {
        const db = client.db(dbName);
        const candleCollection = db.collection('candleData');
        
        // Get a small sample of candles
        const sampleCandles = await candleCollection.find({})
            .limit(20)
            .toArray();
        
        if (sampleCandles.length === 0) {
            console.log('   ⚠️ No candle data found in database');
            return;
        }
        
        console.log(`   📊 Testing ${sampleCandles.length} sample candles from database`);
        
        let reversalCount = 0;
        let buyReversals = 0;
        let sellReversals = 0;
        
        sampleCandles.forEach((candle, index) => {
            const result = detectReversalCandle(candle);
            if (result) {
                reversalCount++;
                if (result.type === 'buy_reversal') {
                    buyReversals++;
                } else {
                    sellReversals++;
                }
                
                console.log(`   🔍 Candle ${index + 1} (${candle.symbol} ${candle.interval}): ${result.type} - ${result.confidence}% confidence`);
            }
        });
        
        console.log(`   📈 Results: ${reversalCount}/${sampleCandles.length} reversal patterns found`);
        console.log(`   🟢 Buy reversals: ${buyReversals}, 🔴 Sell reversals: ${sellReversals}`);
        
        // Test statistics calculation
        const stats = getReversalStatistics(sampleCandles);
        console.log(`   📊 Statistics: ${stats.reversalPercentage}% reversal rate, avg confidence: ${stats.averageConfidence}%`);
        
    } catch (error) {
        console.error('   ❌ Error in sample data test:', error);
    }
}

async function testDatabaseQuery(client, dbName) {
    try {
        const { getReversalCandles, getReversalCandleCount, getReversalStatistics } = require('./models/database');
        
        // Test getting reversal candles
        const reversalCandles = await getReversalCandles(client, dbName, {}, 10, 0);
        console.log(`   📊 Found ${reversalCandles.length} reversal patterns in database`);
        
        if (reversalCandles.length > 0) {
            console.log(`   🔍 Sample reversal:`);
            console.log(`      Symbol: ${reversalCandles[0].symbol}`);
            console.log(`      Interval: ${reversalCandles[0].interval}`);
            console.log(`      Type: ${reversalCandles[0].reversalPattern.type}`);
            console.log(`      Confidence: ${reversalCandles[0].reversalPattern.confidence}%`);
            console.log(`      Time: ${new Date(reversalCandles[0].openTime).toLocaleString()}`);
        }
        
        // Test getting count
        const totalCount = await getReversalCandleCount(client, dbName, {});
        console.log(`   📈 Total reversal patterns in database: ${totalCount}`);
        
        // Test getting statistics
        const dbStats = await getReversalStatistics(client, dbName, {});
        console.log(`   📊 Database statistics:`);
        console.log(`      Total: ${dbStats.totalReversals}`);
        console.log(`      Buy: ${dbStats.buyReversals}, Sell: ${dbStats.sellReversals}`);
        console.log(`      Average confidence: ${dbStats.averageConfidence}%`);
        console.log(`      High confidence (>80%): ${dbStats.confidenceDistribution.high}`);
        
    } catch (error) {
        console.error('   ❌ Error in database query test:', error);
    }
}

// Run the test if this file is executed directly
if (require.main === module) {
    testReversalDetection()
        .then(() => {
            console.log('\n🎉 Test script completed!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test script failed:', error);
            process.exit(1);
        });
}

module.exports = {
    testReversalDetection,
    testSingleCandleDetection,
    testSampleDataDetection,
    testDatabaseQuery
};
