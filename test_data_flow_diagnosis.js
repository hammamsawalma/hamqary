/**
 * Comprehensive Data Flow Diagnosis Script
 * This script will identify issues with symbol data fetching and storage
 */

const { MongoClient } = require('mongodb');
const getPerpetualCandleData = require('./utils/getPerpetualCandleData');
const { getSelectedSymbols } = require('./models/database');
// Using built-in fetch (Node.js 18+)

// Load environment variables
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DATABASE_NAME = process.env.DATABASE_NAME || 'trading_system';

/**
 * Test individual symbol API call
 */
async function testSymbolAPICall(symbol) {
    try {
        console.log(`\n🔍 Testing API call for ${symbol}...`);
        
        // Test direct Binance API call
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=5`;
        const response = await fetch(url);
        
        if (!response.ok) {
            return {
                symbol,
                success: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
                apiResponse: null,
                dataQuality: 'FAILED'
            };
        }
        
        const data = await response.json();
        
        if (!Array.isArray(data) || data.length === 0) {
            return {
                symbol,
                success: false,
                error: 'Empty or invalid response',
                apiResponse: data,
                dataQuality: 'EMPTY'
            };
        }
        
        // Check data quality
        const sampleCandle = data[0];
        const isDummy = checkIfDummyData(data);
        
        return {
            symbol,
            success: true,
            error: null,
            apiResponse: {
                candleCount: data.length,
                sampleCandle: {
                    openTime: new Date(sampleCandle[0]).toISOString(),
                    open: parseFloat(sampleCandle[1]),
                    high: parseFloat(sampleCandle[2]),
                    low: parseFloat(sampleCandle[3]),
                    close: parseFloat(sampleCandle[4]),
                    volume: parseFloat(sampleCandle[5])
                },
                latestCandle: {
                    openTime: new Date(data[data.length - 1][0]).toISOString(),
                    close: parseFloat(data[data.length - 1][4])
                }
            },
            dataQuality: isDummy ? 'DUMMY_DATA' : 'REAL_DATA'
        };
        
    } catch (error) {
        return {
            symbol,
            success: false,
            error: error.message,
            apiResponse: null,
            dataQuality: 'ERROR'
        };
    }
}

/**
 * Check if data appears to be dummy/repetitive
 */
function checkIfDummyData(candles) {
    if (candles.length < 3) return false;
    
    // Check if all candles have the same OHLC values (classic dummy data)
    const firstCandle = candles[0];
    const firstOHLC = [firstCandle[1], firstCandle[2], firstCandle[3], firstCandle[4]];
    
    let identicalCount = 0;
    for (let i = 1; i < candles.length; i++) {
        const currentOHLC = [candles[i][1], candles[i][2], candles[i][3], candles[i][4]];
        if (JSON.stringify(firstOHLC) === JSON.stringify(currentOHLC)) {
            identicalCount++;
        }
    }
    
    // If more than 50% of candles are identical, likely dummy data
    return (identicalCount / (candles.length - 1)) > 0.5;
}

/**
 * Test our utility function
 */
async function testUtilityFunction(symbols) {
    try {
        console.log(`\n🛠️ Testing getPerpetualCandleData utility with ${symbols.length} symbols...`);
        
        const result = await getPerpetualCandleData(symbols, '1m', { limit: 5 });
        
        const analysis = {};
        for (const symbol of symbols) {
            const symbolData = result[symbol];
            
            if (!symbolData) {
                analysis[symbol] = {
                    status: 'MISSING',
                    dataQuality: 'NO_DATA',
                    error: 'No data returned'
                };
            } else if (symbolData.error) {
                analysis[symbol] = {
                    status: 'ERROR',
                    dataQuality: 'ERROR',
                    error: symbolData.error
                };
            } else if (Array.isArray(symbolData)) {
                const isDummy = checkIfDummyData(symbolData.map(candle => [
                    candle.openTime, candle.open, candle.high, candle.low, candle.close, candle.volume
                ]));
                
                analysis[symbol] = {
                    status: 'SUCCESS',
                    dataQuality: isDummy ? 'DUMMY_DATA' : 'REAL_DATA',
                    candleCount: symbolData.length,
                    sampleData: {
                        open: symbolData[0]?.open,
                        close: symbolData[0]?.close,
                        volume: symbolData[0]?.volume
                    }
                };
            } else {
                analysis[symbol] = {
                    status: 'INVALID',
                    dataQuality: 'INVALID_FORMAT',
                    error: 'Unexpected data format'
                };
            }
        }
        
        return analysis;
    } catch (error) {
        console.error('❌ Error testing utility function:', error);
        return null;
    }
}

/**
 * Check database for existing data
 */
async function checkDatabaseData(client, dbName, symbols) {
    try {
        console.log(`\n🗄️ Checking database for existing data...`);
        
        const db = client.db(dbName);
        const candleCollection = db.collection('candleData');
        
        const analysis = {};
        
        for (const symbol of symbols) {
            // Get recent 1m candles for this symbol
            const recentCandles = await candleCollection.find({
                symbol: symbol,
                interval: '1m'
            })
            .sort({ openTime: -1 })
            .limit(10)
            .toArray();
            
            if (recentCandles.length === 0) {
                analysis[symbol] = {
                    status: 'NO_DATA',
                    candleCount: 0,
                    lastUpdate: null
                };
            } else {
                // Check if data looks like dummy data
                const ohlcData = recentCandles.map(candle => [
                    candle.openTime, candle.open, candle.high, candle.low, candle.close, candle.volume
                ]);
                const isDummy = checkIfDummyData(ohlcData);
                
                analysis[symbol] = {
                    status: 'HAS_DATA',
                    candleCount: recentCandles.length,
                    lastUpdate: recentCandles[0].fetchedAt,
                    dataQuality: isDummy ? 'DUMMY_DATA' : 'REAL_DATA',
                    sampleCandle: {
                        openTime: recentCandles[0].openTime,
                        open: recentCandles[0].open,
                        close: recentCandles[0].close,
                        volume: recentCandles[0].volume
                    }
                };
            }
            
            // Also check for artificial candles
            const artificialCandles = await candleCollection.countDocuments({
                symbol: symbol,
                interval: { $ne: '1m' },
                artificiallyGenerated: true
            });
            
            analysis[symbol].artificialCandlesCount = artificialCandles;
        }
        
        return analysis;
    } catch (error) {
        console.error('❌ Error checking database:', error);
        return null;
    }
}

/**
 * Check symbol validity on Binance
 */
async function checkSymbolValidity(symbols) {
    try {
        console.log(`\n✅ Checking symbol validity on Binance...`);
        
        // Get all active symbols from Binance
        const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
        if (!response.ok) {
            throw new Error(`Failed to get exchange info: ${response.statusText}`);
        }
        
        const exchangeInfo = await response.json();
        const activeSymbols = exchangeInfo.symbols
            .filter(s => s.status === 'TRADING')
            .map(s => s.symbol);
        
        const analysis = {};
        for (const symbol of symbols) {
            analysis[symbol] = {
                isValid: activeSymbols.includes(symbol),
                status: activeSymbols.includes(symbol) ? 'ACTIVE' : 'INACTIVE_OR_DELISTED'
            };
        }
        
        return analysis;
    } catch (error) {
        console.error('❌ Error checking symbol validity:', error);
        return null;
    }
}

/**
 * Generate comprehensive report
 */
function generateReport(selectedSymbols, symbolValidityResults, apiTestResults, utilityTestResults, databaseResults) {
    console.log('\n' + '='.repeat(80));
    console.log('📊 COMPREHENSIVE DATA FLOW DIAGNOSIS REPORT');
    console.log('='.repeat(80));
    
    console.log(`\n🎯 Selected Symbols: ${selectedSymbols.length}`);
    console.log(`   Symbols: ${selectedSymbols.join(', ')}`);
    
    // Symbol validity summary
    if (symbolValidityResults) {
        const validSymbols = Object.entries(symbolValidityResults).filter(([, data]) => data.isValid);
        const invalidSymbols = Object.entries(symbolValidityResults).filter(([, data]) => !data.isValid);
        
        console.log(`\n✅ Symbol Validity:`);
        console.log(`   Valid: ${validSymbols.length}/${selectedSymbols.length}`);
        
        if (invalidSymbols.length > 0) {
            console.log(`   ❌ Invalid symbols: ${invalidSymbols.map(([symbol]) => symbol).join(', ')}`);
        }
    }
    
    // API test summary
    if (apiTestResults) {
        const successfulAPI = apiTestResults.filter(r => r.success);
        const failedAPI = apiTestResults.filter(r => !r.success);
        const dummyDataAPI = apiTestResults.filter(r => r.dataQuality === 'DUMMY_DATA');
        
        console.log(`\n🌐 Direct API Test Results:`);
        console.log(`   Successful: ${successfulAPI.length}/${selectedSymbols.length}`);
        console.log(`   Failed: ${failedAPI.length}`);
        console.log(`   Dummy data detected: ${dummyDataAPI.length}`);
        
        if (failedAPI.length > 0) {
            console.log(`   ❌ Failed symbols:`);
            failedAPI.forEach(result => {
                console.log(`      ${result.symbol}: ${result.error}`);
            });
        }
        
        if (dummyDataAPI.length > 0) {
            console.log(`   ⚠️ Dummy data symbols:`);
            dummyDataAPI.forEach(result => {
                console.log(`      ${result.symbol}: Repetitive/dummy data detected`);
            });
        }
    }
    
    // Utility function test summary
    if (utilityTestResults) {
        const successfulUtil = Object.entries(utilityTestResults).filter(([, data]) => data.status === 'SUCCESS');
        const errorUtil = Object.entries(utilityTestResults).filter(([, data]) => data.status === 'ERROR');
        const dummyUtil = Object.entries(utilityTestResults).filter(([, data]) => data.dataQuality === 'DUMMY_DATA');
        
        console.log(`\n🛠️ Utility Function Test Results:`);
        console.log(`   Successful: ${successfulUtil.length}/${selectedSymbols.length}`);
        console.log(`   Errors: ${errorUtil.length}`);
        console.log(`   Dummy data: ${dummyUtil.length}`);
        
        if (errorUtil.length > 0) {
            console.log(`   ❌ Error symbols:`);
            errorUtil.forEach(([symbol, data]) => {
                console.log(`      ${symbol}: ${data.error}`);
            });
        }
    }
    
    // Database summary
    if (databaseResults) {
        const hasData = Object.entries(databaseResults).filter(([, data]) => data.status === 'HAS_DATA');
        const noData = Object.entries(databaseResults).filter(([, data]) => data.status === 'NO_DATA');
        const dummyDB = Object.entries(databaseResults).filter(([, data]) => data.dataQuality === 'DUMMY_DATA');
        
        console.log(`\n🗄️ Database Analysis:`);
        console.log(`   Symbols with data: ${hasData.length}/${selectedSymbols.length}`);
        console.log(`   Symbols without data: ${noData.length}`);
        console.log(`   Dummy data in DB: ${dummyDB.length}`);
        
        if (noData.length > 0) {
            console.log(`   ❌ No data symbols: ${noData.map(([symbol]) => symbol).join(', ')}`);
        }
        
        // Artificial candles summary
        const totalArtificialCandles = Object.values(databaseResults).reduce((sum, data) => sum + (data.artificialCandlesCount || 0), 0);
        console.log(`   🔄 Total artificial candles: ${totalArtificialCandles}`);
    }
    
    console.log('\n' + '='.repeat(80));
}

/**
 * Main diagnostic function
 */
async function runDiagnosis() {
    let client = null;
    
    try {
        console.log('🚀 Starting comprehensive data flow diagnosis...\n');
        
        // Connect to MongoDB
        console.log('📡 Connecting to MongoDB...');
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('✅ Connected to MongoDB');
        
        // Get selected symbols
        console.log('\n📋 Getting selected symbols...');
        const selectedSymbols = await getSelectedSymbols(client, DATABASE_NAME);
        
        if (selectedSymbols.length === 0) {
            console.log('⚠️ No symbols selected! This could be the root cause.');
            return;
        }
        
        console.log(`✅ Found ${selectedSymbols.length} selected symbols`);
        
        // Run all tests
        const symbolValidityResults = await checkSymbolValidity(selectedSymbols);
        
        const apiTestResults = [];
        console.log('\n🔍 Testing individual API calls...');
        for (const symbol of selectedSymbols.slice(0, 10)) { // Test first 10 to avoid rate limits
            const result = await testSymbolAPICall(symbol);
            apiTestResults.push(result);
            console.log(`   ${symbol}: ${result.success ? '✅' : '❌'} ${result.dataQuality}`);
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        const utilityTestResults = await testUtilityFunction(selectedSymbols.slice(0, 5)); // Test first 5 symbols
        const databaseResults = await checkDatabaseData(client, DATABASE_NAME, selectedSymbols);
        
        // Generate comprehensive report
        generateReport(selectedSymbols, symbolValidityResults, apiTestResults, utilityTestResults, databaseResults);
        
        // Recommendations
        console.log('\n💡 RECOMMENDATIONS:');
        
        if (symbolValidityResults) {
            const invalidSymbols = Object.entries(symbolValidityResults).filter(([, data]) => !data.isValid);
            if (invalidSymbols.length > 0) {
                console.log(`   🔄 Remove invalid symbols: ${invalidSymbols.map(([symbol]) => symbol).join(', ')}`);
            }
        }
        
        const failedApiCalls = apiTestResults.filter(r => !r.success);
        if (failedApiCalls.length > 0) {
            console.log(`   🛠️ Fix API issues for symbols: ${failedApiCalls.map(r => r.symbol).join(', ')}`);
        }
        
        const noDatabaseData = databaseResults ? Object.entries(databaseResults).filter(([, data]) => data.status === 'NO_DATA') : [];
        if (noDatabaseData.length > 0) {
            console.log(`   📥 Symbols need initial data loading: ${noDatabaseData.map(([symbol]) => symbol).join(', ')}`);
        }
        
        console.log('\n✅ Diagnosis complete!');
        
    } catch (error) {
        console.error('❌ Diagnosis failed:', error);
    } finally {
        if (client) {
            await client.close();
            console.log('📡 MongoDB connection closed');
        }
    }
}

// Run diagnosis if called directly
if (require.main === module) {
    runDiagnosis().catch(console.error);
}

module.exports = {
    runDiagnosis,
    testSymbolAPICall,
    checkIfDummyData,
    testUtilityFunction,
    checkDatabaseData,
    checkSymbolValidity
};
