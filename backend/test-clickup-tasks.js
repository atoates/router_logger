/**
 * Test script to explore ClickUp API for fetching tasks within lists
 * This helps us understand the hierarchy: List (Location) -> Task (Property)
 */

const axios = require('axios');
const { Pool } = require('pg');

async function testClickUpAPI() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Get the OAuth token
    const tokenResult = await pool.query("SELECT access_token FROM clickup_oauth WHERE user_id = 'default'");
    if (!tokenResult.rows.length) {
      console.log('No ClickUp token found');
      return;
    }
    
    const token = tokenResult.rows[0].access_token;
    const client = axios.create({
      baseURL: 'https://api.clickup.com/api/v2',
      headers: { Authorization: token }
    });
    
    // First get workspaces
    const workspacesRes = await client.get('/team');
    const workspaceId = workspacesRes.data.teams[0].id;
    console.log('Workspace ID:', workspaceId);
    
    // Get spaces
    const spacesRes = await client.get(`/team/${workspaceId}/space`);
    const spaces = spacesRes.data.spaces;
    console.log('\nSpaces:', spaces.map(s => ({ id: s.id, name: s.name })));
    
    // Find Active Accounts space
    const activeSpace = spaces.find(s => s.name.includes('Active'));
    const spaceId = activeSpace?.id || spaces[0].id;
    console.log('\nUsing Space:', activeSpace?.name || spaces[0].name, '(ID:', spaceId, ')');
    
    // Get folderless lists in the space
    const listsRes = await client.get(`/space/${spaceId}/list`, { params: { archived: false } });
    const allLists = listsRes.data.lists;
    console.log('\nTotal Lists (Locations):', allLists.length);
    console.log('\nFirst 5 Lists:');
    allLists.slice(0, 5).forEach(l => console.log(`  - ${l.name} (ID: ${l.id}, Tasks: ${l.task_count})`));
    
    // Pick a list with tasks and fetch tasks from it
    const listWithTasks = allLists.find(l => l.task_count > 0);
    if (listWithTasks) {
      console.log('\n' + '='.repeat(60));
      console.log('Fetching Tasks from List:', listWithTasks.name);
      console.log('='.repeat(60));
      
      const tasksRes = await client.get(`/list/${listWithTasks.id}/task`, { 
        params: { archived: false, page: 0 } 
      });
      const tasks = tasksRes.data.tasks;
      console.log('\nTasks (Properties) found:', tasks.length);
      
      tasks.slice(0, 5).forEach(t => {
        console.log(`\n  Task: ${t.name}`);
        console.log(`    ID: ${t.id}`);
        console.log(`    Status: ${t.status?.status}`);
        console.log(`    URL: ${t.url}`);
        if (t.custom_fields?.length) {
          console.log(`    Custom Fields: ${t.custom_fields.length}`);
        }
      });
      
      // Show one task in full detail
      if (tasks.length > 0) {
        console.log('\n' + '='.repeat(60));
        console.log('FULL TASK OBJECT (first task):');
        console.log('='.repeat(60));
        console.log(JSON.stringify(tasks[0], null, 2));
      }
    } else {
      console.log('\nNo lists with tasks found');
    }
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  } finally {
    await pool.end();
  }
}

testClickUpAPI();
