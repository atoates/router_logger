# Check Recent ClickUp Comments

## Quick Check

To see what comments have been posted to router tasks recently:

```bash
cd backend
npm run check-comments
```

Or specify hours:
```bash
node check-recent-comments.js 24   # Last 24 hours (default)
node check-recent-comments.js 48   # Last 48 hours
node check-recent-comments.js 168  # Last week
```

## What You'll See

```
========================================
  Recent ClickUp Comments
========================================

📅 Time window: Last 24 hours
📁 Log file: /backend/combined.log

📊 Scanning 15,234 log entries...

✨ Found 12 comments

========================================

📊 Summary by Type:

   🔄 Status Change: 8
   🤖 Location Assignment: 2
   👤 User Assignment: 1
   🤖 Location Unlink: 1

========================================

📝 Recent Comments (newest first):

🔄 Status Change
   ⏰ 12/6/2025, 1:15:23 AM (2 hours ago)
   🔌 Router: #98
   📋 ClickUp Task: 86c69115d
   🔄 Status: offline → online

🤖 Location Assignment
   ⏰ 12/5/2025, 3:55:00 PM (9 hours ago)
   🔌 Router: #98
   📋 ClickUp Task: 86c69115d
   📍 Location: #279 | Unit 44G, Leyton Industrial Village, E10 7QE

...
```

## Comment Types Tracked

The script looks for these types of comments:

1. **🤖 Location Assignment** - Router linked to a location
2. **🤖 Location Unlink** - Router removed from a location
3. **👤 User Assignment** - Router assigned to user(s)
4. **👤 User Unassignment** - Router unassigned from user(s)
5. **🔄 Status Change** - Router went online/offline
6. **🗑️ Decommission/Return** - Router decommissioned or being returned

## Based on Application Logs

This script scans the application logs (`combined.log`) for comment activity. It shows:
- When each comment was posted
- What router it was for
- What ClickUp task received the comment
- Additional context (location, assignees, status changes, etc.)

## No Results?

If you see "No ClickUp comments found", it means:
- The server hasn't been running (so no logs)
- No actions that trigger comments have occurred
- The time window is too narrow (try more hours)

## Current Status

Based on the local environment:
- **Log entries**: 2 (minimal - likely fresh logs)
- **Recent comments**: None found in last 72 hours locally

This is expected if:
- You're running this on your local development machine
- The production server is running on Railway
- Logs are separate between environments

## Check Production Logs

To see comments from the production environment:

### Option 1: Railway Dashboard
1. Go to your Railway project
2. Click on the backend service
3. Go to "Deployments" → Select latest deployment
4. Click "View Logs"
5. Search for: "Added comment to router task" or "createTaskComment"

### Option 2: Railway CLI
```bash
railway logs --service backend | grep -i "comment"
```

### Option 3: ClickUp Directly
1. Go to any router task in ClickUp
2. Scroll to the comments section
3. Look for comments with "🤖 **System:**" or "👤 **System:**"

## Related Documentation

- **Comment Actions**: `/CLICKUP-COMMENT-ACTIONS.md` - All actions that create comments
- **Comment Types**: See the full list of 6 comment types and their formats

## Example Use Cases

### After linking Router #98 to location
```bash
npm run check-comments
```
Should show a location assignment comment

### After a router goes offline
```bash
npm run check-comments
```
Should show status change comments

### Weekly review
```bash
node check-recent-comments.js 168  # Last 7 days
```

---

**Note**: This tool is most useful when run on the production server where the main application is actively processing router events. On development machines, you may see fewer or no results.

