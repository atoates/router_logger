# Router-Property Tracking Design

## Overview
Track which property each router is installed at, with full historical records.

---

## Database Schema

### New Table: `router_property_assignments`

```sql
CREATE TABLE router_property_assignments (
  id SERIAL PRIMARY KEY,
  router_id VARCHAR(50) NOT NULL,
  property_clickup_task_id VARCHAR(50) NOT NULL,
  property_name VARCHAR(255),
  installed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TIMESTAMP,
  notes TEXT,
  installed_by VARCHAR(100),
  removed_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  CONSTRAINT fk_router FOREIGN KEY (router_id) REFERENCES routers(router_id),
  INDEX idx_router_id (router_id),
  INDEX idx_property_task (property_clickup_task_id),
  INDEX idx_current_assignment (router_id, removed_at) -- for finding current assignment
);

-- Comments
COMMENT ON TABLE router_property_assignments IS 'Historical tracking of router installations at properties';
COMMENT ON COLUMN router_property_assignments.removed_at IS 'NULL means currently installed, timestamp means moved/removed';
```

### Update `routers` Table

```sql
ALTER TABLE routers 
  ADD COLUMN current_property_task_id VARCHAR(50),
  ADD COLUMN current_property_name VARCHAR(255),
  ADD COLUMN property_installed_at TIMESTAMP;

CREATE INDEX idx_routers_current_property ON routers(current_property_task_id);

COMMENT ON COLUMN routers.current_property_task_id IS 'ClickUp task ID of current property (denormalized for quick access)';
```

---

## ClickUp Custom Fields

### Router Tasks - Add Fields:

1. **Current Property** (Relationship field)
   - Links to Property tasks
   - Shows current installation location
   
2. **Property Installed Date** (Date field)
   - When router was installed at current property
   
3. **Properties Count** (Number field)
   - Total number of properties router has been in (historical)

### Property Tasks - Add Fields:

1. **Installed Routers** (Relationship field - multiple)
   - Links to Router tasks currently at this property
   - Can see all active routers in one view

---

## API Endpoints

### New Routes: `/api/router-properties`

```javascript
// Get current property for a router
GET /api/router-properties/:routerId/current

// Get property history for a router
GET /api/router-properties/:routerId/history

// Assign router to property
POST /api/router-properties/assign
Body: {
  routerId: "6001747099",
  propertyTaskId: "abc123xyz",
  propertyName: "Property Name",
  installedAt: "2025-10-30T10:00:00Z",
  installedBy: "John Doe",
  notes: "Installed on roof"
}

// Remove router from property (move/uninstall)
POST /api/router-properties/remove
Body: {
  routerId: "6001747099",
  removedAt: "2025-11-15T10:00:00Z",
  removedBy: "Jane Smith",
  notes: "Moved to new property"
}

// Get all routers at a property
GET /api/router-properties/property/:propertyTaskId/routers
```

---

## Workflow

### 1. Installing Router at Property

```javascript
// Frontend or script calls:
POST /api/router-properties/assign
{
  routerId: "6001747099",
  propertyTaskId: "abc123xyz",
  propertyName: "Beach House #42",
  installedAt: "2025-10-30T10:00:00Z",
  installedBy: "Tech Team"
}

// Backend:
1. Insert record in router_property_assignments (removed_at = NULL)
2. Update routers.current_property_task_id
3. Sync to ClickUp:
   - Update Router task "Current Property" relationship field
   - Update Router task "Property Installed Date"
   - Update Property task "Installed Routers" to include this router
   - Increment Router task "Properties Count"
```

### 2. Moving Router to New Property

```javascript
// Two-step process:
// Step 1: Remove from old property
POST /api/router-properties/remove
{
  routerId: "6001747099",
  removedAt: "2025-11-15T10:00:00Z",
  notes: "Moving to different property"
}

// Step 2: Assign to new property
POST /api/router-properties/assign
{
  routerId: "6001747099",
  propertyTaskId: "xyz789abc",
  propertyName: "Mountain Cabin #12",
  installedAt: "2025-11-15T14:00:00Z"
}

// Backend:
1. Set removed_at on old assignment record
2. Create new assignment record
3. Update routers table
4. Sync to ClickUp (remove old relationship, add new one)
```

### 3. Viewing History

