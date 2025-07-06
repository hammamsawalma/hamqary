/**
 * Test script to verify WebSocket fixes
 * This script tests the improved WebSocket implementation
 */

const { WebSocketCandleCollector } = require('./utils/websocketCandleCollector');

async function testWebSocketFixes() {
    console.log('🧪 Testing WebSocket fixes...\n');
    
    // Test symbols for demonstration
    const testSymbols = ['BTCUSDT', 'ETHUSDT'];
    
    // Create WebSocket collector with test configuration
    const collector = new WebSocketCandleCollector({
        maxReconnectAttempts: 5,
        reconnectDelay: 1000,
        maxReconnectDelay: 10000,
        healthCheckInterval: 30000,
        maxSilentTime: 60000,
        
        // Test callbacks
        onClosedCandle: (candleData) => {
            console.log(`📊 Test: Received closed candle for ${candleData.symbol}:`);
            console.log(`   └── Close price: ${candleData.close}`);
            console.log(`   └── Volume: ${candleData.volume}`);
            console.log(`   └── Time: ${candleData.closeTime.toISOString()}`);
        },
        
        onConnect: () => {
            console.log('✅ Test: Connection established successfully');
        },
        
        onDisconnect: (code, reason) => {
            console.log(`❌ Test: Disconnected with code ${code}: ${reason}`);
        },
        
        onError: (error) => {
            console.error('❌ Test: WebSocket error:', error.message);
        },
        
        onGapDetected: async (gaps) => {
            console.log(`🚨 Test: Data gaps detected for ${gaps.length} symbols`);
            gaps.forEach(({ symbol, gaps: symbolGaps }) => {
                console.log(`   └── ${symbol}: ${symbolGaps.length} missing candles`);
            });
        }
    });
    
    try {
        console.log('🔗 Attempting to connect to Binance WebSocket...');
        
        // Test connection
        await collector.connect(testSymbols);
        
        if (collector.isConnectionReady()) {
            console.log('✅ Connection established and ready');
            
            // Test subscription status
            const status = collector.getStatus();
            console.log(`📊 Subscribed to ${status.subscribedCount} symbols`);
            console.log(`📈 Statistics:`, {
                candlesReceived: status.stats.candlesReceived,
                errors: status.stats.errors,
                reconnectionCount: status.stats.reconnectionCount
            });
            
            // Let it run for a short time to test ping/pong handling
            console.log('⏱️ Testing connection for 30 seconds...');
            await new Promise(resolve => setTimeout(resolve, 30000));
            
            // Test graceful disconnection
            console.log('🔌 Testing graceful disconnection...');
            collector.disconnect();
            
            console.log('✅ All tests completed successfully');
            
        } else {
            throw new Error('Connection not ready after establishment');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        
        // Force cleanup on error
        collector.forceCleanup();
        
        throw error;
    }
}

// Run the test if this script is executed directly
if (require.main === module) {
    testWebSocketFixes()
        .then(() => {
            console.log('\n🎉 WebSocket fixes test completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 WebSocket fixes test failed:', error);
            process.exit(1);
        });
}

module.exports = { testWebSocketFixes };
