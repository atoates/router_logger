// Quick test script to see what RMS actually returns - try different auth formats
require('dotenv').config();
const axios = require('axios');

const deviceId = '1924954';
const companyId = '102229'; // from your screenshot
const token = process.env.RMS_ACCESS_TOKEN;

console.log(`Token (first 20 chars): ${token?.substring(0, 20)}...`);

async function testAuthFormat(authHeader) {
  console.log(`\n===== Testing with auth: ${authHeader.substring(0, 50)}... =====`);
  
  const client = axios.create({
    baseURL: 'https://api.rms.teltonika-networks.com',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    timeout: 15000
  });

  try {
    console.log('GET /api/devices?limit=2');
    const devices = await client.get(`/api/devices`, { params: { limit: 2 } });
    console.log('SUCCESS! Response:');
    console.log(JSON.stringify(devices.data, null, 2).substring(0, 1500));
    return true;
  } catch (e) {
    console.error('FAILED:', e.response?.status, JSON.stringify(e.response?.data || e.message).substring(0, 200));
    return false;
  }
}

async function test() {
  // Try different auth header formats
  const formats = [
    `Bearer ${token}`,
    `Token ${token}`,
    token,
    `PersonalAccessToken ${token}`
  ];

  for (const format of formats) {
    const success = await testAuthFormat(format);
    if (success) {
      console.log('\n✅ Found working auth format!');
      break;
    }
  }
}

test().catch(console.error);
