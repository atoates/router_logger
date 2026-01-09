# RouterLogger - Claude Code Context

## Project Overview
RouterLogger is a monitoring system for Teltonika RUT200 routers with integrations for:
- **Teltonika RMS** (OAuth) - Router telemetry and status
- **ClickUp** (OAuth) - Task management for router deployment
- **Self-Hosted RADIUS/Captive Portal** - Guest WiFi authentication and tracking

## Tech Stack
- **Backend**: Node.js/Express, PostgreSQL (Railway)
- **Frontend**: React (Railway)
- **RADIUS Server**: FreeRADIUS, MariaDB, Node.js Captive Portal (DigitalOcean VPS @ 134.122.101.195)
- **Deployment**: Railway (auto-deploys on git push to main)

## Deployment & Testing Strategy

**The best way to verify changes is to deploy and check logs.**
Local testing is limited because there is no local database access.

### RouterLogger Deployment (Railway)
```bash
git push origin main  # Auto-deploys backend + frontend
```

### RADIUS Server Deployment (VPS)
```bash
# Full stack rebuild
cd radius-server
tar czf - . | ssh root@134.122.101.195 \
  "cd /opt/radius-server/radius-server && tar xzf - && docker compose down && docker compose up -d --build"

# Captive portal only
tar czf - captive-portal/ | ssh root@134.122.101.195 \
  "cd /opt/radius-server/radius-server && tar xzf - && docker compose build captive-portal && docker compose up -d captive-portal"
```

### Diagnostic Pattern
Add diagnostic code to `backend/src/server.js` in `startServer()`:
```javascript
async function runMyDiagnostic() {
  const { pool } = require('./config/database');
  try {
    const result = await pool.query('SELECT ...');
    logger.info('Diagnostic output:', result.rows);
  } catch (error) {
    logger.warn('Diagnostic failed (non-fatal):', error.message);
  }
}
await runMyDiagnostic();
```

## Key Database Tables

### Router Data (PostgreSQL - Railway)
- `routers` - Router registry (router_id, name, mac_address, etc.)
- `router_logs` - Telemetry logs (partitioned by month)
- `router_current_status` - Denormalized latest status for fast dashboard queries

### Guest WiFi (PostgreSQL - Railway)
- `wifi_guest_sessions` - Guest session data from captive portal
- `captive_free_usage` - Tracks free access cooldowns by MAC

### RADIUS Accounting (MariaDB - VPS)
- `radcheck` - User credentials
- `radacct` - Accounting data (bytes uploaded/downloaded, session time)

## Guest WiFi / Captive Portal System

### Architecture
```
User Device → CoovaChilli Router → FreeRADIUS → MariaDB (radacct)
                    ↓                              ↓
              Captive Portal              RouterLogger Sync (2min)
                    ↓                              ↓
              wifi_guest_sessions ←──────── PostgreSQL
```

### Webhook Endpoint
`POST /api/guests/captive-portal/event`

```json
{
  "type": "registration_completed",
  "session_id": "unique-session-id",
  "username": "free-1234567890-xyz",
  "email": "guest@email.com",
  "mac_address": "aa:bb:cc:dd:ee:ff",
  "router_mac": "20:97:27:xx:xx:xx",
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### Event Types
- `registration_completed` - Guest registered and connected
- `free_access_granted` - Guest connected with free access
- `guest_login` / `guest_logout` - Session start/end
- `radius_accounting` - RADIUS accounting packet (Start/Interim-Update/Stop)

### Router Matching
System matches routers by MAC address with fuzzy matching on first 5 octets (Teltonika routers have different MACs for LAN/WAN/WiFi interfaces).

## File Locations

### Backend
- `backend/src/server.js` - Main server, startup logic
- `backend/src/services/rmsSync.js` - RMS telemetry sync
- `backend/src/services/radiusAccountingSync.js` - RADIUS data sync
- `backend/src/routes/guestWifi.js` - Guest WiFi webhook + session queries

### Frontend
- `frontend/src/components/GuestWifi.js` - Guest WiFi dashboard

### RADIUS Server
- `radius-server/config/freeradius/` - FreeRADIUS configuration
- `radius-server/config/freeradius/clients.conf` - **CRITICAL: Shared secret config**
- `radius-server/captive-portal/` - Node.js captive portal app
- `radius-server/docker-compose.yml` - Container orchestration

### Database
- `backend/src/database/schema.sql` - Main schema
- `backend/src/database/migrations/` - Migration files

## Critical Configuration

### RADIUS Shared Secret
**MUST match between FreeRADIUS and router CoovaChilli config.**

Current production: `lPvk2g6aQuMWpmAGnQrwQ`

Files:
- `radius-server/config/freeradius/clients.conf`
- Router: `uci show chilli | grep radiussecret`

If mismatched: Users register but get no WiFi access (stuck in "dnat" state).

### FreeRADIUS SQL
FreeRADIUS does NOT support `${ENV_VAR}` syntax. All values must be hardcoded in `mods-enabled/sql`.

## Useful Commands

### Check RADIUS logs
```bash
ssh root@134.122.101.195 "docker logs freeradius --tail=100"
```

### Check accounting data
```bash
ssh root@134.122.101.195 'docker exec radius-db mysql -u radius -p"lI5ST8a0WJ2GrvE5SSn1Vw" radius -e "SELECT username, acctinputoctets, acctoutputoctets FROM radacct ORDER BY acctstarttime DESC LIMIT 10;"'
```

### Check router CoovaChilli status
```bash
ssh admin@ROUTER_IP
chilli_query list  # Look for "pass" state, not "dnat"
```

### Trigger manual RADIUS sync
```bash
curl -X POST https://routerlogger-production.up.railway.app/api/guests/sync-accounting
```

### View container status on VPS
```bash
ssh root@134.122.101.195 "docker ps"
ssh root@134.122.101.195 "docker logs -f captive-portal"
```

---

## Historical Notes

### IronWifi Integration (Deprecated - Dec 2024)

Previously used IronWifi for guest WiFi tracking. Removed because webhooks never worked reliably. Replaced with self-hosted RADIUS/captive portal.

Legacy tables kept for historical data:
- `ironwifi_guests`, `ironwifi_sessions`, `ironwifi_webhook_log`

Files removed:
- `backend/src/services/ironwifiSync.js`
- `backend/src/routes/ironwifiWebhook.js`
- `docs/IRONWIFI-*.md`
