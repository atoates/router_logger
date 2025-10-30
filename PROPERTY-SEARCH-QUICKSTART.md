# Property Search & Assignment - Quick Reference

## What's New
Routers can now be assigned to **properties** by searching ClickUp tasks that have `Type = "property"`. This prevents accidentally assigning routers to wrong task types.

## Setup Required (One-Time)

### 1. Add "Type" Field in ClickUp
```
List Settings → Custom Fields → Add Dropdown Field
Name: Type
Options: router, property
```

### 2. Create Property Tasks
Create tasks for your properties:
- Name: "Beach House #1"
- Type: **property** ✅
- Add other fields (Address, Beds, etc.)

See: `CLICKUP-PROPERTY-TYPE-SETUP.md` for detailed setup

## API Usage

### Search Properties
```bash
GET /api/router-properties/search-properties/{listId}?search=beach

Response:
{
  "properties": [
    { "id": "abc123", "name": "Beach House #1", ... }
  ],
  "count": 1
}
```

### Assign Router (with validation)
```bash
POST /api/router-properties/assign
{
  "routerId": "6001747099",
  "propertyTaskId": "abc123",  # ClickUp task ID with Type=property
  "installedBy": "John"
}
```

The system will:
1. ✅ Validate task exists in ClickUp
2. ✅ Verify Type = "property"
3. ✅ Fetch official property name
4. ✅ Create assignment

### Errors
- **400 Bad Request**: "Task X is not a property task"
  → Selected task doesn't have Type = "property"
  
- **409 Conflict**: "Router already assigned to Y"
  → Use `/move` endpoint instead

## Frontend Integration

```javascript
// 1. Search properties
const properties = await fetch(
  `/api/router-properties/search-properties/${listId}?search=beach`
).then(r => r.json());

// 2. Show searchable dropdown
<PropertySearch 
  properties={properties.properties}
  onSelect={(property) => assignRouter(routerId, property.id)}
/>

// 3. Assign when user selects
await fetch('/api/router-properties/assign', {
  method: 'POST',
  body: JSON.stringify({
    routerId: selectedRouter,
    propertyTaskId: selectedProperty.id
    // propertyName auto-fetched from ClickUp
  })
});
```

## Key Endpoints

| Endpoint | Purpose | Validation |
|----------|---------|------------|
| `GET /api/router-properties/search-properties/:listId` | Search property tasks | Filters Type=property |
| `POST /api/router-properties/assign` | Assign router | Validates task Type |
| `POST /api/router-properties/move` | Move between properties | Validates new property |
| `POST /api/router-properties/bulk-assign` | Assign many routers | Validates once |

## Full Documentation
- **Complete guide**: `PROPERTY-SEARCH-GUIDE.md`
- **Setup instructions**: `CLICKUP-PROPERTY-TYPE-SETUP.md`
- **Property tracking**: `PROPERTY-TRACKING-QUICKSTART.md`

## Current Status

**✅ Backend Complete**
- Property search with Type filtering
- ClickUp validation
- Error handling
- Bulk operations

**🔲 Setup Needed**
1. Create "Type" custom field in ClickUp
2. Create property tasks with Type = "property"
3. Build frontend property search UI

**🔲 Optional Enhancements**
- ClickUp relationship fields sync
- Property dashboard
- Router relocation tracking