```javascript
GET /api/router-properties/6001747099/history

Response:
{
  routerId: "6001747099",
  currentProperty: {
    propertyTaskId: "xyz789abc",
    propertyName: "Mountain Cabin #12",
    installedAt: "2025-11-15T14:00:00Z",
    daysSinceInstalled: 5
  },
  history: [
    {
      propertyTaskId: "xyz789abc",
      propertyName: "Mountain Cabin #12",
      installedAt: "2025-11-15T14:00:00Z",
      removedAt: null,
      durationDays: 5,
      current: true
    },
    {
      propertyTaskId: "abc123xyz",
      propertyName: "Beach House #42",
      installedAt: "2025-10-30T10:00:00Z",
      removedAt: "2025-11-15T10:00:00Z",
      durationDays: 16,
      current: false
    }
  ],
  totalProperties: 2,
  totalDaysDeployed: 21
}
```

---

## Frontend Components

### Router Dashboard - Add Section:

```jsx
<PropertyAssignment routerId={routerId}>
  Current Property: Beach House #42 (16 days)
  [View in ClickUp] [Change Property] [View History]
  
  History: 2 properties
  - Beach House #42: Oct 30 - Nov 15 (16 days)
  - Mountain Cabin #12: Sep 1 - Oct 29 (58 days)
</PropertyAssignment>
```

### Property Dashboard - Add Section:

```jsx
<InstalledRouters propertyTaskId={propertyTaskId}>
  Active Routers (3):
  - Router #1 (6001747099) - Installed Oct 30
  - Router #5 (6001784791) - Installed Nov 1
  - Router #8 (6000712469) - Installed Nov 10
</InstalledRouters>
```

---

## Migration Steps

### Step 1: Database Migration

```bash
# Create migration file
touch backend/src/database/migrations/008_add_property_tracking.sql
```

### Step 2: API Implementation

```bash
# Create new route file
touch backend/src/routes/router-properties.js

# Create service file
touch backend/src/services/propertyService.js
```

### Step 3: ClickUp Setup

1. In ClickUp, add custom field to Router tasks:
   - "Current Property" (Relationship → Property tasks)
   - "Property Installed Date" (Date)
   - "Properties Count" (Number)

2. In ClickUp, add custom field to Property tasks:
   - "Installed Routers" (Relationship → Router tasks, multiple)

### Step 4: Sync Script

```bash
# Script to sync current data
touch backend/sync-router-properties.js
```

---

## Advanced Features (Future)

### Auto-Detection
- Monitor router location (if GPS available)
- Detect when router moves between properties
- Auto-suggest property changes

### Alerts
- Router at property > X days (maintenance due)
- Router offline at property (notification)
- Multiple routers at same property (inventory check)

### Reporting
- Average deployment duration
- Most common property types
- Router utilization rate

### Bulk Operations
- Move multiple routers to new property
- Decommission all routers at a property
- Clone property setup to new location

---

## Example Use Cases

### Use Case 1: Property Manager View
"Show me all routers currently at Beach House #42"
```
GET /api/router-properties/property/abc123xyz/routers
→ Lists all active routers with installation dates
```

### Use Case 2: Router Technician
"Where has Router #1 been deployed?"
```
GET /api/router-properties/6001747099/history
→ Shows complete deployment history
```

### Use Case 3: Inventory Management
"Which routers have been deployed to the most properties?"
```
GET /api/router-properties/stats/most-deployed
→ Ranks routers by number of property assignments
```

### Use Case 4: Property Setup
"I'm setting up a new property with 3 routers"
```
POST /api/router-properties/bulk-assign
{
  propertyTaskId: "new123",
  propertyName: "New Beach House",
  routers: ["6001747099", "6001748313", "6001783121"],
  installedAt: "2025-10-30T10:00:00Z"
}
```

---

## Data Integrity

### Rules:
1. A router can only be assigned to ONE property at a time
2. Cannot assign router to new property without removing from old one
3. Cannot delete property if it has active router assignments
4. Historical records are immutable (never delete, only mark removed)

### Constraints:
```sql
-- Ensure only one active assignment per router
CREATE UNIQUE INDEX idx_unique_active_assignment 
ON router_property_assignments(router_id) 
WHERE removed_at IS NULL;

-- Ensure valid dates
ALTER TABLE router_property_assignments 
ADD CONSTRAINT check_dates 
CHECK (removed_at IS NULL OR removed_at >= installed_at);
```

---

## Next Steps

Would you like me to:
1. ✅ Create the database migration
2. ✅ Implement the API endpoints
3. ✅ Add ClickUp custom fields
4. ✅ Build the sync script
5. ✅ Create frontend components

Let me know which parts you'd like to implement first!
