/**
 * Test property search functionality
 */

const clickupClient = require('./src/services/clickupClient');

async function testSearch() {
  const spaceId = '90152330498'; // Active Accounts
  const searchQuery = 'cambr';
  
  console.log('Testing property search...');
  console.log('Space ID:', spaceId);
  console.log('Search Query:', searchQuery);
  console.log('---');
  
  try {
    const results = await clickupClient.searchPropertyTasks(spaceId, searchQuery, 'default');
    console.log('Results:', results.length);
    console.log('Sample results:');
    results.slice(0, 5).forEach(task => {
      console.log(`  - ${task.name} (${task.list_name})`);
    });
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error);
  }
}

testSearch();
