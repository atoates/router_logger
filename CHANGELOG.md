# RouterLogger Changelog

## January 2026

### Jan 9, 2026
- **Guest WiFi Dashboard**: Added delete functionality for guest sessions
  - DELETE endpoint `/api/guests/session/:sessionId`
  - Delete button on session tables with confirmation modal
  - Auto-refresh stats after deletion

### Jan 8, 2026
- **RADIUS Shared Secret Fix**: Critical fix for authentication failures
  - Shared secret mismatch was causing silent auth failures
  - Users could register but not get WiFi access (stuck in "dnat" state)
  - Fixed `clients.conf` to use production secret
  - Documented in `radius-server/docs/RADIUS-SHARED-SECRET.md`

- **FreeRADIUS SQL Configuration**: Fixed crash-loop issue
  - FreeRADIUS doesn't support `${ENV_VAR}` syntax in config files
  - Hardcoded all database connection values
  - Fixed SQL module to use correct attribute names

### Jan 7, 2026
- **Major RADIUS Accounting Integration**
  - Created `radiusAccountingSync.js` service to pull data from RADIUS MariaDB
  - Auto-sync runs every 2 minutes
  - Manual sync endpoints: `POST /api/guests/sync-accounting`
  - Real-time usage endpoint: `GET /api/guests/:username/usage`

- **Session Tracking Fixes**
  - Fixed duplicate data across sessions by matching on `session_id`
  - Added auto-expire for stale sessions (>25 hours or >2 hours idle)
  - Fixed router MAC matching with fuzzy match on first 5 octets

- **Captive Portal Improvements**
  - Fixed webhook to send RADIUS username instead of email
  - Added MAC address to redirect URLs
  - Enhanced debug logging throughout auth flow
  - Added fallback WiFi activation mechanism on success page

- **Dashboard Enhancements**
  - Device grouping view for guest sessions
  - Live session timer showing active connection duration
  - Total data usage display on router cards

### Jan 6, 2026
- **FreeRADIUS REST Module Fixes**
  - Disabled REST in post-auth to prevent auth failures
  - Enabled non-blocking REST accounting for data tracking

- **Mobile Captive Portal UI**
  - Fixed mobile layout issues
  - Improved form styling
  - Added shared secret configuration

## December 2024

### Dec 16, 2024
- **Code Cleanup**
  - Removed unused frontend components and pages
  - Streamlined backend configuration
  - Updated documentation

### Dec 14, 2024
- **Guest WiFi Integration**
  - Added self-hosted captive portal webhook support
  - Created `wifi_guest_sessions` table
  - Implemented guest session tracking

### Dec 11, 2024
- **IronWifi Deprecation**
  - Removed IronWifi integration (webhooks never worked reliably)
  - Removed `ironwifiSync.js`, `ironwifiWebhook.js`
  - Kept legacy tables for historical data

## November 2024

### Nov 10, 2024
- **User Authentication System**
  - Implemented session-based authentication
  - Added login/logout endpoints
  - Protected API routes

- **MAC Address Sync**
  - Added MAC address matching for router identification
  - Fuzzy matching for Teltonika router MAC variants

## October 2024

### Oct 30, 2024
- **ClickUp Property Tracking**
  - Router-to-property assignment system
  - Property search API
  - Installation date tracking
  - Event-based location tracking

### Oct 16, 2024
- **RMS OAuth Integration**
  - OAuth flow for Teltonika RMS
  - Automatic telemetry sync (15-60 min intervals)
  - Device status monitoring

- **ClickUp OAuth Integration**
  - Task management integration
  - Custom field syncing (30 min intervals)
  - Router task linking

- **Initial MQTT Setup**
  - Real-time telemetry ingestion
  - RUT200 payload processing

---

## Architecture Overview

### Current System (Jan 2026)

```
User Device (iOS/Android)
    |
    v (randomized MAC)
CoovaChilli Router (Teltonika RUT200)
    |
    v (RADIUS auth/accounting)
FreeRADIUS Server
    |
    +---> MariaDB (radacct table)
    |         |
    |         v (sync every 2 min)
    |     RouterLogger Backend
    |         |
    v         v
Captive Portal --> PostgreSQL (wifi_guest_sessions)
    |                   |
    v                   v
Success Page      Main Dashboard
```

### Key Components

1. **RouterLogger Backend** (Railway)
   - Node.js/Express API
   - PostgreSQL database
   - RMS/ClickUp integrations
   - RADIUS accounting sync

2. **RADIUS Server** (DigitalOcean VPS)
   - FreeRADIUS for authentication
   - MariaDB for accounting data
   - Captive Portal (Node.js)

3. **Frontend Dashboard** (Railway)
   - React application
   - Real-time monitoring
   - Guest WiFi session management

---

## Environment Variables

### RouterLogger Backend (Railway)
```
DATABASE_URL=postgresql://...
RMS_API_KEY=...
CLICKUP_CLIENT_ID=...
CLICKUP_CLIENT_SECRET=...
RADIUS_DB_HOST=134.122.101.195
RADIUS_DB_PORT=3306
RADIUS_DB_USER=radius
RADIUS_DB_PASS=...
RADIUS_DB_NAME=radius
```

### RADIUS Server (VPS)
```
RADIUS_SECRET=lPvk2g6aQuMWpmAGnQrwQ
```

See `docs/ENVIRONMENT-VARIABLES.md` for complete list.

---

## Deployment

### RouterLogger (Railway)
```bash
git push origin main  # Auto-deploys
```

### RADIUS Server (VPS)
```bash
cd radius-server
tar czf - . | ssh root@134.122.101.195 \
  "cd /opt/radius-server/radius-server && tar xzf - && docker compose down && docker compose up -d --build"
```

### Captive Portal Only
```bash
cd radius-server
tar czf - captive-portal/ | ssh root@134.122.101.195 \
  "cd /opt/radius-server/radius-server && tar xzf - && docker compose build captive-portal && docker compose up -d captive-portal"
```
