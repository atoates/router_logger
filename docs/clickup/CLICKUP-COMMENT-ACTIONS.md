# ClickUp Router Task Comment Actions

This document lists all actions in the RouterLogger system that automatically add comments to router tasks in ClickUp.

## Summary

The system adds comments to router tasks in ClickUp for the following **6 action types**:

1. **Router Linked to Location** (Property Assignment)
2. **Router Unlinked from Location** (Property Unassignment)
3. **Router Assigned to User(s)**
4. **Router Unassigned from User(s)**
5. **Router Status Changed** (Online ↔ Offline)
6. **Router Decommissioned or Being Returned**

---

## 1. Router Linked to Location

**When:** A router is assigned to a physical location (property)  
**Trigger:** `POST /api/routers/:routerId/link`  
**File:** `/backend/src/services/propertyService.js` (lines 130-169)

### Comment Format:
```
🤖 **System:** Router assigned to location: **{Location Name}**

📍 Location: {ClickUp List URL}
🕐 Assigned at: {Timestamp}
👤 Linked by: {Username} (if provided)

📝 Notes: {Notes} (if provided)
```

### Example:
```
🤖 **System:** Router assigned to location: **#279 | Unit 44G, Leyton Industrial Village, E10 7QE**

📍 Location: https://app.clickup.com/12345/v/li/901518472110
🕐 Assigned at: 12/4/2025, 3:55:00 PM
👤 Linked by: john.doe

📝 Notes: Router installed on ground floor near main entrance
```

### Additional Actions:
- Updates router task status to "installed"
- Removes any existing assignees from the router task
- Syncs the "Date Installed" custom field from ClickUp

---

## 2. Router Unlinked from Location

**When:** A router is removed from a physical location  
**Trigger:** `POST /api/routers/:routerId/unlink`  
**File:** `/backend/src/services/propertyService.js` (lines 257-295)

### Comment Format:
```
🤖 **System:** Router removed from location: **{Location Name}**

📍 Previous Location: {ClickUp List URL}
🕐 Unlinked at: {Timestamp}
👤 Unlinked by: {Username} (if provided)

📝 Notes: {Notes} (if provided)
```

### Example:
```
🤖 **System:** Router removed from location: **#279 | Unit 44G, Leyton Industrial Village, E10 7QE**

📍 Previous Location: https://app.clickup.com/12345/v/li/901518472110
🕐 Unlinked at: 12/6/2025, 10:30:00 AM
👤 Unlinked by: jane.smith

📝 Notes: Router being relocated to different property
```

### Additional Actions:
- Updates router task status to "needs attention"

---

## 3. Router Assigned to User(s)

**When:** A router task is assigned to one or more ClickUp users  
**Trigger:** `POST /api/routers/:routerId/assign`  
**File:** `/backend/src/services/propertyService.js` (lines 469-496)

### Comment Format:
```
👤 **System:** Router assigned to: **{User Names}**

🕐 Assigned at: {Timestamp}
```

### Example:
```
👤 **System:** Router assigned to: **john.doe, jane.smith**

🕐 Assigned at: 12/6/2025, 2:15:00 PM
```

### Additional Actions:
- Replaces all existing assignees with the new ones
- Updates router task status to "ready"
- Updates the database immediately with assignee information

---

## 4. Router Unassigned from User(s)

**When:** All assignees are removed from a router task  
**Trigger:** `POST /api/routers/:routerId/remove-assignees`  
**File:** `/backend/src/services/propertyService.js` (lines 564-589)

### Comment Format:
```
👤 **System:** Router unassigned from: **{User Names}**

🕐 Unassigned at: {Timestamp}
```

### Example:
```
👤 **System:** Router unassigned from: **john.doe, jane.smith**

🕐 Unassigned at: 12/6/2025, 4:45:00 PM
```

---

## 5. Router Status Changed (Online ↔ Offline)

**When:** Router status changes between online and offline  
**Trigger:** Automatic when router telemetry is received OR RMS sync detects status change  
**Files:**
- `/backend/src/services/telemetryProcessor.js` (lines 125-164) - MQTT telemetry
- `/backend/src/routes/rms.js` (lines 293-324) - RMS sync

### Comment Format:
```
{Status Emoji} **System:** Router status changed

**Previous:** {Previous Status}
**Current:** {Current Status}

🕐 Changed at: {Timestamp}
```

