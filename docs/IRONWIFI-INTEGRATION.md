# IronWifi Integration Guide

## Overview

This integration connects your router tracking system with IronWifi's captive portal service to monitor which routers have active users connecting. The system tracks user sessions, connection statistics, and provides insights into router usage patterns.

## ✅ Recommended Method: Webhook Integration

**Use webhooks, not API polling!** Webhooks provide:
- ✅ No rate limits (IronWifi pushes to you)
- ✅ Real-time data delivery
- ✅ No API key management
- ✅ Lower server load
- ✅ More reliable data flow

See [IRONWIFI-WEBHOOK-SETUP.md](IRONWIFI-WEBHOOK-SETUP.md) for complete webhook setup instructions.

## How It Works

1. **IronWifi Sends Webhook**: Hourly RADIUS Accounting reports delivered via POST
2. **MAC Address Matching**: Routers matched to IronWifi access points using MAC addresses
3. **Session Processing**: Parse CSV/JSON data, normalize MACs, extract session details
4. **Database Storage**: Sessions and statistics stored locally for fast querying
5. **REST API**: Frontend components access user data through standardized endpoints

## Database Schema

### Tables

**ironwifi_sessions**
- Stores individual user connection sessions
- Links sessions to routers via MAC address matching
- Tracks connection time, bandwidth usage, device info
- Marks sessions as active/inactive based on sync updates

**router_user_stats**
- Daily aggregated statistics per router
- Unique user count, total sessions, bandwidth totals
- Peak concurrent users, average session duration

**router_active_users** (Materialized View)
- Fast lookup for current active users per router
- Refreshed on each sync cycle

### Router Table Additions

Three new columns added to the `routers` table:
- `mac_address`: Router MAC address (format: xx:xx:xx:xx:xx:xx)
- `ironwifi_ap_id`: IronWifi access point ID
- `ironwifi_ap_name`: IronWifi access point name

## Environment Variables

### For Webhook Integration (Recommended)

**NO environment variables needed!** Webhooks work out of the box.

Just configure the webhook in IronWifi Console to point to:
```
https://your-backend.railway.app/api/ironwifi/webhook
```

### For API Polling (Not Recommended - Use Webhook Instead)

Only if you can't use webhooks (not recommended due to rate limits):

```bash
# IronWifi API Configuration (API Polling - NOT RECOMMENDED)
IRONWIFI_API_KEY=your-api-key
IRONWIFI_API_URL=https://console.ironwifi.com/api
IRONWIFI_NETWORK_ID=your-network-id

# Sync Configuration (⚠️ BE CAREFUL WITH API LIMITS!)
IRONWIFI_SYNC_INTERVAL_MINUTES=15
IRONWIFI_HOURLY_LIMIT=1000
```

**Note**: API polling has strict rate limits. Webhooks are strongly recommended.

### Getting Your Credentials

1. **API Key**: `779cfe99-f15d-4318-8d30-9fafeb46ed7d` ✅ (already provided, tested and working!)
2. **API URL**: `https://console.ironwifi.com/api` ✅ (confirmed working)
3. **Network ID**: ⚠️ **You need to create this in IronWifi Console first**

### ⚠️ IMPORTANT: Account Setup Required

**Current Status**: API Key is valid, but your IronWifi account has no networks configured yet.

**Before this integration will work, you must:**

1. **Log into IronWifi Console**: https://console.ironwifi.com/
2. **Create a Network**:
   - Go to Networks section
   - Click "Add Network"
   - Give it a name (e.g., "Router Network")
   - Copy the Network ID after creation
3. **Add Access Points**:
   - Your routers must be registered as Access Points in IronWifi
   - Each router needs to be added with its MAC address
   - Go to Networks → Your Network → Access Points
4. **Configure Captive Portal** (optional but recommended):
   - Set up splash page for user authentication
   - This enables user session tracking
5. **Get Network ID**:
   - After creating network, note the ID
   - Add it to your `.env` file

