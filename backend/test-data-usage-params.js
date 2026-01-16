const RMSClient = require('./src/services/rmsClient');

(async () => {
  try {
    const client = await RMSClient.createWithAuth();
    console.log('✓ Created RMS client');
    
    // Test device
    const deviceId = 6006859018;
    
    // Test 1: WRONG parameters (what we're currently using - from/to with ISO format)
    console.log('\n=== Test 1: WRONG parameters (from/to) ===');
    try {
      const wrongResult = await client.client.get(`/api/devices/${deviceId}/data-usage`, {
        params: { 
          from: '2026-01-16T11:00:00.000Z', 
          to: '2026-01-16T12:30:00.000Z' 
        }
      });
      console.log('SUCCESS - Result:', JSON.stringify(wrongResult.data, null, 2).substring(0, 500));
    } catch (e) {
      console.log('FAILED - Status:', e.response?.status, 'Data:', JSON.stringify(e.response?.data));
    }
    
    // Test 2: CORRECT parameters (start_date/end_date with Y-m-d H:i:s format)
    console.log('\n=== Test 2: CORRECT parameters (start_date/end_date) ===');
    try {
      const correctResult = await client.client.get(`/api/devices/${deviceId}/data-usage`, {
        params: { 
          start_date: '2026-01-16 11:00:00', 
          end_date: '2026-01-16 12:30:00' 
        }
      });
      console.log('SUCCESS - Result:', JSON.stringify(correctResult.data, null, 2).substring(0, 1000));
    } catch (e) {
      console.log('FAILED - Status:', e.response?.status, 'Data:', JSON.stringify(e.response?.data));
    }

    // Test 3: Try with broader time range to see if we can get historical data
    console.log('\n=== Test 3: Historical data from 11:15 to 12:20 ===');
    try {
      const historicalResult = await client.client.get(`/api/devices/${deviceId}/data-usage`, {
        params: { 
          start_date: '2026-01-16 11:15:00', 
          end_date: '2026-01-16 12:20:00' 
        }
      });
      console.log('SUCCESS - Result:', JSON.stringify(historicalResult.data, null, 2));
    } catch (e) {
      console.log('FAILED - Status:', e.response?.status, 'Data:', JSON.stringify(e.response?.data));
    }
    
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
})();
