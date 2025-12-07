/**
 * Check Router #9's firmware field directly in ClickUp task
 */

const clickupClient = require('./src/services/clickupClient');
const { CLICKUP_FIELD_IDS } = require('./src/config/constants');
require('dotenv').config();

async function checkRouter9ClickUp() {
  try {
    const router9 = {
      router_id: '6001810972',
      name: 'Router #9',
      clickup_task_id: '86c6911a7',
      db_firmware: 'RUT2M_R_00.07.18.1'  // From database
    };
    
    console.log('🔍 Checking Router #9 Firmware in ClickUp\n');
    console.log('='.repeat(70));
    console.log('\nRouter Details:');
    console.log('  Router ID:', router9.router_id);
    console.log('  Name:', router9.name);
    console.log('  ClickUp Task ID:', router9.clickup_task_id);
    console.log('  ClickUp Task URL: https://app.clickup.com/t/' + router9.clickup_task_id);
    console.log('  Database Firmware:', router9.db_firmware);
    
    console.log('\n📋 Fetching task from ClickUp...');
    
    const task = await clickupClient.getTask(router9.clickup_task_id);
    
    console.log('\nTask Name:', task.name);
    console.log('Task Status:', task.status?.status || 'N/A');
    
    // Find all relevant custom fields
    const firmwareField = task.custom_fields?.find(
      f => f.id === CLICKUP_FIELD_IDS.FIRMWARE
    );
    const routerIdField = task.custom_fields?.find(
      f => f.id === CLICKUP_FIELD_IDS.ROUTER_ID
    );
    const imeiField = task.custom_fields?.find(
      f => f.id === CLICKUP_FIELD_IDS.IMEI
    );
    
    console.log('\n📊 CUSTOM FIELDS:');
    
    if (routerIdField) {
      console.log('\n  Router ID Field:');
      console.log('    Field ID:', routerIdField.id);
      console.log('    Value:', routerIdField.value || 'NULL');
    }
    
    if (imeiField) {
      console.log('\n  IMEI Field:');
      console.log('    Field ID:', imeiField.id);
      console.log('    Value:', imeiField.value || 'NULL');
    }
    
    if (firmwareField) {
      console.log('\n  Firmware Field:');
      console.log('    Field ID:', firmwareField.id);
      console.log('    Field Name:', firmwareField.name);
      console.log('    Type:', firmwareField.type);
      console.log('    Value:', firmwareField.value || 'NULL');
      console.log('    Type Conf:', JSON.stringify(firmwareField.type_config || {}, null, 2));
    } else {
      console.log('\n  ⚠️  Firmware field not found in task!');
    }
    
    // Compare values
    console.log('\n🔍 COMPARISON:');
    const clickupFirmware = firmwareField?.value;
    console.log(`  Database:         ${router9.db_firmware}`);
    console.log(`  ClickUp:          ${clickupFirmware || 'NULL'}`);
    
    if (clickupFirmware === router9.db_firmware) {
      console.log('\n  ✅ Values MATCH - No issue detected!');
    } else {
      console.log('\n  ❌ VALUES DO NOT MATCH!');
      console.log('\n  ISSUE IDENTIFIED:');
      console.log(`    - Expected (from DB): ${router9.db_firmware}`);
      console.log(`    - Actual (in ClickUp): ${clickupFirmware || 'NULL'}`);
      
      console.log('\n  💡 RECOMMENDATIONS:');
      console.log('    1. Manually sync router to ClickUp:');
      console.log(`       POST /api/clickup/sync-router/${router9.router_id}`);
      console.log('    2. Check recent sync logs for errors');
      console.log('    3. Verify ClickUp field IDs in constants.js');
      console.log('    4. Check if field is read-only or has restrictions');
    }
    
    // Show ALL custom fields for debugging
    console.log('\n📝 ALL CUSTOM FIELDS IN TASK:');
    if (task.custom_fields && task.custom_fields.length > 0) {
      task.custom_fields.forEach(field => {
        console.log(`\n  - ${field.name}:`);
        console.log(`    ID: ${field.id}`);
        console.log(`    Type: ${field.type}`);
        console.log(`    Value: ${field.value || 'NULL'}`);
      });
    } else {
      console.log('  No custom fields found');
    }
    
    console.log('\n' + '='.repeat(70));
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('  Status:', error.response.status);
      console.error('  Data:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('\nStack:', error.stack);
  }
}

checkRouter9ClickUp();

