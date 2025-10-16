# RMS OAuth Setup Guide

This guide walks you through setting up OAuth authentication with Teltonika RMS to get full access to device monitoring data including usage statistics that aren't available with Personal Access Tokens.

## Why OAuth Instead of Personal Access Tokens?

**Personal Access Tokens (PAT)** have limited API scope:
- ❌ Cannot access device-specific endpoints (`/api/devices/:id/monitoring`, `/api/devices/:id/data-usage`)
- ❌ Returns 404 for most monitoring APIs
- ❌ Cannot see the usage data visible in RMS UI

**OAuth 2.0 Tokens** provide full API access:
- ✅ Access all device endpoints including monitoring and usage data
- ✅ See the complete 55.96 MB usage data visible in RMS UI
- ✅ Automatic token refresh (no expiration issues)
- ✅ Better security with user-level permissions

## Prerequisites

1. **Teltonika RMS Account** with access to your devices
2. **Railway Account** with your Router Logger deployed
3. **RMS OAuth Application** (we'll create this below)

## Step 1: Create RMS OAuth Application

1. **Log in to Teltonika RMS**: https://rms.teltonika-networks.com/

2. **Navigate to OAuth Applications**:
   - Click your profile/avatar (top right)
   - Select **"Account Settings"** or **"Developer Settings"**
   - Look for **"OAuth Applications"** or **"API Applications"**
   - Click **"New Application"** or **"Create OAuth App"**

3. **Configure Application**:
   - **Application Name**: `Router Logger` (or your preferred name)
   - **Description**: `Router monitoring dashboard for RUT200 devices`
   - **Redirect URI**: `https://your-backend.up.railway.app/api/auth/rms/callback`
     - Replace `your-backend` with your actual Railway backend URL
     - Example: `https://routerlogger-production.up.railway.app/api/auth/rms/callback`
   - **Scopes** (select all monitoring-related scopes):
     - ✅ `devices:read` - Read device information
     - ✅ `monitoring:read` - Read monitoring data
     - ✅ `statistics:read` - Read statistics data
     - ✅ `company_device_statistics:read` - Read company-level statistics
   - Click **"Create Application"** or **"Save"**

4. **Copy Credentials**:
   - After creation, you'll see:
     - **Client ID** (e.g., `abc123def456...`)
     - **Client Secret** (e.g., `secret_xyz789...`)
   - ⚠️ **IMPORTANT**: Copy both immediately - you won't see the secret again!
   - Store them securely (you'll add them to Railway next)

## Step 2: Configure Railway Environment Variables

### Find Your Backend URL

First, get your Railway backend URL:

1. Open Railway dashboard: https://railway.com/
2. Click your Router Logger project
3. Click on your **backend service**
4. Go to **"Settings"** tab
5. Copy the **"Public URL"** (e.g., `https://routerlogger-production.up.railway.app`)

### Add Environment Variables

In the same backend service settings:

1. Go to **"Variables"** tab
2. Add these three variables:

**RMS_OAUTH_CLIENT_ID**:
```
Value: [Paste your Client ID from Step 1]
```

**RMS_OAUTH_CLIENT_SECRET**:
```
Value: [Paste your Client Secret from Step 1]
```

**RMS_OAUTH_REDIRECT_URI**:
```
Value: https://your-backend-url.up.railway.app/api/auth/rms/callback
```
(Replace with your actual backend URL from above)

Example:
```
RMS_OAUTH_REDIRECT_URI=https://routerlogger-production.up.railway.app/api/auth/rms/callback
```

3. Click **"Add"** for each variable
4. The service will automatically redeploy

## Step 3: Run Database Migration

The OAuth system needs a database table to store tokens. SSH into your Railway backend or use the Railway CLI:

```bash
# Via Railway CLI
railway link [your-project-id]
railway run node src/database/migrate.js
```

Or manually trigger via the /api/migrate endpoint if you have one set up.

The migration creates the `oauth_tokens` table with:
- User ID storage
- Access token (encrypted)
- Refresh token (for auto-renewal)
- Expiration timestamps
- Scope information

## Step 4: Test OAuth Flow

### A. Open Your Frontend

1. Visit your frontend URL: `https://your-frontend.up.railway.app`
2. You should see a new **"Connect with RMS"** button near the top
3. The button should show as "Not connected to RMS"

### B. Initiate OAuth Login

1. Click **"Connect with RMS"** button
2. You'll be redirected to Teltonika RMS login page
3. Log in with your RMS credentials
4. RMS will show the authorization screen:
   - Application name: "Router Logger"
   - Requested scopes: devices:read, monitoring:read, etc.
5. Click **"Authorize"** or **"Allow"**

### C. Complete Authentication

1. You'll be redirected back to your frontend
2. You should see a success toast: "Successfully authenticated with RMS!"
3. The button should now show:
   - ✓ **Connected to RMS**
   - Scopes: devices:read monitoring:read statistics:read...
   - **Disconnect** button

### D. Verify Data Ingestion

1. Wait for the next RMS sync (runs every 15 minutes)
2. Or manually trigger: `curl -X POST https://your-backend.up.railway.app/api/rms/sync`
3. Select **Router #96** from the dropdown
4. Check DeviceInfo section - you should now see:
   - **Total TX**: Shows actual data (e.g., 28.45 MB) instead of 0 bytes
   - **Total RX**: Shows actual data (e.g., 27.51 MB) instead of 0 bytes
5. Charts should populate with usage data

## Step 5: Verify in Backend Logs

Check your Railway backend logs to confirm OAuth is working:

```bash
railway logs
```

Look for these success messages:

```
info: Using OAuth token for RMS API
info: Fetched 96 devices from RMS
info: Processed telemetry from router 1924954
info: Total TX: 28450000, Total RX: 27510000
```

**Before OAuth** (with PAT), you'd see:
```
warn: RMS GET /api/devices/1924954/monitoring -> 404 Not Found
error: Error fetching monitoring data
```

**After OAuth**, 404s should disappear and you'll see successful data fetches.

## How It Works

### OAuth Flow

1. **User clicks "Connect with RMS"**
   - Frontend redirects to `/api/auth/rms/login`
   - Backend generates PKCE challenge and state
   - User redirected to RMS authorization page

2. **User authorizes on RMS**
   - RMS redirects back to `/api/auth/rms/callback?code=...&state=...`
   - Backend verifies state (CSRF protection)
   - Backend exchanges code for access token using PKCE
   - Token stored in `oauth_tokens` table

3. **RMS Sync Uses OAuth Token**
   - Every 15 minutes, `rmsSync.js` runs
   - `RMSClient.createWithAuth()` checks for OAuth token first
   - If OAuth token exists and valid → uses it
   - If OAuth token expired → auto-refreshes using refresh token
   - If no OAuth token → falls back to PAT (if set)

4. **Token Refresh (Automatic)**
   - OAuth tokens expire after 1-2 hours
   - System detects expiration 5 minutes before
   - Automatically uses refresh token to get new access token
   - New token stored in database
   - No user interaction needed

### Security Features

- **PKCE (Proof Key for Code Exchange)**: Prevents authorization code interception
- **State Parameter**: CSRF protection
- **HttpOnly Cookies**: State stored in secure cookies
- **Token Encryption**: Tokens encrypted in database (optional, add later)
- **Automatic Cleanup**: Expired PKCE entries removed after 10 minutes

## Troubleshooting

### "OAuth not configured" Shows in UI

**Problem**: Environment variables not set correctly

**Solution**:
1. Check Railway Variables tab
2. Verify all three variables are set:
   - `RMS_OAUTH_CLIENT_ID`
   - `RMS_OAUTH_CLIENT_SECRET`
   - `RMS_OAUTH_REDIRECT_URI`
3. Redeploy if needed

### "Invalid redirect URI" Error on RMS

**Problem**: Mismatch between RMS app config and Railway variable

**Solution**:
1. Check RMS OAuth app settings
2. Ensure redirect URI exactly matches:
   ```
   https://your-backend.up.railway.app/api/auth/rms/callback
   ```
3. No trailing slash
4. Must be HTTPS in production

### "State mismatch" Error

**Problem**: CSRF protection triggered or cookies not working

**Solution**:
1. Ensure cookies are enabled in browser
2. Check CORS is configured correctly:
   ```javascript
   cors({
     origin: process.env.FRONTEND_URL,
     credentials: true
   })
   ```
3. Frontend must send `credentials: 'include'` in fetch requests

### Still Seeing 404 Errors After OAuth

**Problem**: OAuth token not being used or wrong scopes

**Solution**:
1. Check `/api/auth/rms/status` endpoint:
   ```bash
   curl https://your-backend.up.railway.app/api/auth/rms/status
   ```
   Should return: `{"authenticated":true,"configured":true}`
2. Check backend logs for "Using OAuth token" message
3. Verify scopes include `monitoring:read` and `statistics:read`
4. Try logging out and logging back in

### Token Refresh Failing

**Problem**: Refresh token expired or invalid

**Solution**:
1. OAuth tokens expire after several months
2. User needs to reconnect:
   - Click **"Disconnect"**
   - Click **"Connect with RMS"** again
3. Authorize the app again

## Production Checklist

Before going live:

- [ ] OAuth app created in RMS
- [ ] Client ID and Secret added to Railway
- [ ] Redirect URI matches exactly (HTTPS)
- [ ] Database migration run (`oauth_tokens` table exists)
- [ ] Frontend deployed with RMSAuthButton component
- [ ] Backend deployed with OAuth routes
- [ ] CORS configured with credentials support
- [ ] Test complete OAuth flow (login → callback → data sync)
- [ ] Verify Router #96 shows real usage data (not 0 bytes)
- [ ] Test token refresh (wait 2 hours, verify still works)
- [ ] Test logout and re-login

## Next Steps

Once OAuth is working:

1. **Monitor Performance**: OAuth tokens provide faster API responses
2. **Remove PAT**: You can remove `RMS_ACCESS_TOKEN` if OAuth is stable
3. **Add Multi-User**: Extend to support multiple RMS accounts (requires user sessions)
4. **Add Token Encryption**: Encrypt tokens in database for extra security
5. **Set Up Alerts**: Monitor token refresh failures

## Reference

- **RMS OAuth Documentation**: Check your RMS Developer portal
- **OAuth 2.0 Spec**: https://oauth.net/2/
- **PKCE Extension**: https://oauth.net/2/pkce/

---

**Need Help?**

- Check Railway logs: `railway logs`
- Test auth status: `curl https://your-backend.up.railway.app/api/auth/rms/status`
- Verify OAuth endpoints: `/api/auth/rms/login`, `/api/auth/rms/callback`, `/api/auth/rms/logout`
