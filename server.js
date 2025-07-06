const { configureExpress } = require('./config/express');
const { connectToMongoDB, dbName } = require('./config/database');
const { 
    runInitialTopMoversAndHybridInitialization,
    setupMonitoringCronJob,
    setupTopMoversCronJob,
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
            // Set up monitoring cron job
            setupMonitoringCronJob();
            
            // Set up top movers automatic selection cron job
            setupTopMoversCronJob(client, dbName);
            
            // Set up data cleanup cron job
            setupDataCleanupCronJob(client, dbName);
            
            // Run initial top movers selection and hybrid system initialization
            await runInitialTopMoversAndHybridInitialization(client, dbName);
            
            console.log('✅ Hybrid WebSocket + API system has been successfully configured');
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
