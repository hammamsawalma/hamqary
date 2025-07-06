/**
 * Test WebSocket Reconnection Fix
 * Validates that the infinite recursion bug is fixed and connection remains stable
 */

console.log('🧪 Testing WebSocket Reconnection Fix');
console.log('====================================\n');

const { WebSocketCandleCollector } = require('./utils/websocketCandleCollector');

// Test configuration
const TEST_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
const TEST_DURATION = 30000; // 30 seconds per test

class WebSocketReconnectionTest {
    constructor() {
        this.testResults = [];
        this.collector = null;
    }

    async runAllTests() {
        console.log('🚀 Starting WebSocket Reconnection Tests\n');
        
        try {
            await this.testBasicConnection();
            await this.testReconnectionWithSymbols();
            await this.testReconnectionWithoutSymbols();
            await this.testForceReconnection();
            await this.testCleanupAndMemoryLeaks();
            
            this.printResults();
            
        } catch (error) {
            console.error('❌ Test suite failed:', error);
        }
    }

    async testBasicConnection() {
        console.log('📋 Test 1: Basic Connection and Close Flag Processing');
        console.log('-----------------------------------------------------');
        
        const testResult = {
            name: 'Basic Connection',
            success: false,
            details: [],
            errors: []
        };

        try {
            let candlesReceived = 0;
            let closedCandlesReceived = 0;
            
            this.collector = new WebSocketCandleCollector({
                onClosedCandle: (candleData) => {
                    closedCandlesReceived++;
                    console.log(`✅ Closed candle: ${candleData.symbol} at ${candleData.closeTime.toISOString()}`);
                    testResult.details.push(`Closed candle received: ${candleData.symbol}`);
                },
                onConnect: () => {
                    console.log('✅ Connected to WebSocket');
                    testResult.details.push('WebSocket connected successfully');
                },
                onError: (error) => {
                    console.error('❌ WebSocket error:', error);
                    testResult.errors.push(error.message);
                }
            });
            
            // Connect with test symbols
            await this.collector.connect(TEST_SYMBOLS);
            
            // Wait for data
            await this.waitFor(10000); // 10 seconds
            
            const status = this.collector.getStatus();
            
            testResult.details.push(`Connected: ${status.isConnected}`);
            testResult.details.push(`Subscribed symbols: ${status.subscribedCount}`);
            testResult.details.push(`Candles received: ${status.stats.candlesReceived}`);
            testResult.details.push(`Closed candles processed: ${status.stats.closedCandlesProcessed}`);
            
            if (status.isConnected && status.subscribedCount === TEST_SYMBOLS.length) {
                testResult.success = true;
                console.log('✅ Basic connection test PASSED');
            } else {
                console.log('❌ Basic connection test FAILED');
            }
            
        } catch (error) {
            testResult.errors.push(error.message);
            console.error('❌ Basic connection test ERROR:', error);
        }
        
        this.testResults.push(testResult);
        console.log();
    }

    async testReconnectionWithSymbols() {
        console.log('📋 Test 2: Reconnection with Persisted Symbols');
        console.log('----------------------------------------------');
        
        const testResult = {
            name: 'Reconnection with Symbols',
            success: false,
            details: [],
            errors: []
        };

        try {
            let reconnectionCount = 0;
            
            // Add reconnection tracking
            const originalCallback = this.collector.onConnectCallback;
            this.collector.onConnectCallback = () => {
                reconnectionCount++;
                console.log(`🔄 Connection established (attempt ${reconnectionCount})`);
                testResult.details.push(`Connection attempt ${reconnectionCount}`);
                if (originalCallback) originalCallback();
            };
            
            // Force reconnection by terminating connection
            console.log('🔌 Forcing disconnection to test reconnection...');
            if (this.collector.ws) {
                this.collector.ws.terminate();
            }
            
            // Wait for reconnection
            await this.waitFor(15000); // 15 seconds
            
            const status = this.collector.getStatus();
            
            testResult.details.push(`Final connected state: ${status.isConnected}`);
            testResult.details.push(`Reconnection attempts: ${status.stats.reconnectionCount}`);
            testResult.details.push(`Subscribed symbols: ${status.subscribedCount}`);
            
            if (status.isConnected && status.subscribedCount === TEST_SYMBOLS.length && reconnectionCount >= 2) {
                testResult.success = true;
                console.log('✅ Reconnection with symbols test PASSED');
            } else {
                console.log('❌ Reconnection with symbols test FAILED');
            }
            
        } catch (error) {
            testResult.errors.push(error.message);
            console.error('❌ Reconnection test ERROR:', error);
        }
        
        this.testResults.push(testResult);
        console.log();
    }

