/**
 * Update ClickUp task custom fields with router data
 */

const axios = require('axios');

const BACKEND_URL = 'https://routerlogger-production.up.railway.app';

// Custom field IDs from ClickUp
const CUSTOM_FIELDS = {
  OPERATIONAL_STATUS: '8a661229-13f0-4693-a7cb-1df86725cfed',
  ROUTER_MODEL: 'f2cbe126-4e68-4be0-9c3b-fa230d289f51',
  FIRMWARE: '845f6619-e3ee-4634-b92a-a117f14fb8c7',
  LAST_MAINTENANCE_DATE: '49551d31-6e57-4620-af95-32c701e93488',
  IMEI: '8b278eb1-ba02-43c7-81d6-0b739c089e7c',
  ROUTER_ID: 'dfe0016c-4ab0-4dd9-bb38-b338411e9b47',
  LAST_ONLINE: '684e19a1-06c3-4bfd-94dd-6aca4a9b85fe',
  DATA_USAGE: 'c58206db-e995-4717-8e62-d36e15d0a3e2'
};

// Operational status options
const STATUS_OPTIONS = {
  ONLINE: 'b256bad4-2f9e-4e98-89b1-77a2a5443337',
  OFFLINE: '7149ad8d-db43-48ab-a038-a17162c7495d',
  MAINTENANCE: '38342970-fdd4-4c9f-bcea-738be4f6e2c5'
};

async function updateTaskCustomFields() {
  try {
    console.log('Fetching routers with linked tasks...');
    
    const routersRes = await axios.get(`${BACKEND_URL}/api/routers`);
    const routers = routersRes.data.filter(r => r.clickup_task_id);
    
    console.log(`Found ${routers.length} routers with ClickUp tasks`);
    
    let updated = 0;
    let errors = 0;
    
    for (const router of routers) {
      try {
        console.log(`\n📝 Updating task ${router.clickup_task_id} for Router #${router.router_id}`);
        
        // Prepare custom fields data
        const customFields = [];
        
        // Router ID (text)
        customFields.push({
          id: CUSTOM_FIELDS.ROUTER_ID,
          value: router.router_id.toString()
        });
        
        // IMEI (number) - convert IMEI string to number
        if (router.imei) {
          customFields.push({
            id: CUSTOM_FIELDS.IMEI,
            value: parseInt(router.imei) || 0
          });
        }
        
        // Router Model (text)
        if (router.model) {
          customFields.push({
            id: CUSTOM_FIELDS.ROUTER_MODEL,
            value: router.model
          });
        }
        
        // Firmware (long text)
        if (router.firmware_version) {
          customFields.push({
            id: CUSTOM_FIELDS.FIRMWARE,
            value: router.firmware_version
          });
        }
        
        // Last Online (date) - convert to timestamp
        if (router.last_connection) {
          const lastOnline = new Date(router.last_connection).getTime();
          customFields.push({
            id: CUSTOM_FIELDS.LAST_ONLINE,
            value: lastOnline
          });
        }
        
        // Data Usage (number) - total bytes
        if (router.total_data_sent || router.total_data_received) {
          const totalData = (router.total_data_sent || 0) + (router.total_data_received || 0);
          // Convert to MB
          const dataMB = Math.round(totalData / 1024 / 1024);
          customFields.push({
            id: CUSTOM_FIELDS.DATA_USAGE,
            value: dataMB
          });
        }
        
        // Operational Status (dropdown)
        // Determine status based on last connection
        let statusValue = STATUS_OPTIONS.OFFLINE;
        if (router.last_connection) {
          const lastSeen = new Date(router.last_connection);
          const now = new Date();
          const hoursSinceLastSeen = (now - lastSeen) / (1000 * 60 * 60);
          
          if (hoursSinceLastSeen < 24) {
            statusValue = STATUS_OPTIONS.ONLINE;
          }
        }
        
        customFields.push({
          id: CUSTOM_FIELDS.OPERATIONAL_STATUS,
          value: statusValue
        });
        
        // Update task via ClickUp API
        const updateData = {
          custom_fields: customFields
        };
        
        await axios.put(
          `${BACKEND_URL}/api/clickup/task/${router.clickup_task_id}`,
          updateData
        );
        
        console.log(`✅ Updated custom fields for Router #${router.router_id}`);
        console.log(`   - Router ID: ${router.router_id}`);
        console.log(`   - IMEI: ${router.imei || 'N/A'}`);
        console.log(`   - Model: ${router.model || 'N/A'}`);
        console.log(`   - Status: ${statusValue === STATUS_OPTIONS.ONLINE ? 'Online' : 'Offline'}`);
        
        updated++;
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.error(`❌ Error updating task for router ${router.router_id}:`, 
          error.response?.data || error.message);
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
