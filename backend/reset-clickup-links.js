/**
 * Reset ClickUp task links in database
 * Run this to clear old task IDs before re-creating tasks
 */

const axios = require('axios');

const BACKEND_URL = 'https://routerlogger-production.up.railway.app';

async function resetClickUpLinks() {
  try {
    console.log('This will clear all ClickUp task links from the database.');
    console.log('You will need to re-run create-all-tasks.js after this.\n');
    
    const response = await axios.post(`${BACKEND_URL}/api/clickup/reset-all-links`);
    
    console.log('✅ Reset complete!');
    console.log(`   Cleared links from ${response.data.count} routers`);
    console.log('\nNow run: node create-all-tasks.js');
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    process.exit(1);
  }
}

resetClickUpLinks();
