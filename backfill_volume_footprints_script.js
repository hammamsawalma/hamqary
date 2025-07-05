/**
 * Quick Backfill Script for Volume Footprints
 * Run this script to add volume footprints to existing reversal candles
 */

const { MongoClient } = require('mongodb');
const { backfillVolumeFootprints, getBackfillStatus } = require('./utils/backfillVolumeFootprints');
require('dotenv').config();

async function runBackfillScript() {
    console.log('🚀 Starting Volume Footprint Backfill Script');
    console.log('=============================================');
    
    let client;
    
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        const dbName = process.env.DB_NAME;
        
        if (!mongoUri || !dbName) {
            throw new Error('Missing MONGODB_URI or DB_NAME in .env file');
        }
        
        console.log('🔗 Connecting to MongoDB...');
        client = new MongoClient(mongoUri);
        await client.connect();
        console.log('✅ Connected to MongoDB');
        
        // Check current status
        console.log('\n📊 Checking current backfill status...');
        const status = await getBackfillStatus(client, dbName);
        
        console.log(`📈 Total reversal candles: ${status.totalCandles}`);
        console.log(`✅ Already processed: ${status.processedCandles}`);
        console.log(`⏳ Pending processing: ${status.pendingCandles}`);
        console.log(`🎯 Completion: ${status.completionPercentage}%`);
        
        if (status.pendingCandles === 0) {
            console.log('\n🎉 All reversal candles already have volume footprints!');
            return;
        }
        
        // Run backfill
        console.log(`\n🔄 Starting backfill for ${status.pendingCandles} candles...`);
        
        const backfillOptions = {
            limit: 10,           // Process 10 candles at a time to respect rate limits
            batchDelay: 1000,    // 1 second delay between batches
            maxAge: 30,          // Only process candles from last 30 days
            dryRun: false        // Set to true to test without saving
        };
        
        const results = await backfillVolumeFootprints(client, dbName, backfillOptions);
        
        // Show results
        console.log('\n🏁 Backfill Completed!');
        console.log('====================');
        console.log(`⏱️  Duration: ${results.summary.duration} seconds`);
        console.log(`📊 Processed: ${results.summary.processed} candles`);
        console.log(`✅ Successful: ${results.summary.successful} candles`);
        console.log(`❌ Failed: ${results.summary.failed} candles`);
        console.log(`⏭️  Skipped: ${results.summary.skipped} candles`);
        console.log(`🎯 Success Rate: ${results.summary.successRate}%`);
        
        if (results.errors.length > 0) {
            console.log(`\n⚠️  Errors encountered:`);
            results.errors.slice(0, 5).forEach((error, index) => {
                console.log(`${index + 1}. ${error.candle}: ${error.error}`);
            });
            if (results.errors.length > 5) {
                console.log(`... and ${results.errors.length - 5} more errors`);
            }
        }
        
        console.log('\n✨ Backfill process completed!');
        console.log('💡 New reversal candles will automatically get volume footprints.');
        
    } catch (error) {
        console.error('\n❌ Backfill script failed:', error);
        process.exit(1);
    } finally {
        if (client) {
            await client.close();
            console.log('\n🔌 Disconnected from MongoDB');
        }
    }
}

// Run the script
if (require.main === module) {
    runBackfillScript()
        .then(() => {
            console.log('\n👋 Script finished. You can now check the reversal candles page!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { runBackfillScript };
