# Deploy Date Installed Database Migration

## Steps to Deploy

### 1. Run Migration on Railway

SSH into Railway backend and run:

```bash
cd backend
node run-migration-013.js
```

This will:
- Add `date_installed` BIGINT column to `routers` table
- Create index on `date_installed` for efficient queries

### 2. Sync Existing Data from ClickUp

After migration completes, sync the existing data:

```bash
cd backend
node sync-date-installed.js
```

This will:
- Fetch all routers with location assignments
- Pull `date_installed` from ClickUp for each location
- Update the database with the values
- Add 200ms delay between ClickUp API calls to avoid rate limits

**Expected time**: ~2-3 minutes for 13 routers

### 3. Verify Deployment

Check that the API returns data correctly:

```bash
curl https://routerlogger-production.up.railway.app/api/routers/with-locations | jq '.[0]'
```

Should see `date_installed` field with numeric timestamp value.

### 4. Restart Services (if needed)

The changes should deploy automatically via Railway's GitHub integration. If needed, manually restart in Railway dashboard.

## What Changed

### Before
- `date_installed` fetched from ClickUp API on every request
- Sequential API calls with 200ms delays to avoid rate limits
- Slow response times (~15-20 seconds for with-locations endpoint)
- High risk of rate limit errors

### After
- `date_installed` stored in PostgreSQL database
- Read directly from database (instant)
- Only synced from ClickUp when router is linked to location
- Fast response times (<100ms)
- No rate limit issues

## Future Syncs

To manually re-sync dates from ClickUp (if needed):

```bash
cd backend
node sync-date-installed.js
```

This is useful if:
- Date Installed field is updated in ClickUp manually
- Need to backfill after bulk updates
- Data integrity check needed
