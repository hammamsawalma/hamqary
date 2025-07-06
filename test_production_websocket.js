/**
 * Production WebSocket Test
 * Tests the WebSocket collector with realistic symbol counts (40 symbols)
 * to verify rate limiting fixes work correctly
 */

const { WebSocketCandleCollector } = require('./utils/websocketCandleCollector');

async function testProductionWebSocket() {
    console.log('🧪 Testing Production WebSocket with 40 symbols...\n');

    // Simulate production symbols (top 40 USDT pairs)
    const testSymbols = [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'SOLUSDT', 'DOTUSDT',
        'MATICUSDT', 'LTCUSDT', 'AVAXUSDT', 'LINKUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT', 'XLMUSDT',
        'ALGOUSDT', 'VETUSDT', 'ICPUSDT', 'FILUSDT', 'TRXUSDT', 'FTMUSDT', 'HBARUSDT', 'MANAUSDT',
        'SANDUSDT', 'AXSUSDT', 'THETAUSDT', 'AAVEUSDT', 'EOSUSDT', 'GRTUSDT', 'FLOWUSDT', 'XTZUSDT',
        'CHZUSDT', 'ENJUSDT', 'MKRUSDT', 'COMPUSDT', 'YFIUSDT', 'SNXUSDT', 'UMAUSDT', 'RUNEUSDT'
    ];

    let candlesReceived = 0;

    // Create collector with realistic production callbacks
    const collector = new WebSocketCandleCollector({
        onClosedCandle: (candleData) => {
            candlesReceived++;
            console.log(`📊 Production: Closed candle received for ${candleData.symbol}`);
            console.log(`   └── Price: ${candleData.close}, Volume: ${candleData.volume}`);
            console.log(`   └── Time: ${candleData.closeTime.toISOString()}`);
            console.log(`   └── Total candles received: ${candlesReceived}`);
        },
        onConnect: () => {
            console.log('✅ Production: WebSocket connected successfully');
        },
        onDisconnect: (code, reason) => {
            console.log(`❌ Production: WebSocket disconnected: ${code} - ${reason}`);
        },
        onError: (error) => {
            console.error('❌ Production: WebSocket error:', error);
        }
    });

    try {
        console.log(`🔗 Connecting to Binance with ${testSymbols.length} symbols...`);
        console.log(`📊 Test symbols: ${testSymbols.slice(0, 5).join(', ')}...`);
        
        // Connect with all symbols at once (like production)
        const connectSuccess = await collector.connect(testSymbols);
        
        if (!connectSuccess) {
            throw new Error('Failed to connect to WebSocket');
        }

        console.log('\n✅ Connection established successfully!');
        console.log('📊 Monitoring subscriptions and data flow...\n');

        // Monitor for 60 seconds to see subscription progress and data reception
        console.log('⏱️ Monitoring for 60 seconds to verify stability...');
        
        let monitoringCount = 0;
        const monitoringInterval = setInterval(() => {
            monitoringCount++;
            const status = collector.getStatus();
            
            console.log(`\n📈 Status Check ${monitoringCount}:`);
            console.log(`   ├── Connected: ${status.isConnected ? '✅' : '❌'}`);
            console.log(`   ├── Subscribed Symbols: ${status.subscribedCount}/${testSymbols.length}`);
            console.log(`   ├── Candles Received: ${candlesReceived}`);
            console.log(`   ├── Reconnection Attempts: ${status.reconnectAttempts}`);
            console.log(`   └── Uptime: ${Math.round(status.stats.uptime / 1000)}s`);
            
            // Check for issues
            if (!status.isConnected) {
                console.log('⚠️ Connection lost during monitoring!');
            }
            
            if (status.subscribedCount < testSymbols.length && monitoringCount > 4) {
                console.log(`⚠️ Not all symbols subscribed after ${monitoringCount * 10}s`);
            }
            
        }, 10000); // Every 10 seconds

        // Wait for monitoring period
        await new Promise(resolve => setTimeout(resolve, 60000));
        
        clearInterval(monitoringInterval);

        // Final status check
        const finalStatus = collector.getStatus();
        
        console.log('\n📊 Final Production Test Results:');
        console.log(`├── Connection Success: ${finalStatus.isConnected ? '✅' : '❌'}`);
        console.log(`├── Subscriptions: ${finalStatus.subscribedCount}/${testSymbols.length} (${Math.round(finalStatus.subscribedCount/testSymbols.length*100)}%)`);
        console.log(`├── Candles Received: ${candlesReceived}`);
        console.log(`├── Total Errors: ${finalStatus.stats.errors}`);
        console.log(`├── Reconnections: ${finalStatus.stats.reconnectionCount}`);
        console.log(`└── Total Uptime: ${Math.round(finalStatus.stats.uptime / 1000)}s`);

        // Test results evaluation
        const subscriptionRate = finalStatus.subscribedCount / testSymbols.length;
        const hasReceivedData = candlesReceived > 0;
        const stableConnection = finalStatus.isConnected && finalStatus.stats.reconnectionCount <= 2;

        console.log('\n🎯 Test Evaluation:');
        
        if (subscriptionRate >= 0.9) {
            console.log('✅ Subscription Rate: EXCELLENT (≥90%)');
        } else if (subscriptionRate >= 0.7) {
            console.log('⚠️ Subscription Rate: GOOD (≥70%)');
        } else {
            console.log('❌ Subscription Rate: POOR (<70%)');
        }

        if (hasReceivedData) {
            console.log('✅ Data Reception: SUCCESS');
        } else {
            console.log('❌ Data Reception: FAILED');
        }

        if (stableConnection) {
            console.log('✅ Connection Stability: STABLE');
        } else {
            console.log('❌ Connection Stability: UNSTABLE');
        }

        // Overall result
        if (subscriptionRate >= 0.8 && hasReceivedData && stableConnection) {
            console.log('\n🎉 PRODUCTION TEST: SUCCESS!');
            console.log('The WebSocket implementation is ready for production use.');
        } else {
            console.log('\n❌ PRODUCTION TEST: NEEDS IMPROVEMENT');
            console.log('The WebSocket implementation requires further optimization.');
        }

        // Graceful shutdown
        console.log('\n🔌 Testing graceful disconnection...');
        collector.disconnect();
        console.log('✅ Graceful disconnection completed');

    } catch (error) {
        console.error('\n💥 Production test failed:', error);
        
        // Force cleanup on error
        collector.forceCleanup();
        
        throw error;
    }
}

// Run the test
if (require.main === module) {
    testProductionWebSocket()
        .then(() => {
            console.log('\n✅ Production WebSocket test completed!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Production WebSocket test failed:', error);
            process.exit(1);
        });
}

module.exports = { testProductionWebSocket };
