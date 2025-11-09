/**
 * Test script to check ClickUp status format
 * Run with: node backend/test-clickup-status.js
 */

require('dotenv').config();
const { pool, logger } = require('./src/config/database');
const clickupClient = require('./src/services/clickupClient');

async function testClickUpStatus() {
  try {
    console.log('\n=== Testing ClickUp Status Format ===\n');
    
    // Get a router with a ClickUp task linked
    const result = await pool.query(
      `SELECT router_id, name, clickup_task_id, clickup_task_status 
       FROM routers 
       WHERE clickup_task_id IS NOT NULL 
       LIMIT 1`
    );
    
    if (result.rows.length === 0) {
      console.log('❌ No routers with ClickUp tasks found');
      process.exit(1);
    }
    
    const router = result.rows[0];
    console.log('📍 Testing with router:', {
      id: router.router_id,
      name: router.name,
      taskId: router.clickup_task_id,
      currentStatus: router.clickup_task_status
    });
    
    // Fetch the task from ClickUp
    console.log('\n📥 Fetching task from ClickUp...');
    const task = await clickupClient.getTask(router.clickup_task_id, 'default');
    
    console.log('\n✅ Task retrieved successfully!');
    console.log('\n📊 Status information:');
    console.log('Status object:', JSON.stringify(task.status, null, 2));
    
    // Show all available statuses
    if (task.status && task.status.type) {
      console.log('\n📋 Available statuses for this list:');
      
      // Try to get list info to see all statuses
      const listId = task.list?.id;
      if (listId) {
        console.log('List ID:', listId);
        // Note: We'd need to implement a getListStatuses method to see all available statuses
      }
    }
    
    console.log('\n✨ Test complete!\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    await pool.end();
    process.exit(0);
  }
}

testClickUpStatus();
