const axios = require('axios');
const db = require('./src/config/database');

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

const STATUS_OPTIONS = {
  ONLINE: 'b256bad4-2f9e-4e98-89b1-77a2a5443337',
  OFFLINE: '7149ad8d-db43-48ab-a038-a17162c7495d',
  MAINTENANCE: '38342970-fdd4-4c9f-bcea-738be4f6e2c5'
};

async function testCreateTask() {
  try {
    console.log('Fetching test router...');
    const [routers] = await db.query(
      'SELECT * FROM routers LIMIT 1'
    );
    
    if (!routers.length) {
      console.log('No routers found');
      return;
    }
    
    const router = routers[0];
    console.log(`Testing with router: ${router.router_id} (${router.name})`);
    
    const taskName = `Test Router ${router.router_id}`;
    const customFields = [];
    
    // Router ID
    if (router.router_id) {
      customFields.push({
        id: CUSTOM_FIELDS.ROUTER_ID,
        value: router.router_id.toString()
      });
    }
    
    // IMEI
    if (router.imei) {
      customFields.push({
        id: CUSTOM_FIELDS.IMEI,
        value: parseInt(router.imei)
      });
    }
    
    // Router Model
    if (router.model) {
      customFields.push({
        id: CUSTOM_FIELDS.ROUTER_MODEL,
        value: router.model
      });
    }
    
    // Firmware
    if (router.firmware_version) {
      customFields.push({
        id: CUSTOM_FIELDS.FIRMWARE,
        value: router.firmware_version
      });
    }
    
    // Last Online
    if (router.last_connection) {
      const timestamp = new Date(router.last_connection).getTime();
      customFields.push({
        id: CUSTOM_FIELDS.LAST_ONLINE,
        value: timestamp
      });
    }
    
    // Data Usage
    const dataUsageMB = Math.round(
      (router.total_data_sent + router.total_data_received) / 1024 / 1024
    );
    customFields.push({
      id: CUSTOM_FIELDS.DATA_USAGE,
      value: dataUsageMB
    });
    
    // Operational Status
    const hoursSinceLastConnection = router.last_connection 
      ? (Date.now() - new Date(router.last_connection).getTime()) / (1000 * 60 * 60)
      : 9999;
    const statusValue = hoursSinceLastConnection < 24 ? STATUS_OPTIONS.ONLINE : STATUS_OPTIONS.OFFLINE;
    customFields.push({
      id: CUSTOM_FIELDS.OPERATIONAL_STATUS,
      value: statusValue
    });
    
    const taskData = {
      name: taskName,
      status: 'to do',
      priority: 3,
      tags: ['test', 'router'],
      custom_fields: customFields
    };
    
    console.log('\n=== Task Data ===');
    console.log(JSON.stringify(taskData, null, 2));
    
    console.log('\n=== Creating task via backend API ===');
    const response = await axios.post(
      `${BACKEND_URL}/api/clickup/tasks/901517043586`,
      taskData
    );
    
    console.log('\n=== Response ===');
    console.log(JSON.stringify(response.data, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    process.exit(1);
  }
}

testCreateTask();
