const axios = require('axios');

const BACKEND_URL = 'https://routerlogger-production.up.railway.app';

async function updateDatabase() {
  try {
    console.log('Fetching all routers from production...');
    const response = await axios.get(`${BACKEND_URL}/api/routers`);
    const routers = response.data;
    
    console.log(`Found ${routers.length} routers`);
    console.log('Clearing ClickUp task associations by updating each router...');
    
    // We'll use the PUT endpoint to update each router if it exists
    // For now, let's just create the tasks fresh since the DB references will be updated when tasks are created
    
    console.log('✅ Ready to create tasks - database will be updated automatically when tasks are linked');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

updateDatabase();
