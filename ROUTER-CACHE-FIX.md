# Router Cache & Deduplication Fix

## Problem
Routers weren't showing up after updates due to:
1. **Backend cache** (60 seconds) - Prevents repeated database queries
2. **Frontend cache** (90 seconds) - Prevents repeated API calls
3. **Deduplication logic** - Groups routers by name (case-insensitive) and keeps only the "best" one

## Solution Implemented

### 1. Admin Debug Tools Page
**Location:** `/admin/debug` (Admin-only)

This new page provides:

#### Cache Management
- **🔄 Force Refresh Routers** - Clears frontend cache and fetches fresh data
- **🗑️ Clear All Caches** - Clears both frontend and backend caches (requires confirmation)

#### Deduplication Report
- **📊 Show Deduplication Report** - Shows which routers are hidden due to duplicate names

### 2. Backend API Endpoints

#### POST `/api/admin/clear-cache`
- Clears all router caches (routers, routers_with_locations, assignees)
- Requires admin authentication
- Returns: `{ success: true, message: "...", caches_cleared: [...] }`

#### GET `/api/admin/deduplication-report`
- Shows which routers share the same name
- Indicates which router is kept vs hidden
- Requires admin authentication
- Returns detailed report with:
  - Total routers in database
  - After deduplication count
  - List of duplicate groups showing kept vs hidden routers

### 3. Frontend API Functions

```javascript
// Clear all caches (frontend + backend)
clearRouterCache()

// Force refresh from database
forceRefreshRouters()

// Get deduplication report
getDeduplicationReport()
```

## How Deduplication Works

When multiple routers have the same name (case-insensitive), the system keeps the "best" one based on:

1. **Serial-like ID** (9+ digits) - Preferred over short IDs
2. **Log count** - Router with more telemetry logs
3. **Last seen** - Most recently active router

### Example
If you have:
- Router A: `router_id="12345"`, name="Test Router", logs=100
- Router B: `router_id="123456789"`, name="Test Router", logs=50

**Router B will be shown** because it has a serial-like ID (9+ digits), even though it has fewer logs.

## Accessing the Debug Tools

1. Log in as an admin
2. Navigate to **🔧 Debug** in the navigation menu
3. Use the tools to:
   - Clear caches if routers aren't showing
   - View deduplication report to see hidden routers
   - Identify why specific routers aren't appearing

## Common Issues & Solutions

### Issue: "I added a router but it's not showing"
**Solutions:**
1. Wait 60-90 seconds for cache to expire, OR
2. Go to `/admin/debug` and click "Force Refresh Routers"

### Issue: "I see one router but there are duplicates in the database"
**Solutions:**
1. Go to `/admin/debug` and click "Show Deduplication Report"
2. Review which router is being kept vs hidden
3. Options to fix:
   - Rename one router to make names unique
   - Ensure the router you want shown has more logs
   - Delete the duplicate router from database

### Issue: "The wrong router is being shown for a name"
**Cause:** Deduplication logic prefers routers with serial-like IDs (9+ digits) and more logs.
**Solutions:**
1. Check deduplication report to see the criteria
2. Either:
   - Give routers unique names
   - Ensure the preferred router has a serial-like ID
   - Ensure the preferred router has more logs

## Cache Settings

### Backend Cache
- **TTL:** 60 seconds (configurable via `ROUTERS_CACHE_TTL_SECONDS` env var)
- **Location:** `/backend/src/routes/router.js`
- **Variable:** `routersCache`

### Frontend Cache
- **TTL:** 90 seconds (configurable via `REACT_APP_ROUTERS_TTL_SECONDS` env var)
- **Location:** `/frontend/src/services/api.js`
- **Variable:** `_routersCache`

## Testing the Fix

1. **Test Cache Clearing:**
   ```bash
   # Add a router to database
   # Go to /admin/debug
   # Click "Clear All Caches"
   # Verify router appears immediately
   ```

2. **Test Deduplication:**
   ```bash
   # Create two routers with same name
   # Go to /admin/debug
   # Click "Show Deduplication Report"
   # Verify report shows which is kept/hidden
   ```

## For Developers

### Backend Changes
- `backend/src/routes/router.js`:
  - Added `POST /admin/clear-cache` endpoint
  - Added `GET /admin/deduplication-report` endpoint

### Frontend Changes
- `frontend/src/services/api.js`:
  - Added `clearRouterCache()` function
  - Added `forceRefreshRouters()` function
  - Added `getDeduplicationReport()` function

- `frontend/src/components/AdminDebugTools.js`: New component (with CSS)
- `frontend/src/App.js`: Added route and navigation link

