/**
 * Test script for router-property tracking
 * Demonstrates how to use the property assignment API
 */

const axios = require('axios');

const BACKEND_URL = 'https://routerlogger-production.up.railway.app';

async function testPropertyTracking() {
  try {
    console.log('🧪 Testing Router-Property Tracking API\n');
    console.log('='.repeat(60));

    // Example 1: Assign a router to a property
    console.log('\n1️⃣  Assigning Router #1 to a property...');
    
    const assignResponse = await axios.post(`${BACKEND_URL}/api/router-properties/assign`, {
      routerId: '6001747099',
      propertyTaskId: 'property123',  // Replace with actual ClickUp property task ID
      propertyName: 'Beach House #42',
      installedAt: new Date().toISOString(),
      installedBy: 'John Doe',
      notes: 'Installed on roof, good signal'
    });
    
    console.log('✅ Assignment successful!');
    console.log(`   Property: ${assignResponse.data.assignment.property_name}`);
    console.log(`   Installed: ${new Date(assignResponse.data.assignment.installed_at).toLocaleString()}`);

    // Example 2: Get current property for a router
    console.log('\n2️⃣  Getting current property for Router #1...');
    
    const currentResponse = await axios.get(`${BACKEND_URL}/api/router-properties/6001747099/current`);
    
    if (currentResponse.data.assigned) {
      console.log('✅ Router is currently assigned:');
      console.log(`   Property: ${currentResponse.data.property_name}`);
      console.log(`   Days installed: ${currentResponse.data.daysSinceInstalled}`);
    } else {
      console.log('ℹ️  Router is not currently assigned to any property');
    }

    // Example 3: Get property history
    console.log('\n3️⃣  Getting property history for Router #1...');
    
    const historyResponse = await axios.get(`${BACKEND_URL}/api/router-properties/6001747099/history`);
    
    console.log('✅ Property history retrieved:');
    console.log(`   Total properties: ${historyResponse.data.totalProperties}`);
    console.log(`   Total days deployed: ${historyResponse.data.totalDaysDeployed}`);
    console.log('\n   History:');
    historyResponse.data.history.forEach((assignment, i) => {
      const status = assignment.current ? '🟢 Current' : '⚪ Past';
      console.log(`   ${i + 1}. ${status} - ${assignment.propertyName}`);
      console.log(`      Installed: ${new Date(assignment.installedAt).toLocaleDateString()}`);
      console.log(`      Duration: ${assignment.durationDays} days`);
    });

    // Example 4: Get statistics
    console.log('\n4️⃣  Getting overall statistics...');
    
    const statsResponse = await axios.get(`${BACKEND_URL}/api/router-properties/stats`);
    
    console.log('✅ Statistics:');
    console.log(`   Total routers assigned (ever): ${statsResponse.data.total_routers_assigned}`);
    console.log(`   Currently assigned: ${statsResponse.data.currently_assigned}`);
    console.log(`   Total properties: ${statsResponse.data.total_properties}`);
    console.log(`   Active properties: ${statsResponse.data.active_properties}`);
    console.log(`   Avg deployment: ${statsResponse.data.avg_deployment_days} days`);

    // Example 5: Remove router from property
    console.log('\n5️⃣  Removing Router #1 from property...');
    
    const removeResponse = await axios.post(`${BACKEND_URL}/api/router-properties/remove`, {
      routerId: '6001747099',
      removedAt: new Date().toISOString(),
      removedBy: 'Jane Smith',
      notes: 'Moving to different property'
    });
    
    console.log('✅ Router removed from property');
    console.log(`   Was at: ${removeResponse.data.assignment.property_name}`);
    console.log(`   Removed: ${new Date(removeResponse.data.assignment.removed_at).toLocaleString()}`);

    // Example 6: Move router to new property (convenience method)
    console.log('\n6️⃣  Moving Router #2 to a new property...');
    
    // First assign it somewhere
    await axios.post(`${BACKEND_URL}/api/router-properties/assign`, {
      routerId: '6001748313',
      propertyTaskId: 'oldproperty',
      propertyName: 'Old Location',
      installedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days ago
    }).catch(() => {}); // Ignore if already assigned
    
    // Now move it
    const moveResponse = await axios.post(`${BACKEND_URL}/api/router-properties/move`, {
      routerId: '6001748313',
      newPropertyTaskId: 'newproperty',
      newPropertyName: 'Mountain Cabin #12',
      movedAt: new Date().toISOString(),
      movedBy: 'Tech Team',
      notes: 'Relocation project'
    });
    
    console.log('✅ Router moved to new property!');
    console.log(`   New property: ${moveResponse.data.assignment.property_name}`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed successfully!');
    console.log('\n📚 API Endpoints Available:');
    console.log('   GET  /api/router-properties/:routerId/current');
    console.log('   GET  /api/router-properties/:routerId/history');
    console.log('   POST /api/router-properties/assign');
    console.log('   POST /api/router-properties/remove');
    console.log('   POST /api/router-properties/move');
    console.log('   GET  /api/router-properties/property/:propertyTaskId/routers');
    console.log('   POST /api/router-properties/bulk-assign');
    console.log('   GET  /api/router-properties/stats');

  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('Details:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Run tests
testPropertyTracking();
