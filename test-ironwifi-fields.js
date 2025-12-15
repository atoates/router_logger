require('dotenv').config();
const axios = require('axios');
const https = require('https');

const API_KEY = process.env.IRONWIFI_API_KEY;
const API_URL = process.env.IRONWIFI_API_URL || 'https://console.ironwifi.com/api';

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.IRONWIFI_REJECT_UNAUTHORIZED !== 'false'
});

async function testAPI() {
  console.log('Testing IronWifi API for guest fields...\n');
  console.log('API URL:', API_URL);
  
  const client = axios.create({
    baseURL: API_URL,
    timeout: 30000,
    httpsAgent,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  try {
    // Fetch first page of guests
    const response = await client.get('/guests', { params: { page: 1, page_size: 5 } });
    const guests = response.data._embedded?.users || [];
    
    console.log(`\nFetched ${guests.length} guests\n`);
    
    if (guests.length > 0) {
      console.log('=== SAMPLE GUEST FIELDS ===');
      const sample = guests[0];
      console.log('\nAll fields in first guest:');
      Object.keys(sample).forEach(key => {
        console.log(`  ${key}: ${JSON.stringify(sample[key])}`);
      });
      
      // Check for specific fields we need
      console.log('\n=== CHECKING FOR MAC FIELDS ===');
      const macFields = ['client_mac', 'ap_mac', 'mac', 'mac_address', 'calling_station_id', 'called_station_id', 
                         'venue_id', 'captive_portal_name', 'public_ip', 'mobilephone'];
      macFields.forEach(field => {
        const value = sample[field];
        console.log(`  ${field}: ${value !== undefined ? JSON.stringify(value) : '(not present)'}`);
      });
    }
  } catch (error) {
    console.error('Error:', error.response?.status, error.response?.data || error.message);
  }
}

testAPI();
