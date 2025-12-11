# IronWifi Integration - Ready Status ✅

**Date**: November 11, 2025  
**Status**: WEBHOOK READY FOR ACCOUNTING DATA

## Summary

Your IronWifi webhook integration is now **fully configured** to handle RADIUS Accounting data in the exact format IronWifi sends.

## What Was Updated

### ✅ Webhook Handler (`/api/ironwifi/webhook`)
- **Field mapping**: Now correctly parses IronWifi-specific CSV field names
  - `calledstationid` → AP MAC (router identifier)
  - `callingstationid` → User device MAC
  - `acctsessionid` → Unique session ID
  - `acctstarttime` / `acctstoptime` → Session timing
  - `acctinputoctets` / `acctoutputoctets` → Bandwidth data
  - `acctsessiontime` → Session duration
  
- **Format support**: Handles both CSV and JSON webhook formats
- **MAC normalization**: Converts `20-97-27-XX-XX-XX` to `20:97:27:xx:xx:xx`
- **Error handling**: Logs failures, continues processing remaining records

### ✅ Test Results from Your Sample Data

**Sample Report Analysis**:
- 7 sessions successfully parsed
- 5 unique routers identified
- 6 unique users tracked
- Total data: 41.57 MB down, 614.56 MB up
- Average session: 10.6 minutes

**AP MACs Found** (need to match to routers):
```
20-97-27-8E-88-1D → 20:97:27:8e:88:1d
20-97-27-4F-53-16 → 20:97:27:4f:53:16
20-97-27-55-BC-FC → 20:97:27:55:bc:fc
26-97-27-2F-57-2A → 26:97:27:2f:57:2a
20-97-27-5A-C1-0A → 20:97:27:5a:c1:0a
```

## Current Webhook Configuration (Your IronWifi Console)

✅ **Report Type**: RADIUS Accounting (correct!)  
✅ **Delivery Method**: Webhook  
✅ **Format**: CSV  
✅ **Frequency**: Hourly  
✅ **Webhook URL**: `https://your-backend.railway.app/api/ironwifi/webhook`

## What Happens Next

### When IronWifi Sends the Next Report (Hourly):

1. **Webhook Receives Data** → `/api/ironwifi/webhook` endpoint
2. **Parses CSV** → Extracts 27 fields per session
3. **Normalizes MACs** → Converts to standard format
4. **Matches to Routers** → Looks up router by AP MAC in database
5. **Stores Sessions** → Inserts into `ironwifi_sessions` table
6. **Updates Stats** → Aggregates data in `router_user_stats`

## Critical: Router MAC Address Matching

**⚠️ IMPORTANT**: Sessions will only link to routers if MAC addresses match.

### Check Current Router MACs

Run this to see if your routers have MACs:
```bash
# Via Railway CLI
railway run node backend/check-mac-matching.js

# Or query database directly
SELECT router_id, name, mac_address 
FROM routers 
WHERE mac_address IS NOT NULL;
```

### Expected Match Format

IronWifi sends: `20-97-27-8E-88-1D`  
Database needs: `20:97:27:8e:88:1d`  
(Our webhook normalizes automatically)

### If MACs Are Missing

**Option 1: Wait for RMS Sync** (Automatic)
- RMS sync runs every 5 minutes
- Automatically captures MAC addresses from RMS API
- Check after next sync: `SELECT router_id, mac_address FROM routers`

**Option 2: Manual Update** (If RMS doesn't provide MACs)
```sql
UPDATE routers 
SET mac_address = '20:97:27:8e:88:1d' 
WHERE router_id = 'SERIAL_NUMBER';
```

## Monitoring & Verification

### Check Webhook Status
```bash
curl https://your-backend.railway.app/api/ironwifi/webhook/test
```

### View Session Stats (After First Webhook)
```bash
curl https://your-backend.railway.app/api/ironwifi/webhook/stats
```

### Check Railway Logs
```bash
railway logs --tail 100 | grep -i ironwifi
```

Look for:
- `IronWifi webhook received` - Webhook was called
- `Processing X records from webhook` - Data being processed
- `Stored session from webhook` - Sessions saved to database

## What The Dashboard Will Show

Once data is flowing:

### Router List Page
- 👥 **Active Users** badge on each router
- Shows count of currently connected users
- Click to see user list with device info

### Router Detail Page
- **Active Users Section**
  - Username
  - Device MAC
  - Connection time
  - Bandwidth used
  - IP address

- **Session History Chart**
  - Users over time
  - Peak usage times
  - Session durations

- **User Statistics**
  - Total unique users (daily/weekly/monthly)
  - Total sessions
  - Total bandwidth
  - Average session duration

## Troubleshooting

### "No sessions in database"
1. Check webhook is configured in IronWifi Console
2. Verify webhook URL is correct
3. Check Railway logs for incoming requests
4. Confirm report is being sent (check IronWifi scheduler status)

### "Sessions but no router_id"
1. Check router MAC addresses in database
2. Verify MAC format matches (use check-mac-matching.js)
3. Check IronWifi AP MACs match your router MACs
4. Run RMS sync to populate MACs if missing

### "Webhook returning errors"
1. Check Railway logs for error details
2. Verify database tables exist (migration 007)
3. Test parsing: `node backend/test-webhook-parsing.js`

## Next Webhook Delivery

Based on your hourly schedule, the next webhook should arrive at the top of the hour.

**To verify it's working**:
1. Wait for next hour
2. Check logs: `railway logs | grep "IronWifi webhook received"`
3. Check stats: `curl /api/ironwifi/webhook/stats`
4. Verify data: Check dashboard for active users

## Summary

✅ Webhook handler deployed and ready  
✅ Correctly parses your accounting data format  
✅ MAC address normalization working  
✅ Database tables exist  
⏳ Waiting for next scheduled webhook delivery  
⚠️ Verify router MACs match AP MACs for proper linking  

**Everything is ready - just waiting for IronWifi to send the next hourly report!** 🎉