**Testing Current Status**:
```bash
# Run the API test script
cd backend
node test-ironwifi-api.js
```

Once you see data in `/networks` and `/devices`, you're ready to integrate!

### ⚠️ IMPORTANT: API Rate Limits

**The IronWifi API has rate limits. We must be extremely careful to avoid hitting these limits.**

**Our Protection Mechanisms:**
1. **Hourly Call Tracking**: System tracks all API calls and enforces a limit (default: 1000/hour)
2. **Auto-Skip at 90%**: When we reach 90% of the hourly limit, syncs are automatically skipped
3. **Rate Limit Detection**: If the API returns 429 (rate limit), we immediately stop and wait
4. **Configurable Sync Interval**: Default is 15 minutes (not 5!) to reduce API calls
5. **Single Call Per Sync**: We fetch all sessions in ONE API call, not per-router

**Estimated API Usage:**
- 1 API call per sync cycle (fetches all sessions at once)
- At 15-minute intervals: 4 calls/hour, 96 calls/day
- At 5-minute intervals: 12 calls/hour, 288 calls/day
- **Recommendation**: Start with 15-minute intervals until you understand your usage patterns

**Configuration:**
```bash
# Sync every 15 minutes (safer, recommended)
IRONWIFI_SYNC_INTERVAL_MINUTES=15

# Hourly API call limit (default: 1000)
# Set lower if IronWifi enforces stricter limits
IRONWIFI_HOURLY_LIMIT=1000
```

**Monitoring API Usage:**
Check `/api/ironwifi/status` to see current usage:
```json
{
  "apiUsage": {
    "callsMade": 45,
    "limit": 1000,
    "remaining": 955,
    "percentageUsed": "4.5",
    "resetInMinutes": 32
  }
}
```

## Setup Steps

### 1. Database Migration

Run the IronWifi migration to create required tables:

```bash
cd backend
psql $DATABASE_URL -f database/migrations/007_add_ironwifi_tables.sql
```

Or use your migration tool:
```bash
npm run migrate
```

### 2. Configure Environment Variables

Copy the variables above into your `.env` file with your actual credentials.

### 3. Add Router MAC Addresses

**CRITICAL**: IronWifi matches sessions to routers via MAC address. Without MAC addresses populated, no sessions will be linked to routers!

**✅ AUTOMATIC (Recommended)**: The system now automatically captures MAC addresses from RMS API during sync. The next RMS sync will populate MAC addresses if RMS provides them. Check after sync with:

```sql
SELECT router_id, name, mac_address, last_seen 
FROM routers 
WHERE mac_address IS NOT NULL;
```

