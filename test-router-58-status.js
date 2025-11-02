/**
 * Quick test to see what status Router #58 has and what we would send to ClickUp
 */

const axios = require('axios');

const BACKEND_URL = 'https://routerlogger-production.up.railway.app';

// Operational status options (dropdown UUIDs)
const STATUS_OPTIONS = {
  ONLINE: 'b256bad4-2f9e-4e98-89b1-77a2a5443337',
  OFFLINE: '7149ad8d-db43-48ab-a038-a17162c7495d',
  MAINTENANCE: '38342970-fdd4-4c9f-bcea-738be4f6e2c5'
};

async function checkRouter58() {
  try {
    const response = await axios.get(`${BACKEND_URL}/api/routers`);
    const router58 = response.data.find(r => r.name === 'Router #58');
    
    if (!router58) {
      console.log('Router #58 not found');
      return;
    }
    
    console.log('\n=== ROUTER #58 DATA ===');
    console.log('Router ID:', router58.router_id);
    console.log('Name:', router58.name);
    console.log('Current Status:', router58.current_status);
    console.log('Last Seen:', router58.last_seen);
    console.log('ClickUp Task ID:', router58.clickup_task_id);
    console.log('Service Status:', router58.service_status);
    console.log('Stored With:', router58.stored_with);
    
    const isOnline = router58.current_status === 'online';
    const statusValue = isOnline ? STATUS_OPTIONS.ONLINE : STATUS_OPTIONS.OFFLINE;
    
    console.log('\n=== CLICKUP SYNC LOGIC ===');
    console.log('isOnline?:', isOnline);
    console.log('Status Value (UUID):', statusValue);
    console.log('Status Label:', isOnline ? 'ONLINE' : 'OFFLINE');
    
    console.log('\n=== EXPECTED CLICKUP PAYLOAD ===');
    console.log(JSON.stringify({
      custom_fields: [{
        id: '8a661229-13f0-4693-a7cb-1df86725cfed',
        value: statusValue
      }]
    }, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkRouter58();
