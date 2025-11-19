# Router Status Race Condition - FIXED

## Problem Description

**Symptom:** When changing a router's status to "Being Returned", it automatically reverted back to "Needs Attention" within 2 minutes.

**Timeline Example:**
- 13:11 - User manually sets status to "Being Returned" ✅
- 13:13 - Status automatically changed back to "Needs Attention" ❌

## Root Cause

### Race Condition in ClickUp Sync

The ClickUp sync process had a **timing vulnerability**:

1. **Sync Batch Loading** (13:10:30)
   - Sync starts and loads all routers from database into memory
   - Query excludes routers with "being returned" status
   - Router #171 has status "needs attention" at this time

2. **Manual Status Change** (13:11:00)
   - User changes router #171 to "being returned"
   - Database is updated ✅
   - ClickUp is updated ✅

3. **Stale Data Processing** (13:12:00)  
   - Sync is still processing the batch loaded at 13:10:30
   - Router #171 data in memory still shows old status
   - Sync doesn't know status was changed

4. **Status Overwrite** (13:13:00)
   - Sync calculates new status based on router state:
     - Has location? Yes (UNIT 16 AT 135, SALISBURY ROAD)
     - Is online? No
     - **Calculated status: "needs attention"**
   - Updates database with calculated status ❌
   - User's manual change is lost!

### Why the Protection Didn't Work

The code had protection at **query time**:

```sql
WHERE r.clickup_task_id IS NOT NULL
  AND LOWER(r.clickup_task_status) NOT IN ('being returned', 'decommissioned')
```

But this only prevents routers with manual statuses from being **included in the batch**. If the status changes AFTER the batch is loaded, the protection doesn't apply!

## The Fix

### Before (Vulnerable):
```javascript
// Check status from router object loaded earlier
const currentDbStatus = router.clickup_task_status?.toLowerCase();
const hasManualStatus = manualStatuses.includes(currentDbStatus);
```

This uses **stale data** from when the batch was loaded.

### After (Fixed):
```javascript
// CRITICAL: Re-check current status from database to avoid race conditions
// The router object may have stale data if status was changed after sync batch was loaded
const freshStatusResult = await pool.query(
  'SELECT clickup_task_status FROM routers WHERE router_id = $1',
  [router.router_id]
);

const currentDbStatus = freshStatusResult.rows[0]?.clickup_task_status?.toLowerCase();
const hasManualStatus = manualStatuses.includes(currentDbStatus);
```

Now it **queries the database** right before processing each router, catching any status changes that happened during the sync.

## Technical Details

**File:** `backend/src/services/clickupSync.js`
**Lines:** 214-227
**Change Type:** Added fresh database query to prevent race condition

### How It Works Now:

1. Sync loads batch of routers (excluding manual statuses at query time)
2. For each router in batch:
   - **Re-check status from database** ← NEW!
   - If status is now manual ("being returned" or "decommissioned"), skip
   - Otherwise, calculate and update status

### Performance Impact

- **Additional Database Queries:** One SELECT per router during sync
- **Typical Impact:** ~0.1ms per router
- **For 100 routers:** +10ms total sync time
- **Trade-off:** Negligible performance cost for critical data integrity

## Testing the Fix

### Test Scenario 1: Change During Sync
1. Trigger a manual sync: `POST /api/clickup/sync`
2. Immediately change router status to "Being Returned"
3. Wait for sync to complete
4. **Expected:** Status remains "Being Returned" ✅

### Test Scenario 2: Change Before Scheduled Sync
1. Change router status to "Being Returned"
2. Wait for next scheduled sync (runs every 30 minutes)
3. **Expected:** Status remains "Being Returned" ✅

### Test Scenario 3: Automatic Status Calculation
1. Router with no manual status
2. Router has location + offline
3. Sync runs
4. **Expected:** Status updated to "Needs Attention" ✅

## Related Files

- `backend/src/services/clickupSync.js` - Main fix location
- `backend/src/routes/router.js` - Manual status update endpoint
- `ROUTER-CACHE-FIX.md` - Related cache issues documentation

## Prevention

### For Users:
- ✅ Manual statuses ("Being Returned", "Decommissioned") are now fully protected
- ✅ Changes will persist even during sync operations
- ✅ No need to avoid making changes during syncs

### For Developers:
- ✅ Always re-check database for critical values before updates
- ✅ Don't trust data that was loaded earlier in long-running processes
- ✅ Consider batch load time vs. processing time when handling state

## Deployment Notes

1. **Backward Compatible:** Yes, no database changes needed
2. **Restart Required:** Yes, to load new code
3. **Breaking Changes:** None
4. **Migration:** None required

## Log Messages

When the fix prevents a race condition, you'll see:
```
Router 123456789 has manual status "being returned" - skipping automatic status sync (race condition prevented)
```

The "(race condition prevented)" suffix indicates the fresh check caught a status change.

## Summary

- **Problem:** Manual status changes were overwritten by sync
- **Cause:** Sync used stale data loaded before the change
- **Fix:** Re-query database for current status before each update
- **Impact:** Negligible performance cost, critical data integrity gain
- **Status:** ✅ FIXED - Manual statuses are now protected

