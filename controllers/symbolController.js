const { getSelectedSymbols } = require('../config/database');
const { handleFirstTimeSymbolSelection } = require('../config/cron');
const { saveSelectedSymbols } = require('../models/database');
const getBinanceUSDTSymbols = require('../utils/getBinanceUSDTSymbols');

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
 * Handle symbol selection submission
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
        
        // Store in MongoDB
        const { isFirstSelection } = await saveSelectedSymbols(client, dbName, selectedSymbols);
        
        // After reset, ALWAYS treat as first selection to trigger complete fresh startup
        const treatAsFirstSelection = systemWasReset || isFirstSelection;
        
        if (treatAsFirstSelection && selectedSymbols.length > 0) {
            console.log('🚀 Starting fresh system with new symbols...');
            console.log(`   └── Symbols: ${selectedSymbols.join(', ')}`);
            console.log('   └── Loading historical data and starting all processes...');
            
            // We don't await this to avoid blocking the response
            handleFirstTimeSymbolSelection(client, dbName, selectedSymbols, true)
                .catch(error => {
                    console.error('❌ Error in fresh system startup:', error);
                });
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

module.exports = {
    homeController,
    symbolsListController,
    symbolsSelectController,
    symbolsResetController
};
