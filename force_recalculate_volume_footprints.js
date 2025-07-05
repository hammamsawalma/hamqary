/**
 * Force Recalculation of Volume Footprints
 * Updates all existing reversal candles with corrected VAH/VAL calculations
 */

const { MongoClient } = require('mongodb');
const { fetchReversalCandleTickData } = require('./utils/fetchHistoricalTickData');
const { calculateReversalVolumeFootprint } = require('./utils/volumeFootprintCalculator');
const { validateTradeSignal } = require('./utils/tradeSignalValidator');
require('dotenv').config();

async function forceRecalculateVolumeFootprints() {
    console.log('🔄 Force Recalculating Volume Footprints with Corrected Algorithm');
    console.log('================================================================');
    
    let client;
    
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        const dbName = process.env.DB_NAME;
        
        if (!mongoUri || !dbName) {
            throw new Error('Missing MONGODB_URI or DB_NAME in .env file');
        }
        
        console.log('🔗 Connecting to MongoDB...');
        client = new MongoClient(mongoUri);
        await client.connect();
        console.log('✅ Connected to MongoDB');
        
        const db = client.db(dbName);
        const collection = db.collection('reversalCandles');
        
        // Get all reversal candles with volume footprints (to recalculate them)
        const query = {
            'volumeFootprint.poc': { $exists: true },
            interval: { $in: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '10m', 
                              '11m', '12m', '13m', '14m', '15m', '16m', '17m', '18m', '19m', '20m'] }
        };
        
        const candles = await collection.find(query).toArray();
        console.log(`📊 Found ${candles.length} reversal candles to recalculate`);
        
        if (candles.length === 0) {
            console.log('ℹ️ No candles found for recalculation');
            return;
        }
        
        let processed = 0;
        let successful = 0;
        let failed = 0;
        
        console.log('\n🔄 Starting recalculation process...\n');
        
        for (const candle of candles) {
            try {
                processed++;
                console.log(`📊 [${processed}/${candles.length}] Processing ${candle.symbol} ${candle.interval} from ${new Date(candle.openTime).toISOString()}`);
                
                const openTime = candle.openTime instanceof Date ? candle.openTime.getTime() : candle.openTime;
                const closeTime = candle.closeTime instanceof Date ? candle.closeTime.getTime() : candle.closeTime;
                
                // Fetch tick data
                const tickDataResult = await fetchReversalCandleTickData(
                    candle.symbol,
                    openTime,
                    closeTime,
                    candle.interval
                );

                if (!tickDataResult.success || tickDataResult.trades.length === 0) {
                    console.log(`❌ Failed to fetch tick data: ${tickDataResult.error || 'No trades found'}`);
                    failed++;
                    continue;
                }

                // Calculate volume footprint with CORRECTED algorithm
                const volumeFootprint = calculateReversalVolumeFootprint(
                    tickDataResult.trades,
                    candle.symbol,
                    openTime,
                    closeTime
                );

                if (volumeFootprint.error) {
                    console.log(`❌ Volume footprint calculation failed: ${volumeFootprint.error}`);
                    failed++;
                    continue;
                }

                // Compare old vs new values
                const oldPOC = candle.volumeFootprint.poc;
                const oldVAH = candle.volumeFootprint.vah;
                const oldVAL = candle.volumeFootprint.val;
                
                const newPOC = volumeFootprint.poc;
                const newVAH = volumeFootprint.vah;
                const newVAL = volumeFootprint.val;
                
                const pocChanged = Math.abs(oldPOC - newPOC) > 0.0001;
                const vahChanged = Math.abs(oldVAH - newVAH) > 0.0001;
                const valChanged = Math.abs(oldVAL - newVAL) > 0.0001;
                
                if (pocChanged || vahChanged || valChanged) {
                    console.log(`🔄 Values changed - updating:`);
                    console.log(`   POC: ${oldPOC} → ${newPOC} ${pocChanged ? '(CHANGED)' : ''}`);
                    console.log(`   VAH: ${oldVAH} → ${newVAH} ${vahChanged ? '(CHANGED)' : ''}`);
                    console.log(`   VAL: ${oldVAL} → ${newVAL} ${valChanged ? '(CHANGED)' : ''}`);
                } else {
                    console.log(`✅ Values unchanged - algorithm produced same results`);
                }

                // Recalculate trade signal with corrected volume footprint
                let tradeSignalData = null;
                try {
                    const tradeSignalValidation = validateTradeSignal(
                        candle.candleData,
                        {
                            poc: volumeFootprint.poc,
                            vah: volumeFootprint.vah,
                            val: volumeFootprint.val
                        },
                        candle.reversalPattern?.type
                    );
                    
                    tradeSignalData = {
                        isValidSignal: tradeSignalValidation.isValidSignal,
                        signalType: tradeSignalValidation.signalType,
                        reason: tradeSignalValidation.reason,
                        criteria: tradeSignalValidation.criteria,
                        validatedAt: new Date()
                    };
                    
                    console.log(`🚦 Trade signal: ${tradeSignalValidation.isValidSignal ? '✅ VALID' : '❌ INVALID'} (${tradeSignalValidation.signalType || 'none'})`);
                } catch (signalError) {
                    console.log(`⚠️ Trade signal validation failed: ${signalError.message}`);
                }

                // Update the candle with new calculations
                await collection.updateOne(
                    { _id: candle._id },
                    {
                        $set: {
                            volumeFootprint: {
                                poc: volumeFootprint.poc,
                                vah: volumeFootprint.vah,
                                val: volumeFootprint.val,
                                totalVolume: volumeFootprint.totalVolume,
                                valueAreaVolume: volumeFootprint.valueAreaVolume,
                                valueAreaPercentage: volumeFootprint.valueAreaPercentage,
                                tickDataSource: 'historical',
                                calculatedAt: new Date(),
                                tradesProcessed: volumeFootprint.tradesProcessed,
                                executionTime: tickDataResult.executionTime,
                                algorithmVersion: 'corrected_market_profile_v2' // Mark as using corrected algorithm
                            },
                            ...(tradeSignalData && { tradeSignal: tradeSignalData })
                        }
                    }
                );

                successful++;
                console.log(`✅ Successfully updated ${candle.symbol} ${candle.interval}\n`);
                
                // Add small delay to respect rate limits
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.error(`❌ Error processing ${candle.symbol} ${candle.interval}:`, error.message);
                failed++;
            }
        }
        
        console.log('\n🏁 Recalculation Completed!');
        console.log('==========================');
        console.log(`📊 Processed: ${processed} candles`);
        console.log(`✅ Successful: ${successful} candles`);
        console.log(`❌ Failed: ${failed} candles`);
        console.log(`🎯 Success Rate: ${processed > 0 ? Math.round((successful / processed) * 100) : 0}%`);
        
        console.log('\n✨ All volume footprints have been recalculated with the corrected Market Profile algorithm!');
        console.log('💡 The VAH/VAL values now use proper volume-weighted selection methodology.');
        
    } catch (error) {
        console.error('\n❌ Recalculation script failed:', error);
        process.exit(1);
    } finally {
        if (client) {
            await client.close();
            console.log('\n🔌 Disconnected from MongoDB');
        }
    }
}

// Run the script
if (require.main === module) {
    forceRecalculateVolumeFootprints()
        .then(() => {
            console.log('\n👋 Recalculation finished. Check the reversal candles page for updated values!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { forceRecalculateVolumeFootprints };
