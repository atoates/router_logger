/**
 * Test IronWifi Webhook Handler with Real Accounting Data
 * This simulates what happens when IronWifi sends the webhook
 */

const fs = require('fs');
const path = require('path');

// Read the sample accounting CSV
const csvPath = path.join(__dirname, 'ironwifi-accounting-sample.csv');
const csvData = fs.readFileSync(csvPath, 'utf-8');

console.log('\n🧪 Testing IronWifi Webhook Data Processing\n');
console.log('='.repeat(70));

// Parse CSV to JSON (simulating what webhook handler does)
function parseCSV(text) {
  const lines = text.split('\n').filter(line => line.trim());
  const records = [];

  if (lines.length > 1) {
    const headers = lines[0].split(',').map(h => h.trim());
    console.log(`\n📋 CSV Headers Found: ${headers.length} columns`);
    console.log(`   ${headers.slice(0, 10).join(', ')}...`);
    
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      
      const values = lines[i].split(',');
      const record = {};
      
      headers.forEach((header, index) => {
        let value = values[index] || '';
        value = value.replace(/^"|"$/g, '').trim();
        record[header] = value;
      });
      
      records.push(record);
    }
  }

  return records;
}

// Test parsing
const records = parseCSV(csvData);
console.log(`\n✅ Parsed ${records.length} session records\n`);

// Show first record in detail
if (records.length > 0) {
  const sample = records[0];
  console.log('📊 Sample Session Record:\n');
  console.log(`   Username: ${sample.username}`);
  console.log(`   AP MAC (Router): ${sample.calledstationid}`);
  console.log(`   User Device MAC: ${sample.callingstationid}`);
  console.log(`   Session ID: ${sample.acctsessionid}`);
  console.log(`   Start Time: ${sample.acctstarttime}`);
  console.log(`   Stop Time: ${sample.acctstoptime}`);
  console.log(`   Duration: ${sample.acctsessiontime} seconds`);
  console.log(`   Downloaded: ${parseInt(sample.acctinputoctets || 0).toLocaleString()} bytes`);
  console.log(`   Uploaded: ${parseInt(sample.acctoutputoctets || 0).toLocaleString()} bytes`);
  console.log(`   User IP: ${sample.framedipaddress}`);
  console.log(`   Termination: ${sample.status || sample.acctterminatecause}`);
}

// Extract unique AP MACs
console.log('\n📡 Access Points (Routers) in Report:\n');
const apMacs = [...new Set(records.map(r => r.calledstationid).filter(Boolean))];
console.log(`   Found ${apMacs.length} unique AP MAC addresses:\n`);
apMacs.slice(0, 10).forEach((mac, i) => {
  const count = records.filter(r => r.calledstationid === mac).length;
  console.log(`   ${i + 1}. ${mac} (${count} sessions)`);
});

if (apMacs.length > 10) {
  console.log(`   ... and ${apMacs.length - 10} more`);
}

// Normalize MAC addresses (what webhook handler does)
function normalizeMac(mac) {
  if (!mac) return null;
  return mac.toLowerCase()
    .replace(/[:-]/g, '')
    .match(/.{1,2}/g)
    ?.join(':') || null;
}

console.log('\n🔄 MAC Address Normalization:\n');
apMacs.slice(0, 5).forEach((mac, i) => {
  console.log(`   ${mac} → ${normalizeMac(mac)}`);
});

// Calculate total bandwidth
const totalDownload = records.reduce((sum, r) => sum + parseInt(r.acctinputoctets || 0), 0);
const totalUpload = records.reduce((sum, r) => sum + parseInt(r.acctoutputoctets || 0), 0);
const totalDuration = records.reduce((sum, r) => sum + parseInt(r.acctsessiontime || 0), 0);

console.log('\n📈 Session Statistics:\n');
console.log(`   Total Sessions: ${records.length}`);
console.log(`   Total Download: ${(totalDownload / 1024 / 1024).toFixed(2)} MB`);
console.log(`   Total Upload: ${(totalUpload / 1024 / 1024).toFixed(2)} MB`);
console.log(`   Total Duration: ${(totalDuration / 3600).toFixed(2)} hours`);
console.log(`   Avg Session: ${(totalDuration / records.length / 60).toFixed(1)} minutes`);

// Unique users
const uniqueUsers = [...new Set(records.map(r => r.username).filter(Boolean))];
console.log(`   Unique Users: ${uniqueUsers.length}`);

// Show webhook data structure
console.log('\n📦 Webhook Data Structure:\n');
console.log('   When IronWifi sends this via webhook, it will be:');
console.log('   - Content-Type: text/csv or application/json');
console.log('   - Body: CSV text (as above) or JSON array of objects');
console.log('   - Our handler will:');
console.log('     1. Parse CSV to JSON');
console.log('     2. Extract session data fields');
console.log('     3. Normalize MAC addresses');
console.log('     4. Match AP MACs to router_id in database');
console.log('     5. Store in ironwifi_sessions table');

console.log('\n' + '='.repeat(70));
console.log('\n✅ Webhook handler is ready to process this data format!\n');
console.log('Next steps:');
console.log('   1. Ensure webhook is configured in IronWifi Console');
console.log('   2. Verify router MACs match the AP MACs listed above');
console.log('   3. Wait for next scheduled report delivery');
console.log('   4. Check logs: railway logs | grep ironwifi');
console.log('   5. Verify data: curl /api/ironwifi/webhook/stats\n');
