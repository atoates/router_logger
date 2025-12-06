#!/usr/bin/env node

/**
 * Admin Date Sync Script
 * 
 * This script syncs the date_installed field from ClickUp to the database
 * for all routers that have location assignments.
 * 
 * Usage:
 *   node sync-dates-admin.js
 * 
 * Or make it executable:
 *   chmod +x sync-dates-admin.js
 *   ./sync-dates-admin.js
 */

const routerSyncService = require('./src/services/routerSyncService');
const { logger } = require('./src/config/database');

async function syncDates() {
  console.log('\n========================================');
  console.log('  Admin Date Sync - Starting');
  console.log('========================================\n');
  
  const startTime = Date.now();
  
  try {
    console.log('🔄 Syncing date_installed from ClickUp to database...\n');
    
    const result = await routerSyncService.syncDateInstalledFromClickUp();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n========================================');
    console.log('  Sync Complete!');
    console.log('========================================\n');
    
    console.log('📊 Summary:');
    console.log(`  ✅ Successfully updated: ${result.summary.updated}`);
    console.log(`  ❌ Failed: ${result.summary.failed}`);
    console.log(`  📦 Total routers: ${result.summary.total}`);
    console.log(`  🧹 Cache cleared: ${result.cacheCleared ? 'Yes' : 'No'}`);
    console.log(`  ⏱️  Duration: ${duration}s\n`);
    
    if (result.summary.updated > 0) {
      console.log('✨ Updated routers:');
      result.results
        .filter(r => r.status === 'success' && r.date_installed)
        .forEach(r => {
          console.log(`  - Router ${r.router_id}: ${r.date_installed}`);
        });
      console.log('');
    }
    
    if (result.summary.failed > 0) {
      console.log('⚠️  Failed routers:');
      result.results
        .filter(r => r.status === 'failed')
        .forEach(r => {
          console.log(`  - Router ${r.router_id}: ${r.error}`);
        });
      console.log('');
    }
    
    // Show routers with no date set in ClickUp
    const noDates = result.results.filter(r => r.status === 'success' && !r.date_installed);
    if (noDates.length > 0) {
      console.log('ℹ️  Routers with no Date Installed in ClickUp:');
      noDates.forEach(r => {
        console.log(`  - Router ${r.router_id}`);
      });
      console.log('');
      console.log('  💡 Tip: Set the "Date Installed" custom field in ClickUp for these routers');
      console.log('      then run this script again.\n');
    }
    
    console.log('========================================\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error during sync:');
    console.error(`   ${error.message}\n`);
    
    if (error.stack) {
      logger.error('Sync error details:', error);
    }
    
    console.log('========================================\n');
    process.exit(1);
  }
}

// Run the sync
syncDates();

