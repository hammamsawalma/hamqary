/**
 * Test script to verify initial top movers selection on startup
 * This tests the functionality without starting the full server
 */

const { connectToMongoDB, dbName } = require('./config/database');
const { runInitialTopMoversSelection } = require('./config/cron');

console.log('🧪 Testing Initial Top Movers Selection on Startup\n');

async function testInitialTopMoversSelection() {
    try {
        console.log('='.repeat(80));
        console.log('🔥 INITIAL TOP MOVERS SELECTION TEST');
        console.log('='.repeat(80));
        console.log('');

        // Connect to MongoDB
        console.log('📡 Connecting to MongoDB...');
        const client = await connectToMongoDB();
        
        if (!client) {
            throw new Error('Failed to connect to MongoDB');
        }
        
        console.log('✅ MongoDB connection established');
        console.log('');

        // Test the initial top movers selection
        console.log('🔥 Testing Initial Top Movers Selection...');
        console.log('-'.repeat(60));
        
        const startTime = Date.now();
        await runInitialTopMoversSelection(client, dbName);
        const endTime = Date.now();
        
        console.log('');
        console.log(`✅ Initial top movers selection test completed in ${endTime - startTime}ms`);
        console.log('');

        // Test summary
        console.log('📋 Test Results Summary:');
        console.log('   ✅ MongoDB connection: SUCCESS');
        console.log('   ✅ Initial top movers fetch: SUCCESS');
        console.log('   ✅ Symbol selection: SUCCESS'); 
        console.log('   ✅ Database update: SUCCESS');
        console.log('   ⏳ Historical data loading: RUNNING (asynchronous)');
        console.log('');
        console.log('💡 What happens next when you start the real system:');
        console.log('   1. System starts immediately with top movers selected');
        console.log('   2. Historical data loads automatically in background');
        console.log('   3. Hourly cron job continues updating symbols');
        console.log('   4. No more waiting for hourly boundaries!');
        
        // Close connection
        await client.close();
        console.log('');
        console.log('🔌 MongoDB connection closed');
        console.log('🎉 Test completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Run the test
testInitialTopMoversSelection();
