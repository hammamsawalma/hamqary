const { configureExpress } = require('./config/express');
const { connectToMongoDB, dbName } = require('./config/database');
const { 
    setupCandleDataCronJob, 
    setupArtificialCandleDataCronJobs,
    runInitialCandleDataFetch,
    runInitialArtificialCandleDataGeneration,
    setupMonitoringCronJob,
    setupDataCleanupCronJob
} = require('./config/cron');
const routes = require('./routes');

/**
 * Initialize and start the server
 */
async function startServer() {
    // Configure Express app
    const { app, PORT } = configureExpress();
    
    // Connect to MongoDB
    const client = await connectToMongoDB();
    
    // Store the MongoDB client in app.locals for route handlers to use
    app.locals.client = client;
    app.locals.dbName = dbName;
    
    // Setup routes
    app.use('/', routes);
    
    // Start the server
    app.listen(PORT, async () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        
        if (client) {
            // Set up the candle data cron job
            setupCandleDataCronJob(client, dbName);
            
            // Set up the artificial candle data cron jobs
            setupArtificialCandleDataCronJobs(client, dbName);
            
            // Set up monitoring cron job
            setupMonitoringCronJob();
            
            // Set up data cleanup cron job
            setupDataCleanupCronJob(client, dbName);
            
            // Run the initial fetch on startup
            await runInitialCandleDataFetch(client, dbName);
            
            // Run initial artificial candle data generation
            await runInitialArtificialCandleDataGeneration(client, dbName);
            
            console.log('✅ All cron jobs have been successfully configured');
        }
        
        // Close MongoDB connection when the Node process ends
        process.on('SIGINT', async () => {
            if (client) {
                await client.close();
                console.log('🔌 MongoDB connection closed.');
            }
            process.exit(0);
        });
    });
}

module.exports = { startServer };
