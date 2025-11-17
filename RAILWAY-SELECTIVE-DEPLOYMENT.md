# Railway Selective Deployment Configuration

## Problem
All three services (backend, frontend, frontend-mobile) deploy together when any code changes, even if only one service's code changed.

## Solution Options

### Option 1: Configure Root Directory in Railway Dashboard (Recommended)

Railway allows you to set a **root directory** for each service so it only deploys when that directory changes.

**Steps:**

1. **Backend Service:**
   - Go to Railway Dashboard → Your Project → Backend Service
   - Click "Settings" → "Source"
   - Set **Root Directory** to: `backend`
   - Save

2. **Frontend Service:**
   - Go to Railway Dashboard → Your Project → Frontend Service
   - Click "Settings" → "Source"
   - Set **Root Directory** to: `frontend`
   - Save

3. **Mobile Frontend Service:**
   - Go to Railway Dashboard → Your Project → Mobile Frontend Service
   - Click "Settings" → "Source"
   - Set **Root Directory** to: `frontend-mobile`
   - Save

**Result:** Each service will only deploy when files in its specific directory change.

---

### Option 2: Disable Auto-Deploy, Use Manual Deployments

If you prefer more control:

1. **For each service:**
   - Go to Railway Dashboard → Service → Settings
   - Under "Deployments" → "Auto Deploy"
   - Toggle **OFF** for services you want to deploy manually

2. **Deploy manually when needed:**
   - Go to Service → "Deployments" tab
   - Click "Deploy" → Select commit/branch
   - Or use Railway CLI: `railway up`

**Pros:** Full control over when each service deploys
**Cons:** Must remember to deploy manually

---

### Option 3: Use Different Branches

Create separate branches for each service:
- `main` - All services (current)
- `backend-only` - Only backend changes
- `frontend-only` - Only frontend changes
- `mobile-only` - Only mobile changes

Then configure each Railway service to watch a specific branch.

**Pros:** Complete separation
**Cons:** More complex git workflow

---

## Recommended: Option 1 (Root Directory)

This is the cleanest solution. Railway will:
- ✅ Only deploy backend when `backend/` changes
- ✅ Only deploy frontend when `frontend/` changes
- ✅ Only deploy mobile when `frontend-mobile/` changes
- ✅ Still use the same git repository
- ✅ No workflow changes needed

## How to Verify

After configuring root directories:

1. Make a change only in `backend/src/`
2. Push to git
3. Check Railway dashboard - **only backend should deploy**

4. Make a change only in `frontend/src/`
5. Push to git
6. Check Railway dashboard - **only frontend should deploy**

## Current Configuration

Currently, all services are watching the entire repository root, which is why they all deploy together.

