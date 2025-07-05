# 🚀 Hamqary - Professional Trading Signals System

A comprehensive Node.js application that provides real-time trading signals using **Volume Profile Analysis** and **Market Profile methodology** for Binance Futures markets.

![Hamqary Trading Signals Dashboard](https://img.shields.io/badge/Status-Active-brightgreen) ![Node.js](https://img.shields.io/badge/Node.js-16%2B-green) ![MongoDB](https://img.shields.io/badge/MongoDB-5.0%2B-green) ![License](https://img.shields.io/badge/License-MIT-blue)

## 🎯 Key Features

### 📊 **Advanced Signal Scoring (1-10 Scale)**
- **Buy Signals**: POC closer to candle low = higher score
- **Sell Signals**: POC closer to candle high = higher score
- Mathematical distance-based scoring algorithm
- Quality filtering with configurable minimum scores

### 📈 **Volume Profile Analysis**
- **POC (Point of Control)**: Price level with highest volume
- **VAH (Value Area High)**: Upper boundary of 70% volume area
- **VAL (Value Area Low)**: Lower boundary of 70% volume area
- Market Profile methodology compliance

### 🎛️ **Modern Trading Dashboard**
- Beautiful card-based UI with gradient backgrounds
- Real-time filtering by symbol, timeframe, and score
- Auto-refresh every 1 minute + manual refresh
- Statistics cards showing signal distribution
- Sorted by close time (newest completed signals first)

### ⚙️ **System Management**
- **System Control Panel**: Monitor and control operations
- **Database Management**: Reset, cleanup, and status monitoring
- **Automatic Data Cleanup**: Removes OHLC data >2 hours old
- **Real-time System Statistics**: Database stats, uptime, collection counts

### 🔄 **Real-time Data Processing**
- **Binance Futures API**: Live market data integration
- **WebSocket Tick Data**: Real-time price and volume collection
- **Historical Backfill**: Automatic historical data loading
- **Multi-Timeframe Support**: 1-20 minute intervals

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Binance API   │───▶│   Data Layer     │───▶│   Signal Engine │
│                 │    │                  │    │                 │
│ • Futures Data  │    │ • MongoDB        │    │ • Volume Profile│
│ • WebSocket     │    │ • Collections    │    │ • Scoring       │
│ • Historical    │    │ • Indexing       │    │ • Validation    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │     Web Interface       │
                    │                         │
                    │ • Trading Dashboard     │
                    │ • System Control        │
                    │ • Symbol Management     │
                    │ • Analytics View        │
                    └─────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v16 or higher)
- **MongoDB** (v5.0 or higher) - Local or MongoDB Atlas
- **Binance Account** (for API access)

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/hammamsawalma/hamqary.git
cd hamqary

# Install dependencies
npm install
```

### 2. Configuration

Create a `.env` file in the root directory:

```env
# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017
DB_NAME=hamqary_trading

# For MongoDB Atlas (Cloud)
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/
# DB_NAME=hamqary_production

# Application Configuration
PORT=3000
NODE_ENV=development
```

### 3. Start the Application

```bash
# Development mode
npm start

# Or directly with Node.js
node index.js
```

### 4. Access the Dashboard

Open your browser and navigate to:
- **Trading Dashboard**: `http://localhost:3000`
- **Symbol Management**: `http://localhost:3000/symbols`
- **System Control**: `http://localhost:3000/system`

## 📱 User Interface

### 🏠 Trading Signals Dashboard
The main dashboard displays real-time trading signals with:
- **Signal Cards**: Beautiful cards showing buy/sell signals
- **Smart Filtering**: Filter by symbol, timeframe (3m+ default), minimum score
- **Statistics**: Total signals, buy/sell distribution, high-score signals
- **Auto-refresh**: Updates every minute automatically

### 📊 Signal Information
Each signal card shows:
- **Signal Score**: 1-10 scale rating
- **Signal Type**: BUY 📈 or SELL 📉
- **Volume Profile**: POC, VAH, VAL values
- **Timeframes**: From 1 minute to 20 minutes
- **Timestamps**: Open time → Close time
- **Volume Data**: Total trading volume

### ⚙️ System Control Panel
Comprehensive system management:
- **Start/Stop**: Control data collection
- **Database Reset**: Clean slate functionality
- **Data Cleanup**: Remove old OHLC data
- **System Status**: Monitor database and operations

## 🔧 Technical Details

### Signal Scoring Algorithm

The scoring system uses mathematical distance calculations:

**For Buy Signals:**
```javascript
score = 10 * (1 - (poc - low) / (vah - low))
```

**For Sell Signals:**
```javascript
score = 10 * (1 - (high - poc) / (high - val))
```

**Score Ranges:**
- **8-10**: 🔥 High Quality Signals
- **6-7**: ⭐ Good Signals  
- **4-5**: 📊 Average Signals
- **1-3**: 📉 Low Quality Signals

### Data Flow

1. **Collection**: Binance Futures API → MongoDB
2. **Processing**: Volume footprint calculation
3. **Analysis**: Reversal pattern detection
4. **Scoring**: Quality assessment algorithm
5. **Presentation**: Real-time dashboard updates

### Database Collections