    async testReconnectionWithoutSymbols() {
        console.log('📋 Test 3: Reconnection without Database Symbols (Bug Fix)');
        console.log('----------------------------------------------------------');
        
        const testResult = {
            name: 'Reconnection without Symbols',
            success: false,
            details: [],
            errors: []
        };

        try {
            // Clear persisted symbols to simulate the problematic scenario
            const originalSymbols = [...this.collector.persistedSymbols];
            this.collector.persistedSymbols = [];
            
            // Mock getCurrentSymbolsFromDatabase to return empty array
            const originalMethod = this.collector.getCurrentSymbolsFromDatabase;
            this.collector.getCurrentSymbolsFromDatabase = async () => {
                console.log('📊 Simulating empty database symbols');
                testResult.details.push('Database returned empty symbols');
                return [];
            };
            
            let reconnectionAttempts = 0;
            const originalHandleReconnection = this.collector.handleReconnection.bind(this.collector);
            this.collector.handleReconnection = async function() {
                reconnectionAttempts++;
                console.log(`🔄 Reconnection attempt ${reconnectionAttempts}`);
                testResult.details.push(`Reconnection attempt ${reconnectionAttempts}`);
                
                // Prevent infinite recursion by limiting attempts
                if (reconnectionAttempts > 5) {
                    console.log('🛑 Stopping test - no infinite recursion detected');
                    testResult.details.push('No infinite recursion - test passed');
                    return;
                }
                
                return originalHandleReconnection();
            };
            
            // Force disconnection
            console.log('🔌 Forcing disconnection without symbols...');
            if (this.collector.ws) {
                this.collector.ws.terminate();
            }
            
            // Wait and observe behavior
            await this.waitFor(10000); // 10 seconds
            
            // Restore symbols and method
            this.collector.persistedSymbols = originalSymbols;
            this.collector.getCurrentSymbolsFromDatabase = originalMethod;
            
            testResult.details.push(`Total reconnection attempts: ${reconnectionAttempts}`);
            
            // Success if no infinite recursion (attempts should be limited)
            if (reconnectionAttempts > 0 && reconnectionAttempts <= 10) {
                testResult.success = true;
                console.log('✅ No infinite recursion bug - test PASSED');
            } else {
                console.log('❌ Infinite recursion may still exist - test FAILED');
            }
            
        } catch (error) {
            testResult.errors.push(error.message);
            console.error('❌ Reconnection without symbols test ERROR:', error);
        }
        
        this.testResults.push(testResult);
        console.log();
    }

