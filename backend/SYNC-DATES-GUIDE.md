# Admin Date Sync Script

Automated script to sync `date_installed` from ClickUp to the database for all routers with location assignments.

## Quick Start

### Option 1: Using npm script (Recommended)
```bash
cd backend
npm run sync-dates
```

### Option 2: Direct execution
```bash
cd backend
node sync-dates-admin.js
```

### Option 3: As executable
```bash
cd backend
./sync-dates-admin.js
```

## What It Does

1. **Fetches all routers** with location assignments from the database
2. **Queries ClickUp** for each router's "Date Installed" custom field from the location list
3. **Updates the database** with the fetched dates
4. **Clears the cache** to ensure fresh data is served
5. **Provides a detailed report** showing:
   - Number of routers updated successfully
   - Number of routers that failed
   - Which routers have no date set in ClickUp
   - Total execution time

## Output Example

```
========================================
  Admin Date Sync - Starting
========================================

🔄 Syncing date_installed from ClickUp to database...

========================================
  Sync Complete!
========================================

📊 Summary:
  ✅ Successfully updated: 45
  ❌ Failed: 2
  📦 Total routers: 47
  🧹 Cache cleared: Yes
  ⏱️  Duration: 12.34s

✨ Updated routers:
  - Router 6001785063: 2025-06-20T12:00:00.000Z
  - Router 6001813665: 2025-06-09T12:00:00.000Z
  ...

⚠️  Failed routers:
  - Router 6006857298: API rate limit exceeded

ℹ️  Routers with no Date Installed in ClickUp:
  - Router 6006858295
  - Router 6001301145

  💡 Tip: Set the "Date Installed" custom field in ClickUp for these routers
      then run this script again.

========================================
```

## When to Run

### Manual Triggers
- After setting/updating "Date Installed" fields in ClickUp
- When investigating date display issues (like Router #98)
- After bulk property assignments
- When dates appear stale or incorrect

### Scheduled Automation (Optional)
You can schedule this script to run periodically:

#### Using cron (Linux/Mac)
```bash
# Run daily at 3 AM
0 3 * * * cd /path/to/backend && npm run sync-dates >> /var/log/sync-dates.log 2>&1
```

#### Using systemd timer (Linux)
Create `/etc/systemd/system/sync-dates.timer`:
```ini
[Unit]
Description=Sync router dates from ClickUp daily

[Timer]
OnCalendar=daily
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

#### Using Railway scheduled task
Add to `railway.json`:
```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  },
  "cron": [
    {
      "schedule": "0 3 * * *",
      "command": "npm run sync-dates"
    }
  ]
}
```

## Error Handling

The script handles errors gracefully:
- **Rate Limit Errors**: Individual router failures don't stop the entire sync
- **Network Issues**: Retries with exponential backoff
- **Missing Fields**: Logs routers where the ClickUp field isn't set
- **API Errors**: Detailed error messages in logs

## Requirements

- Node.js environment
- Database connection configured (`.env` file)
- ClickUp OAuth token in database
- Routers must have `clickup_location_task_id` set

## Environment Variables

Required in `.env`:
```env
DATABASE_URL=postgresql://...
CLICKUP_API_BASE_URL=https://api.clickup.com/api/v2
```

## Related Files

- **Script**: `/backend/sync-dates-admin.js`
- **Service**: `/backend/src/services/routerSyncService.js`
- **Controller**: `/backend/src/controllers/adminController.js`
- **API Endpoint**: `POST /api/admin/sync-dates` (requires admin auth)

## Troubleshooting

### "No routers with location assignments found"
- Check that routers have `clickup_location_task_id` populated
- Verify routers are linked to locations via the UI

### "Failed to fetch from ClickUp"
- Check OAuth token is valid: `SELECT * FROM clickup_oauth_tokens;`
- Verify ClickUp API is accessible
- Check rate limits haven't been exceeded

### "Date is null after sync"
- The "Date Installed" custom field isn't set in ClickUp for that location
- Set it manually in ClickUp and re-run the script

### High failure rate
- Check ClickUp API status
- Verify the CLICKUP_FIELD_IDS.DATE_INSTALLED constant is correct
- Review error logs for specific error messages

## Performance

- **Rate Limited**: Includes delays between API calls to respect ClickUp limits
- **Typical Speed**: ~1-2 routers per second
- **50 routers**: ~25-50 seconds
- **100 routers**: ~50-100 seconds

## Logging

Logs are written to:
- **Console**: Formatted user-friendly output
- **Application logs**: `/backend/combined.log` and `/backend/error.log`
- **Database logs**: Via `logger` service

## Security

- Requires ClickUp OAuth token (stored securely in database)
- No user credentials in code
- Uses environment variables for sensitive config
- Database connection is encrypted (SSL)

## See Also

- Router #98 Date Investigation: `/ROUTER-98-DATE-INVESTIGATION.md`
- ClickUp Comment Actions: `/CLICKUP-COMMENT-ACTIONS.md`
- ClickUp Integration: `/docs/CLICKUP-INTEGRATION.md`

