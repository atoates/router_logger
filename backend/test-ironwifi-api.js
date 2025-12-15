#!/usr/bin/env node
/**
 * IronWifi API Test Script
 * 
 * Tests connectivity and explores available endpoints
 * 
 * Usage:
 *   node test-ironwifi-api.js
 * 
 * Make sure IRONWIFI_API_KEY is set in environment or .env file
 */

require('dotenv').config();

const ironwifiClient = require('./src/services/ironwifiClient');

async function testEndpoint(name, fn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    const result = await fn();
    console.log('✅ OK');
    return { name, success: true, data: result };
  } catch (error) {
    const status = error.response?.status || 'unknown';
    console.log(`❌ FAILED (${status}: ${error.message})`);
    return { name, success: false, error: error.message, status };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('               IronWifi API Connectivity Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();

  // Check configuration
  const apiKey = process.env.IRONWIFI_API_KEY;
  if (!apiKey) {
    console.log('❌ IRONWIFI_API_KEY not set in environment');
    console.log('   Set it in your .env file or export it:');
    console.log('   export IRONWIFI_API_KEY=your-api-key-here');
    process.exit(1);
  }
  
  console.log(`API Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);
  console.log(`API URL: ${process.env.IRONWIFI_API_URL || 'https://console.ironwifi.com/api'}`);
  console.log();

  // Test basic connectivity
  console.log('Testing API connection...');
  console.log('─────────────────────────────────────────────────────────────────');
  
  const results = [];
  
  // Test connection
  const connResult = await testEndpoint('Connection Test', async () => {
    return await ironwifiClient.testConnection();
  });
  results.push(connResult);
  if (connResult.data) {
    console.log(`   └─ ${connResult.data.message}`);
  }
  
  // Test networks endpoint
  results.push(await testEndpoint('Networks', async () => {
    return await ironwifiClient.getNetworks();
  }));
  
  // Test users endpoint
  results.push(await testEndpoint('Users', async () => {
    return await ironwifiClient.getUsers();
  }));
  
  // Test devices endpoint
  results.push(await testEndpoint('Devices', async () => {
    return await ironwifiClient.getDevices();
  }));
  
  // Test accounting report (last 4 hours)
  results.push(await testEndpoint('Accounting Report (last 4h)', async () => {
    return await ironwifiClient.getAccountingReport({ earliest: '-4h', latest: 'now' });
  }));
  
  console.log();
  console.log('─────────────────────────────────────────────────────────────────');
  
  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log();
  console.log('Summary:');
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log();
  
  // API Usage
  const usage = ironwifiClient.getApiUsage();
  console.log('API Usage:');
  console.log(`   Calls made this hour: ${usage.callsMade}/${usage.limit}`);
  console.log(`   Remaining: ${usage.remaining}`);
  console.log(`   Resets in: ${usage.resetInMinutes} minutes`);
  console.log();
  
  // Display data if available
  for (const result of results) {
    if (result.success && result.data) {
      if (result.name === 'Networks' && result.data.items) {
        console.log(`Networks found: ${result.data.total_items || result.data.items?.length || 0}`);
        if (result.data.items?.length > 0) {
          console.log('   Networks:');
          result.data.items.slice(0, 5).forEach(n => {
            console.log(`   - ${n.name || n.id} (ID: ${n.id})`);
          });
        }
      }
      if (result.name === 'Users' && result.data.items) {
        console.log(`Users found: ${result.data.total_items || result.data.items?.length || 0}`);
      }
      if (result.name === 'Devices' && result.data.items) {
        console.log(`Devices found: ${result.data.total_items || result.data.items?.length || 0}`);
        if (result.data.items?.length > 0) {
          console.log('   Devices:');
          result.data.items.slice(0, 5).forEach(d => {
            console.log(`   - ${d.name || d.mac_address || d.id}`);
          });
        }
      }
      if (result.name.includes('Accounting')) {
        const sessions = Array.isArray(result.data) ? result.data : 
                        result.data.items || result.data.records || result.data.data || [];
        console.log(`Accounting records found: ${sessions.length}`);
        if (sessions.length > 0) {
          console.log('   Sample session fields:');
          const sample = sessions[0];
          Object.keys(sample).slice(0, 10).forEach(key => {
            console.log(`   - ${key}: ${JSON.stringify(sample[key]).slice(0, 50)}`);
          });
        }
      }
    }
  }
  
  console.log();
  console.log('═══════════════════════════════════════════════════════════════');
  
  if (failed > 0) {
    console.log();
    console.log('Some tests failed. Check the following:');
    console.log('1. Is your API key valid? Get it from IronWifi Console → Account → API Keys');
    console.log('2. Is your IronWifi account configured with networks and devices?');
    console.log('3. Are there any rate limits in effect?');
    console.log();
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Test script failed:', error);
  process.exit(1);
});

