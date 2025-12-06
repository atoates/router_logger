#!/usr/bin/env node

/**
 * API Test Script - Admin Sync Dates Endpoint
 * 
 * This script tests the admin sync-dates API endpoint
 * Requires valid admin session cookie or can be adapted to use direct admin credentials
 * 
 * Usage:
 *   node test-sync-dates-api.js [api-base-url]
 * 
 * Example:
 *   node test-sync-dates-api.js
 *   node test-sync-dates-api.js http://localhost:3000
 *   node test-sync-dates-api.js https://routerlogger-production.up.railway.app
 */

const axios = require('axios');

const API_BASE = process.argv[2] || process.env.API_BASE_URL || 'http://localhost:3000';

async function testSyncDatesEndpoint() {
  console.log('\n========================================');
  console.log('  Testing Admin Sync Dates API');
  console.log('========================================\n');
  console.log(`API Base: ${API_BASE}`);
  console.log(`Endpoint: POST ${API_BASE}/api/admin/sync-dates\n`);
  
  const startTime = Date.now();
  
  try {
    console.log('🔄 Sending request...\n');
    
    const response = await axios.post(
      `${API_BASE}/api/admin/sync-dates`,
      {},
      {
        headers: {
          'Content-Type': 'application/json'
        },
        // If you have a session cookie, uncomment and set it:
        // headers: {
        //   'Cookie': 'connect.sid=your-session-cookie-here'
        // }
      }
    );
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('✅ Success!\n');
    console.log('📊 Response:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log(`\n⏱️  Duration: ${duration}s`);
    
    if (response.data.summary) {
      console.log('\n📈 Summary:');
      console.log(`  ✅ Updated: ${response.data.summary.updated}`);
      console.log(`  ❌ Failed: ${response.data.summary.failed}`);
      console.log(`  📦 Total: ${response.data.summary.total}`);
      console.log(`  🧹 Cache Cleared: ${response.data.cacheCleared ? 'Yes' : 'No'}`);
    }
    
    console.log('\n========================================\n');
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.error('❌ Request failed!\n');
    
    if (error.response) {
      console.error(`Status: ${error.response.status} ${error.response.statusText}`);
      console.error(`Error: ${JSON.stringify(error.response.data, null, 2)}`);
      
      if (error.response.status === 401 || error.response.status === 403) {
        console.error('\n⚠️  Authentication required!');
        console.error('   This endpoint requires admin authentication.');
        console.error('   Options:');
        console.error('   1. Use the sync-dates-admin.js script instead (bypasses auth)');
        console.error('   2. Add a valid session cookie to this script');
        console.error('   3. Login to the web interface first');
      }
    } else if (error.request) {
      console.error('No response received from server');
      console.error('Error:', error.message);
      console.error('\n⚠️  Check that:');
      console.error('   1. The backend server is running');
      console.error('   2. The API base URL is correct');
      console.error(`   3. The endpoint is accessible: ${API_BASE}/api/admin/sync-dates`);
    } else {
      console.error('Error:', error.message);
    }
    
    console.error(`\n⏱️  Duration: ${duration}s`);
    console.log('\n========================================\n');
    
    process.exit(1);
  }
}

// Run the test
testSyncDatesEndpoint();

