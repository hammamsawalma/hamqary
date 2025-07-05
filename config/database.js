const { MongoClient } = require('mongodb');
require('dotenv').config();

// MongoDB connection string from environment variable or default to local
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.DB_NAME || 'testdb';

/**
 * Connect to MongoDB database
 * @returns {Promise<MongoClient|null>} MongoDB client or null if connection fails
 */
async function connectToMongoDB() {
    const client = new MongoClient(uri);
    
    try {
        console.log('Attempting to connect to MongoDB...');
        
        // Connect to MongoDB
        await client.connect();
        
        // Test the connection by accessing the database
        const db = client.db(dbName);
        await db.admin().ping();
        
        console.log('✅ Successfully connected to MongoDB!');
        console.log(`📊 Database: ${dbName}`);
        console.log(`🔗 Connection URI: ${uri}`);
        
        return client;
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB:');
        console.error(error.message);
        // We don't exit the process here, since we want the web server to run
        // even if MongoDB connection fails
        return null;
    }
}

/**
 * Helper function to get selected symbols from MongoDB
 * @param {MongoClient} client - MongoDB client
 * @returns {Promise<Array>} Array of selected symbols
 */
async function getSelectedSymbols(client) {
    let selectedSymbols = [];
    
    if (client) {
        try {
            const db = client.db(dbName);
            const collection = db.collection('selectedSymbols');
            
            // Get the most recent document
            const latestSelection = await collection.findOne(
                {}, 
                { sort: { timestamp: -1 } }
            );
            
            if (latestSelection && latestSelection.symbols) {
                selectedSymbols = latestSelection.symbols;
            }
        } catch (error) {
            console.error('Error fetching selected symbols:', error);
            // Return empty array on error
        }
    }
    
    return selectedSymbols;
}

module.exports = {
    connectToMongoDB,
    getSelectedSymbols,
    dbName
};
