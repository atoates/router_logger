# Troubleshooting Notes - January 7, 2026
## Captive Portal Dashboard Integration & RADIUS Accounting

### Initial Problem
- Success page was showing wrong MAC address in dashboard link
- Dashboard showed "No active session found" despite users being connected
- Data usage was not syncing from RADIUS to main RouterLogger dashboard

---

## Issue #1: MAC Address in Success Page Link

### Problem
URL generated: `134.122.101.195:8081/usage?mac=02-19-C1-7A-78-94`  
User's actual MAC: `04:BF:D5:A6:AD:39`

### Investigation
- The MAC `02-19-C1-7A-78-94` is iOS randomized MAC (privacy feature)
- This is actually correct - it's the MAC the device uses on THIS network
- Not a bug - working as designed

### Lesson Learned
Modern devices (iOS/Android) use randomized MAC addresses for WiFi privacy. The "wrong" MAC is actually the correct one for that connection.

---

## Issue #2: Dashboard Link Showing Wrong MAC

### Problem
Success page redirect wasn't passing MAC address in URL parameter

### Files Modified
- `/radius-server/captive-portal/src/routes/auth.js` (lines 587, 690, 845)
- `/radius-server/captive-portal/src/views/success.ejs`

### Solution
```javascript
// Added MAC to redirect URLs
redirect: `/success?type=free&token=${successToken}&mac=${encodeURIComponent(client_mac)}`
```

### Commands Used
```bash
cd "/Users/ato/VS Code/RouterLogger/radius-server"
tar czf - captive-portal/ | ssh root@134.122.101.195 "cd /opt/radius-server/radius-server && tar xzf - && docker compose build captive-portal && docker compose up -d captive-portal"
```

---

## Issue #3: Switched to Username-Based Lookup

### Problem
MAC address approach was unreliable due to iOS randomization and timing issues

### Solution
Changed dashboard to use RADIUS username (e.g., `free-1767824504947-u2g922`) instead of MAC

### Files Modified
- `/radius-server/captive-portal/src/routes/portal.js`
- `/radius-server/captive-portal/src/views/success.ejs`

### Changes Made
```javascript
// Portal.js - Added username parameter support
const { mac, username } = req.query;
const radiusUsername = username || req.session?.username;

// Success.ejs - Changed dashboard link
<a href="/usage?username=<%= encodeURIComponent(dashboardUsername) %>">
```

---

## Issue #4: RADIUS Accounting Data Not Being Written

### Problem
Dashboard always showed "No active session found" even after username fix

### Investigation Steps

#### Step 1: Check if RADIUS is receiving accounting packets
```bash
ssh root@134.122.101.195 "docker logs freeradius --tail=100 | grep -E 'Acct-Status-Type|User-Name'"
```

**Result:** ✅ FreeRADIUS WAS receiving accounting packets

#### Step 2: Check database for accounting data
```bash
ssh root@134.122.101.195 'docker exec radius-db mysql -u radius -p"lI5ST8a0WJ2GrvE5SSn1Vw" radius -e "SELECT username, callingstationid, acctstarttime, acctinputoctets, acctoutputoctets FROM radacct ORDER BY acctstarttime DESC LIMIT 10;"'
```

**Result:** ❌ NO DATA! Database was empty despite FreeRADIUS receiving packets

#### Step 3: Check FreeRADIUS SQL configuration
```bash
ssh root@134.122.101.195 "docker logs freeradius --tail=200 | grep -i -E 'sql|query'"
```

**Result:** Found error:
```
(25) sql: EXPAND .query
(25) sql:    --> .query
(25) sql: WARNING: No such configuration item .query
```

### Root Cause #1: SQL Module Not Enabled in Accounting Section

**Check accounting configuration:**
```bash
ssh root@134.122.101.195 "docker exec freeradius grep -A 40 'accounting {' /etc/freeradius/sites-enabled/default | grep -E 'sql'"
```

**Found:** SQL was commented out with `-sql` prefix

**Fix:**
```bash
ssh root@134.122.101.195 "docker exec freeradius sed -i 's/^\s*-sql$/        sql/' /etc/freeradius/sites-enabled/default && docker restart freeradius"
```

### Root Cause #2: Missing Interim-Update Query

**Problem:** CoovaChilli was sending `Interim-Update` packets, not `Start` packets  
**Error:** FreeRADIUS SQL module had no query defined for interim updates

**Files Modified:**
- `/radius-server/config/freeradius/mods-enabled/sql`

**Fix Applied:**
```sql
-- Changed from incorrect attribute names:
start_query = "INSERT..."
interim_query = "UPDATE..."

-- To correct FreeRADIUS attribute names:
accounting_start_query = "INSERT..."
accounting_update_query = "INSERT...ON DUPLICATE KEY UPDATE..." 
accounting_stop_query = "UPDATE..."
```

