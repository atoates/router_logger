# Property Search and Assignment Guide

## Overview
Routers can now be assigned to properties by searching ClickUp tasks that have **Task Type = "Property"**. This uses ClickUp's native Task Types feature to ensure only valid property tasks are used for router assignments.

## Prerequisites
1. ClickUp OAuth must be authorized
2. Your ClickUp workspace has the "Property" task type available (built-in)
3. Property tasks must have their Task Type set to "Property"

## API Endpoints

### 1. Search for Property Tasks

**GET** `/api/clickup/properties/:listId?search=beach`

Returns all tasks where Task Type = "Property" from the specified list.

**Parameters:**
- `listId` (required) - The ClickUp list ID to search in
- `search` (optional) - Filter property names by search term

**Response:**
```json
{
  "properties": [
    {
      "id": "abc123",
      "name": "Beach House #1",
      "status": "active",
      "url": "https://app.clickup.com/t/abc123",
      "description": "Luxury beach property",
      "tags": ["beachfront", "luxury"],
      "custom_fields": {
        "Address": "123 Ocean Drive",
        "Beds": 4
      }
    }
  ],
  "count": 1
}
```

### 2. Search via Router Properties Route

**GET** `/api/router-properties/search-properties/:listId?search=villa`

Alternative endpoint specifically for router-property assignment workflow.

**Response:**
```json
{
  "properties": [
    {
      "id": "xyz789",
      "name": "Sunset Villa #2",
      "status": "active",
      "url": "https://app.clickup.com/t/xyz789",
      "customFields": {
        "Type": "property",
        "Address": "456 Sunset Blvd"
      }
    }
  ],
  "count": 1,
  "listId": "12345678"
}
```

### 3. Assign Router to Property (with validation)

**POST** `/api/router-properties/assign`

Assigns a router to a property. By default, validates that the task exists in ClickUp and has Task Type = "Property".

**Request Body:**
```json
{
  "routerId": "6001747099",
  "propertyTaskId": "abc123",
  "propertyName": "Beach House #1",  // Optional - will be fetched from ClickUp
  "installedAt": "2025-10-30T12:00:00Z",  // Optional - defaults to now
  "installedBy": "John Smith",  // Optional
  "notes": "Installation notes",  // Optional
  "validateClickUp": true  // Optional - defaults to true
}
```

**Success Response:**
```json
{
  "success": true,
  "assignment": {
    "id": 1,
    "router_id": "6001747099",
    "property_clickup_task_id": "abc123",
    "property_name": "Beach House #1",  // Uses official name from ClickUp
    "installed_at": "2025-10-30T12:00:00.000Z",
    "installed_by": "John Smith",
    "notes": "Installation notes"
  }
}
```

**Error Responses:**

*Already assigned:*
```json
{
  "error": "Router 6001747099 is already assigned to property \"Sunset Villa\" (xyz789). Remove from current property first."
}
```
Status: 409 Conflict

*Wrong task type:*
```json
{
  "error": "Task \"Router #15\" has Task Type \"Task (default)\" but needs to be \"Property\". Please select a task with Task Type = \"Property\"."
}
```
Status: 400 Bad Request

*Not authorized:*
```json
{
  "error": "No ClickUp token found. Please authorize the application."
}
```
Status: 401 Unauthorized

### 4. Move Router Between Properties

**POST** `/api/router-properties/move`

Moves a router from its current property to a new one. Validates the new property by default.

**Request Body:**
```json
{
  "routerId": "6001747099",
  "newPropertyTaskId": "xyz789",
  "newPropertyName": "Sunset Villa #2",  // Optional
  "movedAt": "2025-11-01T10:00:00Z",  // Optional
  "movedBy": "Jane Doe",  // Optional
  "notes": "Relocated due to maintenance",  // Optional
  "validateClickUp": true  // Optional
}
```

### 5. Bulk Assign Routers to Property

**POST** `/api/router-properties/bulk-assign`

Assign multiple routers to the same property. Validates property once before processing all routers.

**Request Body:**
```json
{
  "propertyTaskId": "abc123",
  "propertyName": "Beach House #1",  // Optional
  "routerIds": ["6001747099", "6001747100", "6001747101"],
  "installedAt": "2025-10-30T12:00:00Z",  // Optional
  "installedBy": "Installation Team",  // Optional
  "notes": "Bulk installation",  // Optional
  "validateClickUp": true  // Optional - validates once for all
}
```

**Response:**
```json
{
  "success": true,
  "assigned": 3,
  "failed": 0,
  "results": [
    { "routerId": "6001747099", "success": true, "assignment": {...} },
    { "routerId": "6001747100", "success": true, "assignment": {...} },
    { "routerId": "6001747101", "success": true, "assignment": {...} }
  ],
  "errors": []
}
```

## Validation Behavior

