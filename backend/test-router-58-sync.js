/**
 * Test script to sync Router #58 and show detailed logs
 */

require('dotenv').config();
const { pool, logger } = require('./src/config/database');
const { syncRouterToClickUp } = require('./src/services/clickupSync');

async function testRouter58Sync() {
  try {
    console.log('Fetching Router #58 data from database...');
    
    const result = await pool.query(
      `SELECT 
         r.router_id, 
         r.clickup_task_id, 
         r.imei, 
         r.firmware_version, 
         r.last_seen, 
         r.name,
         (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as current_status
       FROM routers r
       WHERE r.router_id = '6004928162'`
    );
    
    if (result.rows.length === 0) {
      console.error('Router #58 not found!');
      return;
    }
    
    const router = result.rows[0];
    console.log('\nRouter #58 data from database:');
    console.log(JSON.stringify(router, null, 2));
    
    console.log('\nAttempting to sync to ClickUp...\n');
    
    const syncResult = await syncRouterToClickUp(router);
    
    console.log('\nSync result:');
    console.log(JSON.stringify(syncResult, null, 2));
    
    if (syncResult.success) {
      console.log('\n✅ Sync reported success');
    } else {
      console.log('\n❌ Sync reported failure:', syncResult.error);
    }
    
  } catch (error) {
    console.error('Error during sync test:', error);
  } finally {
    await pool.end();
  }
}

testRouter58Sync();
