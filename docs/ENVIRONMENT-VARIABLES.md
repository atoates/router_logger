# Environment Variables Reference

## Backend Environment Variables

### Required for Basic Operation

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Server
PORT=3001
NODE_ENV=production

# Frontend (for CORS)
FRONTEND_URL=https://your-frontend.up.railway.app
```

### RMS Integration - Personal Access Token (Legacy - Not Recommended)

```bash
# RMS API Personal Access Token (Limited scope - cannot access device monitoring)
# Use OAuth instead for full access
RMS_ACCESS_TOKEN=your_personal_access_token_here

# RMS Sync interval in minutes (default: 5)
RMS_SYNC_INTERVAL_MINUTES=5

# Optional: Override RMS API endpoints
RMS_API_BASE_URL=https://api.rms.teltonika-networks.com
RMS_API_PREFIX=
```

### RMS Integration - OAuth (✅ Recommended - Full Access)

```bash
# RMS OAuth Client Credentials (from RMS Developer Settings)
RMS_OAUTH_CLIENT_ID=your_client_id_from_rms
RMS_OAUTH_CLIENT_SECRET=your_client_secret_from_rms
RMS_OAUTH_REDIRECT_URI=https://your-backend.up.railway.app/api/auth/rms/callback

# Sync interval (default: 5 minutes for near real-time data)
RMS_SYNC_INTERVAL_MINUTES=5

# Note: With OAuth configured, RMS_ACCESS_TOKEN becomes optional fallback
# Optional: override default scopes (space or comma separated). Default: "devices:read monitoring:read statistics:read"
# Example to include company-level stats:
# RMS_OAUTH_SCOPES="devices:read monitoring:read statistics:read company_device_statistics:read"
```

### IronWifi Integration (⚠️ DEPRECATED - December 2024)

**This integration has been replaced with self-hosted RADIUS/captive portal.**

IronWifi was deprecated in December 2024 due to unreliable webhooks. The system now uses a self-hosted FreeRADIUS server with custom captive portal for guest WiFi tracking.

**For new installations**: Skip this section and use [Self-Hosted RADIUS Server Integration](#self-hosted-radius-server-integration) below.

**Legacy webhook endpoint** (`/api/ironwifi/webhook`) is kept for backwards compatibility but should not be used for new deployments.

**See [Migration Guide](../radius-server/docs/MIGRATION-GUIDE.md)** for migrating from IronWifi to self-hosted RADIUS.

### Self-Hosted RADIUS Server Integration (✅ Recommended for Guest WiFi)

The RouterLogger backend connects to your self-hosted RADIUS server (FreeRADIUS + MariaDB) to sync guest WiFi session data and RADIUS accounting information.

**Architecture**: The RADIUS server runs on a separate VPS (DigitalOcean) and sends webhook events to RouterLogger. RouterLogger also polls the RADIUS database every 2 minutes for accounting updates (bytes uploaded/downloaded, session duration).

**See [RADIUS Server Setup Guide](../../radius-server/README.md) for complete installation instructions.**

**Environment Variables**:

```bash
# RADIUS database connection (MariaDB on VPS)
RADIUS_DB_HOST=134.122.101.195          # VPS IP address
RADIUS_DB_PORT=3306                      # MySQL/MariaDB port
RADIUS_DB_USER=radius                    # RADIUS database user
RADIUS_DB_PASS=your-radius-db-password   # Database password
RADIUS_DB_NAME=radius                    # Database name (default: radius)
```

**Note**: These credentials allow read-only access to RADIUS accounting data. The RouterLogger backend never writes to the RADIUS database.

### ClickUp Integration

```bash
# ClickUp OAuth (configured via /api/clickup/auth/start)
# Tokens are stored in database after OAuth flow

# ClickUp Routers List ID (REQUIRED for auto-creating tasks)
# Find this by opening your "Routers" list in ClickUp and copying from URL
# URL format: https://app.clickup.com/{workspace_id}/v/li/{LIST_ID}
CLICKUP_ROUTERS_LIST_ID=901517043586

# Auto-create ClickUp tasks for new routers (default: true)
# Set to 'false' to disable automatic task creation
CLICKUP_AUTO_CREATE_TASKS=true

# ClickUp sync interval in minutes (default: 30)
CLICKUP_SYNC_INTERVAL_MINUTES=30
```

### MQTT (Optional - for router push)

```bash
# MQTT Broker Configuration
MQTT_BROKER_URL=mqtt://broker.hivemq.com:1883
MQTT_USERNAME=optional_username
MQTT_PASSWORD=optional_password
MQTT_TOPIC=rut200/telemetry
```

## Frontend Environment Variables

```bash
# Backend API URL
REACT_APP_API_URL=https://your-backend.up.railway.app
```

## Railway Setup

### Backend Service Variables

In Railway Dashboard → Your Project → Backend Service → Variables:

1. **Database** (Auto-configured by Railway PostgreSQL plugin):
   - `DATABASE_URL` - Auto-set by PostgreSQL plugin

2. **Basic Config**:
   - `FRONTEND_URL` = `https://routerlogger-frontend-production.up.railway.app`
   - `PORT` = `3001` (or leave empty for Railway default)

