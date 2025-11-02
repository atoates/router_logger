/**
 * Check ClickUp Operational Status field configuration
 */

require('dotenv').config();
const axios = require('axios');
const clickupOAuthService = require('./src/services/clickupOAuthService');

async function checkOperationalStatusField() {
  try {
    // Get a valid token
    const token = await clickupOAuthService.getValidToken('default');
    
    if (!token) {
      console.log('No ClickUp OAuth token available');
      return;
    }
    
    // Fetch Router #58's task
    const taskId = '86c6910r3';
    const response = await axios.get(`https://api.clickup.com/api/v2/task/${taskId}`, {
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      }
    });
    
    const task = response.data;
    const opStatusField = task.custom_fields?.find(f => f.name === 'Operational Status');
    
    if (!opStatusField) {
      console.log('Operational Status field not found');
      return;
    }
    
    console.log('\n=== OPERATIONAL STATUS FIELD ===');
    console.log('Field ID:', opStatusField.id);
    console.log('Type:', opStatusField.type);
    console.log('Current Value:', opStatusField.value);
    
    if (opStatusField.type_config?.options) {
      console.log('\n=== DROPDOWN OPTIONS ===');
      opStatusField.type_config.options.forEach(opt => {
        console.log(`  ${opt.name}: ${opt.id} ${opt.color ? `(${opt.color})` : ''}`);
      });
    }
    
    console.log('\n=== CURRENT CODE USES ===');
    console.log('  ONLINE: b256bad4-2f9e-4e98-89b1-77a2a5443337');
    console.log('  OFFLINE: 7149ad8d-db43-48ab-a038-a17162c7495d');
    console.log('  MAINTENANCE: 38342970-fdd4-4c9f-bcea-738be4f6e2c5');
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

checkOperationalStatusField();
