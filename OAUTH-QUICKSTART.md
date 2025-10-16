# Quick Start: OAuth Implementation

Your OAuth implementation has been deployed! Here's what to do next:

## ✅ What Was Implemented

1. **Backend OAuth Service** (`oauthService.js`)
   - PKCE-based OAuth 2.0 flow
   - Automatic token refresh
   - Secure token storage in database

2. **Auth API Routes** (`/api/auth/*`)
   - `GET /api/auth/rms/login` - Start OAuth flow
   - `GET /api/auth/rms/callback` - Handle RMS callback
   - `GET /api/auth/rms/status` - Check auth status
   - `POST /api/auth/rms/logout` - Disconnect

3. **RMS Client Updates**
   - Now tries OAuth token first
   - Falls back to PAT if no OAuth
   - Automatic token refresh on expiration

4. **Frontend UI** (`RMSAuthButton`)
   - "Connect with RMS" button
   - Auth status display
   - Disconnect functionality

5. **Database Migration**
   - `oauth_tokens` table created
   - Automatic deployment via Railway

## 🚀 Next Steps

### Step 1: Create RMS OAuth Application (5 minutes)

1. Go to https://rms.teltonika-networks.com/
2. Login → Profile → Developer Settings → OAuth Applications
3. Click "New Application"
4. Configure:
   - **Name**: `Router Logger`
   - **Redirect URI**: `https://routerlogger-production.up.railway.app/api/auth/rms/callback`
     *(Replace with your actual Railway backend URL)*
    - **Scopes**: Select at least:
       - ✅ `devices:read`
       - ✅ `monitoring:read`
       - ✅ `statistics:read`
       - Optional: `company_device_statistics:read` (not requested by default; enable via RMS_OAUTH_SCOPES)
