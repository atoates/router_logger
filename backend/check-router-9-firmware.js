/**
 * Check Router #9's firmware version in both database and ClickUp
 * This script will compare firmware values from:
 * 1. Database routers table
 * 2. Recent router_logs entries
 * 3. ClickUp task custom field
 */

const { pool, logger } = require('./src/config/database');
const clickupClient = require('./src/services/clickupClient');
const { CLICKUP_FIELD_IDS } = require('./src/config/constants');
require('dotenv').config();

async function checkRouter9Firmware() {
  try {
    console.log('🔍 Checking Router #9 Firmware Information\n');
    console.log('='.repeat(70));
    
    // 1. Get router data from database
    const routerQuery = await pool.query(`
      SELECT 
        router_id,
        name,
        firmware_version as db_firmware,
        clickup_task_id,
        clickup_task_url,
        last_seen,
        created_at
      FROM routers
      WHERE router_id = '9'
    `);
    
    if (routerQuery.rows.length === 0) {
      console.log('❌ Router #9 not found in database!');
      await pool.end();
      return;
    }
    
    const router = routerQuery.rows[0];
    console.log('\n📊 DATABASE - routers table:');
    console.log('  Router ID:', router.router_id);
    console.log('  Name:', router.name || 'N/A');
    console.log('  Firmware (routers.firmware_version):', router.db_firmware || 'NULL');
    console.log('  ClickUp Task ID:', router.clickup_task_id || 'Not linked');
    console.log('  ClickUp Task URL:', router.clickup_task_url || 'N/A');
    console.log('  Last Seen:', router.last_seen ? new Date(router.last_seen).toISOString() : 'N/A');
    
    // 2. Get recent firmware values from logs
    const logsQuery = await pool.query(`
      SELECT 
        timestamp,
        firmware_version,
        status
      FROM router_logs
      WHERE router_id = '9'
      AND firmware_version IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT 10
    `);
    
    console.log('\n📝 DATABASE - Recent router_logs with firmware:');
    if (logsQuery.rows.length === 0) {
      console.log('  ⚠️  No logs with firmware_version found');
    } else {
      console.log(`  Found ${logsQuery.rows.length} recent logs with firmware:\n`);
      logsQuery.rows.forEach((log, idx) => {
        console.log(`  ${idx + 1}. ${new Date(log.timestamp).toISOString()}`);
        console.log(`     Firmware: ${log.firmware_version}`);
        console.log(`     Status: ${log.status}\n`);
      });
      
      // Check if firmware values are consistent
      const uniqueFirmwares = [...new Set(logsQuery.rows.map(l => l.firmware_version))];
      if (uniqueFirmwares.length > 1) {
        console.log('  ⚠️  MULTIPLE FIRMWARE VERSIONS DETECTED:');
        uniqueFirmwares.forEach(fw => console.log(`     - ${fw}`));
      } else {
        console.log(`  ✅ Consistent firmware in logs: ${uniqueFirmwares[0]}`);
      }
    }
    
    // 3. Check ClickUp if task is linked
    if (router.clickup_task_id) {
      console.log('\n📋 CLICKUP - Task custom field:');
      console.log(`  Fetching firmware from task ${router.clickup_task_id}...`);
      
      try {
        // Get the full task to see the firmware field
        const task = await clickupClient.getTask(router.clickup_task_id);
        
        const firmwareField = task.custom_fields?.find(
          f => f.id === CLICKUP_FIELD_IDS.FIRMWARE
        );
        
        if (firmwareField) {
          console.log('  Field ID:', firmwareField.id);
          console.log('  Field Name:', firmwareField.name);
          console.log('  Current Value:', firmwareField.value || 'NULL/Empty');
          console.log('  Type:', firmwareField.type);
        } else {
          console.log('  ⚠️  Firmware field not found in task custom fields');
        }
        
        // Compare values
        console.log('\n🔄 COMPARISON:');
        const dbFirmware = router.db_firmware;
        const latestLogFirmware = logsQuery.rows[0]?.firmware_version;
        const clickupFirmware = firmwareField?.value;
        
        console.log(`  Database (routers table):      ${dbFirmware || 'NULL'}`);
        console.log(`  Latest Log:                    ${latestLogFirmware || 'NULL'}`);
        console.log(`  ClickUp Task:                  ${clickupFirmware || 'NULL'}`);
        
        // Identify discrepancies
        const allSame = dbFirmware === latestLogFirmware && latestLogFirmware === clickupFirmware;
        
        if (allSame) {
          console.log('\n  ✅ All sources match!');
        } else {
          console.log('\n  ❌ MISMATCH DETECTED!');
          
          if (dbFirmware !== latestLogFirmware) {
            console.log(`\n  Issue 1: Database routers.firmware_version doesn't match latest log`);
            console.log(`           DB: ${dbFirmware || 'NULL'}`);
            console.log(`           Log: ${latestLogFirmware || 'NULL'}`);
          }
          
          if (latestLogFirmware !== clickupFirmware) {
            console.log(`\n  Issue 2: ClickUp firmware doesn't match latest log`);
            console.log(`           Log: ${latestLogFirmware || 'NULL'}`);
            console.log(`           ClickUp: ${clickupFirmware || 'NULL'}`);
          }
          
          if (dbFirmware !== clickupFirmware) {
            console.log(`\n  Issue 3: ClickUp firmware doesn't match database`);
            console.log(`           DB: ${dbFirmware || 'NULL'}`);
            console.log(`           ClickUp: ${clickupFirmware || 'NULL'}`);
          }
        }
        
        // Recommendations
        console.log('\n💡 RECOMMENDATIONS:');
        if (!allSame) {
          console.log('  1. Check when firmware was last updated in each location');
          console.log('  2. Run a manual sync to update ClickUp:');
          console.log(`     POST /api/clickup/sync-router/${router.router_id}`);
          console.log('  3. If database is stale, check telemetry processor');
          console.log('  4. Review recent router_logs to see when firmware changed');
        } else {
          console.log('  All values match - no action needed!');
        }
        
      } catch (clickupError) {
        console.error('\n❌ Error fetching from ClickUp:', clickupError.message);
        if (clickupError.response) {
          console.error('  Status:', clickupError.response.status);
          console.error('  Data:', JSON.stringify(clickupError.response.data, null, 2));
        }
      }
    } else {
      console.log('\n⚠️  Router #9 is not linked to a ClickUp task');
      console.log('  Cannot check ClickUp firmware value');
    }
    
    await pool.end();
    console.log('\n' + '='.repeat(70));
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkRouter9Firmware();

