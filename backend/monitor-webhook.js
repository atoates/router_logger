/**
 * Monitor IronWifi Webhook - Real-time
 * Checks for incoming webhook data every few seconds
 */

const { pool, logger } = require('./src/config/database');

let lastCheckTime = new Date();
let checkCount = 0;
const maxChecks = 40; // Monitor for ~2 minutes (40 checks x 3 seconds)

async function checkForNewSessions() {
  checkCount++;
  
  try {
    // Check for sessions created in the last 2 minutes
    const recentSessions = await pool.query(`
      SELECT 
        session_id,
        router_id,
        router_mac_address,
        username,
        session_start,
        bytes_total,
        created_at
      FROM ironwifi_sessions 
      WHERE created_at > NOW() - INTERVAL '2 minutes'
      ORDER BY created_at DESC
    `);
    
    const newSessions = recentSessions.rows.filter(
      row => new Date(row.created_at) > lastCheckTime
    );
    
    if (newSessions.length > 0) {
      console.log('\n🎉 NEW WEBHOOK DATA RECEIVED!\n');
      console.log(`Found ${newSessions.length} new sessions:\n`);
      console.table(newSessions);
      
      console.log('\n✅ Webhook is working! Check your dashboard to see active users.');
      process.exit(0);
    } else {
      const totalSessions = await pool.query('SELECT COUNT(*) as count FROM ironwifi_sessions');
      const elapsed = Math.floor((Date.now() - lastCheckTime) / 1000);
      
      process.stdout.write(`\r⏳ Waiting for webhook... (${elapsed}s elapsed, ${totalSessions.rows[0].count} total sessions) [Check ${checkCount}/${maxChecks}]`);
    }
    
    if (checkCount >= maxChecks) {
      console.log('\n\n⏱️  2 minutes elapsed - no new webhook data received yet.');
      console.log('\nPossible reasons:');
      console.log('  1. Webhook scheduled time might be slightly off');
      console.log('  2. Check IronWifi Report Scheduler status');
      console.log('  3. Verify webhook URL in IronWifi Console');
      console.log('\nYou can run this script again or check Railway logs:');
      console.log('  railway logs --tail 100 | grep ironwifi\n');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('\n❌ Error checking database:', error.message);
    process.exit(1);
  }
}

async function start() {
  console.log('\n🔍 Monitoring for IronWifi Webhook Data');
  console.log('Checking every 3 seconds for new sessions...\n');
  
  // Check initial MAC addresses
  try {
    const macCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM routers 
      WHERE mac_address IS NOT NULL
    `);
    console.log(`📍 Routers with MAC addresses: ${macCount.rows[0].count}\n`);
    
    if (macCount.rows[0].count === 0) {
      console.log('⚠️  Warning: No routers have MAC addresses yet.');
      console.log('   Sessions may not link to routers until MACs are populated.\n');
    }
  } catch (err) {
    console.log('⚠️  Could not check router MACs\n');
  }
  
  // Start monitoring
  lastCheckTime = new Date();
  const interval = setInterval(checkForNewSessions, 3000);
  
  // Initial check
  await checkForNewSessions();
  
  // Cleanup on exit
  process.on('SIGINT', async () => {
    clearInterval(interval);
    await pool.end();
    console.log('\n\nMonitoring stopped.\n');
    process.exit(0);
  });
}

start().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