- **`selectedSymbols`**: User-chosen trading pairs
- **`candleData`**: OHLC price data (auto-cleanup >2h)
- **`reversalCandles`**: Processed signals with scores
- **`volumeFootprints`**: Volume profile analysis

## 📚 API Endpoints

### Main Pages
- `GET /` - Trading Signals Dashboard
- `GET /symbols` - Symbol Selection & Management
- `GET /reversal-candles` - Technical Analysis View
- `GET /system` - System Control Panel

### System Control
- `POST /system/stop` - Stop system operations
- `POST /system/reset` - Reset database
- `POST /system/clean-data` - Clean old OHLC data

### Symbol Management  
- `GET /symbols` - List available symbols
- `POST /symbols/select` - Save selected symbols

## 🎨 Customization

### Timeframe Filtering

The default filter shows **3m+ timeframes** (3, 5, 10, 15, 20 minutes), but you can customize this in the frontend:

```javascript
// In controllers/signalsController.js
intervals: [
    { value: '3m+', label: '3m+ Timeframes (Default)' },
    { value: '5m+', label: '5m+ Timeframes' },
    { value: 'all', label: 'All Timeframes' }
]
```

### Scoring Thresholds

Adjust signal quality thresholds:

```javascript
// High quality signals threshold
const HIGH_SCORE_THRESHOLD = 8;

// Minimum valid signal score
const MIN_VALID_SCORE = 4;
```

## 🔧 Development

### Project Structure

```
hamqary/
├── config/                 # Application configuration
│   ├── database.js         # MongoDB connection
│   ├── express.js          # Express.js setup
│   └── cron.js            # Scheduled jobs
├── controllers/            # Request handlers
│   ├── signalsController.js # Main dashboard
│   ├── systemController.js  # System management
│   └── symbolController.js  # Symbol management
├── models/                 # Data models
├── routes/                 # URL routing
├── utils/                  # Utility functions
│   ├── volumeFootprintCalculator.js
│   ├── tradeSignalValidator.js
│   └── fetchAndStoreCandleData.js
├── views/                  # Frontend templates
└── tests/                  # Test files
```

### Running Tests

```bash
# Test signal scoring system
node test_trade_signal_validator.js

# Test volume footprint calculations
node test_volume_footprint_system.js

# Test complete system
node test_complete_signals_system.js
```

### Adding New Features

1. **New Signal Types**: Extend `tradeSignalValidator.js`
2. **Custom Timeframes**: Modify `fetchAndStoreCandleData.js`
3. **Additional Indicators**: Add to `volumeFootprintCalculator.js`
4. **UI Enhancements**: Update controller HTML generators

## 📊 Performance

### Optimization Features

- **Efficient Queries**: MongoDB indexing for fast lookups
- **Data Cleanup**: Automatic removal of old OHLC data
- **Batch Processing**: Queued artificial candle generation
- **Resource Management**: Controlled cron job execution

### System Requirements

- **RAM**: 512MB minimum, 2GB recommended
- **Storage**: 1GB minimum for database
- **Network**: Stable internet for Binance API
- **CPU**: Single core sufficient, multi-core preferred

## 🔒 Security

### Best Practices

- **Environment Variables**: Sensitive data in `.env` files
- **Input Validation**: All user inputs sanitized
- **Error Handling**: Graceful error management
- **Rate Limiting**: Binance API rate limit compliance

### MongoDB Security

```javascript
// Use authenticated connections for production
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/

// Enable MongoDB authentication
// Set up proper user roles and permissions
```

## 🚀 Deployment

### Local Deployment

```bash
# Install PM2 for process management
npm install -g pm2

# Start application with PM2
pm2 start index.js --name hamqary

# Monitor application
pm2 monitor
```

### Cloud Deployment (Heroku)

```bash
# Create Heroku app
heroku create your-hamqary-app

# Add MongoDB Atlas addon
heroku addons:create mongolab:sandbox

# Configure environment variables
heroku config:set NODE_ENV=production

# Deploy
git push heroku main
```

### Docker Deployment

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
```

## 🤝 Contributing

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and test thoroughly
4. Commit with descriptive messages
5. Push and create a Pull Request

### Contribution Guidelines

- **Code Style**: Follow existing patterns and ESLint rules
- **Testing**: Add tests for new features
- **Documentation**: Update README and code comments
- **Performance**: Consider impact on system resources

### Bug Reports

Please include:
- **Environment**: Node.js version, OS, MongoDB version
- **Steps to Reproduce**: Clear reproduction steps
- **Expected vs Actual**: What should happen vs what happens
- **Logs**: Relevant error messages or console output

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2025 HiMonacci

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

## 💰 Support & Tips

If **Hamqary** helps you achieve profitable trades, consider supporting the developer:

### 🎯 **Tip Addresses**
- **USDT (TRC20)**: `TNGCEh1LdUDQ4sQwqA93q8fV7fvRGzemt7`
- **Binance ID**: `1022104942`

### 🚀 **Wishing all traders successful trades!**

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=hammamsawalma/hamqary&type=Date)](https://star-history.com/#hammamsawalma/hamqary&Date)

---

**Built with ❤️ by [HammamasSawalma](https://github.com/hammamsawalma) for the trading community**

**"Success in trading comes from discipline, patience, and the right tools"** 🎯
