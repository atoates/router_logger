# RouterLogger - Claude Code Context

## Project Overview
RouterLogger is a monitoring system for Teltonika RUT200 routers with integrations for:
- **Teltonika RMS** (OAuth) - Router telemetry and status
- **ClickUp** (OAuth) - Task management for router deployment
- **IronWifi** (API + Webhooks) - Guest WiFi session tracking

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

### IronWifi Integration
- `ironwifi_guests` - Guest registration data (contact info, ap_mac, client_mac)
- `ironwifi_sessions` - RADIUS accounting sessions (real-time bandwidth, duration)
- `router_user_stats` - Daily aggregated WiFi stats per router

### MAC Address Matching
IronWifi guests connect via `ap_mac` (WiFi AP MAC of router). To link guests to routers:
- `ap_mac` in IronWifi = Called-Station-Id = Router's WiFi interface MAC
- `client_mac` in IronWifi = Calling-Station-Id = User's device MAC
- Matching uses `routers.mac_address` column

## Common Issues

### Guests not matching to routers
Check `routers.mac_address` column - it must contain the WiFi AP MAC (format: `20:97:27:xx:xx:xx` for Teltonika).
RMS API may provide WAN/LAN MAC instead of WiFi MAC. The startup diagnostic logs this.

## File Locations

### Backend
- `backend/src/server.js` - Main server, startup logic
- `backend/src/services/ironwifiSync.js` - IronWifi API sync
- `backend/src/routes/ironwifiWebhook.js` - Webhook + CSV upload endpoints
- `backend/src/services/rmsSync.js` - RMS telemetry sync
- `backend/src/models/router.js` - Router database operations

### Frontend
- `frontend/src/` - React components

### Database
- `backend/src/database/schema.sql` - Main schema
- `backend/src/database/migrations/` - Migration files
