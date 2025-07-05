const express = require('express');
const ejsLayouts = require('express-ejs-layouts');

/**
 * Configure Express application
 * @returns {object} Configured Express app
 */
function configureExpress() {
    // Create Express app
    const app = express();
    const PORT = process.env.PORT || 3000;

    // Set up EJS as the view engine with layouts
    app.set('view engine', 'ejs');
    app.use(ejsLayouts);
    app.set('layout', 'layout');

    // Add middleware for parsing form data
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    return { app, PORT };
}

module.exports = {
    configureExpress
};
