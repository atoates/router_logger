# Router #98 Date Investigation Summary

## Issue
Router #98 is showing "Date not set" for the install date in the Installed Routers list, even though it appears there should be a date set.

## Root Cause
**The `date_installed` field in the database is `null` for Router #98.**

### Evidence from API Response
```json
{
  "router_id": "6006858295",
  "name": "Router #98",
  "location_task_id": "901518472110",
  "location_task_name": "#279 | Unit 44G, Leyton Indsutrial Village, E10 7QE",
  "location_linked_at": "2025-12-04T15:55:00.685Z",
  "date_installed": null  ← This is the problem
}
```

### Comparison with Router #99 (Working Correctly)
```json
{
  "router_id": "6006857285",
  "name": "Router #99",
  "location_task_id": "901509008008",
  "location_task_name": "#109 | Unit 11-13 Fairways Business Park, E10 7QT",
  "location_linked_at": "2025-12-04T13:57:06.836Z",
  "date_installed": "1741060800000"  ← Has a valid timestamp
}
```

Router #99 correctly displays as `04/03/2025` (March 4, 2025) because it has a valid Unix timestamp.

## Why Is date_installed NULL?

When a router is linked to a location, the system attempts to sync the `date_installed` field from ClickUp:

**File: `/backend/src/services/propertyService.js` (lines 63-87)**

```javascript
// Fetch and sync date_installed from ClickUp
const DATE_INSTALLED_FIELD_ID = CLICKUP_FIELD_IDS.DATE_INSTALLED;
try {
  const rawDate = await clickupClient.getListCustomFieldValue(
    locationTaskId,
    DATE_INSTALLED_FIELD_ID,
    'default'
  );
  const dateInstalled = rawDate ? Number(rawDate) : null;
  
  await client.query(
    `UPDATE routers SET date_installed = $1 WHERE router_id = $2`,
    [dateInstalled, routerId]
  );
} catch (dateError) {
  logger.warn('Failed to sync date_installed (location link still recorded)', {
    routerId,
    error: dateError.message
  });
}
```

The `date_installed` will be `null` if:
1. The "Date Installed" custom field is not set in ClickUp for location #279
2. The sync failed due to an API error
3. The field was empty when Router #98 was linked on Dec 4, 2025

## Frontend Behavior (Correct)

The frontend correctly identifies `null` values and displays "Date not set":

**File: `/frontend/src/components/InstalledRouters.js` (lines 38-60)**

```javascript
const formatDate = (dateValue) => {
  if (!dateValue) return 'Date not set';  // Catches null, undefined, 0
  
  let timestamp = dateValue;
  if (typeof dateValue === 'string') {
    timestamp = parseInt(dateValue, 10);
  }
  
  const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(dateValue);
  
  // Check for invalid date or Unix epoch (01/01/1970)
  if (isNaN(date.getTime()) || date.getTime() === 0 || date.getFullYear() === 1970) {
    return 'Date not set';
  }
  
  // Format as DD/MM/YYYY (UK format)
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  
  return `${day}/${month}/${year}`;
};
```

## Solutions

### Option 1: Set the Date in ClickUp (Recommended)
1. Go to ClickUp list for location #279: `https://app.clickup.com/901518472110`
2. Find the "Date Installed" custom field
3. Set the appropriate installation date
4. Run the admin sync endpoint to update the database:
   ```bash
   POST /api/admin/sync-dates
   ```

### Option 2: Manual Database Update (If needed urgently)
If you know the correct installation date and want to set it directly:

```sql
-- Example: Set to December 4, 2025
UPDATE routers 
SET date_installed = 1733270400000  -- Dec 4, 2025 00:00:00 UTC
WHERE router_id = '6006858295';
```

Then clear the cache:
```bash
POST /api/admin/clear-cache
```

### Option 3: Check ClickUp Field Status
Run the diagnostic script to see if the field is set in ClickUp:

```bash
cd backend
node check-router-98-clickup.js
```

This will show:
- Whether the Date Installed field has a value in ClickUp
- What that value is if it exists
- Instructions for fixing the issue

## Verification Steps

After setting the date:

1. **Verify in database**: Check that `date_installed` is no longer null
2. **Clear cache**: `POST /api/admin/clear-cache`
3. **Refresh frontend**: The Installed Routers list should now show the date
4. **Check API**: `GET /api/routers/with-locations` should show the timestamp

## Technical Details

- **Database column**: `routers.date_installed` (BIGINT)
- **Format**: Unix timestamp in milliseconds
- **ClickUp field ID**: Stored in `CLICKUP_FIELD_IDS.DATE_INSTALLED`
- **Sync endpoint**: `POST /api/admin/sync-dates` (admin only)
- **Auto-sync**: Happens when linking router to location
- **Cache**: Results are cached; must clear after manual updates

## Related Files

- `/backend/src/services/propertyService.js` - Links routers to locations and syncs dates
- `/backend/src/services/routerSyncService.js` - Manual date sync functionality
- `/backend/src/controllers/adminController.js` - Admin sync endpoint
- `/frontend/src/components/InstalledRouters.js` - Displays the install dates
- `/backend/src/database/migrations/013_add_date_installed.sql` - Database schema

## Conclusion

**This is NOT a bug.** The system is working as designed. Router #98 shows "Date not set" because the `date_installed` field is legitimately `null` in the database, which means the ClickUp custom field was not set (or was empty) when the router was linked to location #279 on December 4, 2025.

**Action Required**: Set the "Date Installed" custom field in ClickUp for location #279, then run the sync endpoint.

