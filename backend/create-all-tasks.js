const axios = require('axios');

const BACKEND_URL = 'https://routerlogger-production.up.railway.app';
const FRONTEND_URL = 'https://routerlogger-frontend-production.up.railway.app';
const LIST_ID = '901517043586';

const CUSTOM_FIELDS = {
  ROUTER_ID: 'dfe0016c-4ab0-4dd9-bb38-b338411e9b47',
  IMEI: '8b278eb1-ba02-43c7-81d6-0b739c089e7c',
  FIRMWARE: '845f6619-e3ee-4634-b92a-a117f14fb8c7',
  LAST_ONLINE: '684e19a1-06c3-4bfd-94dd-6aca4a9b85fe',
  OPERATIONAL_STATUS: '8a661229-13f0-4693-a7cb-1df86725cfed',
  ROUTER_DASHBOARD: 'b9cf2e41-dc79-4768-985a-bda52b9dad1f'
};

// Operational status dropdown option UUIDs
const STATUS_OPTIONS = {
  ONLINE: 'b256bad4-2f9e-4e98-89b1-77a2a5443337',
  OFFLINE: '7149ad8d-db43-48ab-a038-a17162c7495d',
  MAINTENANCE: '38342970-fdd4-4c9f-bcea-738be4f6e2c5'
};

async function createAllTasks() {
  try {
    console.log('Fetching all routers...');
    const routersRes = await axios.get(`${BACKEND_URL}/api/routers`);
    const routers = routersRes.data;
    console.log(`Found ${routers.length} routers\n`);
    
    let created = 0;
    let errors = 0;
    let skipped = 0;
    
    for (const router of routers) {
      // Skip routers that already have a ClickUp task
      if (router.clickup_task_id) {
        console.log(`⏭️  ${router.router_id.padEnd(12)} - Already has task ${router.clickup_task_id}`);
        skipped++;
        continue;
      }
      
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
      
      const taskData = {
        name: router.name || `Router #${router.router_id}`,
        // status: 'to do',  // Let ClickUp use default status
        priority: 3,
        tags: ['router', 'auto-created'],
        custom_fields: customFields
      };
      
      try {
        const res = await axios.post(
          `${BACKEND_URL}/api/clickup/tasks/${LIST_ID}`,
          taskData
        );
        
        const task = res.data.task;
        const statusText = statusValue === STATUS_OPTIONS.ONLINE ? 'Online' : 'Offline';
        console.log(`✅ ${router.router_id.padEnd(12)} → ${task.id} (${statusText})`);
        
        // Link task to router in database
        await axios.post(`${BACKEND_URL}/api/clickup/link-router`, {
          routerId: router.router_id,
          taskId: task.id,
          taskUrl: task.url
        });
        
        created++;
        
        // Rate limiting delay
        await new Promise(r => setTimeout(r, 300));
        
      } catch (e) {
        const errorData = e.response?.data;
        const errorMsg = errorData?.clickupError?.err || errorData?.error || e.message;
        console.log(`❌ ${router.router_id.padEnd(12)} - ${errorMsg}`);
        if (errors === 0) {
          // Show full details for first error
          console.log('\n=== FIRST ERROR DETAILS ===');
          console.log('Router data:', JSON.stringify(router, null, 2));
          console.log('Task data sent:', JSON.stringify(taskData, null, 2));
          console.log('Response:', JSON.stringify(errorData, null, 2));
          console.log('=========================\n');
        }
        errors++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`SUMMARY:`);
    console.log(`  ✅ Created: ${created}`);
    console.log(`  ⏭️  Skipped (already linked): ${skipped}`);
    console.log(`  ❌ Errors: ${errors}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

createAllTasks();
