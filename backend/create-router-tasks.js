/**
 * Bulk create ClickUp tasks for all routers
 */

const axios = require('axios');

const BACKEND_URL = 'https://routerlogger-production.up.railway.app';

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
        const description = `
**Router Details:**
- Router ID: ${router.router_id}
- IMEI: ${router.imei || 'N/A'}
- Model: ${router.model || 'N/A'}
- Serial Number: ${router.serial_number || 'N/A'}

[View in RouterLogger Dashboard](https://routerlogger-frontend-production.up.railway.app/router/${router.router_id})
        `.trim();
        
        console.log(`\n📝 Creating task for: ${taskName}`);
        
        const taskData = {
          name: taskName,
          description: description,
          markdown_description: description,
          status: 'to do',
          priority: 3, // Normal priority
          tags: ['router', 'auto-created']
        };
        
        // Create task via API
        const createRes = await axios.post(
          `${BACKEND_URL}/api/clickup/tasks/${routersList.id}`,
          taskData
        );
        
        const task = createRes.data.task;
        console.log(`✅ Created task: ${task.id} - ${task.name}`);
        
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
