# Setting Up Property Task Type in ClickUp

## Overview
ClickUp has a built-in **Task Types** feature that allows you to categorize tasks. To use the property search and validation feature, you need to set certain tasks to use the "Property" task type.

## Step-by-Step Setup

### 1. Verify "Property" Task Type Exists

The "Property" task type should already be available in your workspace. To check:

1. **Open ClickUp** and navigate to your workspace
2. **Click Settings** → **ClickUps** → **Task Types**
3. **Look for "Property"** in the list of task types

If you see "Property" ✅, you're all set! If not, you can create it:
- Click "Create Task Type"
- Name: `Property`
- Icon: 🏠 (building/property icon)
- Save

### 2. Create Property Tasks

#### Method 1: Create New Tasks
1. In your "Routers" list, click **"+ New Task"**
2. Name it descriptively (e.g., "Beach House #1", "Sunset Villa #2")
3. **Click the task type icon** (usually shows circle for "Task")
4. **Select "Property"** from the dropdown
5. Add other details (address, status, etc.)
6. Save

#### Method 2: Convert Existing Tasks
If you already have property tasks created as regular tasks:
1. Open the task
2. Click the task type icon (top left, near task name)
3. Select "Property"
4. Save

### 3. Organize Your Tasks

**Recommended Structure:**
- **Router tasks** → Keep as "Task" (default) or create "Router" task type
- **Property tasks** → Set to "Property" task type
- **Other tasks** → Use appropriate task types

### 4. Example Property Tasks

Create these example properties to test:

**Example 1: Beach House #1**
- Name: `Beach House #1`
- Task Type: **Property** ✅
- Custom fields:
  - Address: "123 Ocean Drive"
  - Status: "Active"
- Tags: ["beachfront", "luxury"]

**Example 2: Mountain Cabin**
- Name: `Mountain Cabin`
- Task Type: **Property** ✅
- Custom fields:
  - Address: "456 Pine Trail"
  - Status: "Maintenance"

**Example 3: City Apartment**
- Name: `City Apartment`
- Task Type: **Property** ✅
- Custom fields:
  - Address: "789 Main Street, Unit 401"
  - Status: "Active"

## Verification

After setting up property tasks, verify they appear correctly:

```bash
curl -s "https://routerlogger-production.up.railway.app/api/router-properties/search-properties/901517043586" | jq
```

You should see your property tasks listed.

## Testing Property Search

Once you've created property tasks with Task Type = "Property":

```bash
# Search all properties
curl -s "https://routerlogger-production.up.railway.app/api/clickup/properties/901517043586" | jq

# Search with filter
curl -s "https://routerlogger-production.up.railway.app/api/clickup/properties/901517043586?search=beach" | jq

# Alternative endpoint
curl -s "https://routerlogger-production.up.railway.app/api/router-properties/search-properties/901517043586" | jq
```

## Using the Property Search

### Assign Router with Validation

Once you have property tasks:

```bash
# Get a property task ID from search results
PROPERTY_ID="<clickup-task-id>"

# Assign router to property (validates Task Type = "Property")
curl -X POST "https://routerlogger-production.up.railway.app/api/router-properties/assign" \
  -H "Content-Type: application/json" \
  -d '{
    "routerId": "6001747099",
    "propertyTaskId": "'$PROPERTY_ID'",
    "installedBy": "Setup Script",
    "notes": "Testing property validation"
  }'
```

### What Happens During Validation

When you assign a router to a property with `validateClickUp: true` (default):

1. ✅ Fetches the task from ClickUp API
2. ✅ Checks task_type field
3. ✅ Verifies Task Type = "Property"
4. ✅ Uses official task name from ClickUp
5. ✅ Creates assignment in database

If validation fails:
- ❌ Returns 400 Bad Request
- ❌ Error: "Task 'XYZ' has Task Type 'Task (default)' but needs to be 'Property'. Please select a task with Task Type = 'Property'."

## Benefits of Task Types

1. **Native ClickUp Feature** - No custom fields needed
2. **Visual Organization** - Different icons for different task types
3. **Better Filtering** - ClickUp UI filters by task type
4. **Data Integrity** - Prevents assigning routers to wrong task types
5. **Scalability** - Can add more task types later (e.g., "Gateway", "Sensor")

## Available Task Types

Based on your screenshot, you have these task types available:
- Task (default)
- Milestone
- Account
- Asset
- Camera Log
- Contact
- Email
- Form Response
- Meeting Note
- Payment
- **Property** ✅ (use this for property tasks)
- Verification

You can also create custom task types for routers if desired (e.g., "Router" task type).

## Next Steps

After setting up property task types:

1. ✅ Create property tasks with Task Type = "Property"
2. ✅ Test property search API
3. ✅ Assign routers to properties
4. 🔲 Build frontend UI with property search dropdown
5. 🔲 Set up ClickUp relationship fields (optional)

## Troubleshooting

### "No properties found"
- Ensure tasks have Task Type set to "Property" (not "Task" default)
- Check that tasks are not archived
- Verify you're searching in the correct list
- Task type name is case-insensitive but must be exactly "Property"

### "Task has Task Type 'X' but needs to be 'Property'"
- The task is using a different task type
- Click the task type icon in the task and select "Property"
- Make sure you're selecting a task that represents a physical property

### Task type not available
- Check workspace settings → ClickUps → Task Types
- "Property" should be in the default task types
- If missing, create a custom task type named "Property"