### Automatic Validation (Default)
When `validateClickUp: true` (default), the system:
1. Fetches the task from ClickUp API
2. Checks the task's `task_type` field (native ClickUp Task Types)
3. Verifies the Task Type name equals "Property" (case-insensitive)
4. Uses the official task name from ClickUp (ignoring provided `propertyName`)

### Skip Validation
Set `validateClickUp: false` to skip ClickUp validation:
- Faster for bulk operations
- Useful when you've already validated the property
- Still enforces database constraints (single property per router)

## Setting Up Property Tasks in ClickUp

### 1. Use "Property" Task Type
ClickUp has a built-in "Property" task type:
1. Create a new task (or open existing task)
2. Click the task type icon (usually shows a circle for "Task")
3. Select "Property" from the dropdown
4. Save the task

### 2. Create Property Tasks
1. Create a new task for each property
2. Set Task Type to "Property"
3. Name it descriptively (e.g., "Beach House #1", "Sunset Villa")
4. Add other relevant custom fields (Address, Beds, etc.)

### 3. Recommended Additional Custom Fields
- **Address** (Text) - Property address
- **Property Manager** (People) - Who manages this property
- **Beds** (Number) - Number of bedrooms
- **Status** (Dropdown) - Active, Maintenance, Vacant
- **Installed Routers** (Relationship) - Links to router tasks (manual setup)

## Example Workflow

### Frontend Implementation

```javascript
// 1. Get workspace and list info
const authStatus = await fetch('/api/clickup/auth/status');
const { workspace } = await authStatus.json();

const listsResponse = await fetch(`/api/clickup/lists/${workspace.workspace_id}`);
const { list } = await listsResponse.json();

// 2. Search for properties
const searchProperties = async (query) => {
  const response = await fetch(
    `/api/router-properties/search-properties/${list.id}?search=${encodeURIComponent(query)}`
  );
  const { properties } = await response.json();
  return properties;
};

// 3. Display properties in searchable dropdown
const properties = await searchProperties('beach');
// Show dropdown with: properties.map(p => ({ label: p.name, value: p.id }))

// 4. Assign router when user selects property
const assignRouter = async (routerId, propertyId) => {
  const response = await fetch('/api/router-properties/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      routerId,
      propertyTaskId: propertyId,
      // propertyName not needed - fetched from ClickUp
      installedBy: currentUser.name,
      notes: 'Assigned via dashboard'
    })
  });
  
  if (!response.ok) {
    const { error } = await response.json();
    throw new Error(error);
  }
  
  return await response.json();
};
```

### React Component Example

```jsx
import React, { useState, useEffect } from 'react';

function PropertySearch({ listId, onSelect }) {
  const [query, setQuery] = useState('');
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const searchProperties = async () => {
      if (query.length < 2) return;
      
      setLoading(true);
      try {
        const response = await fetch(
          `/api/router-properties/search-properties/${listId}?search=${query}`
        );
        const { properties } = await response.json();
        setProperties(properties);
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(searchProperties, 300);
    return () => clearTimeout(debounce);
  }, [query, listId]);

  return (
    <div className="property-search">
      <input
        type="text"
        placeholder="Search properties..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      
      {loading && <div>Searching...</div>}
      
      <ul className="property-list">
        {properties.map(property => (
          <li key={property.id} onClick={() => onSelect(property)}>
            <strong>{property.name}</strong>
            {property.customFields?.Address && (
              <small>{property.customFields.Address}</small>
            )}
            <span className="status">{property.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "No ClickUp token found" | Not authenticated | Click "Connect ClickUp" button |
| "Task X has Task Type Y but needs to be Property" | Selected task has wrong task type | Change task's Task Type to "Property" |
| "Router already assigned to Y" | Router is at another property | Remove from current property first, or use `/move` endpoint |
| "List not found" | Invalid list ID | Verify you're using the correct list ID |

### Validation Best Practices

1. **Always validate in production** - Keep `validateClickUp: true` to prevent data errors
2. **Cache property list** - Search results can be cached for 5-10 minutes
3. **Handle auth expiration** - Check for 401 errors and prompt re-authorization
4. **Show helpful errors** - Display validation errors to users clearly

## Performance Considerations

### Search Performance
- Property search loads all tasks from the list and filters client-side
- For large lists (>1000 tasks), consider caching the property list
- Use the `search` parameter to filter results on backend

### Validation Performance
- Each assignment validates against ClickUp API (adds ~200-500ms)
- For bulk operations, validate once and set `validateClickUp: false` for individual assigns
- Consider async queue for bulk assignments to avoid API rate limits

## Next Steps

1. **Set up relationship fields** - Create "Current Property" field on router tasks and "Installed Routers" on property tasks
2. **Implement ClickUp sync** - Auto-update relationship fields when routers are assigned/removed
3. **Build frontend UI** - Create property search/select components
4. **Add caching** - Cache property lists to reduce API calls
