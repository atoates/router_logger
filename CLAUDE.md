# RouterLogger - Claude Code Context

## Project Overview
RouterLogger is a monitoring system for Teltonika RUT200 routers with integrations for:
- **Teltonika RMS** (OAuth) - Router telemetry and status
- **ClickUp** (OAuth) - Task management for router deployment

## Tech Stack
- **Backend**: Node.js/Express, PostgreSQL
- **Frontend**: React
- **Deployment**: Railway (auto-deploys on git push to main)

## Deployment & Testing Strategy (Preferred Method)

**The best way to verify changes is to deploy and check logs.**
Local testing is limited because there is no local database access.

### Verification Workflow:
1. **Write Tests**: Create Jest unit tests in `backend/tests/`.
2. **Commit & Push**: `git push` triggers Railway deployment.
3. **Wait for Build**: Railway will run `npm test` during the build phase (configured in package.json).
   - If tests fail, deployment halts (Safe!).
4. **Check Logs**: For runtime verification, use the "Diagnostic on Startup" pattern below.

### Running diagnostics on startup:
Add diagnostic code to `backend/src/server.js` in the `startServer()` function. It runs on every deploy.

Example pattern:
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
// Call in startServer() before app.listen():
await runMyDiagnostic();
```

## Key Database Tables

### Router Data
- `routers` - Router registry (router_id, name, mac_address, etc.)
- `router_logs` - Telemetry logs (partitioned by month)
- `router_current_status` - Denormalized latest status for fast dashboard queries

### Guest WiFi
- `wifi_guest_sessions` - Guest session data from self-hosted captive portal
- `ironwifi_guests`, `ironwifi_sessions` - Legacy tables (see Historical Notes)

## Self-Hosted Captive Portal Integration

The system receives guest WiFi events from the self-hosted RADIUS server/captive portal.

**Webhook Endpoint:** `POST /api/guests/captive-portal/event`

**Expected Payload:**
```json
{
  "type": "guest_login",
  "session_id": "unique-session-id",
  "username": "guest@email.com",
  "email": "guest@email.com",
  "phone": "+1234567890",
  "name": "Guest Name",
  "mac_address": "aa:bb:cc:dd:ee:ff",
  "router_mac": "20:97:27:xx:xx:xx",
  "router_id": "optional-router-id",
  "session_duration": 3600,
  "timestamp": "2024-01-15T12:00:00Z"
}
```

**Event Types:**
- `registration_completed` - Guest registered and connected
- `free_access_granted` - Guest connected with free access
- `guest_login` - Guest logged in
- `guest_logout` - Guest disconnected
- `session_expired` - Session timed out

**Router Matching:** If `router_id` is not provided, the system matches by `router_mac` against `routers.mac_address`.

## File Locations

### Backend
- `backend/src/server.js` - Main server, startup logic
- `backend/src/services/rmsSync.js` - RMS telemetry sync
- `backend/src/models/router.js` - Router database operations
- `backend/src/routes/guestWifi.js` - Guest WiFi webhook + session queries

### Frontend
- `frontend/src/` - React components

### Database
- `backend/src/database/schema.sql` - Main schema
- `backend/src/database/migrations/` - Migration files

---

## Historical Notes

### IronWifi Integration (Deprecated - Dec 2024)

The project originally integrated with IronWifi for guest WiFi tracking. This integration was removed because the webhook system never worked reliably in production.

**What was IronWifi?**
- Third-party captive portal service for guest WiFi authentication
- Provided RADIUS accounting and guest registration data
- Used webhooks to push session events to RouterLogger

**Legacy database tables (kept for historical data):**
- `ironwifi_guests` - Cached guest registration data from IronWifi API
- `ironwifi_sessions` - RADIUS accounting sessions
- `ironwifi_webhook_log` - Debug log for webhook receipts

**MAC Address Matching (historical context):**
- `ap_mac` = Called-Station-Id = Router's WiFi interface MAC
- `client_mac` = Calling-Station-Id = User's device MAC
- Matching attempted via `routers.mac_address` column

**Why it was removed:**
- Webhook endpoint never received data reliably
- API rate limits made sync impractical
- Replaced with simpler `wifi_guest_sessions` table for manual/CSV imports

**Files removed:**
- `backend/src/services/ironwifiSync.js`
- `backend/src/routes/ironwifiWebhook.js`
- `backend/test-ironwifi-api.js`
- `docs/IRONWIFI-*.md` (integration docs, webhook setup, API test results, rate limits)
