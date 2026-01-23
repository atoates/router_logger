/**
 * Migration Script: Convert list-based location links to task-based links
 * 
 * Current: Routers are linked to ClickUp LIST IDs (e.g., "901506769295")
 * New: Routers will be linked to ClickUp TASK IDs (e.g., "86c2xfpaa")
 * 
 * The script:
 * 1. Finds all routers with list-based links (numeric IDs)
 * 2. For each list, fetches the tasks inside
 * 3. Picks the first task with a matching property number (e.g., #37.1 for list #37)
 * 4. Updates the router to point to the task ID instead
 * 
 * Usage: railway run node migrate-list-to-task-links.js [--dry-run]
 */

const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Check for dry-run mode
const DRY_RUN = process.argv.includes('--dry-run');

async function getClickUpToken() {
  const result = await pool.query("SELECT access_token FROM clickup_oauth_tokens LIMIT 1");
  if (!result.rows.length) {
    throw new Error('No ClickUp token found in database');
  }
  return result.rows[0].access_token;
}

async function getTasksFromList(client, listId) {
  try {
    const response = await client.get(`/list/${listId}/task`, {
      params: { archived: false, page: 0 }
    });
    return response.data.tasks || [];
  } catch (error) {
    console.error(`  Error fetching tasks from list ${listId}:`, error.response?.data?.err || error.message);
    return [];
  }
}

function extractPropertyNumber(name) {
  // Extract property number from names like "#37 | SUITE 16..." or "#37.1 | SUITE 16..."
  const match = name.match(/#(\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}

function isListId(id) {
  // List IDs are purely numeric (e.g., "901506769295")
  // Task IDs are alphanumeric (e.g., "86c2xfpaa")
  return /^[0-9]+$/.test(id);
}

async function migrateRouterLinks() {
  console.log('='.repeat(60));
  console.log('Migration: Convert List-based Links to Task-based Links');
  console.log(DRY_RUN ? '*** DRY RUN MODE - No changes will be made ***' : '*** LIVE MODE - Changes will be applied ***');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Get ClickUp token
    const token = await getClickUpToken();
    const client = axios.create({
      baseURL: 'https://api.clickup.com/api/v2',
      headers: { Authorization: token }
    });

    // Get all routers with list-based links (numeric IDs only)
    const result = await pool.query(
      `SELECT router_id, name, clickup_location_task_id, clickup_location_task_name 
       FROM routers 
       WHERE clickup_location_task_id IS NOT NULL`
    );

    const routers = result.rows;
    const listBasedRouters = routers.filter(r => isListId(r.clickup_location_task_id));
    
    console.log(`Total routers with location links: ${routers.length}`);
    console.log(`Routers with list-based links (need migration): ${listBasedRouters.length}`);
    console.log(`Routers already task-based (no migration needed): ${routers.length - listBasedRouters.length}`);
    console.log('');

    if (listBasedRouters.length === 0) {
      console.log('✅ No migration needed - all links are already task-based!');
      return;
    }

    // Group routers by list ID to minimize API calls
    const routersByList = {};
    for (const router of listBasedRouters) {
      const listId = router.clickup_location_task_id;
      if (!routersByList[listId]) {
        routersByList[listId] = [];
      }
      routersByList[listId].push(router);
    }

    const listIds = Object.keys(routersByList);
    console.log(`Unique lists to process: ${listIds.length}`);
    console.log('');

    let migrated = 0;
    let failed = 0;
    let skipped = 0;
    const results = [];

    for (let i = 0; i < listIds.length; i++) {
      const listId = listIds[i];
      const routersForList = routersByList[listId];
      const firstRouter = routersForList[0];
      
      console.log(`[${i + 1}/${listIds.length}] Processing list: ${firstRouter.clickup_location_task_name || listId}`);
      
      // Fetch tasks from the list
      const tasks = await getTasksFromList(client, listId);
      
      if (tasks.length === 0) {
        console.log(`  ⚠️  No tasks found in list, skipping ${routersForList.length} router(s)`);
        skipped += routersForList.length;
        results.push(...routersForList.map(r => ({ 
          router_id: r.router_id, 
          status: 'skipped', 
          reason: 'No tasks in list' 
        })));
        continue;
      }

      // Extract property number from list name (e.g., "#37" from "#37 | SUITE 16...")
      const listPropertyNum = extractPropertyNumber(firstRouter.clickup_location_task_name || '');
      
      // Find the best matching task
      // Priority: 1) Exact property number match (e.g., #37.1), 2) First task
      let selectedTask = tasks[0]; // Default to first task
      
      if (listPropertyNum) {
        // Look for a task with property number like #37.1 (sub-property)
        const subPropertyTask = tasks.find(t => {
          const taskPropNum = extractPropertyNumber(t.name);
          return taskPropNum && taskPropNum.startsWith(listPropertyNum + '.');
        });
        
        if (subPropertyTask) {
          selectedTask = subPropertyTask;
          console.log(`  ✓ Found sub-property task: ${selectedTask.name.substring(0, 50)}...`);
        } else {
          // Look for exact match
          const exactMatch = tasks.find(t => {
            const taskPropNum = extractPropertyNumber(t.name);
            return taskPropNum === listPropertyNum;
          });
          if (exactMatch) {
            selectedTask = exactMatch;
          }
          console.log(`  ✓ Using task: ${selectedTask.name.substring(0, 50)}...`);
        }
      }

      // Update all routers linked to this list
      for (const router of routersForList) {
        try {
          if (!DRY_RUN) {
            await pool.query(
              `UPDATE routers 
               SET clickup_location_task_id = $1, clickup_location_task_name = $2
               WHERE router_id = $3`,
              [selectedTask.id, selectedTask.name, router.router_id]
            );
          }
          
          console.log(`  ✅ Router ${router.router_id}: ${router.name || 'Unknown'}`);
          console.log(`     Old: ${listId} (list)`);
          console.log(`     New: ${selectedTask.id} (task)`);
          
          results.push({
            router_id: router.router_id,
            router_name: router.name,
            old_list_id: listId,
            new_task_id: selectedTask.id,
            new_task_name: selectedTask.name,
            status: 'migrated'
          });
          migrated++;
        } catch (error) {
          console.log(`  ❌ Router ${router.router_id}: ${error.message}`);
          results.push({
            router_id: router.router_id,
            status: 'failed',
            error: error.message
          });
          failed++;
        }
      }

      // Rate limiting delay between lists
      if (i < listIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Migration Summary');
    console.log('='.repeat(60));
    console.log(`Migrated: ${migrated}`);
    console.log(`Failed:   ${failed}`);
    console.log(`Skipped:  ${skipped}`);
    console.log('');
    
    if (DRY_RUN) {
      console.log('🔍 This was a DRY RUN. No changes were made.');
      console.log('   Run without --dry-run to apply changes.');
    } else {
      console.log('✅ Migration complete!');
    }

    // Output detailed results as JSON for debugging
    if (process.argv.includes('--json')) {
      console.log('\nDetailed Results (JSON):');
      console.log(JSON.stringify(results, null, 2));
    }

  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

migrateRouterLinks().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
