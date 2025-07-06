/**
 * Clean up script to remove signals with future close times
 * Run this once to clean up any existing problematic signals
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

async function cleanupFutureSignals() {
    const client = new MongoClient(process.env.MONGODB_URI);
    const dbName = process.env.MONGODB_DATABASE;
    
    try {
        console.log('🔗 Connecting to MongoDB...');
        await client.connect();
        
        const db = client.db(dbName);
        const collection = db.collection('reversalCandles');
        
        console.log('🧹 Cleaning up signals with future close times...');
        
        // Get current time
        const now = new Date();
        console.log(`⏰ Current time: ${now.toISOString()}`);
        
        // Find signals with future close times
        const futureSignals = await collection.find({
            closeTime: { $gt: now }
        }).toArray();
        
        console.log(`🔍 Found ${futureSignals.length} signals with future close times`);
        
        if (futureSignals.length > 0) {
            // Log some examples
            console.log('📋 Examples of future signals:');
            futureSignals.slice(0, 5).forEach((signal, index) => {
                console.log(`   ${index + 1}. ${signal.symbol} ${signal.interval} - close: ${signal.closeTime.toISOString()}`);
            });
            
            // Delete all future signals
            const deleteResult = await collection.deleteMany({
                closeTime: { $gt: now }
            });
            
            console.log(`✅ Deleted ${deleteResult.deletedCount} signals with future close times`);
        } else {
            console.log('✅ No signals with future close times found');
        }
        
        // Also clean up any candles with future close times from candleData collection
        console.log('🧹 Cleaning up candles with future close times...');
        const candleCollection = db.collection('candleData');
        
        const futureCandles = await candleCollection.find({
            closeTime: { $gt: now }
        }).toArray();
        
        console.log(`🔍 Found ${futureCandles.length} candles with future close times`);
        
        if (futureCandles.length > 0) {
            const deleteCandlesResult = await candleCollection.deleteMany({
                closeTime: { $gt: now }
            });
            
            console.log(`✅ Deleted ${deleteCandlesResult.deletedCount} candles with future close times`);
        } else {
            console.log('✅ No candles with future close times found');
        }
        
        console.log('🎉 Cleanup completed successfully!');
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    } finally {
        await client.close();
        console.log('🔌 MongoDB connection closed');
    }
}

// Run the cleanup
cleanupFutureSignals().catch(console.error);
