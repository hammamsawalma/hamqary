// Load environment variables
require('dotenv').config();

// Import server initialization
const { startServer } = require('./server');

// Start the server
startServer().catch(error => {
    console.error('Error starting server:', error);
    process.exit(1);
});
