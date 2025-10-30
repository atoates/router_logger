/**
 * Update ClickUp task custom fields with router data
 */

const axios = require('axios');

const BACKEND_URL = 'https://routerlogger-production.up.railway.app';
const FRONTEND_URL = 'https://routerlogger-frontend-production.up.railway.app';

// Custom field IDs from ClickUp
const CUSTOM_FIELDS = {
  OPERATIONAL_STATUS: '8a661229-13f0-4693-a7cb-1df86725cfed',
  ROUTER_MODEL: 'f2cbe126-4e68-4be0-9c3b-fa230d289f51',
  FIRMWARE: '845f6619-e3ee-4634-b92a-a117f14fb8c7',
  LAST_MAINTENANCE_DATE: '49551d31-6e57-4620-af95-32c701e93488',
  IMEI: '8b278eb1-ba02-43c7-81d6-0b739c089e7c',
  ROUTER_ID: 'dfe0016c-4ab0-4dd9-bb38-b338411e9b47',
  LAST_ONLINE: '684e19a1-06c3-4bfd-94dd-6aca4a9b85fe',
  DATA_USAGE: 'c58206db-e995-4717-8e62-d36e15d0a3e2',
  ROUTER_DASHBOARD: 'b9cf2e41-dc79-4768-985a-bda52b9dad1f'
};

// Operational status options
const STATUS_OPTIONS = {
  ONLINE: 'b256bad4-2f9e-4e98-89b1-77a2a5443337',
  OFFLINE: '7149ad8d-db43-48ab-a038-a17162c7495d',
  MAINTENANCE: '38342970-fdd4-4c9f-bcea-738be4f6e2c5'
};

async function updateTaskCustomFields() {
  try {
    console.log('Fetching routers with linked tasks...\n');
    
    const routersRes = await axios.get(`${BACKEND_URL}/api/routers`);
    const routers = routersRes.data.filter(r => r.clickup_task_id);
    
    console.log(`Found ${routers.length} routers with ClickUp tasks\n`);
    
    let updated = 0;
    let errors = 0;
    
    for (const router of routers) {
      try {
        // Prepare custom fields data
        const customFields = [];
        
        // Router ID (text) - required
        customFields.push({
          id: CUSTOM_FIELDS.ROUTER_ID,
          value: router.router_id.toString()
        });
        
        // IMEI (number)
        if (router.imei) {
          const imeiNum = parseInt(router.imei);
          if (!isNaN(imeiNum)) {
            customFields.push({
              id: CUSTOM_FIELDS.IMEI,
              value: imeiNum
            });
          }
        }
        
        // Firmware (text)
        if (router.firmware_version) {
          customFields.push({
            id: CUSTOM_FIELDS.FIRMWARE,
            value: router.firmware_version
          });
        }
        
        // Last Online (date timestamp in milliseconds)
        if (router.last_seen) {
          customFields.push({
            id: CUSTOM_FIELDS.LAST_ONLINE,
            value: new Date(router.last_seen).getTime()
          });
        }
        
        // Operational Status (dropdown: use UUID option IDs)
        const statusValue = router.current_status === 'online' 
          ? STATUS_OPTIONS.ONLINE 
          : STATUS_OPTIONS.OFFLINE;
        customFields.push({
          id: CUSTOM_FIELDS.OPERATIONAL_STATUS,
          value: statusValue
        });
        
        // Router Dashboard (URL) - direct link to router's page
        const dashboardUrl = `${FRONTEND_URL}/router/${router.router_id}`;
        customFields.push({
          id: CUSTOM_FIELDS.ROUTER_DASHBOARD,
          value: dashboardUrl
        });
        
        // Update task via ClickUp API
        const updateData = {
          custom_fields: customFields
        };
        
        await axios.put(
          `${BACKEND_URL}/api/clickup/task/${router.clickup_task_id}`,
          updateData
        );
        
        const statusText = statusValue === STATUS_OPTIONS.ONLINE ? 'Online' : 'Offline';
        console.log(`✅ ${router.router_id.padEnd(12)} → ${router.clickup_task_id} (${statusText})`);
        
        updated++;
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        const errorData = error.response?.data;
        const errorMsg = errorData?.clickupError?.err || errorData?.error || error.message;
        console.log(`❌ ${router.router_id.padEnd(12)} - ${errorMsg}`);
        if (errors === 0) {
          console.log('\n=== FIRST ERROR DETAILS ===');
          console.log('Response:', JSON.stringify(errorData, null, 2));
          console.log('=========================\n');
        }
        errors++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY:');
    console.log(`✅ Updated: ${updated}`);
    console.log(`❌ Errors: ${errors}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('Fatal error:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Run the script
updateTaskCustomFields();
