# Property Search API - Quick Reference

## Overview
Search and link **any ClickUp task** to a router. No restrictions on task type - use tasks from any list or space.

## Available Endpoints

### 1. Search Tasks in a Space (e.g., "Active Accounts")

**GET** `/api/router-properties/search-properties/:spaceId?search=query`

Search all tasks within a specific ClickUp space.

**Example:**
```bash
# Get Active Accounts space ID first
curl -s "https://routerlogger-production.up.railway.app/api/clickup/spaces/9015487518" | jq '.spaces'

# Search tasks in Active Accounts (spaceId: 90152330498)
curl -s "https://routerlogger-production.up.railway.app/api/router-properties/search-properties/90152330498?search=beach" | jq
```

**Response:**
```json
{
  "properties": [
    {
      "id": "abc123",
      "name": "Beach House Rental",
      "status": "active",
      "url": "https://app.clickup.com/t/abc123",
      "listName": "Properties",
      "listId": "12345",
      "tags": ["rental", "beach"]
    }
  ],
  "count": 1,
  "spaceId": "90152330498"
}
```

### 2. Search All Tasks in Workspace

**GET** `/api/router-properties/search-all/:workspaceId?search=query`

Search all tasks across the entire workspace.

**Example:**
```bash
# Search all tasks
curl -s "https://routerlogger-production.up.railway.app/api/router-properties/search-all/9015487518" | jq

# Search with filter
curl -s "https://routerlogger-production.up.railway.app/api/router-properties/search-all/9015487518?search=villa" | jq
```

**Response:**
```json
{
  "tasks": [
    {
      "id": "xyz789",
      "name": "Sunset Villa",
      "status": "active",
      "url": "https://app.clickup.com/t/xyz789",
      "list": {"id": "12345", "name": "Properties"},
      "space": {"id": "90152330498", "name": "Active Accounts"}
    }
  ],
  "count": 1,
  "workspaceId": "9015487518"
}
```

### 3. Get Spaces in Workspace

**GET** `/api/clickup/spaces/:workspaceId`

List all spaces to find space IDs.

**Example:**
```bash
curl -s "https://routerlogger-production.up.railway.app/api/clickup/spaces/9015487518" | jq
```

**Response:**
```json
{
  "spaces": [
    {"id": "90152330498", "name": "Active Accounts"},
    {"id": "90152380144", "name": "VacatAd Team"},
    {"id": "90152341913", "name": "ATO"}
  ]
}
```

### 4. Assign Router to Property (Any Task)

**POST** `/api/router-properties/assign`

Assign a router to any ClickUp task. No type restrictions.

**Example:**
```bash
curl -X POST "https://routerlogger-production.up.railway.app/api/router-properties/assign" \
  -H "Content-Type: application/json" \
  -d '{
    "routerId": "6001747099",
    "propertyTaskId": "86c6911cf",
    "installedBy": "John Smith",
    "notes": "Installed at property"
  }' | jq
```

**Success Response:**
```json
{
  "success": true,
  "assignment": {
    "id": 4,
    "router_id": "6001747099",
    "property_clickup_task_id": "86c6911cf",
    "property_name": "Router #15",  // Fetched from ClickUp
    "installed_at": "2025-10-30T23:41:30.881Z",
    "installed_by": "John Smith",
    "notes": "Installed at property"
  }
}
```

## Common Workflows

### Workflow 1: Search Active Accounts Space

```bash
# 1. Get spaces
SPACES=$(curl -s "https://routerlogger-production.up.railway.app/api/clickup/spaces/9015487518")
echo $SPACES | jq '.spaces | map({id, name})'

# 2. Get Active Accounts space ID
ACTIVE_ACCOUNTS_ID=$(echo $SPACES | jq -r '.spaces[] | select(.name == "Active Accounts") | .id')
echo "Active Accounts ID: $ACTIVE_ACCOUNTS_ID"

# 3. Search tasks in that space
curl -s "https://routerlogger-production.up.railway.app/api/router-properties/search-properties/$ACTIVE_ACCOUNTS_ID?search=beach" | jq

# 4. Pick a task ID and assign router
PROPERTY_ID="<task-id-from-search>"
curl -X POST "https://routerlogger-production.up.railway.app/api/router-properties/assign" \
  -H "Content-Type: application/json" \
  -d "{\"routerId\":\"6001747099\",\"propertyTaskId\":\"$PROPERTY_ID\",\"installedBy\":\"Me\"}" | jq
```

### Workflow 2: Workspace-Wide Search

```bash
# Search all tasks with keyword
curl -s "https://routerlogger-production.up.railway.app/api/router-properties/search-all/9015487518?search=villa" | jq

# Shows tasks from ALL spaces and lists
# Pick any task and assign
```

## Frontend Integration Example

```javascript
// 1. Get spaces
const spaces = await fetch('/api/clickup/spaces/9015487518').then(r => r.json());

// 2. Find Active Accounts space
const activeAccounts = spaces.spaces.find(s => s.name === 'Active Accounts');

// 3. Search tasks in that space
const searchProperties = async (query) => {
  const response = await fetch(
    `/api/router-properties/search-properties/${activeAccounts.id}?search=${query}`
  );
  return await response.json();
};

// 4. Display in searchable dropdown
const properties = await searchProperties('beach');
// Show: properties.properties.map(p => ({ label: p.name, value: p.id }))

// 5. Assign when user selects
const assignRouter = async (routerId, propertyId) => {
  const response = await fetch('/api/router-properties/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      routerId,
      propertyTaskId: propertyId,
      installedBy: currentUser.name
    })
  });
  return await response.json();
};
```

## Key Features

✅ **No type restrictions** - Link any ClickUp task
✅ **Space-specific search** - Search "Active Accounts" space
✅ **Workspace-wide search** - Find tasks anywhere
✅ **Auto-fetch names** - Uses official task name from ClickUp
✅ **Full validation** - Checks task exists before assignment
✅ **History tracking** - Complete assignment history

## Quick Reference

| Endpoint | Purpose | Parameters |
|----------|---------|------------|
| `GET /api/clickup/spaces/:workspaceId` | List spaces | workspaceId |
| `GET /api/router-properties/search-properties/:spaceId` | Search space | spaceId, ?search |
| `GET /api/router-properties/search-all/:workspaceId` | Search workspace | workspaceId, ?search |
| `POST /api/router-properties/assign` | Assign router | routerId, propertyTaskId |
| `POST /api/router-properties/move` | Move router | routerId, newPropertyTaskId |
| `GET /api/router-properties/:routerId/current` | Get current property | routerId |
| `GET /api/router-properties/:routerId/history` | Get history | routerId |

## IDs You'll Need

- **Workspace ID**: `9015487518` (VacatAd)
- **Active Accounts Space ID**: `90152330498`
- **VacatAd Team Space ID**: `90152380144`
- **ATO Space ID**: `90152341913`
