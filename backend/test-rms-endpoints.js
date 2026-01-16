const RMSClient = require('./src/services/rmsClient');

(async () => {
  try {
    const client = await RMSClient.createWithAuth();
    console.log('✓ Created RMS client\n');
    
    // Get first device
    console.log('=== Fetching devices ===');
    const devicesResponse = await client.getDevices(3, 0);
    const devices = Array.isArray(devicesResponse) ? devicesResponse : (devicesResponse.data || devicesResponse.items || []);
    
    if (devices.length === 0) {
      console.log('No devices found!');
      return;
    }
    
    const testDevice = devices[0];
    const deviceId = testDevice.id || testDevice.device_id;
    console.log(`Using device: ${deviceId} (${testDevice.name})\n`);
    
    // Test 1: Does /statistics endpoint work?
    console.log('=== Test 1: /statistics endpoint (what we use in fallback) ===');
    try {
      const statsResult = await client.client.get(`/api/devices/${deviceId}/statistics`, {
        params: { from: '2026-01-16T11:00:00Z', to: '2026-01-16T12:30:00Z' }
      });
      console.log('✓ SUCCESS - /statistics works!');
      console.log('Response:', JSON.stringify(statsResult.data).substring(0, 400));
    } catch (e) {
      console.log('✗ FAILED - Status:', e.response?.status, 'Error:', e.response?.data?.errors?.[0]?.message || e.message);
    }
    
    // Test 2: Does /data-usage endpoint exist AT ALL?
    console.log('\n=== Test 2: /data-usage endpoint (404 on all params) ===');
    try {
      const dataUsageResult = await client.client.get(`/api/devices/${deviceId}/data-usage`, {
        params: { start_date: '2026-01-16 11:00:00', end_date: '2026-01-16 12:30:00' }
      });
      console.log('✓ SUCCESS - /data-usage works!');
      console.log('Response:', JSON.stringify(dataUsageResult.data, null, 2));
    } catch (e) {
      console.log('✗ FAILED - Status:', e.response?.status, 'Error:', e.response?.data?.errors?.[0]?.message || e.message);
      console.log('This endpoint may not be available in this RMS API version/plan');
    }
    
    // Test 3: Check OpenAPI spec for available endpoints
    console.log('\n=== Test 3: What endpoints ARE available? ===');
    console.log('Checking OpenAPI spec...');
    const axios = require('axios');
    try {
      const spec = await axios.get('https://api.rms.teltonika-networks.com/openapi/compiled.yaml');
      const specText = spec.data;
      
      const hasDataUsage = specText.includes('/data-usage');
      const hasStatistics = specText.includes('/statistics');
      const hasInformationHistory = specText.includes('/information-history');
      
      console.log('  - /data-usage endpoint in spec:', hasDataUsage);
      console.log('  - /statistics endpoint in spec:', hasStatistics);
      console.log('  - /information-history endpoint in spec:', hasInformationHistory);
    } catch (e) {
      console.log('Could not fetch OpenAPI spec:', e.message);
    }
    
    // Test 4: Try information-history endpoint (might have historical data)
    console.log('\n=== Test 4: /information-history endpoint (may have time-series data) ===');
    try {
      const historyResult = await client.client.get(`/api/devices/${deviceId}/information-history`, {
        params: { from: '2026-01-16T11:00:00Z', to: '2026-01-16T12:30:00Z' }
      });
      console.log('✓ SUCCESS - /information-history works!');
      console.log('Response sample:', JSON.stringify(historyResult.data).substring(0, 600));
    } catch (e) {
      console.log('✗ FAILED - Status:', e.response?.status, 'Error:', e.response?.data?.errors?.[0]?.message || e.message);
    }
    
  } catch (error) {
    console.error('Fatal error:', error.message);
  }
})();
