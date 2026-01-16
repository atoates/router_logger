const RMSClient = require('./src/services/rmsClient');

(async () => {
  try {
    const client = await RMSClient.createWithAuth();
    console.log('✓ Created RMS client\n');
    
    // First, get all devices to see what IDs exist
    console.log('=== Fetching all devices ===');
    const devicesResponse = await client.getDevices(5, 0);
    const devices = Array.isArray(devicesResponse) ? devicesResponse : (devicesResponse.data || devicesResponse.items || []);
    
    console.log(`Found ${devices.length} devices:`);
    devices.forEach((d, i) => {
      console.log(`  ${i+1}. ID: ${d.id || d.device_id}, Name: ${d.name}, Serial: ${d.serial_number}`);
    });
    
    if (devices.length === 0) {
      console.log('No devices found!');
      return;
    }
    
    // Use the first device
    const testDevice = devices[0];
    const deviceId = testDevice.id || testDevice.device_id;
    console.log(`\n=== Testing with device ${deviceId} (${testDevice.name}) ===\n`);
    
    // Test different parameter combinations
    const tests = [
      {
        name: 'Current code (from/to with ISO)',
        params: { from: '2026-01-16T11:00:00Z', to: '2026-01-16T12:30:00Z' }
      },
      {
        name: 'API spec (start_date/end_date with Y-m-d H:i:s)',
        params: { start_date: '2026-01-16 11:00:00', end_date: '2026-01-16 12:30:00' }
      },
      {
        name: 'Try without time (just dates)',
        params: { start_date: '2026-01-16', end_date: '2026-01-16' }
      },
      {
        name: 'Today range',
        params: { start_date: '2026-01-16 00:00:00', end_date: '2026-01-16 23:59:59' }
      }
    ];
    
    for (const test of tests) {
      console.log(`\n=== ${test.name} ===`);
      console.log('Params:', JSON.stringify(test.params));
      try {
        const result = await client.client.get(`/api/devices/${deviceId}/data-usage`, {
          params: test.params
        });
        console.log('✓ SUCCESS!');
        console.log('Response:', JSON.stringify(result.data, null, 2).substring(0, 800));
      } catch (e) {
        console.log('✗ FAILED');
        console.log('Status:', e.response?.status);
        console.log('Error:', JSON.stringify(e.response?.data));
      }
    }
    
  } catch (error) {
    console.error('Fatal error:', error.message);
    console.error(error.stack);
  }
})();
