# Create Test Property in ClickUp

## Quick Steps

1. **Go to ClickUp** → Open your "Routers" list

2. **Click "+ New Task"**

3. **Name it**: `Test Beach House #1`

4. **Click the task type icon** (circle icon, top-left near task name)
   - You'll see a dropdown with all task types
   - Select **"Property"** (the one with the building icon 🏢)

5. **Add details** (optional):
   - Description: "Test property for router assignment"
   - Status: Set to active
   - Add custom field "Address": "123 Ocean Drive, Test City"

6. **Save the task**

7. **Repeat** to create 2-3 test properties:
   - "Test Mountain Cabin"
   - "Test City Apartment"

## Verify It Worked

Run this command to see your property tasks:

```bash
curl -s "https://routerlogger-production.up.railway.app/api/router-properties/search-properties/901517043586" | jq
```

You should see:
```json
{
  "properties": [
    {
      "id": "...",
      "name": "Test Beach House #1",
      "status": "...",
      "url": "https://app.clickup.com/t/..."
    }
  ],
  "count": 1
}
```

## Test Assignment

Once you have a property, assign a router:

```bash
# Get the property ID from search results above
PROPERTY_ID="<paste-id-here>"

# Assign router
curl -X POST "https://routerlogger-production.up.railway.app/api/router-properties/assign" \
  -H "Content-Type: application/json" \
  -d '{
    "routerId": "6001747099",
    "propertyTaskId": "'$PROPERTY_ID'",
    "installedBy": "Test User",
    "notes": "Testing property assignment"
  }' | jq
```

Should return:
```json
{
  "success": true,
  "assignment": {
    "id": 3,
    "router_id": "6001747099",
    "property_clickup_task_id": "...",
    "property_name": "Test Beach House #1",
    "installed_at": "...",
    "installed_by": "Test User",
    "notes": "Testing property assignment"
  }
}
```

## What You'll See

✅ **Property search works** - Only shows tasks with Task Type = "Property"
✅ **Validation works** - Rejects tasks with wrong task type
✅ **Assignment works** - Creates property assignment in database
✅ **History tracking** - Can view assignment history

That's it! You're ready to use the property tracking system. 🎉
