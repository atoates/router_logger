# RMS API Integration Guide

This guide shows you how to connect your Router Logger directly to the Teltonika RMS API to automatically pull device data.

## Why Use RMS API Integration?

**Benefits:**
- ✅ **No router configuration needed** - Pull data from RMS instead of configuring each router
- ✅ **Centralized control** - Manage everything from RMS
- ✅ **Automatic sync** - Data syncs every 15 minutes (configurable)
- ✅ **Works alongside push methods** - Use both RMS API pull AND router push simultaneously
- ✅ **Get historical data** - Pull existing data from RMS

## Step 1: Get Your RMS Personal Access Token

1. **Log in to Teltonika RMS**: https://rms.teltonika-networks.com/

2. **Navigate to your profile**:
   - Click your username/avatar (top right)
   - Select **"Account Settings"** or **"Profile"**

3. **Go to Personal Access Tokens**:
   - Look for **"Personal Access Tokens"** or **"API Tokens"** section
   - Click **"Create New Token"** or **"Generate Token"**

4. **Create Token**:
   - **Name**: `Router Logger API` (or whatever you prefer)
   - **Scopes**: Select all device-related scopes:
     - `devices:read` - Read device information
     - `monitoring:read` - Read monitoring data
     - `statistics:read` - Read statistics data
   - Click **"Generate"** or **"Create"**

5. **Copy Token**:
   - ⚠️ **IMPORTANT**: Copy the token immediately - you won't be able to see it again!
   - Store it safely (you'll add it to Railway in the next step)

## Step 2: Add Token to Railway

### Option A: Via Railway Web Dashboard

1. **Open your Railway project**: https://railway.com/project/7b2bc4f9-a4be-467d-9ea5-69539500e818

2. **Click on your backend service**

3. **Go to "Variables" tab**

4. **Add new variable**:
   - **Key**: `RMS_ACCESS_TOKEN`
   - **Value**: Paste your RMS Personal Access Token
   - Click **"Add"**

5. **Optional - Set sync interval**:
   - **Key**: `RMS_SYNC_INTERVAL_MINUTES`
   - **Value**: `15` (or any number of minutes between syncs)
   - Click **"Add"**

6. **Redeploy**: The service should redeploy automatically

### Option B: Via Railway CLI

```bash
cd /Users/ato/VS\ Code/RouterLogger/backend
railway variables --set RMS_ACCESS_TOKEN='your-token-here'
railway variables --set RMS_SYNC_INTERVAL_MINUTES=15
railway up
```

## Step 3: Verify It's Working

### Check Sync Status

```bash
# Via curl (replace with your Railway URL)
curl https://your-backend.up.railway.app/api/rms/status
```

Expected response:
```json
{
  "enabled": true,
  "syncInterval": "15",
  "message": "RMS integration is enabled"
}
```

### Manually Trigger Sync

```bash
curl -X POST https://your-backend.up.railway.app/api/rms/sync
```

Expected response:
```json
{
  "success": true,
  "message": "RMS sync completed",
  "successCount": 25,
  "errorCount": 0,
  "total": 25
}
```

### Check Logs

```bash
railway logs
```

Look for:
```
info: Starting RMS sync...
info: Fetched 25 devices from RMS
info: RMS sync complete: 25 successful, 0 errors
```

## How It Works

1. **Scheduled Sync**: Every 15 minutes (configurable), the system:
   - Calls RMS API to get all your devices
   - Fetches monitoring data for each device (cellular signal, data usage, etc.)
   - Transforms RMS data format to our telemetry format
   - Saves to database

2. **Data Collected**:
   - Device info (serial, IMEI, name, location)
   - Cellular data (operator, MCC/MNC, network type)
   - Signal quality (RSRP, RSRQ, RSSI, SINR)
   - Cell tower info (LAC/TAC, Cell ID)
   - Data usage (TX/RX bytes)
   - WiFi clients
   - System info (uptime, firmware version)

3. **Available in Dashboard**: All synced data appears in your Router Logger dashboard just like push data

## API Endpoints

### GET /api/rms/status
Check if RMS integration is enabled and configured

### POST /api/rms/sync
Manually trigger an RMS sync (useful for testing)

## Troubleshooting

### "RMS integration is disabled"
- Make sure `RMS_ACCESS_TOKEN` is set in Railway variables
- Check the token is valid (try it with a curl command to RMS API)

### "Error fetching devices from RMS"
- Check your token has the correct scopes (`devices:read`, `monitoring:read`)
- Verify your RMS account has devices added
- Check RMS API status: https://status.rms.teltonika-networks.com/

### Devices syncing but no data showing
- Check that devices in RMS are online
- Verify monitoring data is available in RMS dashboard
- Check logs for transformation errors

### Rate Limiting
- RMS API has rate limits
- Default sync interval (15 min) is safe for 100+ devices
- For very large fleets (500+), increase interval to 30-60 minutes

## Best Practices

1. **Keep Token Secret**: Never commit tokens to git, use environment variables
2. **Regular Token Rotation**: Create new tokens periodically and delete old ones
3. **Monitor Sync Health**: Check logs regularly to ensure syncs are successful
4. **Start with Manual Sync**: Test with `POST /api/rms/sync` before relying on scheduled sync
5. **Use Both Methods**: Keep RMS API sync AND router push for redundancy

## Combination with Router Push

You can use **both** methods simultaneously:

- **RMS API Pull** (every 15 min): Regular scheduled updates, historical data
- **Router Push** (every 5 min): More frequent updates, real-time data

The system automatically deduplicates - the most recent data is always used.

## Next Steps

1. ✅ Add RMS_ACCESS_TOKEN to Railway
2. ✅ Test with manual sync: `POST /api/rms/sync`
3. ✅ Check dashboard - devices should appear
4. ✅ Monitor logs to ensure scheduled syncs work
5. ✅ Optional: Configure routers to also push data for real-time updates

---

**Documentation**: https://developers.rms.teltonika-networks.com/
**RMS Status**: https://status.rms.teltonika-networks.com/