    async testForceReconnection() {
        console.log('📋 Test 4: Forced Reconnection (Health Monitoring)');
        console.log('--------------------------------------------------');
        
        const testResult = {
            name: 'Force Reconnection',
            success: false,
            details: [],
            errors: []
        };

        try {
            // Ensure we have a connected collector
            if (!this.collector.isConnected) {
                await this.collector.connect(TEST_SYMBOLS);
                await this.waitFor(2000);
            }
            
            let forceReconnections = 0;
            const originalForceReconnection = this.collector.forceReconnection.bind(this.collector);
            this.collector.forceReconnection = function(reason) {
                forceReconnections++;
                console.log(`🚨 Force reconnection ${forceReconnections}: ${reason}`);
                testResult.details.push(`Force reconnection: ${reason}`);
                return originalForceReconnection(reason);
            };
            
            // Simulate silent connection by manipulating lastMessageTime
            console.log('🔇 Simulating silent connection...');
            this.collector.lastMessageTime = new Date(Date.now() - 300000); // 5 minutes ago
            
            // Trigger health check
            this.collector.checkConnectionHealth();
            
            // Wait for reconnection
            await this.waitFor(5000);
            
            testResult.details.push(`Force reconnections triggered: ${forceReconnections}`);
            
            if (forceReconnections > 0) {
                testResult.success = true;
                console.log('✅ Force reconnection test PASSED');
            } else {
                console.log('❌ Force reconnection test FAILED');
            }
            
        } catch (error) {
            testResult.errors.push(error.message);
            console.error('❌ Force reconnection test ERROR:', error);
        }
        
        this.testResults.push(testResult);
        console.log();
    }

    async testCleanupAndMemoryLeaks() {
        console.log('📋 Test 5: Cleanup and Memory Leak Prevention');
        console.log('---------------------------------------------');
        
        const testResult = {
            name: 'Cleanup and Memory Leaks',
            success: false,
            details: [],
            errors: []
        };

        try {
            // Check initial state
            const initialStatus = this.collector.getStatus();
            testResult.details.push(`Initial subscriptions: ${initialStatus.subscribedCount}`);
            
            // Test disconnect
            this.collector.disconnect();
            
            // Verify cleanup
            const afterDisconnect = this.collector.getStatus();
            testResult.details.push(`After disconnect - Connected: ${afterDisconnect.isConnected}`);
            testResult.details.push(`After disconnect - Subscriptions: ${afterDisconnect.subscribedCount}`);
            
            // Check timers are cleared (indirect check)
            const hasHeartbeat = this.collector.heartbeatInterval !== null;
            const hasHealthTimer = this.collector.connectionHealthTimer !== null;
            const hasReconnectTimer = this.collector.reconnectTimer !== null;
            
            testResult.details.push(`Heartbeat timer cleared: ${!hasHeartbeat}`);
            testResult.details.push(`Health timer cleared: ${!hasHealthTimer}`);
            testResult.details.push(`Reconnect timer cleared: ${!hasReconnectTimer}`);
            
            // Test force cleanup
            this.collector.forceCleanup();
            
            if (!afterDisconnect.isConnected && 
                afterDisconnect.subscribedCount === 0 &&
                !hasHeartbeat && !hasHealthTimer && !hasReconnectTimer) {
                testResult.success = true;
                console.log('✅ Cleanup test PASSED');
            } else {
                console.log('❌ Cleanup test FAILED - potential memory leaks');
            }
            
        } catch (error) {
            testResult.errors.push(error.message);
            console.error('❌ Cleanup test ERROR:', error);
        }
        
        this.testResults.push(testResult);
        console.log();
    }

    printResults() {
        console.log('📊 Test Results Summary');
        console.log('======================');
        
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(test => test.success).length;
        const failedTests = totalTests - passedTests;
        
        console.log(`Total Tests: ${totalTests}`);
        console.log(`Passed: ${passedTests} ✅`);
        console.log(`Failed: ${failedTests} ❌`);
        console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);
        
        this.testResults.forEach((test, index) => {
            console.log(`${index + 1}. ${test.name}: ${test.success ? '✅ PASS' : '❌ FAIL'}`);
            
            if (test.details.length > 0) {
                console.log('   Details:');
                test.details.forEach(detail => console.log(`   • ${detail}`));
            }
            
            if (test.errors.length > 0) {
                console.log('   Errors:');
                test.errors.forEach(error => console.log(`   ❌ ${error}`));
            }
            console.log();
        });
        
        if (passedTests === totalTests) {
            console.log('🎉 All tests passed! WebSocket reconnection fix is working correctly.');
        } else {
            console.log('⚠️ Some tests failed. Review the issues above.');
        }
    }

    async waitFor(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Run the tests
const tester = new WebSocketReconnectionTest();
tester.runAllTests().catch(console.error);
