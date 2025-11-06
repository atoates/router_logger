require('dotenv').config();
const axios = require('axios');

async function testListDates() {
  const listId = '901514224964'; // #197 | Unit 1, Michael Manley Industrial Estate
  
  try {
    // Use the production API endpoint to get list details
    const listResponse = await axios.get(
      `https://routerlogger-production.up.railway.app/api/clickup/list/${listId}`
    );
    
    const list = listResponse.data.list;
    
    console.log('\n=== LIST DETAILS ===');
    console.log('ID:', list.id);
    console.log('Name:', list.name);
    console.log('\n=== DATE FIELDS ===');
    console.log('start_date:', list.start_date);
    console.log('due_date:', list.due_date);
    console.log('end_date:', list.end_date);
    
    // Also check for any other date-related fields
    const dateKeys = Object.keys(list).filter(key => 
      key.toLowerCase().includes('date') || 
      key.toLowerCase().includes('time') ||
      key.toLowerCase().includes('start') ||
      key.toLowerCase().includes('end')
    );
    
    console.log('\n=== ALL DATE-RELATED FIELDS ===');
    dateKeys.forEach(key => {
      console.log(`${key}:`, list[key]);
    });
    
    console.log('\n=== FULL LIST OBJECT ===');
    console.log(JSON.stringify(list, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testListDates();
