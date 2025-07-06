const { getSelectedSymbols } = require('../config/database');
const { updateHybridSystemSymbols, initializeHybridCandleSystem } = require('../config/cron');
const { saveSelectedSymbols } = require('../models/database');
const getBinanceUSDTSymbols = require('../utils/getBinanceUSDTSymbols');
const loadHistoricalCandleData = require('../utils/loadHistoricalCandleData');

/**
 * Display the home page with selected symbols
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function homeController(req, res) {
    try {
        // Get MongoDB client
        const client = req.app.locals.client;
        
        // Get selected symbols
        const selectedSymbols = await getSelectedSymbols(client);
        
        // Render the home page with selected symbols
        res.render('home', { 
            selectedSymbols: selectedSymbols
        });
    } catch (error) {
        console.error('Error in home controller:', error);
        res.status(500).send('An error occurred');
    }
}

/**
 * Display the symbols page with all available symbols
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function symbolsListController(req, res) {
    try {
        // Set initial loading state
        const viewData = {
            loading: true,
            symbols: [],
            error: null,
            selectedSymbols: [],
            success: req.query.success // Pass the success parameter to the view
        };

        // Get MongoDB client and fetch previously selected symbols
        const client = req.app.locals.client;
        
        // Get selected symbols
        viewData.selectedSymbols = await getSelectedSymbols(client);
        
        try {
            // Fetch the symbols
            const symbols = await getBinanceUSDTSymbols();
            
            // Update view data with the results
            viewData.symbols = symbols;
            viewData.loading = false;
        } catch (error) {
            console.error('Error fetching Binance symbols:', error);
            viewData.error = error.message;
            viewData.loading = false;
        }
        
        // Render the symbols page with the data
        res.render('symbols', viewData);
    } catch (renderError) {
        console.error('Error rendering symbols page:', renderError);
        res.status(500).send('An error occurred while rendering the page');
    }
}

/**
 * Handle symbol selection submission with smart change detection
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function symbolsSelectController(req, res) {
    try {
        const client = req.app.locals.client;
        const dbName = req.app.locals.dbName;
        
        // Check if we have a MongoDB connection
        if (!client) {
            return res.status(500).send('Database connection not available');
        }
        
        // Get the selected symbols from the form
        let selectedSymbols = req.body.selectedSymbols || [];
        
        // Convert to array if only one symbol is selected
        if (!Array.isArray(selectedSymbols)) {
            selectedSymbols = [selectedSymbols];
        }
        
        console.log(`🎯 Symbol selection requested: ${selectedSymbols.length} symbols`);
        
        // Get current symbols to detect changes
        const currentSymbols = await getSelectedSymbols(client);
        
        // Detect symbol changes
        const addedSymbols = selectedSymbols.filter(symbol => !currentSymbols.includes(symbol));
        const removedSymbols = currentSymbols.filter(symbol => !selectedSymbols.includes(symbol));
        const unchangedSymbols = selectedSymbols.filter(symbol => currentSymbols.includes(symbol));
        
        console.log(`🔍 Symbol change analysis:`);
        console.log(`   ✅ Unchanged: ${unchangedSymbols.length} (${unchangedSymbols.join(', ') || 'none'})`);
        console.log(`   ➕ Added: ${addedSymbols.length} (${addedSymbols.join(', ') || 'none'})`);
        console.log(`   ➖ Removed: ${removedSymbols.length} (${removedSymbols.join(', ') || 'none'})`);
        
        // Check if system was recently reset (database is empty or system is not running)
        const db = client.db(dbName);
        const collections = await db.listCollections().toArray();
        const systemWasReset = collections.length === 0 || !global.systemState?.isSystemRunning;
        
        if (systemWasReset) {
            console.log('🔄 System was reset - treating as fresh startup');
            console.log('🚀 Initializing fresh system state...');
            
            // Reset system state to fresh startup condition
            global.systemState = {
                cronJobs: new Map(),
                activeIntervals: [],
                activeTimeouts: [],
                isSystemRunning: true
            };
        }
        
        // Store in MongoDB with enhanced tracking
        const { isFirstSelection } = await saveSelectedSymbolsWithChanges(client, dbName, selectedSymbols, addedSymbols, removedSymbols);
        
        // Handle different scenarios
        if (systemWasReset || isFirstSelection) {
            // Complete fresh startup - initialize hybrid system with all symbols
            console.log('🚀 Starting fresh hybrid system with all symbols...');
            console.log(`   └── All Symbols: ${selectedSymbols.join(', ')}`);
            console.log('   └── Initializing hybrid WebSocket + API system...');
            
            initializeHybridCandleSystem(client, dbName)
                .then(() => {
                    console.log('✅ Hybrid system initialized successfully from manual selection');
                })
                .catch(error => {
                    console.error('❌ Error in hybrid system initialization:', error);
                });
                
        } else if (addedSymbols.length > 0 || removedSymbols.length > 0) {
            // Update existing hybrid system with symbol changes
            console.log('🆕 Updating hybrid system with symbol changes...');
            console.log(`   └── New Symbols: ${addedSymbols.join(', ') || 'none'}`);
            console.log(`   └── Removed Symbols: ${removedSymbols.join(', ') || 'none'}`);
            
            updateHybridSystemSymbols(client, dbName, selectedSymbols)
                .then((success) => {
                    if (success) {
                        console.log('✅ Hybrid system updated successfully with new symbols');
                    } else {
                        console.error('❌ Failed to update hybrid system with new symbols');
                    }
                })
                .catch(error => {
                    console.error('❌ Error updating hybrid system:', error);
                });
        }
        
        if (removedSymbols.length > 0) {
            console.log('🗑️ Removed symbols will stop being processed but data will be preserved');
            console.log(`   └── Use individual signal deletion buttons to clean up unwanted signals`);
        }
        
        // Redirect back to symbols page with a success parameter
        res.redirect('/symbols?success=true');
        
    } catch (error) {
        console.error('Error saving selected symbols:', error);
        res.status(500).send('An error occurred while saving your selections');
    }
}

/**
 * Handle symbol reset - Clear all selected symbols
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function symbolsResetController(req, res) {
    try {
        const client = req.app.locals.client;
        const dbName = req.app.locals.dbName;
        
        // Check if we have a MongoDB connection
        if (!client) {
            return res.status(500).json({ success: false, message: 'Database connection not available' });
        }
        
        console.log('🔄 Resetting all selected symbols...');
        
        // Clear all selected symbols by saving empty array
        await saveSelectedSymbols(client, dbName, []);
        
        console.log('✅ All selected symbols have been reset');
        
        // Return success response
        res.json({ 
            success: true, 
            message: 'All tracked symbols have been reset successfully' 
        });
        
    } catch (error) {
        console.error('❌ Error resetting selected symbols:', error);
        res.status(500).json({ 
            success: false, 
            message: 'An error occurred while resetting symbols: ' + error.message 
        });
    }
}

/**
 * Handle addition of new symbols to running system
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Array} newSymbols - Array of newly added symbols
 */
