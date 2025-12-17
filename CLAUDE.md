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

## Deployment Process

### To deploy changes:
1. Make changes to code
2. `git add . && git commit -m "message"`
3. `git push`
4. Railway automatically deploys from main branch
5. Wait ~2-3 minutes for deployment to complete
6. Check Railway logs for startup output

### Running diagnostics on deploy:
Since there's no local PostgreSQL access, add diagnostic code to `backend/src/server.js` in the `startServer()` function. It runs on every deploy and logs to Railway.

Example pattern (see `runIronWifiMacDiagnostic()` in server.js):
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
