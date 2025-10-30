/**
 * Bulk create ClickUp tasks for all routers with custom fields
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
// Dropdown values use index, not option ID
const STATUS_OPTIONS = {
  ONLINE: 0,      // orderindex 0
  OFFLINE: 1,     // orderindex 1
  MAINTENANCE: 2  // orderindex 2
};

async function createRouterTasks() {
  try {
    console.log('Fetching routers...');
    
    // Get all routers from API
    const routersRes = await axios.get(`${BACKEND_URL}/api/routers`);
    const routers = routersRes.data;
    console.log(`Found ${routers.length} routers`);
    
    // Get workspace and list info
    console.log('\nGetting ClickUp workspace info...');
    const workspacesRes = await axios.get(`${BACKEND_URL}/api/clickup/workspaces`);
    const workspace = workspacesRes.data.workspaces[0];
    console.log(`Workspace: ${workspace.name} (${workspace.id})`);
    
    const listRes = await axios.get(`${BACKEND_URL}/api/clickup/lists/${workspace.id}`);
    const routersList = listRes.data.list;
    console.log(`List: ${routersList.name} (${routersList.id})`);
    
    // Create tasks for routers that don't have one
    let created = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const router of routers) {
      if (router.clickup_task_id) {
        console.log(`⏭️  Router ${router.router_id} already has task ${router.clickup_task_id}`);
        skipped++;
        continue;
      }
      
      try {
        const taskName = router.name || `Router #${router.router_id}`;
        
        console.log(`\n📝 Creating task for: ${taskName}`);
        
        // Prepare custom fields
        const customFields = [];
        
        // Router ID (text)
        customFields.push({
          id: CUSTOM_FIELDS.ROUTER_ID,
          value: router.router_id.toString()
        });
        
        // IMEI (number)
        if (router.imei) {
          customFields.push({
            id: CUSTOM_FIELDS.IMEI,
            value: parseInt(router.imei) || 0
          });
        }
        
        // Firmware (long text)
        if (router.firmware_version) {
          customFields.push({
            id: CUSTOM_FIELDS.FIRMWARE,
            value: router.firmware_version
          });
        }
        
        // Last Online (date) - convert to timestamp in milliseconds
        if (router.last_connection) {
          const lastOnline = new Date(router.last_connection).getTime();
          customFields.push({
            id: CUSTOM_FIELDS.LAST_ONLINE,
            value: lastOnline
          });
        }
        
        // Data Usage (number) - total in MB
        if (router.total_data_sent || router.total_data_received) {
          const totalData = (router.total_data_sent || 0) + (router.total_data_received || 0);
          const dataMB = Math.round(totalData / 1024 / 1024);
          customFields.push({
            id: CUSTOM_FIELDS.DATA_USAGE,
            value: dataMB
          });
        }
        
        // Operational Status (dropdown) - based on last connection
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
        
        // Task data (no description)
        const taskData = {
          name: taskName,
          status: 'to do',
          priority: 3,
          tags: ['router', 'auto-created'],
          custom_fields: customFields
        };
        
        // Create task via API
        const createRes = await axios.post(
          `${BACKEND_URL}/api/clickup/tasks/${routersList.id}`,
          taskData
        );
        
        const task = createRes.data.task;
        console.log(`✅ Created task: ${task.id} - ${task.name}`);
        console.log(`   - Router ID: ${router.router_id}`);
        console.log(`   - IMEI: ${router.imei || 'N/A'}`);
        console.log(`   - Firmware: ${router.firmware_version || 'N/A'}`);
        console.log(`   - Status: ${statusValue === STATUS_OPTIONS.ONLINE ? 'Online' : 'Offline'}`);
        console.log(`   - Data Usage: ${customFields.find(f => f.id === CUSTOM_FIELDS.DATA_USAGE)?.value || 0} MB`);
        
        // Link task to router
        await axios.post(`${BACKEND_URL}/api/clickup/link-router`, {
          routerId: router.router_id,
          taskId: task.id,
          taskUrl: task.url
        });
        
        console.log(`🔗 Linked task to router ${router.router_id}`);
        created++;
        
        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.error(`❌ Error creating task for router ${router.router_id}:`, error.response?.data || error.message);
        errors++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY:');
    console.log(`✅ Created: ${created}`);
    console.log(`⏭️  Skipped (already exists): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('Fatal error:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Run the script
createRouterTasks();