### Examples:
```
🟢 **System:** Router status changed

**Previous:** Offline
**Current:** Online

🕐 Changed at: 12/6/2025, 8:30:15 AM
```

```
🔴 **System:** Router status changed

**Previous:** Online
**Current:** Offline

🕐 Changed at: 12/6/2025, 11:45:30 PM
```

### Conditions:
- Only triggered when status actually changes (not on every telemetry update)
- Requires both previous and new status to be known
- Router must have a linked ClickUp task ID

### Sources:
1. **MQTT Telemetry**: When router sends status updates via MQTT
2. **RMS Sync**: When Teltonika RMS API reports status changes

---

## 6. Router Decommissioned or Being Returned

**When:** Router status is changed to "decommissioned" or "being returned"  
**Trigger:** `POST /api/routers/:routerId/status`  
**File:** `/backend/src/routes/router.js` (lines 715-742)

### Comment Format (Decommissioned):
```
🗑️ **Router Decommissioned**

This router has been permanently decommissioned and removed from service.

**Notes:** {Notes} (if provided)
```

### Comment Format (Being Returned):
```
📦 **Router Being Returned**

This router is being returned and is no longer in use.

**Notes:** {Notes} (if provided)
```

### Examples:
```
🗑️ **Router Decommissioned**

This router has been permanently decommissioned and removed from service.

**Notes:** Hardware failure, beyond repair
```

```
📦 **Router Being Returned**

This router is being returned and is no longer in use.

**Notes:** End of rental period
```

### Additional Actions:
- Updates router task status in ClickUp to match the new status
- Updates database with the new status

---

## Technical Implementation Details

### Comment Creation Function
**File:** `/backend/src/services/clickupClient.js` (lines 483-539)

```javascript
async createTaskComment(taskId, commentText, options = {}, userId = 'default')
```

**Parameters:**
- `taskId`: ClickUp task ID
- `commentText`: The comment content (supports markdown)
- `options.notifyAll`: Boolean to notify all task members (default: `false`)
- `options.assignee`: ClickUp user ID to assign the comment to
- `userId`: User identifier for OAuth token lookup (default: `'default'`)

**Return:** Created comment object with ID

### Error Handling
All comment creation is wrapped in try-catch blocks. If a comment fails to post:
- A warning is logged
- The main action (linking, status change, etc.) still succeeds
- The system continues operating normally

This ensures that ClickUp comment failures don't break core functionality.

### Notification Policy
All automated system comments use `notifyAll: false` to avoid spamming users with notifications for routine system events.

### Rate Limiting
Comments are subject to ClickUp API rate limits:
- Uses exponential backoff retry (up to 3 attempts)
- Implements delay between requests
- Tracks API call metrics

---

## Comment Characteristics

### Markdown Support
All comments support markdown formatting:
- **Bold text** using `**text**`
- Emoji icons for visual categorization
- Line breaks for readability
- Links to ClickUp resources

### Consistent Format
Every system comment includes:
1. **Icon/Emoji**: Visual indicator of action type
2. **System identifier**: "**System:**" label
3. **Action description**: What happened
4. **Timestamp**: When it occurred (in local time)
5. **Context**: Additional relevant information
6. **Notes**: Optional user-provided context

### No Duplicate Comments
Status change comments only fire when status actually changes, preventing duplicate comments for the same status.

---

## Viewing Comments

Comments can be viewed:
1. **In ClickUp**: On the router task page
2. **Via API**: Using ClickUp's API to fetch task comments
3. **Activity Log**: ClickUp's activity feed shows all comment history

---

## Configuration

### Environment Variables Required:
- `CLICKUP_ACCESS_TOKEN`: OAuth access token for API access (stored in database per user)
- `CLICKUP_API_BASE_URL`: Base URL for ClickUp API (defaults to https://api.clickup.com/api/v2)

### Database Dependencies:
- `routers.clickup_task_id`: Must be set for comments to be posted
- `clickup_oauth_tokens`: Stores user OAuth tokens

---

## Future Enhancements

Potential additions for comment functionality:
- Router firmware update notifications
- Data usage threshold alerts
- Network operator changes
- Extended offline period alerts
- Manual inspection logged events

---

## Related Documentation

- **ClickUp API**: https://clickup.com/api
- **Router Tracking**: `/docs/ROUTER-PROPERTY-TRACKING.md`
- **ClickUp Integration**: `/docs/CLICKUP-INTEGRATION.md`
- **Error Handling**: `/backend/ERROR-HANDLING.md`

