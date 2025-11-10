# MAC Address Sync Setup

## Overview

MAC addresses are now synced between ClickUp, the database, and IronWifi webhooks to enable user session tracking.

## 🚨 CRITICAL: Run Database Migration First

Before anything works, you MUST run the migration to add the `mac_address` column:

```bash
cd backend
./run_migration.sh
```

Or via Railway CLI:
```bash
railway shell
cd backend
./run_migration.sh
```

Or directly via psql:
```bash
psql "$DATABASE_URL" -f backend/database/migrations/007_add_ironwifi_tables.sql
```

## MAC Address Flow

### Three Sources of MAC Addresses

1. **ClickUp Custom Field** (Primary Source - Manual Entry)
   - Field Name: "MAC Address"
   - Format: Text field
   - Users enter MAC addresses in router tasks
   - Synced TO database every 30 minutes
   - Synced FROM database on every router update

2. **RMS API** (Automatic)
   - Extracted from device data during RMS sync
   - Fields checked: `device.mac_address`, `device.mac`, `hw.mac_address`, `network.mac`, `wifi.mac_address`
   - Automatically stored in database

3. **IronWifi Webhooks** (Matching)
   - Webhook reports include AP MAC addresses
   - Matched against router MAC addresses in database
   - Sessions stored with matched router_id

## Auto-Discovery

The ClickUp sync service will automatically discover the MAC Address custom field ID on first use. No manual configuration needed!

## API Endpoints

### Sync MAC Addresses FROM ClickUp TO Database
```bash
POST /api/clickup/sync/mac-addresses
```

This reads the MAC Address custom field from all router tasks in ClickUp and updates the local database.

**Example:**
```bash
curl -X POST https://routerlogger-production.up.railway.app/api/clickup/sync/mac-addresses
```

**Response:**
```json
{
  "success": true,
  "synced": 5,
  "errors": 0,
  "duration": 2453
}
```

### Regular ClickUp Sync (Includes MAC TO ClickUp)
The regular sync endpoint already includes MAC address syncing FROM database TO ClickUp:

```bash
POST /api/clickup/sync
```

## Sync Schedule

### Automatic Syncs
- **Database → ClickUp**: Every 30 minutes (includes MAC addresses)
- **ClickUp → Database**: Manual trigger only (use `/api/clickup/sync/mac-addresses`)

### When to Trigger MAC Sync
- After users manually add MAC addresses to ClickUp tasks
- After initial setup to populate existing MAC addresses
- When troubleshooting IronWifi session matching

## Workflow

### Initial Setup
1. ✅ Add "MAC Address" custom field to ClickUp (DONE)
2. ⚠️ **Run database migration** (REQUIRED - BLOCKING)
3. 🔄 Users manually enter MAC addresses in ClickUp router tasks
4. 🔄 Run initial MAC sync: `POST /api/clickup/sync/mac-addresses`
5. 🔄 Verify MAC addresses in database
6. 🔄 Wait for IronWifi webhook to receive reports
7. 🔄 Check session matching

### Ongoing Operation
1. RMS sync runs hourly → extracts MAC from device data → stores in database
2. ClickUp sync runs every 30 minutes → sends MAC from database to ClickUp
3. Users can manually add/edit MAC in ClickUp → trigger MAC sync to database
4. IronWifi webhooks arrive hourly → match AP MAC to router MAC → store sessions

## Verification

### Check MAC Addresses in Database
```sql
SELECT router_id, name, mac_address 
FROM routers 
WHERE mac_address IS NOT NULL 
ORDER BY router_id;
```

### Check IronWifi Session Matching
```sql
SELECT 
  s.router_id,
  r.name AS router_name,
  r.mac_address AS router_mac,
  COUNT(*) as session_count
FROM ironwifi_sessions s
JOIN routers r ON s.router_id = r.router_id
GROUP BY s.router_id, r.name, r.mac_address
ORDER BY session_count DESC;
```

### Check Unmatched Sessions (No Router Found)
```sql
SELECT ap_mac_address, COUNT(*) as session_count
FROM ironwifi_sessions
WHERE router_id IS NULL
GROUP BY ap_mac_address
ORDER BY session_count DESC;
```

## Troubleshooting

### Sessions Not Matching Routers
1. Check if MAC addresses are in database: `SELECT COUNT(*) FROM routers WHERE mac_address IS NOT NULL`
2. Check AP MAC format in webhook logs
3. Verify MAC format matches (should be consistent format like `AA:BB:CC:DD:EE:FF`)
4. Check webhook logs for matching attempts

### ClickUp Sync Not Including MAC
1. Verify migration ran successfully: `\d routers` in psql should show `mac_address` column
2. Check if MAC Address field was auto-discovered: Look for log message "Auto-discovered MAC Address field ID"
3. Verify routers have MAC addresses: `SELECT router_id, mac_address FROM routers WHERE mac_address IS NOT NULL`

### MAC Not Syncing FROM ClickUp
1. Run manual sync: `POST /api/clickup/sync/mac-addresses`
2. Check logs for "MAC address sync complete"
3. Verify custom field exists in ClickUp and has values
4. Check field ID was discovered correctly

## Code Changes

### Files Modified
1. `backend/src/services/clickupSync.js`
   - Added `MAC_ADDRESS` to `CUSTOM_FIELDS` (auto-discovery)
   - Added `discoverMacAddressField()` function
   - Updated `syncRouterToClickUp()` to include MAC address
   - Added `syncMacAddressesFromClickUp()` for reverse sync
   - Updated SQL query to fetch `mac_address` column

2. `backend/src/routes/clickup.js`
   - Added `POST /api/clickup/sync/mac-addresses` endpoint

3. `backend/database/migrations/007_add_ironwifi_tables.sql`
   - Added `mac_address` column to routers table
   - Added `ironwifi_ap_id` and `ironwifi_ap_name` columns
   - Created `ironwifi_sessions` table
   - Created `router_user_stats` table
   - Created `router_active_users` materialized view

### Files Ready to Use
- `backend/src/services/rmsSync.js` - Already extracts MAC from RMS
- `backend/src/models/router.js` - Already handles mac_address in upsertRouter
- `backend/src/routes/ironwifiWebhook.js` - Already matches MAC for session storage

## Next Steps

1. **CRITICAL**: Run the database migration
2. Test ClickUp sync to verify MAC Address field is discovered
3. Manually add a few MAC addresses to router tasks in ClickUp
4. Run MAC sync: `POST /api/clickup/sync/mac-addresses`
5. Verify MAC addresses populated in database
6. Wait for next IronWifi webhook (hourly at :35)
7. Check session matching and verify user data is being stored
8. Build frontend components to display user sessions

## Impact

Once the migration runs:
- ✅ RMS sync will work again (currently failing)
- ✅ IronWifi webhook can store session data
- ✅ ClickUp sync will include MAC addresses
- ✅ User session tracking will be operational
