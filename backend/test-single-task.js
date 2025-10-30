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

const STATUS_OPTIONS = {
  ONLINE: 0,      // orderindex 0
  OFFLINE: 1,     // orderindex 1
  MAINTENANCE: 2  // orderindex 2
};

async function testCreateTask() {
  try {
    const taskName = `Test Router 9999999`;
    const customFields = [
      {
        id: CUSTOM_FIELDS.ROUTER_ID,
        value: '9999999'
      },
      {
        id: CUSTOM_FIELDS.IMEI,
        value: 123456789012345
      },
      {
        id: CUSTOM_FIELDS.ROUTER_MODEL,
        value: 'RUT200'
      },
      {
        id: CUSTOM_FIELDS.FIRMWARE,
        value: 'RUT2_R_00.07.06.6'
      },
      {
        id: CUSTOM_FIELDS.LAST_ONLINE,
        value: Date.now()
      },
      {
        id: CUSTOM_FIELDS.DATA_USAGE,
        value: 1500
      },
      {
        id: CUSTOM_FIELDS.OPERATIONAL_STATUS,
        value: STATUS_OPTIONS.ONLINE
      }
    ];
    
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
    console.log(`Task ID: ${response.data.task.id}`);
    console.log(`Task Name: ${response.data.task.name}`);
    console.log(`Custom Fields: ${JSON.stringify(response.data.task.custom_fields, null, 2)}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testCreateTask();
