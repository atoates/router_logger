# IronWifi Rate Limit Protection

## Overview

IronWifi API has rate limits that we must respect to avoid service disruption. This document explains our protection mechanisms and best practices.

## Your API Key

```
IRONWIFI_API_KEY=779cfe99-f15d-4318-8d30-9fafeb46ed7d
```

**⚠️ Keep this private! Do not commit to git or share publicly.**

## Rate Limit Protection Mechanisms

### 1. Client-Side Tracking
**Location**: `backend/src/services/ironwifiClient.js`

- Tracks every API call made
- Maintains hourly counter (resets every 60 minutes)
- Logs API usage percentage

**Configuration**:
```bash
IRONWIFI_HOURLY_LIMIT=1000  # Default: 1000 calls/hour
```

### 2. Pre-Request Blocking
**Location**: `ironwifiClient.js` - Request Interceptor

Before each API call:
- Checks if we've hit the hourly limit
- If over limit: Throws error immediately (doesn't waste API quota)
- If at 80%+: Logs warning with remaining quota
- Tracks call count in logs

**Error Response**:
```javascript
{
  message: "IronWifi API rate limit exceeded (1000/hour). Resets in 23 minutes.",
  isRateLimitError: true,
  resetTime: "2024-11-10T15:30:00Z"
}
```

### 3. Pre-Sync Check
**Location**: `backend/src/services/ironwifiSync.js` - Line 82

Before starting each sync:
- Checks current API usage
- If over 90% of limit: Skips sync entirely
- Logs reason and next reset time

**Skip Response**:
```javascript
{
  success: false,
  skipped: true,
  reason: "Rate limit approaching",
  apiUsage: { callsMade: 920, limit: 1000, remaining: 80 }
}
```

### 4. Server Response Handling
**Location**: `ironwifiClient.js` - Response Interceptor

If IronWifi returns HTTP 429 (Too Many Requests):
- Catches the error
- Flags as rate limit error
- Extracts `Retry-After` header
- Logs warning and stops processing

### 5. Graceful Sync Failure
**Location**: `ironwifiSync.js` - Error Handler

If rate limit hit during sync:
- Marks sync as skipped (not failed)
- Returns detailed error info
- Doesn't mark as catastrophic failure
- Next sync attempt waits for reset

## Sync Frequency

**Default**: 15 minutes (4 calls/hour)

**Why not 5 minutes?**
- 5 min = 12 calls/hour
- Over 24 hours = 288 calls/day
- Leaves room for manual syncs, status checks, etc.
- 15 min is safer and still near real-time

**Configuration**:
```bash
IRONWIFI_SYNC_INTERVAL_MINUTES=15  # Recommended: 15-30
```

## API Call Budget

### Per Sync Cycle
- **1 call**: `getActiveSessions()` - fetches ALL sessions at once
- **0 calls per router**: We don't call per-router, saves quota

### Estimated Daily Usage (15-min intervals)
- Syncs per day: 96 (24 hours × 4 per hour)
- API calls per day: 96
- Hourly average: 4 calls/hour
- **Percentage of limit**: ~0.4% per hour

### Estimated Daily Usage (5-min intervals)
- Syncs per day: 288
- API calls per day: 288
- Hourly average: 12 calls/hour
- **Percentage of limit**: ~1.2% per hour

### Buffer for Other Operations
- Manual sync triggers
- Status checks (`/api/ironwifi/status`)
- Testing and debugging
- **Recommendation**: Keep automatic syncs under 50% of quota

## Monitoring API Usage

### Real-Time Status
```bash
curl http://localhost:3001/api/ironwifi/status
```

**Response**:
```json
{
  "enabled": true,
  "apiConnected": true,
  "lastSync": "2024-11-10T14:30:00Z",
  "activeSessions": 42,
  "apiUsage": {
    "callsMade": 45,
    "limit": 1000,
    "remaining": 955,
    "percentageUsed": "4.5",
    "resetInMinutes": 32,
    "resetTime": "2024-11-10T15:00:00Z"
  }
}
```

### Log Files
Check backend logs for API usage:
```bash
tail -f backend/logs/app.log | grep -i "ironwifi"
```

**Look for**:
- `IronWifi API usage: 45/1000 calls (955 remaining)`
- `IronWifi API call counter reset. Previous hour: 96 calls`
- `IronWifi sync skipped - approaching rate limit`

## What If We Hit the Limit?

### Automatic Behavior
1. **90% threshold**: Syncs automatically skip
2. **100% threshold**: All API calls blocked
3. **After 1 hour**: Counter resets, syncs resume

### Manual Recovery
```bash
# Check status
curl http://localhost:3001/api/ironwifi/status

# Wait for reset (check resetInMinutes)
# Then manually trigger sync
curl -X POST http://localhost:3001/api/ironwifi/sync
```

### Long-Term Solutions
If consistently hitting limits:
1. **Increase interval**: 20-30 minutes
2. **Lower hourly limit**: Set `IRONWIFI_HOURLY_LIMIT=500` to be more conservative
3. **Contact IronWifi**: Request higher rate limit for your account

## Best Practices

### DO:
✅ Start with 15-minute intervals
✅ Monitor `/api/ironwifi/status` regularly
✅ Check logs daily for rate limit warnings
✅ Keep `IRONWIFI_HOURLY_LIMIT` below actual IronWifi limit (safety buffer)
✅ Test changes in development first

### DON'T:
❌ Set sync interval below 5 minutes
❌ Make manual API calls in loops
❌ Ignore rate limit warnings in logs
❌ Assume 1000/hour is the real limit (may be lower)
❌ Share your API key publicly

## Configuration Examples

### Conservative (Recommended for Start)
```bash
IRONWIFI_SYNC_INTERVAL_MINUTES=20
IRONWIFI_HOURLY_LIMIT=800  # Buffer below 1000
```
- 3 syncs/hour = 72 calls/day
- 9% of hourly quota used
- Large buffer for errors/retries

### Balanced
```bash
IRONWIFI_SYNC_INTERVAL_MINUTES=15
IRONWIFI_HOURLY_LIMIT=1000
```
- 4 syncs/hour = 96 calls/day
- 12% of hourly quota used
- Good balance of freshness and safety

### Aggressive (Not Recommended Initially)
```bash
IRONWIFI_SYNC_INTERVAL_MINUTES=5
IRONWIFI_HOURLY_LIMIT=1000
```
- 12 syncs/hour = 288 calls/day
- 36% of hourly quota used
- Less buffer for spikes

## Troubleshooting

### Sync keeps skipping
**Symptom**: Logs show "Rate limit approaching"
**Cause**: API usage over 90%
**Solution**: 
1. Check `/api/ironwifi/status` for `resetInMinutes`
2. Wait for counter reset
3. Consider increasing sync interval

### Getting 429 errors
**Symptom**: "IronWifi API rate limit (429)"
**Cause**: Server-side rate limit hit
**Solution**:
1. System will automatically stop making calls
2. Check `Retry-After` header in logs
3. Increase `IRONWIFI_SYNC_INTERVAL_MINUTES`
4. Lower `IRONWIFI_HOURLY_LIMIT` for more conservative protection

### Counter not resetting
**Symptom**: `callsMade` stays high
**Cause**: Server hasn't been running for full hour
**Solution**: Counter resets exactly 60 minutes after first call. Wait for natural reset.

## MAC Address Tracking

**Good News**: The system now automatically captures MAC addresses from RMS API!

**How It Works**:
1. During RMS sync, we extract MAC address from device data
2. MAC is stored in `routers.mac_address` column
3. IronWifi sync uses MAC to match sessions to routers

**Verify MAC Addresses**:
```sql
SELECT router_id, name, mac_address, last_seen 
FROM routers 
WHERE mac_address IS NOT NULL 
ORDER BY last_seen DESC;
```

**If MACs are missing**:
- Check RMS API response for MAC field
- May need to manually populate (see IRONWIFI-INTEGRATION.md)
- Check which MAC IronWifi is tracking (WLAN vs LAN vs WAN)

## Summary

✅ **Yes, you need the API key as an environment variable**
✅ **Yes, we already log MAC addresses** (newly added)
✅ **Yes, we have comprehensive rate limit protection**
✅ **Recommended**: Start with 15-20 minute intervals and monitor usage

**Next Steps**:
1. Add `IRONWIFI_API_KEY=779cfe99-f15d-4318-8d30-9fafeb46ed7d` to `.env`
2. Find your `IRONWIFI_NETWORK_ID` from IronWifi Console
3. Run database migration `007_add_ironwifi_tables.sql`
4. Restart backend server
5. Check `/api/ironwifi/status` after first sync
6. Monitor logs for MAC address population from RMS sync
