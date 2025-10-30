# Router-Property Tracking - Quick Start

## ✅ What's Been Implemented

### Database
- ✅ `router_property_assignments` table (historical tracking)
- ✅ Property columns added to `routers` table (current assignment)
- ✅ Indexes for performance
- ✅ Constraints to ensure data integrity

### API Endpoints
- ✅ `/api/router-properties/:routerId/current` - Get current assignment
- ✅ `/api/router-properties/:routerId/history` - Get full history
- ✅ `/api/router-properties/assign` - Assign router to property
- ✅ `/api/router-properties/remove` - Remove from property
- ✅ `/api/router-properties/move` - Move to new property
- ✅ `/api/router-properties/property/:propertyTaskId/routers` - Get all routers at property
- ✅ `/api/router-properties/bulk-assign` - Assign multiple routers
- ✅ `/api/router-properties/stats` - Get statistics

### Backend Services
- ✅ Property service with full business logic
- ✅ Transaction support for data integrity
- ✅ Automatic denormalization for performance

---

## 🚀 Usage Examples

### Assign Router to Property

```bash
curl -X POST https://routerlogger-production.up.railway.app/api/router-properties/assign \
  -H "Content-Type: application/json" \
  -d '{
    "routerId": "6001747099",
    "propertyTaskId": "abc123xyz",
    "propertyName": "Beach House #42",
    "installedAt": "2025-10-30T10:00:00Z",
    "installedBy": "John Doe",
    "notes": "Installed on roof"
  }'
```

### Get Current Property

```bash
curl https://routerlogger-production.up.railway.app/api/router-properties/6001747099/current
```

### View History

```bash
curl https://routerlogger-production.up.railway.app/api/router-properties/6001747099/history
```

### Move Router

```bash
curl -X POST https://routerlogger-production.up.railway.app/api/router-properties/move \
  -H "Content-Type: application/json" \
  -d '{
    "routerId": "6001747099",
    "newPropertyTaskId": "xyz789",
    "newPropertyName": "Mountain Cabin #12",
    "movedBy": "Tech Team"
  }'
```

---

## 📊 Database Schema

### `router_property_assignments` Table

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| router_id | VARCHAR(50) | Router identifier |
| property_clickup_task_id | VARCHAR(50) | ClickUp property task ID |
| property_name | VARCHAR(255) | Property name (cached) |
| installed_at | TIMESTAMP | When installed |
| removed_at | TIMESTAMP | When removed (NULL = current) |
| notes | TEXT | Installation notes |
| installed_by | VARCHAR(100) | Who installed |
| removed_by | VARCHAR(100) | Who removed |

### Added to `routers` Table

| Column | Type | Description |
|--------|------|-------------|
| current_property_task_id | VARCHAR(50) | Current property (denormalized) |
| current_property_name | VARCHAR(255) | Current property name |
| property_installed_at | TIMESTAMP | When installed at current |

---

## 🔐 Data Integrity Rules

1. ✅ Router can only be at ONE property at a time
2. ✅ Must remove from old property before assigning to new
3. ✅ Historical records never deleted (removed_at marks end)
4. ✅ Unique constraint prevents double assignments
5. ✅ Dates validated (removed_at must be after installed_at)

---

## 🎯 Next Steps

### ClickUp Integration (To Do)

Add custom fields to ClickUp:

**Router Tasks:**
- Current Property (Relationship field → Property tasks)
- Property Installed Date (Date field)
- Properties Count (Number field)

**Property Tasks:**
- Installed Routers (Relationship field → Router tasks, multiple)

Then update `propertyService.js` to sync to ClickUp when:
- Router assigned → Update relationship fields
- Router removed → Clear relationship fields
- Router moved → Update both old and new properties

### Frontend Components (To Do)

Create UI for:
1. Property assignment modal
2. History viewer
3. Property dashboard showing all routers
4. Bulk assignment wizard

---

## 🧪 Testing

Run the test script:

```bash
cd backend
node test-property-tracking.js
```

This demonstrates all API endpoints.

---

## 📈 Statistics Available

```javascript
GET /api/router-properties/stats

Response:
{
  "total_routers_assigned": 25,      // Ever assigned
  "currently_assigned": 18,          // Active now
  "total_properties": 12,            // Ever used
  "active_properties": 8,            // With routers now
  "avg_deployment_days": 45          // Average stay duration
}
```

---

## 🔄 Workflow Example

### Setting Up a New Property

```javascript
// 1. Create property task in ClickUp (manually or via API)
// 2. Assign routers to it

POST /api/router-properties/bulk-assign
{
  "propertyTaskId": "new123",
  "propertyName": "New Beach House",
  "routerIds": ["6001747099", "6001748313", "6001783121"],
  "installedAt": "2025-10-30T10:00:00Z",
  "installedBy": "Setup Team"
}
```

### Moving a Router

```javascript
// Single API call handles remove + assign
POST /api/router-properties/move
{
  "routerId": "6001747099",
  "newPropertyTaskId": "property456",
  "newPropertyName": "Different Location",
  "movedBy": "Tech Team"
}
```

### Decommissioning a Property

```javascript
// 1. Get all routers
GET /api/router-properties/property/old123/routers

// 2. Remove each one
routers.forEach(router => {
  POST /api/router-properties/remove
  {
    "routerId": router.routerId,
    "removedBy": "Admin",
    "notes": "Property decommissioned"
  }
})
```

---

## 🎨 Frontend Integration

### Router Dashboard Component

```jsx
// Show current property
const { data: current } = useQuery(
  ['currentProperty', routerId],
  () => api.get(`/router-properties/${routerId}/current`)
);

if (current?.assigned) {
  return (
    <div>
      <h3>Current Property</h3>
      <p>{current.property_name}</p>
      <p>Installed {current.daysSinceInstalled} days ago</p>
      <button onClick={() => handleChangeProperty()}>Move</button>
    </div>
  );
}
```

### Property History

```jsx
const { data: history } = useQuery(
  ['propertyHistory', routerId],
  () => api.get(`/router-properties/${routerId}/history`)
);

return (
  <Timeline>
    {history?.history.map(assignment => (
      <TimelineItem key={assignment.id}>
        <h4>{assignment.propertyName}</h4>
        <p>{assignment.durationDays} days</p>
        <span>{assignment.current ? '🟢 Current' : '⚪ Past'}</span>
      </TimelineItem>
    ))}
  </Timeline>
);
```

---

## 🚀 Deployed & Ready!

The system is now live on Railway. The migration will run automatically when the backend starts.

**Test it:**
```bash
curl https://routerlogger-production.up.railway.app/api/router-properties/stats
```

You should see statistics (all zeros initially, until you start assigning routers to properties).

---

## 📝 Notes

- Historical data is preserved forever (never deleted)
- `removed_at = NULL` means currently installed
- All operations use database transactions for safety
- Denormalized fields in `routers` table for quick queries
- Full history available for reporting and auditing