5. Click "Create"
6. **Copy the Client ID and Client Secret** (you won't see them again!)

### Step 2: Add Environment Variables to Railway (2 minutes)

1. Open Railway: https://railway.com/project/7b2bc4f9-a4be-467d-9ea5-69539500e818
2. Click your **backend service**
3. Go to **Variables** tab
4. Add these three variables:

```
RMS_OAUTH_CLIENT_ID = [paste your Client ID]
RMS_OAUTH_CLIENT_SECRET = [paste your Client Secret]
RMS_OAUTH_REDIRECT_URI = https://routerlogger-production.up.railway.app/api/auth/rms/callback
```

5. The backend will auto-redeploy

### Step 3: Wait for Deployment (2-3 minutes)

Watch the Railway logs to see when deployment completes:
- Backend will redeploy with OAuth support
- Frontend will redeploy with RMSAuthButton

### Step 4: Test OAuth Flow (2 minutes)

1. Open your frontend: https://routerlogger-frontend-production.up.railway.app
2. Hard refresh: `Cmd + Shift + R` (macOS) or `Ctrl + Shift + F5` (Windows)
3. You should see a new section near the top:
   ```
   🔒 Not connected to RMS
   [Connect with RMS]
   Sign in to access full device monitoring data
   ```
4. Click **"Connect with RMS"**
5. Login with your RMS credentials
6. Authorize the app
7. You'll be redirected back with:
   ```
   ✓ Connected to RMS
   Scopes: devices:read monitoring:read statistics:read
   [Disconnect]
   ```

### Step 5: Verify Data Ingestion (5 minutes)

1. Wait for next RMS sync (15 minutes) OR trigger manually:
   ```bash
   curl -X POST https://routerlogger-production.up.railway.app/api/rms/sync
   ```

2. Check backend logs:
   ```bash
   # Via Railway dashboard or CLI
   railway logs --service backend
   ```

   Look for:
   ```
   info: Using OAuth token for RMS API
   info: Fetched 96 devices from RMS
   info: Processed telemetry from router 1924954
   ```

3. In the frontend:
   - Select **Router #96** from dropdown
   - Check DeviceInfo section:
     - **Total TX** should show real data (e.g., 28.45 MB)
     - **Total RX** should show real data (e.g., 27.51 MB)
   - Charts should populate with usage data

## 🎯 Expected Results

### Before OAuth (with PAT only):
```
Total TX: 0 bytes
Total RX: 0 bytes
Note: No usage data detected...
```

Backend logs:
```
warn: RMS GET /api/devices/1924954/monitoring -> 404 Not Found
error: Error fetching monitoring data
```

### After OAuth:
```
Total TX: 28.45 MB
Total RX: 27.51 MB
```

Backend logs:
```
info: Using OAuth token for RMS API
info: Successfully fetched monitoring data for device 1924954
info: Processed telemetry from router 1924954
```

## 📋 Troubleshooting

### "OAuth not configured" shows in UI

**Issue**: Environment variables not set

**Fix**:
1. Check Railway backend Variables tab
2. Ensure all 3 variables are set
3. Redeploy if needed

### "Invalid redirect URI" error

**Issue**: Mismatch between RMS app and Railway variable

**Fix**:
1. Get your exact backend URL from Railway
2. Update BOTH:
   - RMS OAuth app redirect URI
   - Railway `RMS_OAUTH_REDIRECT_URI` variable
3. Must match exactly (no trailing slash)

### Still seeing 0 bytes after OAuth

**Issue**: OAuth not being used or wrong scopes

**Fix**:
1. Check auth status:
   ```bash
   curl https://routerlogger-production.up.railway.app/api/auth/rms/status
   ```
   Should return: `{"authenticated":true}`

2. Check backend logs for "Using OAuth token"

3. Try logging out and back in

### Database migration not applied

**Issue**: `oauth_tokens` table doesn't exist

**Fix**:
Backend automatically runs migrations on startup, but you can manually trigger:
```bash
railway run --service backend node src/database/migrate.js
```

## 📚 Documentation

Full guides available in `/docs`:

- **RMS-OAUTH-SETUP.md** - Complete OAuth setup walkthrough
- **ENVIRONMENT-VARIABLES.md** - All env variables explained
- **RMS-API-INTEGRATION.md** - RMS API integration overview
- **RMS-CONFIGURATION-GUIDE.md** - Router configuration guide

## 🔍 Verification Commands

```bash
# Check if backend is deployed
curl https://routerlogger-production.up.railway.app/

# Check OAuth status
curl https://routerlogger-production.up.railway.app/api/auth/rms/status

# Check RMS sync status
curl https://routerlogger-production.up.railway.app/api/rms/status

# Trigger manual sync
curl -X POST https://routerlogger-production.up.railway.app/api/rms/sync

# View recent logs for Router #96
curl "https://routerlogger-production.up.railway.app/api/logs?router_id=1924954&limit=1"
```

## ⏱️ Timeline

| Time | Task | Status |
|------|------|--------|
| 0 min | Deploy complete | ✅ Done |
| 5 min | Create RMS OAuth app | ⏳ Your turn |
| 7 min | Add Railway variables | ⏳ Your turn |
| 10 min | Backend redeploys | ⏳ Automatic |
| 12 min | Test OAuth login | ⏳ Your turn |
| 17 min | Next RMS sync runs | ⏳ Automatic |
| 20 min | Verify data in UI | ⏳ Your turn |

**Total time to working OAuth: ~20 minutes**

## 🎉 Success Criteria

You'll know it's working when:

1. ✅ "Connect with RMS" button appears in UI
2. ✅ You can login and see "Connected to RMS"
3. ✅ Backend logs show "Using OAuth token"
4. ✅ Router #96 shows real TX/RX data (not 0 bytes)
5. ✅ Charts populate with usage statistics
6. ✅ No more 404 errors in backend logs

---

**Ready to start?** Begin with Step 1 above!

**Need help?** Check the full guide in `docs/RMS-OAUTH-SETUP.md`