**Key Fix:** Used `INSERT...ON DUPLICATE KEY UPDATE` for accounting_update_query to handle interim updates that arrive before start packets

### Deployment Commands
```bash
cd "/Users/ato/VS Code/RouterLogger/radius-server"
tar czf - . | ssh root@134.122.101.195 "cd /opt/radius-server/radius-server && tar xzf - && docker compose down && docker compose up -d --build"
```

### Verification
```bash
# Check if accounting data is now being written
ssh root@134.122.101.195 'docker exec radius-db mysql -u radius -p"lI5ST8a0WJ2GrvE5SSn1Vw" radius -e "SELECT COUNT(*) FROM radacct;"'
```

---

## Issue #5: Username Mismatch Between Webhook and RADIUS

### Problem
After fixing RADIUS accounting, sync still didn't work because:
- **RADIUS database** used username: `free-1767824504947-u2g922`
- **wifi_guest_sessions table** had username: `debug@test.com`

### Investigation
```bash
# Check RADIUS data
ssh root@134.122.101.195 'docker exec radius-db mysql -u radius -p"lI5ST8a0WJ2GrvE5SSn1Vw" radius -e "SELECT username FROM radacct LIMIT 5;"'

# Output: free-1767824504947-u2g922, free-1767807624477-1g2vov, etc.

# Check RouterLogger data  
# Guest dashboard showed: debug@test.com, debug2@test.com
```

**Root Cause:** Captive portal webhook was sending `username: email` instead of `username: guestId`

### Files Modified
- `/radius-server/captive-portal/src/routes/auth.js`

### Fix Applied
```javascript
// BEFORE (wrong):
await notifyRouterLogger({
    type: 'registration_completed',
    username: email,  // ❌ Wrong - can't match with RADIUS
    email: email.trim(),
    ...
});

// AFTER (correct):
await notifyRouterLogger({
    type: 'registration_completed',
    username: guestId,  // ✅ Correct - matches RADIUS username
    email: email.trim(),
    ...
});
```

**Applied to multiple webhook locations:**
- Line 483: registration_completed
- Line 670: free_access_granted
- Other event types

---

## Solution: RADIUS Accounting Sync Service

### Implementation
Created automatic sync service to pull RADIUS accounting data into RouterLogger

**Files Created:**
1. `/backend/src/services/radiusAccountingSync.js` - Main sync service
2. `/backend/src/routes/guestWifi.js` - Added sync API endpoints
3. `/backend/src/server.js` - Added auto-sync scheduler

### Features Implemented

#### 1. Automatic Sync (Every 2 Minutes)
```javascript
setInterval(async () => {
    const result = await radiusSync.syncAllActiveSessions();
    logger.info(`RADIUS accounting sync: ${result.synced} synced, ${result.errors} errors`);
}, 2 * 60 * 1000);
```

#### 2. Manual Sync Endpoints
```bash
# Sync all active sessions
POST /api/guests/sync-accounting

# Sync specific user
POST /api/guests/:username/sync

# Get real-time usage
GET /api/guests/:username/usage

# Reset user data allowance (admin action)
POST /api/guests/:username/reset-usage
```

#### 3. Database Configuration
Added to `/backend/.env.example`:
```bash
RADIUS_DB_HOST=134.122.101.195
RADIUS_DB_PORT=3306
RADIUS_DB_USER=radius
RADIUS_DB_PASS=lI5ST8a0WJ2GrvE5SSn1Vw
RADIUS_DB_NAME=radius
```

#### 4. Sync Logic
```javascript
// Query RADIUS accounting
const [radiusRows] = await radiusPool.execute(`
    SELECT 
        username,
        SUM(acctinputoctets) as bytes_uploaded,
        SUM(acctoutputoctets) as bytes_downloaded,
        SUM(acctsessiontime) as total_seconds
    FROM radacct 
    WHERE username = ? 
    GROUP BY username
`, [username]);

// Update RouterLogger session
await pgPool.query(`
    UPDATE wifi_guest_sessions 
    SET 
        bytes_uploaded = $1,
        bytes_downloaded = $2,
        bytes_total = $3,
        session_duration_seconds = $4,
        last_accounting_update = NOW()
    WHERE username = $5 
    AND session_end IS NULL
`, [bytes_uploaded, bytes_downloaded, bytes_total, total_seconds, username]);
```

### Dependencies Added
```bash
cd backend
npm install mysql2
```

Updated `backend/package.json`:
```json
{
  "dependencies": {
    "mysql2": "^3.6.0"
  }
}
```

---

## Database Cleanup

### Problem
During debugging, many test sessions were created with cooldown blocks

