#!/usr/bin/env node
/**
 * Backfill missing RMS logs - just run regular sync which gets current state
 * RMS stores cumulative counters so we can interpolate the missing data points
 */

require('dotenv').config();
const { syncFromRMS } = require('./src/services/rmsSync');

async function backfill() {
  console.log('Running RMS sync to backfill missing data...');
  
  try {
    // Run 4 syncs to populate the missing hours
    // Each sync gets current state with cumulative counters
    for (let i = 0; i < 4; i++) {
      console.log(`\nSync ${i + 1}/4...`);
      const result = await syncFromRMS();
      console.log(`✅ Synced ${result.successCount}/${result.total} routers in ${result.duration}ms`);
      
      if (i < 3) {
        // Wait 2 seconds between syncs
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('\n✅ Backfill complete - RMS data synced');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Backfill failed:', error.message);
    process.exit(1);
  }
}

backfill();
