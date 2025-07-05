const { getSelectedSymbols } = require('../config/database');
const { getReversalCandles, getReversalCandleCount, getReversalStatistics } = require('../models/database');

/**
 * Display reversal candle data for selected symbols
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function reversalCandleController(req, res) {
    try {
        // Get MongoDB client
        const client = req.app.locals.client;
        const dbName = req.app.locals.dbName;
        
        // Check MongoDB connection
        if (!client) {
            return res.status(500).send('Database connection not available');
        }
        
        // Get selected symbols
        const selectedSymbols = await getSelectedSymbols(client);
        
        // Get query parameters
        const symbol = req.query.symbol || (selectedSymbols.length > 0 ? selectedSymbols[0] : null);
        const reversalType = req.query.reversalType || 'all';
        const minConfidence = parseInt(req.query.minConfidence || '0', 10);
        const limit = parseInt(req.query.limit || '50', 10);
        
        // Pagination parameters
        const page = parseInt(req.query.page || '1', 10);
        const skip = (page - 1) * limit;
        
        // Date range parameters
        let startDate = null;
        let endDate = null;
        
        if (req.query.startDate) {
            startDate = new Date(req.query.startDate);
            startDate.setHours(0, 0, 0, 0);
        }
        
        if (req.query.endDate) {
            endDate = new Date(req.query.endDate);
            endDate.setHours(23, 59, 59, 999);
        }
        
        // Prepare filters - exclude interval to show all timeframes for selected symbol
        const filters = {};
        if (symbol) filters.symbol = symbol;
        if (reversalType !== 'all') filters.reversalType = reversalType;
        if (minConfidence > 0) filters.minConfidence = minConfidence;
        if (startDate) filters.startDate = startDate;
        if (endDate) filters.endDate = endDate;
        
        // Prepare view data
        const viewData = {
            selectedSymbols,
            currentSymbol: symbol,
            reversalTypes: [
                { value: 'all', label: 'All Reversals' },
                { value: 'buy_reversal', label: 'Buy Reversals' },
                { value: 'sell_reversal', label: 'Sell Reversals' }
            ],
            currentReversalType: reversalType,
            currentMinConfidence: minConfidence,
            currentLimit: limit,
            currentPage: page,
            startDate: startDate ? startDate.toISOString().split('T')[0] : '',
            endDate: endDate ? endDate.toISOString().split('T')[0] : '',
            totalPages: 1,
            reversalCandles: [],
            statistics: null,
            error: null
        };
        
        // If we have filters, fetch reversal data
        if (symbol) {
            try {
                // Get total count for pagination
                const totalReversals = await getReversalCandleCount(client, dbName, filters);
                viewData.totalPages = Math.ceil(totalReversals / limit);
                
                // Get reversal candle data
                const reversalCandles = await getReversalCandles(client, dbName, filters, limit, skip);
                viewData.reversalCandles = reversalCandles;
                
                // Get statistics
                const statistics = await getReversalStatistics(client, dbName, filters);
                viewData.statistics = statistics;
                
            } catch (dbError) {
                console.error('Error fetching reversal data:', dbError);
                viewData.error = `Error fetching reversal data: ${dbError.message}`;
            }
        }
        
        // Render the reversal candles page
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Reversal Candles - Hamqary</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 1400px; margin: 0 auto; padding: 20px; }
                    h1 { color: #333; display: flex; align-items: center; gap: 10px; }
                    .controls { margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
                    select, button { padding: 8px; border-radius: 4px; border: 1px solid #ddd; }
                    table { width: 100%; border-collapse: collapse; font-size: 14px; }
                    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #ddd; }
                    th { background-color: #f2f2f2; position: sticky; top: 0; }
                    tr:hover { background-color: #f5f5f5; }
                    .buy-reversal { background-color: #e8f5e8; }
                    .sell-reversal { background-color: #ffe8e8; }
                    .confidence-high { color: #28a745; font-weight: bold; }
                    .confidence-medium { color: #ffc107; font-weight: bold; }
                    .confidence-low { color: #dc3545; }
                    .info { background-color: #e7f3fe; border-left: 6px solid #2196F3; padding: 10px; margin-bottom: 15px; }
                    .error { background-color: #ffdddd; border-left: 6px solid #f44336; padding: 10px; margin-bottom: 15px; }
                    .statistics { background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
                    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
                    .stat-card { background: white; padding: 10px; border-radius: 4px; border: 1px solid #dee2e6; text-align: center; }
                    .stat-value { font-size: 24px; font-weight: bold; color: #007bff; }
                    .stat-label { font-size: 12px; color: #666; margin-top: 5px; }
                    .pagination { display: flex; justify-content: center; gap: 10px; margin: 20px 0; align-items: center; flex-wrap: wrap; }
                    .page-numbers { display: flex; gap: 5px; }
                    .page-link { padding: 8px 16px; border: 1px solid #ddd; border-radius: 4px; text-decoration: none; color: #007bff; }
                    .page-link:hover { background-color: #f0f0f0; }
                    .page-link.current { background-color: #007bff; color: white; border-color: #007bff; }
                    .disabled { color: #ccc; cursor: not-allowed; }
                    .form-row { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; align-items: center; }
                    .date-filters { background-color: #f0f8ff; padding: 15px; border-radius: 4px; border: 1px solid #b8daff; margin-top: 10px; }
                    .date-filters h3 { margin-top: 0; margin-bottom: 10px; color: #0056b3; font-size: 16px; }
                    .filter-button { background-color: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; }
                    .filter-button:hover { background-color: #0069d9; }
                    .clear-button { background-color: #f8f9fa; color: #666; border: 1px solid #ddd; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
                    .clear-button:hover { background-color: #e2e6ea; }
                    .pattern-details { font-size: 11px; color: #666; }
                    .candle-viz { width: 30px; height: 60px; position: relative; margin: 0 auto; }
                    .candle-body { position: absolute; left: 25%; width: 50%; background-color: #666; }
                    .candle-tail { position: absolute; left: 49%; width: 2px; background-color: #333; }
                    .green-candle .candle-body { background-color: #28a745; }
                    .red-candle .candle-body { background-color: #dc3545; }
                    .pattern-type { padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; }
                    .buy-pattern { background-color: #d4edda; color: #155724; }
                    .sell-pattern { background-color: #f8d7da; color: #721c24; }
                </style>
            </head>
            <body>
                <h1>📈 Reversal Candle Patterns</h1>
                
                <div class="controls">
                    <form action="/reversal-candles" method="get" id="reversalForm">
                        <div class="form-row">
                            <label for="symbol">Symbol:</label>
                            <select name="symbol" id="symbol">
                                <option value="">Select Symbol</option>
                                ${viewData.selectedSymbols.map(s => 
                                    `<option value="${s}" ${s === viewData.currentSymbol ? 'selected' : ''}>${s}</option>`
                                ).join('')}
                            </select>
                            
                            <label for="reversalType">Pattern Type:</label>
                            <select name="reversalType" id="reversalType">
                                ${viewData.reversalTypes.map(t => 
                                    `<option value="${t.value}" ${t.value === viewData.currentReversalType ? 'selected' : ''}>${t.label}</option>`
                                ).join('')}
                            </select>
                            
                            <label for="minConfidence">Min Confidence:</label>
                            <select name="minConfidence" id="minConfidence">
                                <option value="0" ${minConfidence === 0 ? 'selected' : ''}>All</option>
                                <option value="60" ${minConfidence === 60 ? 'selected' : ''}>≥60%</option>
                                <option value="70" ${minConfidence === 70 ? 'selected' : ''}>≥70%</option>
                                <option value="80" ${minConfidence === 80 ? 'selected' : ''}>≥80%</option>
                                <option value="90" ${minConfidence === 90 ? 'selected' : ''}>≥90%</option>
                            </select>
                            
                            <label for="limit">Limit:</label>
                            <select name="limit" id="limit">
                                <option value="20" ${limit === 20 ? 'selected' : ''}>20</option>
                                <option value="50" ${limit === 50 ? 'selected' : ''}>50</option>
                                <option value="100" ${limit === 100 ? 'selected' : ''}>100</option>
                                <option value="200" ${limit === 200 ? 'selected' : ''}>200</option>
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
                    `<div class="info">Please select a symbol to view reversal candle patterns.</div>` : 
                    ''
                }
                
                ${viewData.statistics ? 
                    `<div class="statistics">
                        <h3>📊 Pattern Statistics</h3>
                        <div class="stats-grid">
                            <div class="stat-card">
                                <div class="stat-value">${viewData.statistics.totalReversals}</div>
                                <div class="stat-label">Total Reversals</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value">${viewData.statistics.buyReversals}</div>
                                <div class="stat-label">Buy Reversals</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value">${viewData.statistics.sellReversals}</div>
                                <div class="stat-label">Sell Reversals</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value">${viewData.statistics.averageConfidence}%</div>
                                <div class="stat-label">Avg Confidence</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value">${viewData.statistics.confidenceDistribution.high}</div>
                                <div class="stat-label">High Confidence (>80%)</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value">${viewData.statistics.confidenceDistribution.medium}</div>
                                <div class="stat-label">Medium Confidence (60-80%)</div>
                            </div>
                        </div>
                    </div>` : 
                    ''
                }
                
                ${viewData.reversalCandles.length === 0 && !viewData.error && symbol ? 
                    `<div class="info">No reversal patterns found for the selected criteria. Try adjusting your filters.</div>` : 
                    ''
                }
                
                ${viewData.reversalCandles.length > 0 ? 
                    `<div style="margin: 15px 0; padding: 10px; background-color: #e7f3fe; border-radius: 4px; text-align: center;">
                        <p style="margin: 0;"><strong>📊 Showing ${viewData.reversalCandles.length} reversal patterns</strong></p>
                        ${viewData.startDate || viewData.endDate ? 
                            `<p style="margin: 5px 0 0 0; font-style: italic;">Filtered by date: ${viewData.startDate ? `from ${viewData.startDate}` : ''} ${viewData.endDate ? `to ${viewData.endDate}` : ''}</p>` : 
                            ''
                        }
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Timeframe</th>
                                <th>Pattern</th>
                                <th>OHLC</th>
                                <th>Body %</th>
                                <th>Upper Tail %</th>
                                <th>Lower Tail %</th>
                                <th>Confidence</th>
                                <th>Candle Color</th>
                                <th>POC</th>
                                <th>VAH</th>
                                <th>VAL</th>
                                <th>Volume</th>
                                <th>Trade Signal</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${viewData.reversalCandles.map(reversal => {
                                const openTime = new Date(reversal.openTime).toLocaleString();
                                const pattern = reversal.reversalPattern;
                                const candle = reversal.candleData;
                                
                                const confidenceClass = pattern.confidence > 80 ? 'confidence-high' : 
                                                      pattern.confidence >= 60 ? 'confidence-medium' : 'confidence-low';
                                
                                const rowClass = pattern.type === 'buy_reversal' ? 'buy-reversal' : 'sell-reversal';
                                
                                return `
                                    <tr class="${rowClass}">
                                        <td style="font-size: 12px;">${openTime}</td>
                                        <td style="font-weight: bold; color: #007bff;">${reversal.interval}</td>
                                        <td>
                                            <span class="pattern-type ${pattern.type === 'buy_reversal' ? 'buy-pattern' : 'sell-pattern'}">
                                                ${pattern.type === 'buy_reversal' ? '🟢 BUY' : '🔴 SELL'}
                                            </span>
                                        </td>
                                        <td style="font-size: 12px;">
                                            O: ${candle.open}<br>
                                            H: ${candle.high}<br>
                                            L: ${candle.low}<br>
                                            C: ${candle.close}
                                        </td>
                                        <td>${pattern.bodyPercentage}%</td>
                                        <td>${pattern.upperTailPercentage}%</td>
                                        <td>${pattern.lowerTailPercentage}%</td>
                                        <td class="${confidenceClass}">${pattern.confidence}%</td>
                                        <td>
                                            <span style="color: ${pattern.candleColor === 'green' ? '#28a745' : pattern.candleColor === 'red' ? '#dc3545' : '#666'};">
                                                ${pattern.candleColor === 'green' ? '🟢' : pattern.candleColor === 'red' ? '🔴' : '⚫'} ${pattern.candleColor}
                                            </span>
                                        </td>
                                        <td style="font-size: 12px; font-weight: bold; color: #007bff;">
                                            ${reversal.volumeFootprint && reversal.volumeFootprint.poc ? 
                                                reversal.volumeFootprint.poc : 
                                                '<span style="color: #999;">N/A</span>'
                                            }
                                        </td>
                                        <td style="font-size: 12px; color: #28a745;">
                                            ${reversal.volumeFootprint && reversal.volumeFootprint.vah ? 
                                                reversal.volumeFootprint.vah : 
                                                '<span style="color: #999;">N/A</span>'
                                            }
                                        </td>
                                        <td style="font-size: 12px; color: #dc3545;">
                                            ${reversal.volumeFootprint && reversal.volumeFootprint.val ? 
                                                reversal.volumeFootprint.val : 
                                                '<span style="color: #999;">N/A</span>'
                                            }
                                        </td>
                                        <td style="font-size: 12px;">
                                            ${reversal.volumeFootprint && reversal.volumeFootprint.totalVolume ? 
                                                `<div style="line-height: 1.3;">
                                                    <strong>${reversal.volumeFootprint.totalVolume.toLocaleString()}</strong><br>
                                                    <small style="color: #666;">
                                                        VA: ${reversal.volumeFootprint.valueAreaPercentage || 0}%<br>
                                                        ${reversal.volumeFootprint.tickDataSource || 'unknown'}
                                                    </small>
                                                </div>` : 
                                                '<span style="color: #999;">N/A</span>'
                                            }
                                        </td>
                                        <td style="font-size: 12px; text-align: center;">
                                            ${reversal.tradeSignal ? 
                                                `<div style="line-height: 1.2;">
                                                    <span style="padding: 4px 8px; border-radius: 12px; font-weight: bold; font-size: 11px; ${
                                                        reversal.tradeSignal.isValidSignal ? 
                                                            (reversal.tradeSignal.signalType === 'buy' ? 
                                                                'background-color: #d4edda; color: #155724;' : 
                                                                'background-color: #f8d7da; color: #721c24;'
                                                            ) : 
                                                            'background-color: #f8f9fa; color: #6c757d;'
                                                    }">
                                                        ${reversal.tradeSignal.isValidSignal ? 
                                                            (reversal.tradeSignal.signalType === 'buy' ? '✅ VALID BUY' : '✅ VALID SELL') : 
                                                            '❌ INVALID'
                                                        }
                                                    </span><br>
                                                    <small style="color: #666; font-size: 10px; margin-top: 2px; display: block;">
                                                        ${reversal.tradeSignal.reason || 'No validation data'}
                                                    </small>
                                                </div>` : 
                                                '<span style="color: #999;">N/A</span>'
                                            }
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                    
                    ${viewData.totalPages > 1 ? 
                        `<div class="pagination">
                            <span>Page ${viewData.currentPage} of ${viewData.totalPages}</span>
                            
                            ${viewData.currentPage > 1 ? 
                                `<a href="/reversal-candles?${new URLSearchParams({...req.query, page: 1}).toString()}" class="page-link">First</a>` : 
                                `<span class="page-link disabled">First</span>`
                            }
                            
                            ${viewData.currentPage > 1 ? 
                                `<a href="/reversal-candles?${new URLSearchParams({...req.query, page: viewData.currentPage - 1}).toString()}" class="page-link">Previous</a>` : 
                                `<span class="page-link disabled">Previous</span>`
                            }
                            
                            <div class="page-numbers">
                                ${(() => {
                                    const pages = [];
                                    const startPage = Math.max(1, viewData.currentPage - 2);
                                    const endPage = Math.min(viewData.totalPages, startPage + 4);
                                    
                                    for (let i = startPage; i <= endPage; i++) {
                                        if (i === viewData.currentPage) {
                                            pages.push(`<span class="page-link current">${i}</span>`);
                                        } else {
                                            pages.push(`<a href="/reversal-candles?${new URLSearchParams({...req.query, page: i}).toString()}" class="page-link">${i}</a>`);
                                        }
                                    }
                                    
                                    return pages.join('');
                                })()}
                            </div>
                            
                            ${viewData.currentPage < viewData.totalPages ? 
                                `<a href="/reversal-candles?${new URLSearchParams({...req.query, page: viewData.currentPage + 1}).toString()}" class="page-link">Next</a>` : 
                                `<span class="page-link disabled">Next</span>`
                            }
                            
                            ${viewData.currentPage < viewData.totalPages ? 
                                `<a href="/reversal-candles?${new URLSearchParams({...req.query, page: viewData.totalPages}).toString()}" class="page-link">Last</a>` : 
                                `<span class="page-link disabled">Last</span>`
                            }
                        </div>` : 
                        ''
                    }` : 
                    ''
                }
                
                <script>
                    // Auto-submit form when filters change
                    ['symbol', 'reversalType', 'minConfidence', 'limit'].forEach(id => {
                        document.getElementById(id).addEventListener('change', function() {
                            document.getElementById('reversalForm').submit();
                        });
                    });
                    
                    // Clear filters button
                    document.getElementById('clearFilters').addEventListener('click', function() {
                        document.getElementById('startDate').value = '';
                        document.getElementById('endDate').value = '';
                        document.getElementById('reversalForm').submit();
                    });
                    
                    // Auto-refresh every 5 minutes
                    setTimeout(() => {
                        location.reload();
                    }, 5 * 60 * 1000);
                </script>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('Error in reversal candles route:', error);
        res.status(500).send('An error occurred while retrieving reversal candle data');
    }
}

module.exports = {
    reversalCandleController
};