3. **Choose ONE RMS integration method**:

   **Option A: Personal Access Token** (Quick setup, limited data):
   ```
   RMS_ACCESS_TOKEN = [token from RMS → Account Settings → Personal Access Tokens]
   RMS_SYNC_INTERVAL_MINUTES = 15
   ```

   **Option B: OAuth** (Recommended, full data access):
   ```
   RMS_OAUTH_CLIENT_ID = [from RMS OAuth app]
   RMS_OAUTH_CLIENT_SECRET = [from RMS OAuth app]
   RMS_OAUTH_REDIRECT_URI = https://routerlogger-production.up.railway.app/api/auth/rms/callback
   RMS_SYNC_INTERVAL_MINUTES = 15
   ```

4. **Optional - MQTT** (if using router push):
   ```
   MQTT_BROKER_URL = mqtt://broker.hivemq.com:1883
   MQTT_TOPIC = rut200/telemetry
   MQTT_USERNAME = [optional]
   MQTT_PASSWORD = [optional]
   ```

### Frontend Service Variables

In Railway Dashboard → Your Project → Frontend Service → Variables:

```
REACT_APP_API_URL = https://routerlogger-production.up.railway.app
```

## Variable Comparison: PAT vs OAuth

| Feature | Personal Access Token | OAuth 2.0 |
|---------|----------------------|-----------|
| Setup Complexity | ⭐ Easy (1 variable) | ⭐⭐⭐ Medium (3 variables + OAuth app) |
| API Access | ❌ Limited (404 on most endpoints) | ✅ Full access |
| Device Monitoring | ❌ Not available | ✅ Available |
| Usage Data | ❌ 0 bytes (404 error) | ✅ Real data (55+ MB) |
| Token Expiration | ⏰ Manual renewal | ✅ Auto-refresh |
| User Login | ❌ No | ✅ Yes (RMS account) |
| Security | ⭐⭐ Token stored in env | ⭐⭐⭐ User-level permissions |

**Recommendation**: Use OAuth for production. PAT is only suitable for testing with no monitoring data needs.

## Getting the Values

### DATABASE_URL
- **Railway PostgreSQL Plugin**: Automatically set when you add PostgreSQL
- Manual: `postgresql://username:password@host:port/database`

### FRONTEND_URL / REACT_APP_API_URL
- **Find in Railway**:
  1. Click service → Settings tab
  2. Copy "Public URL" (e.g., `https://routerlogger-production.up.railway.app`)

### RMS_ACCESS_TOKEN
- **RMS Dashboard**:
  1. Login → Account Settings → Personal Access Tokens
  2. Create token with `devices:read`, `monitoring:read`, `statistics:read` scopes
  3. Copy token (shown only once!)

### RMS OAuth Credentials
- **RMS Developer Settings**:
  1. Login → Developer Settings → OAuth Applications
  2. Create new application
  3. Copy Client ID and Client Secret
  4. Set Redirect URI to `https://your-backend.up.railway.app/api/auth/rms/callback`

### MQTT_BROKER_URL
- **Public Brokers**:
  - `mqtt://broker.hivemq.com:1883` (HiveMQ Public)
  - `mqtt://test.mosquitto.org:1883` (Eclipse Mosquitto)
- **Private**: Your own MQTT broker URL

## Deployment Notes

1. **Never commit secrets to git**
   - Use `.env` for local development
   - Use Railway Variables for production
   - Add `.env` to `.gitignore`

2. **Update both services** when changing URLs:
   - If backend URL changes → update `REACT_APP_API_URL` in frontend
   - If frontend URL changes → update `FRONTEND_URL` in backend (for CORS)

3. **OAuth requires HTTPS**:
   - Railway provides HTTPS automatically
   - Local development with OAuth requires ngrok or similar

4. **Test after setting variables**:
   ```bash
   # Check backend is running
   curl https://your-backend.up.railway.app/

   # Check RMS status
   curl https://your-backend.up.railway.app/api/rms/status

   # Check OAuth status
   curl https://your-backend.up.railway.app/api/auth/rms/status
   ```

## Local Development .env Example

Create `/backend/.env`:

```bash
# Database (use Railway CLI to get production URL or use local Postgres)
DATABASE_URL=postgresql://postgres:password@localhost:5432/router_logger

# Server
PORT=3001
NODE_ENV=development

# Frontend
FRONTEND_URL=http://localhost:3000

# RMS OAuth (recommended)
RMS_OAUTH_CLIENT_ID=your_client_id
RMS_OAUTH_CLIENT_SECRET=your_client_secret
RMS_OAUTH_REDIRECT_URI=http://localhost:3001/api/auth/rms/callback

# OR RMS PAT (for testing only)
# RMS_ACCESS_TOKEN=your_token

# RMS Sync
RMS_SYNC_INTERVAL_MINUTES=15

# MQTT (optional)
MQTT_BROKER_URL=mqtt://broker.hivemq.com:1883
MQTT_TOPIC=rut200/telemetry
```

Create `/frontend/.env`:

```bash
REACT_APP_API_URL=http://localhost:3001
```

**Note**: For OAuth to work locally, you need:
1. RMS OAuth app with redirect URI: `http://localhost:3001/api/auth/rms/callback`
2. Or use ngrok to expose local backend with HTTPS

---

**Quick Start**: Copy the appropriate template above, fill in your values, add to Railway Variables, and redeploy!
