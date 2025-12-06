/**
 * Check Router #98's date_installed field in ClickUp
 * This script will query ClickUp to see if the date_installed custom field is set
 */

const clickupClient = require('./src/services/clickupClient');
const { CLICKUP_FIELD_IDS } = require('./src/config/constants');
require('dotenv').config();

async function checkRouter98() {
  try {
    console.log('Checking Router #98 in ClickUp...\n');
    
    const router98 = {
      router_id: '6006858295',
      location_task_id: '901518472110', // #279 | Unit 44G, Leyton Indsutrial Village, E10 7QE
      location_name: '#279 | Unit 44G, Leyton Indsutrial Village, E10 7QE'
    };
    
    console.log('Router Details:');
    console.log('  Router ID:', router98.router_id);
    console.log('  Location List ID:', router98.location_task_id);
    console.log('  Location Name:', router98.location_name);
    console.log('\nFetching Date Installed custom field from ClickUp...');
    console.log('  Field ID:', CLICKUP_FIELD_IDS.DATE_INSTALLED);
    
    const rawDate = await clickupClient.getListCustomFieldValue(
      router98.location_task_id,
      CLICKUP_FIELD_IDS.DATE_INSTALLED,
      'default'
    );
    
    console.log('\nResult from ClickUp:');
    console.log('  Raw value:', rawDate);
    console.log('  Type:', typeof rawDate);
    
    if (rawDate) {
      const dateInstalled = Number(rawDate);
      const dateObj = new Date(dateInstalled);
      console.log('  Parsed as number:', dateInstalled);
      console.log('  As Date:', dateObj.toISOString());
      console.log('  UK Format:', dateObj.toLocaleDateString('en-GB'));
    } else {
      console.log('\n⚠️  The Date Installed field is NOT set in ClickUp for this location!');
      console.log('  This explains why Router #98 shows "Date not set" in the UI.');
      console.log('\n  To fix this:');
      console.log('  1. Go to ClickUp list: https://app.clickup.com/t/901518472110');
      console.log('  2. Set the "Date Installed" custom field');
      console.log('  3. Run the date sync: POST /api/admin/sync-dates');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('  Status:', error.response.status);
      console.error('  Data:', error.response.data);
    }
  }
}

checkRouter98();

