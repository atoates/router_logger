# Location Tracking Architecture

## Overview

A router can be in ONE of three states at any time:
1. **In Service at a Location** - Linked to a ClickUp location task, NO assignee
2. **Out of Service with a Person** - Assigned to a ClickUp user, NO location link
3. **In Service, Unassigned** - Neither location nor assignee

## Core Principle

**A router is EITHER at a location (place) OR with a person - NEVER BOTH**

This is enforced in the application logic and reflected in ClickUp:
- When a router is **linked to a location task** → the router task assignee is **removed**
- When a router is **unlinked from location** → if out-of-service, assignee is **added back**

## Database Schema

### New Fields in `routers` table (Migration 012)

```sql
clickup_location_task_id VARCHAR(50)    -- ClickUp task ID for physical location
clickup_location_task_name VARCHAR(255) -- Name/description of location (cached)
location_linked_at TIMESTAMP            -- When router was linked to current location
```

### Existing Fields for Person Storage

```sql
current_stored_with_user_id VARCHAR(50)    -- ClickUp user ID of person with router
current_stored_with_username VARCHAR(100)  -- Username of person with router
service_status VARCHAR(20)                 -- 'in-service' or 'out-of-service'
```

## API Endpoints

### Link Router to Location
```
POST /api/routers/:routerId/link-location
Body: {
  "location_task_id": "86c6910abc",      // Required: ClickUp location task ID
  "location_task_name": "Office Building", // Optional: Location name
  "notes": "Installed in server room"     // Optional: Notes
}
```

**Effect:**
- Sets `clickup_location_task_id` and `clickup_location_task_name`
- Clears `current_stored_with_user_id` and `current_stored_with_username`
- **Removes assignee from router's ClickUp task**

### Unlink Router from Location
```
POST /api/routers/:routerId/unlink-location
Body: {
  "reassign_to_user_id": "68476947",        // Optional: User to assign if out-of-service
  "reassign_to_username": "Jordan Jones",  // Optional: Username
  "notes": "Removed for maintenance"       // Optional: Notes
}
```

**Effect:**
- Clears `clickup_location_task_id`, `clickup_location_task_name`, `location_linked_at`
- If router is **out-of-service** AND reassign user provided:
  - Sets `current_stored_with_user_id` and `current_stored_with_username`
  - **Adds assignee back to router's ClickUp task**

### Mark Router Out of Service (Existing)
```
POST /api/routers/:routerId/out-of-service
Body: {
  "stored_with_user_id": "68476947",      // Required: ClickUp user ID
  "stored_with_username": "Jordan Jones", // Required: Username
  "notes": "Router for repairs"           // Optional: Notes
}
```

**Effect:**
- Sets `service_status` to 'out-of-service'
- Sets `current_stored_with_user_id` and `current_stored_with_username`
- **Adds assignee to router's ClickUp task**
- If router was at a location, creates a property removal event

### Return Router to Service (Existing)
```
POST /api/routers/:routerId/return-to-service
Body: {
  "notes": "Repairs completed"  // Optional: Notes
}
```

**Effect:**
- Sets `service_status` to 'in-service'
- Clears `current_stored_with_user_id` and `current_stored_with_username`
- **Removes assignee from router's ClickUp task**

## Workflow Examples

### Example 1: Router at Location
```
1. Router #58 is installed at "Office Building"
   → POST /api/routers/6004928162/link-location
     { location_task_id: "86c6910xyz", location_task_name: "Office Building" }
   
   Result:
   - Router task has NO assignee
   - Router linked to location task
   - Frontend shows: "At Location: Office Building"
```

### Example 2: Router Needs Maintenance
```
1. Router #58 is taken from "Office Building" for repairs
   → POST /api/routers/6004928162/unlink-location
     { reassign_to_user_id: "68476947", reassign_to_username: "Jordan Jones" }
   
   → POST /api/routers/6004928162/out-of-service
     { stored_with_user_id: "68476947", stored_with_username: "Jordan Jones" }
   
   Result:
   - Router task assigned to Jordan
   - Router NOT linked to any location
   - Frontend shows: "Out of Service - Stored with Jordan Jones"
```

### Example 3: Router Returns to Location
```
1. Repairs complete, router returned to "Office Building"
   → POST /api/routers/6004928162/return-to-service
   
   → POST /api/routers/6004928162/link-location
     { location_task_id: "86c6910xyz", location_task_name: "Office Building" }
   
   Result:
   - Router task has NO assignee
   - Router linked to location task again
   - Frontend shows: "At Location: Office Building"
```

## State Transitions

```
┌─────────────────────────────────────────────────────────────┐
│                    ROUTER STATE MACHINE                     │
└─────────────────────────────────────────────────────────────┘

        ┌──────────────────────────┐
        │  In Service, Unassigned  │
        │                          │
        │ No Location              │
        │ No Assignee              │
        └──────────────────────────┘
                 │          │
      link       │          │      out-of-service
      location   │          │      (assign person)
                 ▼          ▼
  ┌────────────────────┐  ┌────────────────────┐
  │  At Location       │  │  With Person       │
  │                    │  │                    │
  │ Location Task ID   │  │ Assignee in Task   │
  │ NO Assignee        │  │ NO Location        │
  └────────────────────┘  └────────────────────┘
         │                         │
         │  unlink               │  return-to-service
         │  location             │  (clear person)
         ▼                         ▼
        ┌──────────────────────────┐
        │  In Service, Unassigned  │
        └──────────────────────────┘
```

## ClickUp Integration

### Router Task (per router)
- Shows operational status, IMEI, firmware, etc.
- **Assignee:** Person who currently has the router (only when out-of-service or not at location)
- **Link to Location:** NOT stored in this task

### Location Task (per physical location)
- Represents a building, office, warehouse, etc.
- NOT automatically linked to routers
- Must be manually linked via API or UI

### Relationship
```
Router Task (86c6910r3 - Router #58)
   ├─ IF at location: routers.clickup_location_task_id = "86c6910xyz"
   │                  task.assignees = []
   │
   └─ IF with person: routers.current_stored_with_user_id = "68476947"
                      task.assignees = [{id: 68476947, username: "Jordan Jones"}]
```

## Migration Path

The new location tracking fields are OPTIONAL and do not break existing functionality:

1. **Before Migration:** Routers use `stored_with` (person) tracking only
2. **After Migration:** Routers can ALSO be linked to location tasks
3. **Backward Compatible:** All existing stored_with functionality continues to work

## Frontend TODO

1. Update `ClickUpTaskWidget` to show:
   - If `clickup_location_task_id` exists → Show location task link
   - Else if `current_stored_with_user_id` exists → Show assignee
   - Else → Show "Unassigned" state

2. Add UI controls:
   - "Link to Location" button → Opens modal to select/search ClickUp location tasks
   - "Unlink from Location" button → Removes location link
   - "Mark Out of Service" button → Assigns to person (existing)
   - "Return to Service" button → Clears person (existing)

## Benefits of This Architecture

1. **Single Source of Truth:** Either location OR person, never confused
2. **Clear ClickUp View:** Assignees only show when router is with someone
3. **Flexible:** Can track both physical locations and temporary storage
4. **Event-Based:** All changes tracked in `router_property_assignments` events
5. **Scalable:** Easy to add more location-based features later

## Next Steps

1. ✅ Database migration created
2. ✅ Backend API endpoints implemented
3. ⏳ Run migration on Railway production
4. ⏳ Update frontend to display location vs assignee
5. ⏳ Add UI for linking/unlinking locations
6. ⏳ Test complete workflow end-to-end
