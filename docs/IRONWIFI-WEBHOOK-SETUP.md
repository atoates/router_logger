# IronWifi Webhook Integration Guide

## Overview

IronWifi's Report Scheduler can push data to your backend via webhook instead of you polling their API. This is **much better** because:

✅ **No API rate limits** - IronWifi pushes to you  
✅ **Real-time data** - Get notified as events happen  
✅ **More data access** - Reports may contain data not available in REST API  
✅ **Scheduled updates** - Set your own frequency (hourly, daily, etc.)

## Setup Steps

### 1. Get Your Webhook URL

Your webhook endpoint is:
```
https://your-backend-domain.com/api/ironwifi/webhook
```

**For Railway deployment:**
```
https://your-app.railway.app/api/ironwifi/webhook
```

**For local testing:**
```
https://your-ngrok-url.ngrok.io/api/ironwifi/webhook
```

### 2. Configure IronWifi Report Scheduler

1. **Log into IronWifi Console** → https://console.ironwifi.com/
2. **Navigate to Reports** section
3. **Click "Report Scheduler"** or "Schedule Report"
4. **Configure the report:**

   **Delivery Method**: Select **"Webhook"**
   
   **Report Type**: Choose one of:
   - **RADIUS Accounting** - Session data with user connections
   - **Access Point Status** - Device online/offline status
   - **Session History** - Historical connection data
   - **Data Usage** - Bandwidth consumption per device/user
   
   **Frequency**: 
   - **Hourly** (recommended for real-time tracking)
   - Daily (if you don't need real-time)
   - Custom interval
   
   **Webhook URL**: 
   ```
   https://your-backend.railway.app/api/ironwifi/webhook
   ```

### 3. Report Format

IronWifi can send reports in different formats:
- **JSON** (preferred - easiest to parse)
- **CSV** (we can parse this too)
- **XML** (supported)

**Recommendation**: Choose JSON format if available.

### 4. Test the Webhook

**Test Endpoint Accessibility:**
```bash
curl https://your-backend.railway.app/api/ironwifi/webhook/test
```

Expected response:
```json
{
  "success": true,
  "message": "IronWifi webhook endpoint is accessible",
  "url": "https://your-backend.railway.app/api/ironwifi/webhook",
  "timestamp": "2025-11-10T..."
}
```

**Send Test Webhook:**
In IronWifi Console, there should be a "Test Webhook" or "Send Test" button. Click it to send sample data.

### 5. Verify Data Reception

Check your backend logs:
```bash
# Railway
railway logs

# Local
tail -f backend/logs/app.log | grep -i ironwifi
```

Check webhook stats:
```bash
curl https://your-backend.railway.app/api/ironwifi/webhook/stats
```

Response:
```json
{
  "success": true,
  "last24Hours": {
    "total_sessions": 145,
    "unique_routers": 12,
    "unique_users": 87,
    "last_received": "2025-11-10T14:30:00Z",
    "total_bytes": 5234567890
  }
}
```

## Expected Data Fields

### RADIUS Accounting Report

The webhook should receive data like:
```json
[
  {
    "username": "user@example.com",
    "calling_station_id": "aa:bb:cc:dd:ee:ff",  // User device MAC
    "called_station_id": "11:22:33:44:55:66",   // AP MAC (router)
    "nas_identifier": "11:22:33:44:55:66",      // Same as AP MAC
    "acct_session_id": "5F3A2B1C",
    "acct_start_time": "2025-11-10T12:00:00Z",
    "acct_stop_time": "2025-11-10T14:30:00Z",   // null if still active
    "acct_session_time": 9000,                   // seconds
    "acct_input_octets": 1234567,               // bytes downloaded
    "acct_output_octets": 7654321,              // bytes uploaded
    "framed_ip_address": "10.0.1.45",
    "nas_ip_address": "35.189.111.2"
  }
]
```

### Access Point Status Report

```json
[
  {
    "mac_address": "11:22:33:44:55:66",
    "name": "autodiscovered 25/04/30 11:15 teltonika",
    "status": "active",
    "last_seen": "2025-11-10T14:25:00Z",
    "network": "default",
    "location": null
  }
]
```

## How It Works

### 1. IronWifi Sends Data
- On schedule (hourly, daily, etc.)
- IronWifi POSTs data to `/api/ironwifi/webhook`
- Data includes session info, device status, etc.

### 2. Our Backend Receives
- Webhook endpoint immediately responds with 200 OK
- Data is queued for async processing
- No blocking - IronWifi gets instant confirmation

### 3. Data Processing
- Parse JSON/CSV format
- Extract MAC addresses, usernames, session times
- Match AP MAC addresses to routers in database
- Store sessions in `ironwifi_sessions` table

### 4. Data Availability
- Sessions appear in database immediately
- Frontend can query `/api/ironwifi/router/:id/active-users`
- Statistics updated in real-time

## MAC Address Matching

**Critical**: Sessions are matched to routers by MAC address.

**The MAC address matching logic:**
1. IronWifi report contains `nas_identifier` or `called_station_id` (AP MAC)
2. We normalize it to format: `aa:bb:cc:dd:ee:ff`
3. Match against `routers.mac_address` column
4. If match found, link session to that router

**Ensure routers have MAC addresses:**
```sql
-- Check which routers have MACs
SELECT router_id, name, mac_address, last_seen 
FROM routers 
WHERE mac_address IS NOT NULL;

-- Routers without MACs won't get sessions linked
SELECT router_id, name, last_seen 
FROM routers 
WHERE mac_address IS NULL;
```

## Recommended Report Settings

### For Real-Time Tracking
- **Report Type**: RADIUS Accounting (Active Sessions)
- **Frequency**: Every hour
- **Delivery**: Webhook (JSON)
- **Filter**: Include only active/recent sessions

### For Daily Summary
- **Report Type**: RADIUS Accounting (Daily Summary)
- **Frequency**: Daily at 00:00
- **Delivery**: Webhook (JSON)
- **Include**: Full day's session history

### For Device Monitoring
- **Report Type**: Access Point Status
- **Frequency**: Every 30 minutes
- **Delivery**: Webhook (JSON)
- **Include**: All APs with last seen timestamp

## Troubleshooting

### Webhook Not Receiving Data

**Check 1: Is endpoint accessible?**
```bash
curl https://your-backend.railway.app/api/ironwifi/webhook/test
```

**Check 2: Firewall/Security**
- Ensure Railway app is public
- No IP restrictions blocking IronWifi

**Check 3: IronWifi Console**
- Check report scheduler status
- Look for delivery errors
- Test webhook button should show success

### Data Not Matching Routers

**Issue**: Sessions appear but `router_id` is NULL

**Cause**: MAC address mismatch

**Solution**:
```sql
-- Check what MACs IronWifi is sending
SELECT DISTINCT router_mac_address 
FROM ironwifi_sessions 
WHERE router_id IS NULL;

-- Check what MACs we have in routers table
SELECT router_id, mac_address 
FROM routers 
WHERE mac_address IS NOT NULL;

-- Update router MAC if needed
UPDATE routers 
SET mac_address = 'aa:bb:cc:dd:ee:ff' 
WHERE router_id = 'SERIAL123';
```

### Webhook Logs

Backend logs show detailed webhook activity:
```bash
# See all webhook data received
grep "IronWifi webhook" backend/logs/app.log

# See processing errors
grep "Error processing webhook" backend/logs/app.log

# See successful stores
grep "Stored session from webhook" backend/logs/app.log
```

## Security Considerations

### Webhook Authentication (Optional)

If you want to secure the webhook:

1. **Add shared secret** in IronWifi webhook config
2. **Verify signature** in webhook handler
3. **IP whitelist** IronWifi's servers

Currently the webhook is **open** (no auth) which is fine for most use cases since:
- Data is not sensitive (public session logs)
- Only valid data formats will be processed
- Invalid data is logged and ignored

### Rate Limiting

The webhook endpoint has **no rate limit** intentionally, since IronWifi controls the frequency via report scheduler.

## Advantages Over API Polling

| Feature | Webhook | API Polling |
|---------|---------|-------------|
| **Rate Limits** | None (they push) | 1000/hour limit |
| **Real-time** | Immediate | 15-min delay |
| **Data Access** | Full reports | Limited API |
| **Server Load** | Minimal | Constant polling |
| **Setup** | Configure once | Ongoing sync jobs |

## Next Steps

1. ✅ **Deploy backend** with webhook endpoint
2. ✅ **Get Railway URL** for webhook
3. ⏳ **Configure IronWifi Report Scheduler** with your webhook URL
4. ⏳ **Test webhook** with "Send Test" button
5. ⏳ **Verify data** in `/api/ironwifi/webhook/stats`
6. ✅ **Frontend already ready** to display session data

Once configured, sessions will flow automatically from IronWifi → Your Backend → Frontend! 🎉
