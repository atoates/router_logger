# Railway Mobile Service Setup - Fix Root Directory Issue

## ❌ Error You're Seeing

```
Could not find root directory: /frontend-mobile
```

## ✅ Solution

The root directory path should **NOT have a leading slash**. Use:

```
frontend-mobile
```

**NOT:**
```
/frontend-mobile
```

---

## 🔧 How to Fix in Railway Dashboard

### Step 1: Go to Service Settings

1. Railway Dashboard → Your Project
2. Click on **Mobile Service** (or whatever you named it)
3. Click **Settings** tab
4. Scroll to **Root Directory** section

### Step 2: Set Root Directory

**Enter exactly:**
```
frontend-mobile
```

**Important:**
- ✅ No leading slash
- ✅ No trailing slash
- ✅ Just: `frontend-mobile`

### Step 3: Save and Redeploy

1. Click **Save** or **Update**
2. Railway will automatically redeploy
3. Check the **Deployments** tab to see it building

---

## 📋 Complete Setup Checklist

### ✅ Service Configuration

- [ ] Service created in Railway
- [ ] Root Directory set to: `frontend-mobile` (no slashes)
- [ ] Environment variable set: `REACT_APP_API_URL=https://your-backend.up.railway.app`
- [ ] Domain generated: `vacatad-mobile.up.railway.app`

### ✅ Verify Files Exist

The directory structure should be:
```
your-repo/
├── frontend-mobile/
│   ├── package.json       ✅
│   ├── railway.json       ✅
│   ├── src/
│   └── public/
```

### ✅ Build Configuration

Railway should auto-detect:
- **Builder**: Nixpacks
- **Build Command**: `npm run build`
- **Start Command**: `serve -s build -l $PORT`

If not auto-detected, you can set manually in Railway dashboard.

---

## 🐛 Troubleshooting

### Still Getting "Could not find root directory"?

1. **Check the path is correct:**
   ```bash
   # From repo root, verify directory exists
   ls -la frontend-mobile
   ```

2. **Check Railway is connected to correct repo:**
   - Railway Dashboard → Service → Settings
   - Verify **Repository** is correct
   - Verify **Branch** is `main` (or your default branch)

3. **Try without any path:**
   - If Railway is already in the repo root, try leaving Root Directory **empty**
   - Then Railway will look for `package.json` in root (won't work, but tests connection)

4. **Check file structure:**
   - Make sure `frontend-mobile/package.json` exists
   - Make sure `frontend-mobile/src/` exists
   - Make sure files are committed to git

### Build Fails?

1. **Check logs:**
   - Railway Dashboard → Service → Deployments → Click latest → View Logs

2. **Common issues:**
   - Missing `package.json` → Add it
   - Missing dependencies → Run `npm install` locally first
   - Build errors → Check `npm run build` works locally

---

## ✅ Quick Fix Steps

1. **Railway Dashboard** → Mobile Service → **Settings**
2. **Root Directory** field → Change from `/frontend-mobile` to `frontend-mobile`
3. **Save**
4. **Redeploy** (should happen automatically)

---

## 📝 After Fix

Once the service is working:

1. **Set environment variable:**
   ```
   REACT_APP_API_URL=https://your-backend.up.railway.app
   ```

2. **Update backend CORS:**
   - Add mobile URL to backend `FRONTEND_URL` or update CORS config
   - Mobile URL: `https://vacatad-mobile.up.railway.app`

3. **Test:**
   - Visit: `https://vacatad-mobile.up.railway.app`
   - Should see "Mobile App - Ready for fresh implementation"

---

**The fix**: Remove the leading slash from the root directory path! 🎯




