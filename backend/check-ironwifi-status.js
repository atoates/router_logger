/**
 * IronWifi Webhook Status Checker
 * Checks if webhook has received any data and diagnoses issues
 */

const { pool, logger } = require('./src/config/database');

async function checkIronWifiStatus() {
  console.log('\n🔍 IronWifi Integration Status Check\n');
  console.log('='.repeat(60));

  try {
    // 1. Check if tables exist
    console.log('\n1️⃣  Checking Database Tables...');
    try {
      const tableCheck = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('ironwifi_sessions', 'router_user_stats')
        ORDER BY table_name
      `);
      
      if (tableCheck.rows.length === 2) {
        console.log('   ✅ Both tables exist (ironwifi_sessions, router_user_stats)');
      } else {
        console.log('   ❌ Missing tables:', tableCheck.rows.map(r => r.table_name).join(', '));
        console.log('   Run migration: database/migrations/007_add_ironwifi_tables.sql');
        return;
      }
    } catch (err) {
      console.log('   ❌ Table check failed:', err.message);
      return;
    }

    // 2. Check session count
    console.log('\n2️⃣  Checking Session Data...');
    const sessionCount = await pool.query('SELECT COUNT(*) as count FROM ironwifi_sessions');
    const totalSessions = parseInt(sessionCount.rows[0].count);
    
    console.log(`   📊 Total sessions in database: ${totalSessions}`);
    
    if (totalSessions === 0) {
      console.log('   ⚠️  No webhook data received yet');
    } else {
      console.log('   ✅ Webhook data has been received!');
      
      // Show recent sessions
      const recent = await pool.query(`
        SELECT 
          session_id,
          router_id,
          router_mac_address,
          username,
          session_start,
          is_active,
          bytes_total,
          created_at
        FROM ironwifi_sessions 
        ORDER BY created_at DESC 
        LIMIT 5
      `);
      
      console.log('\n   📝 Most Recent Sessions:');
      console.table(recent.rows);
    }

    // 3. Check last webhook received
    console.log('\n3️⃣  Checking Webhook Activity...');
    if (totalSessions > 0) {
      const lastReceived = await pool.query(`
        SELECT MAX(created_at) as last_received 
        FROM ironwifi_sessions
      `);
      
      const lastTime = new Date(lastReceived.rows[0].last_received);
      const now = new Date();
      const minutesAgo = Math.floor((now - lastTime) / 1000 / 60);
      
      console.log(`   🕐 Last webhook received: ${lastTime.toISOString()}`);
      console.log(`   ⏱️  Time since last webhook: ${minutesAgo} minutes ago`);
      
      if (minutesAgo > 120) {
        console.log('   ⚠️  No webhook received in over 2 hours - check IronWifi scheduler');
      } else {
        console.log('   ✅ Recent webhook activity detected');
      }
    } else {
      console.log('   ⚠️  No webhook data in database yet');
    }

    // 4. Check router MAC addresses
    console.log('\n4️⃣  Checking Router MAC Addresses...');
    const macCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM routers 
      WHERE mac_address IS NOT NULL
    `);
    
    const totalRouters = await pool.query('SELECT COUNT(*) as count FROM routers');
    const routersWithMac = parseInt(macCount.rows[0].count);
    const totalRouterCount = parseInt(totalRouters.rows[0].count);
    
    console.log(`   📍 Routers with MAC addresses: ${routersWithMac} / ${totalRouterCount}`);
    
    if (routersWithMac === 0) {
      console.log('   ⚠️  No routers have MAC addresses - sessions cannot be matched!');
      console.log('   💡 MAC addresses should auto-populate from RMS sync');
    } else {
      console.log('   ✅ Some routers have MAC addresses');
      
      // Show sample MACs
      const sampleMacs = await pool.query(`
        SELECT router_id, name, mac_address, last_seen 
        FROM routers 
        WHERE mac_address IS NOT NULL 
        ORDER BY last_seen DESC 
        LIMIT 5
      `);
      
      console.log('\n   📝 Sample Router MACs:');
      console.table(sampleMacs.rows);
    }

    // 5. Check matched vs unmatched sessions
    if (totalSessions > 0) {
      console.log('\n5️⃣  Checking Session Matching...');
      const matchedCount = await pool.query(`
        SELECT COUNT(*) as count 
        FROM ironwifi_sessions 
        WHERE router_id IS NOT NULL
      `);
      
      const matched = parseInt(matchedCount.rows[0].count);
      const unmatched = totalSessions - matched;
      const matchRate = totalSessions > 0 ? ((matched / totalSessions) * 100).toFixed(1) : 0;
      
      console.log(`   ✅ Matched sessions: ${matched} (${matchRate}%)`);
      console.log(`   ⚠️  Unmatched sessions: ${unmatched}`);
      
      if (unmatched > 0) {
        // Show unmatched MAC addresses
        const unmatchedMacs = await pool.query(`
          SELECT DISTINCT router_mac_address 
          FROM ironwifi_sessions 
          WHERE router_id IS NULL 
          LIMIT 10
        `);
        
        console.log('\n   🔍 Unmatched AP MAC addresses from IronWifi:');
        unmatchedMacs.rows.forEach(row => {
          console.log(`      - ${row.router_mac_address || 'NULL'}`);
        });
        
        console.log('\n   💡 These MACs need to be added to the routers table');
      }
    }

    // 6. Check daily stats
    console.log('\n6️⃣  Checking Daily Statistics...');
    const statsCount = await pool.query('SELECT COUNT(*) as count FROM router_user_stats');
    console.log(`   📊 Daily stat records: ${statsCount.rows[0].count}`);

    // 7. Configuration check
    console.log('\n7️⃣  Configuration Check...');
    const hasApiKey = !!process.env.IRONWIFI_API_KEY;
    const hasNetworkId = !!process.env.IRONWIFI_NETWORK_ID;
    
    console.log(`   ${hasApiKey ? '✅' : '❌'} IRONWIFI_API_KEY: ${hasApiKey ? 'Set' : 'Not set'}`);
    console.log(`   ${hasNetworkId ? '✅' : '⚠️ '} IRONWIFI_NETWORK_ID: ${hasNetworkId ? 'Set' : 'Not needed for webhook'}`);

    // 8. Summary and recommendations
    console.log('\n' + '='.repeat(60));
    console.log('📋 Summary & Recommendations\n');
    
    if (totalSessions === 0) {
      console.log('❌ STATUS: No webhook data received yet\n');
      console.log('🔧 TROUBLESHOOTING STEPS:');
      console.log('   1. Verify webhook is configured in IronWifi Console');
      console.log('   2. Check webhook URL is correct:');
      console.log('      https://your-backend.railway.app/api/ironwifi/webhook');
      console.log('   3. Test webhook endpoint:');
      console.log('      curl https://your-backend.railway.app/api/ironwifi/webhook/test');
      console.log('   4. Check IronWifi Report Scheduler for errors');
      console.log('   5. Verify report frequency is set (hourly recommended)');
      console.log('   6. Check Railway logs for incoming webhook attempts:');
      console.log('      railway logs --tail 100 | grep ironwifi');
    } else if (unmatched > matched) {
      console.log('⚠️  STATUS: Receiving webhooks but sessions not matching routers\n');
      console.log('🔧 FIX NEEDED:');
      console.log('   - Add MAC addresses to routers table');
      console.log('   - MAC addresses should match the AP MACs shown above');
      console.log('   - Run next RMS sync to auto-populate MACs');
    } else {
      console.log('✅ STATUS: IronWifi integration is working!\n');
      console.log(`   - ${totalSessions} sessions tracked`);
      console.log(`   - ${matched} sessions matched to routers (${matchRate}%)`);
      console.log(`   - Last webhook: ${minutesAgo} minutes ago`);
    }

    console.log('\n' + '='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Error during status check:', error.message);
    logger.error('IronWifi status check failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the check
checkIronWifiStatus().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
