require('dotenv').config();
const { Pool } = require('pg');
const clickupClient = require('./src/services/clickupClient');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') 
    ? { rejectUnauthorized: false } 
    : false
});

const DATE_INSTALLED_FIELD_ID = '9f31c21a-630d-49f2-8a79-354de03e24d1';

async function syncDateInstalled() {
  try {
    // Get all routers with location assignments
    const result = await pool.query(
      `SELECT router_id, clickup_location_task_id 
       FROM routers 
       WHERE clickup_location_task_id IS NOT NULL`
    );
    
    console.log(`Found ${result.rows.length} routers with location assignments`);
    
    let updated = 0;
    let failed = 0;
    
    for (const router of result.rows) {
      try {
        // Fetch date_installed from ClickUp
        const rawDate = await clickupClient.getListCustomFieldValue(
          router.clickup_location_task_id,
          DATE_INSTALLED_FIELD_ID,
          'default'
        );
        
        const dateInstalled = rawDate ? Number(rawDate) : null;
        
        // Update database
        await pool.query(
          `UPDATE routers 
           SET date_installed = $1 
           WHERE router_id = $2`,
          [dateInstalled, router.router_id]
        );
        
        console.log(`Updated router ${router.router_id}`, { 
          date_installed: dateInstalled ? new Date(dateInstalled).toISOString() : null 
        });
        updated++;
        
        // Add 200ms delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`Failed to sync date for router ${router.router_id}:`, error.message);
        failed++;
      }
    }
    
    console.log('Sync completed', { updated, failed, total: result.rows.length });
    
  } catch (error) {
    console.error('Sync failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

syncDateInstalled()
  .then(() => {
    console.log('Sync completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Sync failed:', error);
    process.exit(1);
  });
