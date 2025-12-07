# Router #98 Assignee Discrepancy - Fix

## 🐛 The Issue
**Router #98** showed "Assigned to Jordan Jones" on the mobile app, but "Unassigned" on the web dashboard.

**Root Cause**:
1.  **Web App**: Fetches live task data directly from ClickUp API. Shows the *real* state (Unassigned).
2.  **Mobile App**: Uses cached `clickup_assignees` field from the local database.
3.  **Database State**: The database still had "Jordan Jones" in the `clickup_assignees` column because the assignee sync (pulling FROM ClickUp) wasn't running automatically.

The scheduled sync was only pushing updates **TO** ClickUp, not pulling changes **FROM** ClickUp (except via a separate manual endpoint).

## ✅ The Fix

### 1. Enhanced Force Sync
Modified `syncAllRoutersToClickUp` in `backend/src/services/clickupSync.js`:
- Added logic to call `syncAssigneesFromClickUp()` when `force=true`.
- Now, when you click **"Force ClickUp Sync"**, it does a bidirectional sync:
  - **Push**: Updates Firmware, Status, MAC, etc. -> ClickUp
  - **Pull**: Updates Assignees <- ClickUp

### 2. Updated Admin UI
- Updated description in Admin Debug Tools to mention assignee syncing.

## 🚀 How to Apply

1.  **Deploy** the changes (Backend & Frontend).
2.  Go to **Admin -> Debug Tools**.
3.  Click **"Force ClickUp Sync"**.
4.  This will:
    - Sync all router data to ClickUp (fixing firmware/MAC issues).
    - **Pull the latest assignees from ClickUp** (clearing the stale assignee for Router #98).
5.  **Check Mobile App**: Router #98 should now show as Unassigned.

## 📝 Files Modified
- `backend/src/services/clickupSync.js` - Added assignee sync logic to force mode.
- `frontend/src/components/AdminDebugTools.js` - Updated UI text.

---
**Status**: Fix implemented & ready for deployment.