**Option A: Manual Update (if RMS doesn't provide MACs)**
```sql
UPDATE routers 
SET mac_address = 'aa:bb:cc:dd:ee:ff' 
WHERE router_id = 'ROUTER_SERIAL';
```

**Option B: Get MAC from Router Interface**
1. Log into router web interface
2. Navigate to System → Administration → General
3. Copy the LAN or WiFi MAC address
4. Update database manually

**Option C: Bulk Import from CSV**
```sql
UPDATE routers r
SET mac_address = m.mac
FROM (VALUES 
  ('SERIAL1', '00:11:22:33:44:55'),
  ('SERIAL2', '00:11:22:33:44:66'),
  ('SERIAL3', '00:11:22:33:44:77')
) AS m(router_id, mac)
WHERE r.router_id = m.router_id;
```

**Which MAC Address to Use?**
- IronWifi tracks the **Access Point MAC** (usually WiFi AP MAC)
- This is typically the **WLAN MAC address**, not WAN or LAN
- Check IronWifi Console → Access Points to see what MAC they're logging
- The MAC must match EXACTLY (case-insensitive, but format must align)

### 4. Verify MAC Address Format

IronWifi uses different MAC formats in different contexts. The system normalizes all MACs to lowercase with colons:
- `00:11:22:33:44:55` ✅ Correct
- `00-11-22-33-44-55` → Normalized to `00:11:22:33:44:55`
- `001122334455` → Normalized to `00:11:22:33:44:55`

### 5. Test the Integration

**Check API Status:**
```bash
curl http://localhost:3001/api/ironwifi/status
```

Expected response:
```json
{
  "enabled": true,
  "configured": true,
  "apiConnected": true,
  "lastSync": "2024-01-15T10:30:00Z",
  "activeSessions": 42
}
```

**Trigger Manual Sync:**
```bash
curl -X POST http://localhost:3001/api/ironwifi/sync
```

Expected response:
```json
{
  "success": true,
  "newSessions": 15,
  "updatedSessions": 8,
  "unmatchedSessions": 2,
  "duration": "1.2s"
}
```

### 6. Restart Backend Server

The sync scheduler will start automatically if credentials are configured:

```bash
npm start
```

Look for this log message:
```
IronWifi sync scheduler started (every 5 minutes)
```

## API Endpoints

### Router-Specific Endpoints

**Get Active Users on Router**
```
GET /api/ironwifi/router/:routerId/active-users
```
Returns list of currently connected users with device info, connection time, bandwidth.

**Get Router Session History**
```
GET /api/ironwifi/router/:routerId/sessions?start_date=2024-01-01&end_date=2024-01-31&limit=100&offset=0
```
Returns paginated session history with filters.

**Get Router Statistics**
```
GET /api/ironwifi/router/:routerId/stats?period=7d
```
Returns aggregated statistics (unique users, sessions, bandwidth) for the period.
Periods: `24h`, `7d`, `30d`, `90d`

### Network-Wide Endpoints

**Get All Active Users**
```
GET /api/ironwifi/network/active-users
```
Returns active users grouped by router.

**Get Network Statistics**
```
GET /api/ironwifi/network/stats
```
Returns network totals and top routers by user count.

### Admin Endpoints

**API Status Check**
```
GET /api/ironwifi/status
```
Check if IronWifi is configured and connected.

**Manual Sync**
```
POST /api/ironwifi/sync
```
Trigger immediate sync of session data.

**Update Daily Stats**
```
POST /api/ironwifi/update-daily-stats
```
Recalculate daily aggregated statistics.

**List Routers with MACs**
```
GET /api/ironwifi/routers-with-mac
```
Get all routers that have MAC addresses configured.

## Sync Process Details

### Automatic Sync (Every 5 Minutes)

1. Fetch active sessions from IronWifi API
2. Get all routers with MAC addresses from database
3. Match sessions to routers by MAC address (normalized)
4. Upsert sessions (insert new, update existing)
5. Mark sessions as inactive if not in current batch
6. Refresh `router_active_users` materialized view
7. Update sync timestamp

### Manual Sync

You can trigger a sync at any time:
```bash
curl -X POST http://localhost:3001/api/ironwifi/sync
```

### Daily Statistics Update

Runs automatically as part of each sync. Aggregates:
- Total unique users per day
- Total session count
- Total bandwidth (upload + download)
- Peak concurrent users
- Average session duration

## Monitoring & Troubleshooting

### Check Sync Status

```sql
-- View last sync time
SELECT * FROM ironwifi_sessions 
ORDER BY updated_at DESC LIMIT 1;

-- Count active sessions
SELECT COUNT(*) FROM ironwifi_sessions 
WHERE is_active = true;

-- Sessions by router
SELECT 
  r.router_name,
  COUNT(s.id) as session_count,
  COUNT(DISTINCT s.username) as unique_users
FROM routers r
LEFT JOIN ironwifi_sessions s ON r.id = s.router_id AND s.is_active = true
GROUP BY r.id, r.router_name
ORDER BY session_count DESC;
```

### Common Issues

**Issue: No sessions syncing**
- Check: Are router MAC addresses populated?
- Check: Do MACs match IronWifi access point MACs?
- Verify: `curl http://localhost:3001/api/ironwifi/routers-with-mac`

**Issue: Sessions not matching routers**
- Symptom: `unmatchedSessions` count in sync response
- Cause: MAC address mismatch
- Solution: Verify router MACs match IronWifi AP MACs exactly
- Debug: Check IronWifi console for AP MAC format

**Issue: API connection fails**
- Check: `IRONWIFI_API_KEY` is correct
- Check: `IRONWIFI_NETWORK_ID` is correct
- Verify: `curl http://localhost:3001/api/ironwifi/status`
- Check logs for authentication errors

**Issue: Stale sessions**
- Symptom: Sessions marked active but user disconnected
- Cause: IronWifi API delay or sync missed a cycle
- Solution: Sessions auto-expire after not appearing in 2 sync cycles

### Logs

Check backend logs for sync activity:
```bash
tail -f backend/logs/app.log | grep -i ironwifi
```

Look for:
- `IronWifi sync started`
- `IronWifi sync completed: X new, Y updated`
- `IronWifi API error:` (errors)

## Performance Considerations

### Database Indexes

The migration creates 8 indexes for optimal performance:
- MAC address lookups
- Active session queries
- Date range queries
- Router statistics

### Materialized View

`router_active_users` is a materialized view that caches active user counts per router. It's refreshed on every sync (every 5 minutes).

For very large datasets, consider:
- Increasing sync interval to 10-15 minutes
- Adding data retention policy (e.g., delete sessions older than 90 days)

### Data Retention

By default, all sessions are kept indefinitely. To implement retention:

```sql
-- Delete sessions older than 90 days
DELETE FROM ironwifi_sessions 
WHERE end_time < NOW() - INTERVAL '90 days';

-- Delete stats older than 1 year
DELETE FROM router_user_stats 
WHERE stat_date < CURRENT_DATE - INTERVAL '1 year';
```

Add this as a scheduled job (cron or PostgreSQL pg_cron extension).

## Frontend Integration (Coming Soon)

### Router Dashboard Widgets

**Active Users Card**
- Display count of currently connected users
- Show trend (up/down from previous period)
- Click to see user list

**Session History Chart**
- Line chart showing users over time
- Hourly, daily, weekly views

**User Connection Table**
- List of current users with device info
- Connection duration, bandwidth used
- Last seen timestamp

### Network Overview

**Connected Users Metric**
- Total users across all routers
- Comparison to previous periods

**Top Routers by Usage**
- List of routers with most active connections
- Usage patterns and peak times

## Privacy & Security

### Data Collection

The system collects:
- Username (from captive portal login)
- Device MAC address
- Connection timestamps
- Bandwidth usage
- Device type/OS (if available)

### GDPR Considerations

If operating in EU/regions with privacy regulations:
1. Add data retention policy (90-day recommendation)
2. Consider anonymizing usernames after X days
3. Provide data export for user requests
4. Document data processing in privacy policy

### Anonymization

To anonymize old sessions:
```sql
UPDATE ironwifi_sessions
SET 
  username = MD5(username),
  client_mac = NULL
WHERE end_time < NOW() - INTERVAL '30 days';
```

## Future Enhancements

- [ ] Real-time WebSocket updates for active user count
- [ ] ClickUp integration: sync user count to custom fields
- [ ] Alerts: notify when router has zero users for X hours
- [ ] Bandwidth analytics: identify high-usage routers
- [ ] Return visitor tracking: identify frequent users
- [ ] Mobile app: active user badges on router cards
- [ ] Export: CSV download of session history

## Support

For issues or questions:
1. Check logs: `backend/logs/app.log`
2. Verify configuration: `GET /api/ironwifi/status`
3. Test API manually: Use Postman/curl with IronWifi API
4. Check MAC address format and matching

## References

- [IronWifi API Documentation](https://api.ironwifi.com/)
- [IronWifi Console](https://console.ironwifi.com/)
- Router Logger Backend: `backend/src/services/ironwifiClient.js`
- Sync Service: `backend/src/services/ironwifiSync.js`
- API Routes: `backend/src/routes/ironwifi.js`