### Cleanup SQL
Created `/backend/database/migrations/030_clear_debug_sessions.sql`:
```sql
-- Clear all free usage tracking (removes cooldowns)
DELETE FROM captive_free_usage;

-- Clear recent test sessions
DELETE FROM wifi_guest_sessions WHERE session_start >= NOW() - INTERVAL '24 hours';
```

### Execution
```bash
# Via Railway CLI
railway connect postgres

# Then run:
DELETE FROM captive_free_usage;
DELETE FROM wifi_guest_sessions WHERE session_start >= NOW() - INTERVAL '24 hours';
SELECT COUNT(*) as remaining_sessions FROM wifi_guest_sessions;
```

---

## Router CLI Commands Used

### CoovaChilli Status Check
```bash
ssh root@192.168.1.1
ubus call chilli get_status
```

### View Active Sessions
```bash
cat /var/run/chilli.conf
cat /var/run/chilli.pid
```

### Restart Services
```bash
/etc/init.d/chilli restart
/etc/init.d/freeradius restart
```

---

## Docker Commands Used

### View Logs
```bash
# Captive portal logs
ssh root@134.122.101.195 "docker logs captive-portal --tail=100"

# FreeRADIUS logs
ssh root@134.122.101.195 "docker logs freeradius --tail=100"

# Follow logs in real-time
ssh root@134.122.101.195 "docker logs -f captive-portal"
```

### Database Queries
```bash
# Connect to RADIUS database
ssh root@134.122.101.195 "docker exec -it radius-db mysql -u radius -p"

# Run direct query
ssh root@134.122.101.195 'docker exec radius-db mysql -u radius -p"PASSWORD" radius -e "SELECT * FROM radacct LIMIT 5;"'
```

### Container Management
```bash
# Restart specific service
ssh root@134.122.101.195 "docker restart freeradius"

# Full redeployment
ssh root@134.122.101.195 "cd /opt/radius-server/radius-server && docker compose down && docker compose up -d --build"

# View container status
ssh root@134.122.101.195 "docker ps"
```

---

## Lessons Learned

### 1. **iOS/Android Randomized MAC Addresses**
- Modern devices use random MACs for privacy
- Don't rely on hardware MAC - use the connection MAC
- This is by design, not a bug

### 2. **RADIUS Username is More Reliable Than MAC**
- Captive portal generates unique usernames per session
- MAC addresses can be randomized or change
- Username provides stable identifier for sync

### 3. **FreeRADIUS SQL Configuration is Critical**
- SQL module must be enabled in accounting section (not `-sql`)
- Must have queries for: start, interim-update (update), and stop
- CoovaChilli often sends interim-update BEFORE start packet
- Use `INSERT...ON DUPLICATE KEY UPDATE` for resilience

### 4. **Webhook Username Must Match RADIUS Username**
- If webhook sends email, but RADIUS uses generated ID, sync fails
- Always send the actual RADIUS username in webhooks
- Email can be a separate field

### 5. **Accounting Timeout Issues**
- If RADIUS accounting times out, it's non-fatal
- CoovaChilli will retry
- Don't block registration on accounting success

### 6. **Testing with Real Devices**
- Local testing doesn't reveal iOS privacy features
- Always test with actual mobile devices
- Emulators/browsers don't show randomized MACs

### 7. **Database Sync Timing**
- Accounting data takes 30-60 seconds to appear
- Auto-sync every 2 minutes is reasonable
- Don't expect instant data on fresh connections

### 8. **Cooldown Management**
- In-memory cache persists until container restart
- Database cooldowns need manual clearing for testing
- Consider admin API to clear specific users

---

## Final Architecture

### Data Flow
```
User Device (iOS/Android)
    ↓ (randomized MAC)
CoovaChilli Router
    ↓ (RADIUS authentication)
FreeRADIUS
    ↓ (accounting packets)
RADIUS MariaDB (radacct table)
    ↓ (auto-sync every 2 min)
RouterLogger PostgreSQL (wifi_guest_sessions)
    ↓
Main Dashboard (shows usage)
```

### Key Tables

**RADIUS MariaDB:**
```sql
radacct:
- username (e.g., "free-1767824504947-u2g922")
- callingstationid (device MAC)
- acctinputoctets (bytes uploaded)
- acctoutputoctets (bytes downloaded)
- acctsessiontime (seconds connected)
```

**RouterLogger PostgreSQL:**
```sql
wifi_guest_sessions:
- username (matches RADIUS username)
- email (for display)
- guest_name (for display)
- bytes_uploaded (synced from RADIUS)
- bytes_downloaded (synced from RADIUS)
- bytes_total (sum of both)
- last_accounting_update (timestamp)
```

---

