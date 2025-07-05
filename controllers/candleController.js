const { getSelectedSymbols } = require('../config/database');
const { getCandleData, getCandleCount, getLastUpdateTime } = require('../models/database');

/**
 * Display candle data for selected symbols
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function candleDataController(req, res) {
    try {
        // Get MongoDB client
        const client = req.app.locals.client;
        const dbName = req.app.locals.dbName;
        
        // Check if we have a MongoDB connection
        if (!client) {
            return res.status(500).send('Database connection not available');
        }
        
        // Get selected symbols
        const selectedSymbols = await getSelectedSymbols(client);
        
        // Get the query parameters
        const symbol = req.query.symbol || (selectedSymbols.length > 0 ? selectedSymbols[0] : null);
        const interval = req.query.interval || '1h';
        const limit = parseInt(req.query.limit || '50', 10); // Increased default from 20 to 50
        
        // Pagination parameters
        const page = parseInt(req.query.page || '1', 10);
        const skip = (page - 1) * limit;
        
        // Date range parameters
        let startDate = null;
        let endDate = null;
        
        if (req.query.startDate) {
            startDate = new Date(req.query.startDate);
            // Set to beginning of the day
            startDate.setHours(0, 0, 0, 0);
        }
        
        if (req.query.endDate) {
            endDate = new Date(req.query.endDate);
            // Set to end of the day
            endDate.setHours(23, 59, 59, 999);
        }
        
        // Prepare view data
        const viewData = {
            selectedSymbols,
            currentSymbol: symbol,
            intervals: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '10m', '11m', '12m', '13m', '14m', '15m', '16m', '17m', '18m', '19m', '20m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'],
            currentInterval: interval,
            currentLimit: limit,
            currentPage: page,
            startDate: startDate ? startDate.toISOString().split('T')[0] : '',
            endDate: endDate ? endDate.toISOString().split('T')[0] : '',
            totalPages: 1, // Will be updated after we get the count
            candles: [],
            lastUpdate: null,
            error: null
        };
        
        // If we have a selected symbol, fetch its candle data
        if (symbol) {
            try {
                // Get total count of candles for pagination with date filtering
                const totalCandles = await getCandleCount(client, dbName, symbol, interval, startDate, endDate);
                viewData.totalPages = Math.ceil(totalCandles / limit);
                
                // Get candle data with pagination and date filtering
                const candles = await getCandleData(client, dbName, symbol, interval, limit, skip, startDate, endDate);
                viewData.candles = candles;
                
                // Get the last update time
                viewData.lastUpdate = getLastUpdateTime(candles);
                
            } catch (dbError) {
                console.error('Error fetching candle data:', dbError);
                viewData.error = `Error fetching candle data: ${dbError.message}`;
            }
        }
        
        // Render the candle data page
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Candle Data - Hamqary</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
                    h1 { color: #333; }
                    .controls { margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
                    select, button { padding: 8px; border-radius: 4px; border: 1px solid #ddd; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #ddd; }
                    th { background-color: #f2f2f2; }
                    tr:hover { background-color: #f5f5f5; }
                    .up { color: green; }
                    .down { color: red; }
                    .info { background-color: #e7f3fe; border-left: 6px solid #2196F3; padding: 10px; margin-bottom: 15px; }
                    .error { background-color: #ffdddd; border-left: 6px solid #f44336; padding: 10px; margin-bottom: 15px; }
                    .last-update { margin-top: 10px; font-style: italic; color: #666; }
                    .pagination { display: flex; justify-content: center; gap: 10px; margin: 20px 0; align-items: center; flex-wrap: wrap; }
                    .page-numbers { display: flex; gap: 5px; }
                    .page-link { padding: 8px 16px; border: 1px solid #ddd; border-radius: 4px; text-decoration: none; color: #007bff; }
                    .page-link:hover { background-color: #f0f0f0; }
                    .page-link.current { background-color: #007bff; color: white; border-color: #007bff; }
                    .disabled { color: #ccc; cursor: not-allowed; }
                    .jump-to-page { display: flex; align-items: center; gap: 5px; }
                    button.page-link { cursor: pointer; background-color: #f8f9fa; }
                    button.page-link:hover { background-color: #e2e6ea; }
                    .form-row { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; align-items: center; }
                    .date-filters { background-color: #f0f8ff; padding: 15px; border-radius: 4px; border: 1px solid #b8daff; margin-top: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
                    .date-filters h3 { margin-top: 0; margin-bottom: 10px; color: #0056b3; font-size: 16px; }
                    .filter-button { background-color: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; }
                    .filter-button:hover { background-color: #0069d9; }
                    .clear-button { background-color: #f8f9fa; color: #666; border: 1px solid #ddd; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
                    .clear-button:hover { background-color: #e2e6ea; }
                    .date-input { padding: 8px; border-radius: 4px; border: 1px solid #ced4da; }
                    .pagination-container { margin: 20px 0; background-color: #f8f9fa; padding: 15px; border-radius: 4px; border: 1px solid #ddd; }
                    .pagination-info { margin-bottom: 10px; font-weight: bold; color: #495057; text-align: center; }
                </style>
            </head>
            <body>
                <h1>Candle Data</h1>
                
                <div class="controls">
                    <form action="/candle-data" method="get" id="candleForm">
                        <div class="form-row">
                            <label for="symbol">Symbol:</label>
                            <select name="symbol" id="symbol">
                                ${viewData.selectedSymbols.map(s => 
                                    `<option value="${s}" ${s === viewData.currentSymbol ? 'selected' : ''}>${s}</option>`
                                ).join('')}
                            </select>
                            
                            <label for="interval">Interval:</label>
                            <select name="interval" id="interval">
                                ${viewData.intervals.map(i => 
                                    `<option value="${i}" ${i === viewData.currentInterval ? 'selected' : ''}>${i}</option>`
                                ).join('')}
                            </select>
                            
                            <label for="limit">Limit:</label>
                            <select name="limit" id="limit">
                                <option value="10" ${limit === 10 ? 'selected' : ''}>10</option>
                                <option value="20" ${limit === 20 ? 'selected' : ''}>20</option>
                                <option value="50" ${limit === 50 ? 'selected' : ''}>50</option>
                                <option value="100" ${limit === 100 ? 'selected' : ''}>100</option>
                                <option value="200" ${limit === 200 ? 'selected' : ''}>200</option>
                                <option value="500" ${limit === 500 ? 'selected' : ''}>500</option>
                            </select>
                        </div>
                        
                        <div class="form-row date-filters">
                            <h3>📅 Date Range Filter</h3>
                            <div style="display: flex; flex-wrap: wrap; gap: 10px; width: 100%;">
                                <div>
                                    <label for="startDate"><strong>Start Date:</strong></label>
                                    <input type="date" id="startDate" name="startDate" value="${viewData.startDate}" class="date-input">
                                </div>
                                
                                <div>
                                    <label for="endDate"><strong>End Date:</strong></label>
                                    <input type="date" id="endDate" name="endDate" value="${viewData.endDate}" class="date-input">
                                </div>
                                
                                <div style="display: flex; gap: 5px; margin-left: auto;">
                                    <button type="submit" class="filter-button">Apply Filters</button>
                                    <button type="button" id="clearFilters" class="clear-button">Clear Filters</button>
                                </div>
                            </div>
                        </div>
                        
                        <input type="hidden" name="page" value="1">
                    </form>
                    
                    <a href="/" style="margin-left: auto;">Back to Home</a>
                </div>
                
                ${viewData.error ? 
                    `<div class="error">${viewData.error}</div>` : 
                    ''
                }
                
                ${!symbol ? 
                    `<div class="info">Please select a symbol to view candle data.</div>` : 
                    ''
                }
                
                ${viewData.candles.length === 0 && !viewData.error && symbol ? 
                    `<div class="info">No candle data found for ${symbol} with ${interval} interval. Data may still be loading or not yet collected.</div>` : 
                    ''
                }
                
                ${viewData.lastUpdate ? 
                    `<div class="last-update">Last updated: ${viewData.lastUpdate.toLocaleString()}</div>` : 
                    ''
                }
                
                ${viewData.candles.length > 0 ? 
                    `<div style="margin: 15px 0; padding: 10px; background-color: #e7f3fe; border-radius: 4px; text-align: center;">
                        <p style="margin: 0;"><strong>📊 Showing ${viewData.candles.length} of ${viewData.totalPages * viewData.currentLimit} candles</strong></p>
                        ${viewData.startDate || viewData.endDate ? 
                            `<p style="margin: 5px 0 0 0; font-style: italic;">Filtered by date: ${viewData.startDate ? `from ${viewData.startDate}` : ''} ${viewData.endDate ? `to ${viewData.endDate}` : ''}</p>` : 
                            ''
                        }
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Open Time</th>
                                <th>Open</th>
                                <th>High</th>
                                <th>Low</th>
                                <th>Close</th>
                                <th>Change</th>
                                <th>Volume</th>
                                <th>Trades</th>
                                <th>Source</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${viewData.candles.map(candle => {
                                const openTime = new Date(candle.openTime).toLocaleString();
                                const priceChange = ((candle.close - candle.open) / candle.open * 100).toFixed(2);
                                const changeClass = priceChange >= 0 ? 'up' : 'down';
                                const changeSign = priceChange >= 0 ? '+' : '';
                                
                                // Show raw values without rounding for verification
                                const sourceInfo = candle.artificiallyGenerated ? 
                                    `🔧 ${candle.sourceCandles || 'N/A'}` : 
                                    '📊 Real';
                                
                                return `
                                    <tr>
                                        <td>${openTime}</td>
                                        <td>${candle.open}</td>
                                        <td>${candle.high}</td>
                                        <td>${candle.low}</td>
                                        <td>${candle.close}</td>
                                        <td class="${changeClass}">${changeSign}${priceChange}%</td>
                                        <td>${candle.volume}</td>
                                        <td>${candle.numberOfTrades}</td>
                                        <td style="font-size: 12px; color: #666;">${sourceInfo}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                    
                    ${viewData.totalPages > 1 ? 
                        `<div class="pagination-container">
                            <div class="pagination-info">
                                <h3>📄 Page Navigation</h3>
                                <p>Showing page ${viewData.currentPage} of ${viewData.totalPages} (${viewData.candles.length} records)</p>
                            </div>
                            <div class="pagination">
                            <span>Page ${viewData.currentPage} of ${viewData.totalPages}</span>
                            
                            <!-- First page link -->
                            ${viewData.currentPage > 1 ? 
                                `<a href="/candle-data?symbol=${viewData.currentSymbol}&interval=${viewData.currentInterval}&limit=${viewData.currentLimit}&page=1${viewData.startDate ? '&startDate=' + viewData.startDate : ''}${viewData.endDate ? '&endDate=' + viewData.endDate : ''}" class="page-link">First</a>` : 
                                `<span class="page-link disabled">First</span>`
                            }
                            
                            <!-- Previous page link -->
                            ${viewData.currentPage > 1 ? 
                                `<a href="/candle-data?symbol=${viewData.currentSymbol}&interval=${viewData.currentInterval}&limit=${viewData.currentLimit}&page=${viewData.currentPage - 1}${viewData.startDate ? '&startDate=' + viewData.startDate : ''}${viewData.endDate ? '&endDate=' + viewData.endDate : ''}" class="page-link">Previous</a>` : 
                                `<span class="page-link disabled">Previous</span>`
                            }
                            
                            <!-- Page number links -->
                            <div class="page-numbers">
                                ${(() => {
                                    // Display up to 5 page numbers around the current page
                                    const pages = [];
                                    const startPage = Math.max(1, viewData.currentPage - 2);
                                    const endPage = Math.min(viewData.totalPages, startPage + 4);
                                    
                                    for (let i = startPage; i <= endPage; i++) {
                                        if (i === viewData.currentPage) {
                                            pages.push(`<span class="page-link current">${i}</span>`);
                                        } else {
                                            pages.push(`<a href="/candle-data?symbol=${viewData.currentSymbol}&interval=${viewData.currentInterval}&limit=${viewData.currentLimit}&page=${i}${viewData.startDate ? '&startDate=' + viewData.startDate : ''}${viewData.endDate ? '&endDate=' + viewData.endDate : ''}" class="page-link">${i}</a>`);
                                        }
                                    }
                                    
                                    return pages.join('');
                                })()}
                            </div>
                            
                            <!-- Next page link -->
                            ${viewData.currentPage < viewData.totalPages ? 
                                `<a href="/candle-data?symbol=${viewData.currentSymbol}&interval=${viewData.currentInterval}&limit=${viewData.currentLimit}&page=${viewData.currentPage + 1}${viewData.startDate ? '&startDate=' + viewData.startDate : ''}${viewData.endDate ? '&endDate=' + viewData.endDate : ''}" class="page-link">Next</a>` : 
                                `<span class="page-link disabled">Next</span>`
                            }
                            
                            <!-- Last page link -->
                            ${viewData.currentPage < viewData.totalPages ? 
                                `<a href="/candle-data?symbol=${viewData.currentSymbol}&interval=${viewData.currentInterval}&limit=${viewData.currentLimit}&page=${viewData.totalPages}${viewData.startDate ? '&startDate=' + viewData.startDate : ''}${viewData.endDate ? '&endDate=' + viewData.endDate : ''}" class="page-link">Last</a>` : 
                                `<span class="page-link disabled">Last</span>`
                            }
                            
                            <!-- Jump to page form -->
                            <form class="jump-to-page" action="/candle-data" method="get" style="margin-left: 10px;">
                                <input type="hidden" name="symbol" value="${viewData.currentSymbol}">
                                <input type="hidden" name="interval" value="${viewData.currentInterval}">
                                <input type="hidden" name="limit" value="${viewData.currentLimit}">
                                ${viewData.startDate ? `<input type="hidden" name="startDate" value="${viewData.startDate}">` : ''}
                                ${viewData.endDate ? `<input type="hidden" name="endDate" value="${viewData.endDate}">` : ''}
                                <input type="number" name="page" min="1" max="${viewData.totalPages}" placeholder="Page" style="width: 60px; padding: 4px;">
                                <button type="submit" class="page-link">Go</button>
                            </form>
                            </div>
                        </div>` : 
                        ''
                    }` : 
                    ''
                }
                
                <script>
                    // Handle form control changes
                    document.getElementById('symbol').addEventListener('change', function() {
                        document.getElementById('candleForm').submit();
                    });
                    
                    document.getElementById('interval').addEventListener('change', function() {
                        document.getElementById('candleForm').submit();
                    });
                    
                    document.getElementById('limit').addEventListener('change', function() {
                        document.getElementById('candleForm').submit();
                    });
                    
                    // Clear filters button
                    document.getElementById('clearFilters').addEventListener('click', function() {
                        document.getElementById('startDate').value = '';
                        document.getElementById('endDate').value = '';
                        document.getElementById('candleForm').submit();
                    });
                    
                    // Auto-refresh the page every 5 minutes to show updated data
                    setTimeout(() => {
                        location.reload();
                    }, 5 * 60 * 1000);
                </script>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('Error in candle data route:', error);
        res.status(500).send('An error occurred while retrieving candle data');
    }
}

module.exports = {
    candleDataController
};