async function handleNewSymbolAddition(client, dbName, newSymbols) {
    console.log(`🆕 Loading historical data for ${newSymbols.length} new symbols...`);
    
    try {
        // Create a temporary override for symbol selection to process only new symbols
        const originalFunction = require('../utils/fetchAndStoreCandleData');
        
        // We need to call loadHistoricalCandleData directly with new symbols
        const results = await loadHistoricalCandleData(client, dbName, newSymbols);
        
        console.log(`✅ New symbol historical data loading completed:`);
        console.log(`   └── Candles stored: ${results.candlesStored}`);
        console.log(`   └── Artificial candles generated: ${results.artificialCandlesGenerated}`);
        
        if (results.errors.length > 0) {
            console.log(`⚠️ Some errors occurred during historical data loading:`);
            results.errors.forEach(error => console.log(`   └── ${error}`));
        }
        
    } catch (error) {
        console.error('❌ Error loading historical data for new symbols:', error);
    }
}

/**
 * Enhanced symbol saving with change tracking
 * @param {Object} client - MongoDB client
 * @param {string} dbName - Database name
 * @param {Array} selectedSymbols - Array of selected symbols
 * @param {Array} addedSymbols - Array of added symbols
 * @param {Array} removedSymbols - Array of removed symbols
 * @returns {Promise<Object>} Result of the database operation
 */
async function saveSelectedSymbolsWithChanges(client, dbName, selectedSymbols, addedSymbols, removedSymbols) {
    if (!client) {
        throw new Error('Database connection not available');
    }
    
    const db = client.db(dbName);
    const collection = db.collection('selectedSymbols');
    
    // Check if this is the first time symbols are being selected
    const existingSelections = await collection.countDocuments({});
    const isFirstSelection = existingSelections === 0;
    
    const result = await collection.insertOne({
        symbols: selectedSymbols,
        timestamp: new Date(),
        changes: {
            added: addedSymbols,
            removed: removedSymbols,
            isFirstSelection
        }
    });
    
    console.log(`✅ Saved ${selectedSymbols.length} selected symbols with change tracking`);
    
    return {
        result,
        isFirstSelection
    };
}

module.exports = {
    homeController,
    symbolsListController,
    symbolsSelectController,
    symbolsResetController,
    handleNewSymbolAddition
};