## Testing Checklist

### ✅ Verified Working
- [x] Guest registration creates RADIUS user
- [x] RADIUS accounting data is written to database
- [x] Webhook sends correct username to RouterLogger
- [x] Auto-sync pulls data from RADIUS every 2 minutes
- [x] Dashboard displays data usage correctly
- [x] Success page links to dashboard with correct username

### ⚠️ Known Issues
- [ ] Registration sometimes slow due to RADIUS timeout (non-fatal)
- [ ] Active sessions show 0 B until first accounting update arrives

### 🔄 To Test
- [ ] Data usage reset functionality
- [ ] Manual sync endpoint
- [ ] Multi-router scenarios
- [ ] Session expiration handling

---

## Quick Reference Commands

### Deploy Captive Portal
```bash
cd "/Users/ato/VS Code/RouterLogger/radius-server"
tar czf - captive-portal/ | ssh root@134.122.101.195 "cd /opt/radius-server/radius-server && tar xzf - && docker compose build captive-portal && docker compose up -d captive-portal"
```

### Deploy Full RADIUS Stack
```bash
cd "/Users/ato/VS Code/RouterLogger/radius-server"
tar czf - . | ssh root@134.122.101.195 "cd /opt/radius-server/radius-server && tar xzf - && docker compose down && docker compose up -d --build"
```

### Clear Cooldowns
```bash
ssh root@134.122.101.195 "cd /opt/radius-server/radius-server && docker compose restart captive-portal"
```

### Check Accounting Data
```bash
ssh root@134.122.101.195 'docker exec radius-db mysql -u radius -p"lI5ST8a0WJ2GrvE5SSn1Vw" radius -e "SELECT username, acctinputoctets, acctoutputoctets FROM radacct ORDER BY acctstarttime DESC LIMIT 10;"'
```

### Trigger Manual Sync
```bash
curl -X POST https://routerlogger-backend-production.up.railway.app/api/guests/sync-accounting
```

---

## Environment Variables Reference

### Railway Backend
```bash
RADIUS_DB_HOST=134.122.101.195
RADIUS_DB_PORT=3306
RADIUS_DB_USER=radius
RADIUS_DB_PASS=lI5ST8a0WJ2GrvE5SSn1Vw
RADIUS_DB_NAME=radius
```

### VPS (FreeRADIUS)
```bash
RADIUS_SECRET=rTp8*m.5#z!
RADIUS_DB_HOST=radius-db
RADIUS_DB_PORT=3306
RADIUS_DB_USER=radius
RADIUS_DB_PASS=lI5ST8a0WJ2GrvE5SSn1Vw
```

### Captive Portal
```bash
DB_HOST=postgres-17.cr97glqyvt0y.eu-west-2.rds.amazonaws.com
DB_PORT=5432
DB_NAME=railway
DB_USER=postgres
DB_PASS=$6sRwb19p#R-JD-u
COOVA_UAMSERVER=http://134.122.101.195:8081
```

---

## Git Commits Made Today

```bash
# 1. Fix success page MAC address
git commit -m "Fix success page: remove duplicate content, ensure correct MAC address in dashboard link"

# 2. Add username-based lookup
git commit -m "Fix dashboard lookup using RADIUS username instead of MAC address"

# 3. Fix FreeRADIUS SQL configuration
git commit -m "Fix RADIUS accounting SQL queries with correct attribute names"

# 4. Add RADIUS sync service
git commit -m "Add RADIUS accounting sync to RouterLogger dashboard"

# 5. Fix webhook username
git commit -m "Fix RADIUS accounting sync - use RADIUS username instead of email"

# 6. Deploy everything
git commit -m "Full deployment with RADIUS accounting integration"
```

---

## Files Modified Summary

### Captive Portal
- `radius-server/captive-portal/src/routes/auth.js` - Fixed webhooks, added MAC to redirects
- `radius-server/captive-portal/src/routes/portal.js` - Added username-based lookup, debugging
- `radius-server/captive-portal/src/views/success.ejs` - Cleaned up, added username param
- `radius-server/config/freeradius/mods-enabled/sql` - Fixed accounting query names
- `radius-server/config/freeradius/sites-enabled/default` - Enabled SQL accounting

### RouterLogger Backend
- `backend/src/services/radiusAccountingSync.js` - **NEW** - Main sync service
- `backend/src/routes/guestWifi.js` - Added sync API endpoints
- `backend/src/server.js` - Added auto-sync scheduler
- `backend/package.json` - Added mysql2 dependency
- `backend/.env.example` - Added RADIUS database config
- `backend/database/migrations/030_clear_debug_sessions.sql` - **NEW** - Cleanup script

---

**End of Troubleshooting Notes - January 7, 2026**
