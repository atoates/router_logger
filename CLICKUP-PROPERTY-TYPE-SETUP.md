# Setting Up Property Type Field in ClickUp

## Overview
To use the property search and validation feature, you need to create a "Type" custom field in your ClickUp list. This field will distinguish property tasks from router tasks.

## Step-by-Step Setup

### 1. Create the "Type" Custom Field

1. **Open ClickUp** and navigate to your "Routers" list
2. **Click the "+" next to custom fields** in the list view
3. **Select "Dropdown" as the field type**
4. **Name the field:** `Type`
5. **Add the following options:**
   - `router` (for router tasks)
   - `property` (for property tasks)
6. **Save the field**

### 2. Update Existing Tasks

#### For Router Tasks (99 existing):
1. Select all router tasks (the ones created by `create-all-tasks.js`)
2. Bulk edit the "Type" field to `router`

#### For Property Tasks:
1. Create new tasks for each property (or update existing ones)
2. Set the "Type" field to `property`
3. Name them descriptively (e.g., "Beach House #1", "Sunset Villa #2")

### 3. Create Sample Property Tasks

Here are some example property tasks to create:

**Example 1: Beach House #1**
- Name: `Beach House #1`
- Type: `property` ✅
- Additional fields:
  - Address: "123 Ocean Drive"
  - Status: "Active"
  - Tags: ["beachfront", "luxury"]

**Example 2: Mountain Cabin**
- Name: `Mountain Cabin`
- Type: `property` ✅
- Additional fields:
  - Address: "456 Pine Trail"
  - Status: "Maintenance"

**Example 3: City Apartment**
- Name: `City Apartment`
- Type: `property` ✅
- Additional fields:
  - Address: "789 Main Street, Unit 401"
  - Status: "Active"

## Alternative: Using Labels Instead

If you prefer using labels (tags) instead of dropdown:

1. Create labels:
   - `type:router`
   - `type:property`
2. Update the search logic to look for labels instead of custom fields

However, **dropdown is recommended** because:
- Enforces single value per task
- Easier to filter and search
- Better for reporting

## Verification

After setting up, verify the field exists:

```bash
curl -s "https://routerlogger-production.up.railway.app/api/clickup/custom-fields/901517043586" | jq '.fields | map(select(.name == "Type"))'
```

You should see:
```json
[
  {
    "id": "...",
    "name": "Type",
    "type": "drop_down",
    "type_config": {
      "options": [
        {
          "id": "...",
          "label": "router",
          "color": "..."
        },
        {
          "id": "...",
          "label": "property",
          "color": "..."
        }
      ]
    }
  }
]
```

## Testing Property Search

Once you've created property tasks with Type = "property":

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

Once you have property tasks, you can assign routers:

```bash
# Get a property task ID from search results
PROPERTY_ID="<clickup-task-id>"

# Assign router to property (validates Type = "property")
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
2. ✅ Checks for "Type" custom field
3. ✅ Verifies Type = "property"
4. ✅ Uses official task name from ClickUp
5. ✅ Creates assignment in database

If validation fails:
- ❌ Returns 400 Bad Request
- ❌ Error: "Task X is not a property task. Please select a task with Type = 'property'."

## Benefits of Type Field

1. **Data Integrity** - Prevents assigning routers to wrong task types
2. **Clear Organization** - Easy to filter routers vs properties
3. **Better Reporting** - Can count tasks by type
4. **Scalability** - Can add more types later (e.g., "gateway", "sensor")

## Next Steps

After setting up the Type field:

1. ✅ Create property tasks
2. ✅ Set Type = "property" on each
3. ✅ Test property search API
4. ✅ Assign routers to properties
5. 🔲 Build frontend UI with property search dropdown
6. 🔲 Set up ClickUp relationship fields (optional)

## Troubleshooting

### "No properties found"
- Ensure tasks have Type field set to exactly "property" (lowercase)
- Check that tasks are not archived
- Verify you're searching in the correct list

### "Task is not a property task"
- The task doesn't have a Type field, or
- Type field is not set to "property", or
- Using labels instead of dropdown field

### Custom field not showing
- Refresh ClickUp UI
- Check field is added to the list (not just the workspace)
- Try creating a new task to verify field appears
