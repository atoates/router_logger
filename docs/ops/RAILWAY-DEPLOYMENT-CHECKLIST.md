# Railway Deployment Checklist - Critical Security Fixes

**Date**: 2025-11-13  
**Commit**: `8f0c8a6` - "fix: critical security fixes - CORS, env validation, error sanitization"  
**Status**: ✅ Pushed to `main` branch

---

## ✅ Code Verification

### Changes Deployed:
1. ✅ **Environment Variable Validation** - Validates `DATABASE_URL` on startup
2. ✅ **CORS Security Fix** - Requires `FRONTEND_URL` in production
3. ✅ **Error Sanitization** - Hides stack traces in production

### Code Status:
- ✅ Committed to `main` branch
- ✅ Pushed to GitHub (`origin/main`)
- ✅ Railway should auto-deploy from `main`

---

## 🔍 Railway Dashboard Checks

### 1. Backend Service - Environment Variables

**CRITICAL - Must Have:**
- [ ] `DATABASE_URL` - ✅ Auto-set by Railway PostgreSQL plugin
- [ ] `FRONTEND_URL` - ⚠️ **REQUIRED** (new requirement for CORS)
- [ ] `NODE_ENV=production` - Should be set

**How to Check:**
1. Go to Railway Dashboard → Your Project → Backend Service
2. Click "Variables" tab
3. Verify `FRONTEND_URL` is set to your frontend URL (e.g., `https://routerlogger-frontend-production.up.railway.app`)

**If `FRONTEND_URL` is missing:**
- ⚠️ CORS will reject ALL origins (frontend won't work!)
- Add it immediately: `FRONTEND_URL=https://your-frontend-url.up.railway.app`

**Optional (but recommended):**
- [ ] `RMS_OAUTH_CLIENT_ID` (if using RMS OAuth)
- [ ] `RMS_OAUTH_CLIENT_SECRET` (if using RMS OAuth)
- [ ] `RMS_OAUTH_REDIRECT_URI` (if using RMS OAuth)
- [ ] `CLICKUP_CLIENT_ID` (if using ClickUp)
- [ ] `CLICKUP_CLIENT_SECRET` (if using ClickUp)
- [ ] `MQTT_BROKER_URL` (if using MQTT)

---

### 2. Deployment Status

**Check Deployment:**
1. Go to Railway Dashboard → Backend Service → "Deployments" tab
2. Look for latest deployment with commit `8f0c8a6` or message "critical security fixes"
3. Verify status is "✅ Active" (green)

**If deployment failed:**
- Check logs for error messages
- Most likely cause: Missing `FRONTEND_URL` (will show CORS warning)
- Or: Missing `DATABASE_URL` (will fail startup with clear error)

---

### 3. Health Check

**Verify Health Endpoint:**
```bash
curl https://your-backend.up.railway.app/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-13T..."
}
```

**If health check fails:**
- Check Railway logs for startup errors
- Look for "Environment validation passed" message
- Check for "Missing required environment variables" error

---

### 4. Application Logs

**Check Startup Logs:**
1. Railway Dashboard → Backend Service → "Logs" tab
2. Look for these messages:

**✅ Good Signs:**
```
Environment validation passed
Database initialized successfully
Server running on port 3001
```

**⚠️ Warnings (non-critical but should fix):**
```
⚠️  FRONTEND_URL not set in production - CORS will be restricted for security
⚠️  FRONTEND_URL not set in production - CORS will reject all origins
```

**❌ Errors (must fix):**
```
Missing required environment variables: DATABASE_URL
Failed to start server
```

---

### 5. CORS Verification

**Test CORS from Frontend:**
1. Open browser console on your frontend
2. Try making an API request
3. Check Network tab for CORS errors

**If CORS errors appear:**
- Verify `FRONTEND_URL` matches your frontend URL exactly
- Check that `NODE_ENV=production` is set
- Frontend URL must include protocol: `https://...` (not `http://`)

**Test CORS manually:**
```bash
curl -H "Origin: https://your-frontend.up.railway.app" \
     -H "Access-Control-Request-Method: GET" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS \
     https://your-backend.up.railway.app/api/routers
```

Should return CORS headers if configured correctly.

---

### 6. Error Handling Test

**Test Error Sanitization:**
1. Make a request that will fail (e.g., invalid endpoint)
2. In production, should see: `{"error": "Something went wrong!"}`
3. Should NOT see stack traces or internal details

**Check Logs:**
- Full error details should still appear in Railway logs
- Only client responses are sanitized

---

## 🚨 Critical Issues to Fix Immediately

### Issue 1: Missing FRONTEND_URL
**Symptom:** Frontend can't make API requests (CORS errors)  
**Fix:** Add `FRONTEND_URL=https://your-frontend-url.up.railway.app` to backend variables

### Issue 2: Missing DATABASE_URL
**Symptom:** Server won't start, shows "Missing required environment variables"  
**Fix:** Railway should auto-set this. If missing, check PostgreSQL plugin is connected.

### Issue 3: Wrong FRONTEND_URL Format
**Symptom:** CORS still fails even with FRONTEND_URL set  
**Fix:** Must be full URL with protocol: `https://routerlogger-frontend-production.up.railway.app`

---

## ✅ Post-Deployment Verification

### Test Checklist:
- [ ] Health endpoint returns 200: `/health`
- [ ] API root returns 200: `/`
- [ ] Frontend can make API requests (no CORS errors)
- [ ] Router telemetry ingestion works: `POST /api/log`
- [ ] Webhooks work: `POST /api/ironwifi/webhook`
- [ ] Error responses don't leak stack traces (in production)
- [ ] Logs show "Environment validation passed"

---

## 📝 Railway Configuration Files

### Backend (`backend/railway.json`):
```json
{
  "healthcheckPath": "/health",
  "healthcheckTimeout": 100
}
```
✅ Health check configured correctly

### Frontend (`frontend/railway.json`):
```json
{
  "buildCommand": "npm run build",
  "startCommand": "serve -s build -l $PORT"
}
```
✅ Build and start commands configured

---

## 🔗 Quick Links

- **Railway Dashboard**: https://railway.app
- **GitHub Repository**: https://github.com/atoates/router_logger
- **Backend Health**: `https://your-backend.up.railway.app/health`
- **API Root**: `https://your-backend.up.railway.app/`

---

## 📞 If Something Goes Wrong

1. **Check Railway Logs** - Most errors will be logged
2. **Verify Environment Variables** - Use checklist above
3. **Test Health Endpoint** - Should return 200
4. **Check Deployment Status** - Should be "Active"
5. **Rollback if needed**: Revert to previous commit in Railway

---

**Last Updated**: 2025-11-13  
**Deployed By**: Auto (via git push to main)  
**Status**: ✅ Ready for verification

