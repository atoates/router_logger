/**
 * Check if routers in database match IronWifi AP MACs
 */

const { pool } = require('./src/config/database');

// Sample AP MACs from the IronWifi report (in various formats)
const ironwifiApMacs = [
  '20-97-27-2D-01-71',
  '20-97-27-11-3E-30',
  '20-97-27-1F-A6-20',
  '20-97-27-24-43-4E',
  '20-97-27-24-C4-06',
  '20-97-27-2F-4A-BC',
  '20-97-27-2F-78-CF',
  '20-97-27-2F-9D-FF',
  '20-97-27-30-26-BB',
  '20-97-27-33-B8-7F',
  '20-97-27-34-4D-14',
  '20-97-27-34-54-EE',
  '20-97-27-36-70-4A',
  '20-97-27-3E-74-24',
  '20-97-27-40-71-C2',
  '20-97-27-40-C9-59',
  '20-97-27-48-75-F9',
  '20-97-27-49-11-C8'
];

function normalizeMac(mac) {
  if (!mac) return null;
  // Convert to lowercase with colons
  return mac.toLowerCase()
    .replace(/[:-]/g, '')
    .match(/.{1,2}/g)
    ?.join(':') || null;
}

async function checkMacMatching() {
  console.log('\n🔍 Checking Router MAC Matching with IronWifi\n');
  console.log('='.repeat(70));

  try {
    // Get all routers with MAC addresses
    const routers = await pool.query(`
      SELECT router_id, name, mac_address, last_seen 
      FROM routers 
      WHERE mac_address IS NOT NULL
      ORDER BY last_seen DESC
    `);

    console.log(`\n📊 Routers in database with MAC: ${routers.rows.length}`);

    if (routers.rows.length === 0) {
      console.log('   ⚠️  No routers have MAC addresses yet');
      console.log('   💡 Wait for next RMS sync to auto-populate MACs\n');
      return;
    }

    // Normalize IronWifi MACs
    const normalizedIronwifiMacs = ironwifiApMacs.map(normalizeMac);
    
    console.log(`\n📡 Sample AP MACs from IronWifi report: ${ironwifiApMacs.length}`);
    console.log('   (Showing first 5)');
    ironwifiApMacs.slice(0, 5).forEach((mac, i) => {
      console.log(`   ${i + 1}. ${mac} → ${normalizedIronwifiMacs[i]}`);
    });

    // Check for matches
    console.log('\n🔗 Checking for matches...\n');
    
    const routerMacs = routers.rows.map(r => r.mac_address);
    const matches = [];
    const unmatched = [];

    normalizedIronwifiMacs.forEach((ironMac, i) => {
      if (routerMacs.includes(ironMac)) {
        const router = routers.rows.find(r => r.mac_address === ironMac);
        matches.push({
          ironwifi_mac: ironwifiApMacs[i],
          normalized: ironMac,
          router_id: router.router_id,
          router_name: router.name
        });
      } else {
        unmatched.push({
          ironwifi_mac: ironwifiApMacs[i],
          normalized: ironMac
        });
      }
    });

    if (matches.length > 0) {
      console.log(`✅ MATCHED: ${matches.length} AP MACs match routers in database\n`);
      console.table(matches);
    } else {
      console.log('❌ NO MATCHES FOUND\n');
    }

    if (unmatched.length > 0) {
      console.log(`\n⚠️  UNMATCHED: ${unmatched.length} AP MACs not in database\n`);
      console.log('These IronWifi APs need to be added to your routers:');
      unmatched.slice(0, 10).forEach((item, i) => {
        console.log(`   ${i + 1}. ${item.ironwifi_mac} → ${item.normalized}`);
      });
      
      if (unmatched.length > 10) {
        console.log(`   ... and ${unmatched.length - 10} more\n`);
      }
    }

    // Show current router MACs
    console.log('\n📋 Current Router MACs in Database:\n');
    routers.rows.slice(0, 10).forEach((router, i) => {
      console.log(`   ${i + 1}. ${router.mac_address} - ${router.router_id} (${router.name || 'No name'})`);
    });
    
    if (routers.rows.length > 10) {
      console.log(`   ... and ${routers.rows.length - 10} more`);
    }

    // Recommendations
    console.log('\n' + '='.repeat(70));
    console.log('📋 Recommendations\n');

    if (matches.length === 0) {
      console.log('⚠️  No matches found between IronWifi APs and router MACs\n');
      console.log('Possible reasons:');
      console.log('   1. RMS sync hasn\'t captured MAC addresses yet');
      console.log('   2. IronWifi APs are using different MAC than RMS reports');
      console.log('   3. Routers need manual MAC address entry\n');
      console.log('Next steps:');
      console.log('   1. Wait for next RMS sync (every 5 minutes)');
      console.log('   2. Check RMS portal for router MAC addresses');
      console.log('   3. Manually update MACs if RMS doesn\'t provide them');
    } else if (matches.length < ironwifiApMacs.length / 2) {
      console.log('⚠️  Some matches found, but many APs are unmapped\n');
      console.log('Action needed:');
      console.log('   - Add missing AP MACs to router records');
      console.log('   - These APs won\'t show user session data until matched');
    } else {
      console.log('✅ Good match rate! Most APs are mapped to routers\n');
      console.log('   - User sessions will be linked correctly');
      console.log('   - Consider adding remaining unmatched APs');
    }

    console.log('\n' + '='.repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkMacMatching().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
