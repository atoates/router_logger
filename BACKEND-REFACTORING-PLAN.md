# Backend Architecture Refactoring Plan

## Current State Analysis

### Problems with Current Architecture

#### 1. **Fat Routes (router.js - 1,197 lines, 33 endpoints)**

**Example of the problem:**
```javascript
// Lines 37-111 in router.js
router.post('/admin/sync-dates', requireAdmin, async (req, res) => {
  const DATE_INSTALLED_FIELD_ID = '9f31c21a-630d-49f2-8a79-354de03e24d1'; // ❌ Hardcoded UUID
  
  try {
    // ❌ Raw SQL in route handler
    const result = await pool.query(
      `SELECT router_id, clickup_location_task_id 
       FROM routers 
       WHERE clickup_location_task_id IS NOT NULL`
    );
    
    // ❌ Business logic in route
    for (const router of result.rows) {
      const rawDate = await clickupClient.getListCustomFieldValue(...);
      const dateInstalled = rawDate ? Number(rawDate) : null;
      await pool.query(`UPDATE routers SET date_installed = $1...`);
      await new Promise(resolve => setTimeout(resolve, 200)); // Rate limiting
      // ...error handling, cache invalidation, etc.
    }
    
    // ❌ Cache invalidation mixed with business logic
    routersWithLocationsCache.data = null;
    
    res.json({ success: true, ... });
  } catch (error) {
    res.status(500).json({ error: 'Failed to sync dates' });
  }
});
```

**Issues:**
- ❌ Endpoint definition, SQL queries, business logic, caching, and error handling all in one place
- ❌ Hardcoded UUIDs and magic numbers
- ❌ Impossible to test business logic without HTTP mocking
- ❌ Can't reuse sync logic elsewhere
- ❌ No separation of concerns
- ❌ Difficult to debug and maintain

#### 2. **Model Layer Limitations**

Current `models/router.js`:
- ✅ Good: Has SQL queries
- ❌ Bad: Mixed with business logic functions (`mergeDuplicateRouters`, `getStorageStats`)
- ❌ Bad: No clear separation between data access and aggregation logic

#### 3. **Service Layer Issues**

Current services:
- ✅ Good: `propertyService.js`, `clickupSync.js` exist
- ❌ Bad: Inconsistent - some logic in routes, some in services
- ❌ Bad: Services still do direct database access AND API calls

---

## Target Architecture (Industry Standard)

### Layered Architecture Pattern

```
┌─────────────────────────────────────────────────────────────┐
│  Routes (routes/router.js)                                  │
│  ├─ Define endpoints only                                   │
│  ├─ Parse request parameters                                │
│  ├─ Call controller methods                                 │
│  └─ No business logic, no SQL                               │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  Controllers (controllers/adminController.js)               │
│  ├─ Parse and validate request data                         │
│  ├─ Call service layer methods                              │
│  ├─ Format responses (200, 400, 500)                        │
│  ├─ Handle HTTP-specific concerns (ETags, caching headers)  │
│  └─ No business logic, no SQL                               │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  Services (services/routerSyncService.js)                   │
│  ├─ Business logic (loops, retries, validation)             │
│  ├─ Orchestrate multiple model calls                        │
│  ├─ Call external APIs (ClickUp, etc)                       │
│  ├─ Transaction management                                  │
│  ├─ Cache invalidation logic                                │
│  └─ No HTTP concerns, no SQL queries directly               │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  Models (models/router.js)                                  │
│  ├─ Raw SQL queries ONLY                                    │
│  ├─ CRUD operations                                         │
│  ├─ Single-purpose query functions                          │
│  └─ No business logic, no external API calls                │
└─────────────────────────────────────────────────────────────┘
```

---

## Refactoring Example: `/admin/sync-dates`

### BEFORE (Current - All in Route)

```javascript
// routes/router.js (Lines 37-111)
router.post('/admin/sync-dates', requireAdmin, async (req, res) => {
  const DATE_INSTALLED_FIELD_ID = '9f31c21a-630d-49f2-8a79-354de03e24d1';
  try {
    const result = await pool.query(`SELECT router_id, clickup_location_task_id...`);
    // ... 70 lines of business logic, error handling, caching
    res.json({ success: true, ... });
  } catch (error) {
    res.status(500).json({ error: 'Failed to sync dates' });
  }
});
```

### AFTER (Refactored - Proper Layers)

#### 1. Route (routes/router.js)
```javascript
const adminController = require('../controllers/adminController');

router.post('/admin/sync-dates', requireAdmin, adminController.syncDates);
```
**Responsibility:** Define endpoint only (1 line!)

#### 2. Controller (controllers/adminController.js)
```javascript
async function syncDates(req, res) {
  try {
    const result = await routerSyncService.syncDateInstalledFromClickUp();
    res.json({
      success: true,
      summary: result.summary,
      cacheCleared: result.cacheCleared,
      results: result.details
    });
  } catch (error) {
    logger.error('Date sync failed:', error);
    res.status(500).json({ 
      error: 'Failed to sync dates', 
      message: error.message 
    });
  }
}
```
**Responsibility:** Parse request, call service, format response

#### 3. Service (services/routerSyncService.js)
```javascript
const routerModel = require('../models/router');
const clickupClient = require('./clickupClient');
const cacheManager = require('./cacheManager');
const { CLICKUP_FIELD_IDS } = require('../config/constants');

async function syncDateInstalledFromClickUp() {
  const routers = await routerModel.getRoutersWithLocations();
  
  let updated = 0, failed = 0;
  const results = [];
  
  for (const router of routers) {
    try {
      const dateInstalled = await fetchDateInstalled(router);
      await routerModel.updateDateInstalled(router.router_id, dateInstalled);
      
      results.push({ router_id: router.router_id, status: 'success', dateInstalled });
      updated++;
      
      await rateLimitDelay(200); // Avoid API rate limits
    } catch (error) {
      logger.error(`Failed to sync date for ${router.router_id}:`, error.message);
      results.push({ router_id: router.router_id, status: 'failed', error: error.message });
      failed++;
    }
  }
  
  await cacheManager.invalidateRouterCaches();
  
  return {
    summary: { updated, failed, total: routers.length },
    cacheCleared: true,
    details: results
  };
}
```
**Responsibility:** Business logic, orchestration, error handling

#### 4. Model (models/router.js)
```javascript
async function getRoutersWithLocations() {
  const result = await pool.query(
    `SELECT router_id, clickup_location_task_id 
     FROM routers 
     WHERE clickup_location_task_id IS NOT NULL`
  );
  return result.rows;
}

async function updateDateInstalled(routerId, dateInstalled) {
  const result = await pool.query(
    `UPDATE routers 
     SET date_installed = $1 
     WHERE router_id = $2
     RETURNING *`,
    [dateInstalled, routerId]
  );
  return result.rows[0];
}
```
**Responsibility:** SQL queries only

#### 5. Config (config/constants.js)
```javascript
module.exports.CLICKUP_FIELD_IDS = {
  DATE_INSTALLED: '9f31c21a-630d-49f2-8a79-354de03e24d1',
  OPERATIONAL_STATUS: '8a661229-13f0-4693-a7cb-1df86725cfed',
  // ... all other field IDs
};
```
**Responsibility:** Centralized configuration

---

## Benefits of Refactored Architecture

### 1. **Testability**
```javascript
// BEFORE: Can't test business logic without mocking HTTP
test('sync dates', async () => {
  const req = mockRequest();
  const res = mockResponse();
  await routerHandler(req, res); // ❌ Tests HTTP, DB, API all together
});

// AFTER: Test business logic independently
test('sync dates', async () => {
  const result = await routerSyncService.syncDateInstalledFromClickUp();
  expect(result.summary.updated).toBe(5); // ✅ Pure function test
});
```

### 2. **Reusability**
```javascript
// Can now call sync logic from:
// - API endpoint
// - Cron job
// - CLI script
// - Another service
const result = await routerSyncService.syncDateInstalledFromClickUp();
```

### 3. **Debugging**
```
ERROR in syncDateInstalledFromClickUp() at line 45
  └─ Called by adminController.syncDates() at line 12
    └─ Route: POST /admin/sync-dates

✅ Clear stack trace shows exact layer where error occurred
```

### 4. **Onboarding New Developers**
```
New dev: "Where is the sync dates logic?"
You: "Service layer, routerSyncService.js, line 120"

Not: "Somewhere in the 1,200 line router.js file... good luck!"
```

### 5. **Code Organization**
```
BEFORE:
routes/router.js (1,197 lines) ← Everything here

AFTER:
routes/router.js (200 lines) ← Endpoint definitions only
controllers/
  ├─ adminController.js (150 lines)
  ├─ routerController.js (200 lines)
  └─ statsController.js (100 lines)
services/
  ├─ routerSyncService.js (300 lines)
  ├─ cacheManager.js (100 lines)
  └─ statsService.js (200 lines)
models/
  └─ router.js (400 lines) ← SQL queries only
```

---

## Implementation Plan

### Phase 1: Foundation (No Breaking Changes)
1. ✅ Create `controllers/` directory
2. ✅ Create `config/constants.js` for hardcoded values
3. ✅ Create base controller helpers
4. ✅ Create `services/cacheManager.js` to extract cache logic

### Phase 2: Refactor Admin Endpoints (Example)
1. ✅ Extract `/admin/sync-dates` to:
   - `adminController.syncDates()`
   - `routerSyncService.syncDateInstalledFromClickUp()`
   - `routerModel.getRoutersWithLocations()`
2. ✅ Extract `/admin/clear-cache` similarly
3. ✅ Extract `/admin/deduplication-report`

### Phase 3: Refactor Stats Endpoints
4. Move all `/stats/*` endpoints to `statsController.js`
5. Create `statsService.js` for aggregation logic
6. Keep SQL in `models/router.js`

### Phase 4: Refactor Main CRUD Endpoints
7. Move GET `/routers`, POST `/log`, etc to `routerController.js`
8. Create `routerService.js` for deduplication and caching logic

### Phase 5: Testing & Documentation
9. Add tests for service layer
10. Update API documentation
11. Add JSDoc comments to all layers

---

## File Structure After Refactoring

```
backend/src/
├── config/
│   ├── database.js
│   └── constants.js (NEW - hardcoded UUIDs, magic numbers)
├── controllers/ (NEW)
│   ├── adminController.js
│   ├── routerController.js
│   ├── statsController.js
│   └── inspectionController.js
├── services/
│   ├── routerSyncService.js (NEW)
│   ├── cacheManager.js (NEW)
│   ├── statsService.js (NEW)
│   ├── deduplicationService.js (NEW)
│   ├── clickupSync.js (REFACTOR)
│   ├── propertyService.js (KEEP)
│   └── ...
├── models/
│   └── router.js (SIMPLIFY - SQL only)
├── routes/
│   ├── router.js (SIMPLIFY - 1197 → ~200 lines)
│   ├── clickup.js (REFACTOR)
│   └── ...
└── utils/
    └── ...
```

---

## Rollout Strategy

### Step 1: Create New Structure (Non-Breaking)
- Add new directories and files
- Keep old routes working
- No changes to existing code

### Step 2: Dual Implementation
- New endpoints use controller pattern
- Old endpoints remain unchanged
- Test new pattern thoroughly

### Step 3: Gradual Migration
- Migrate one route at a time
- Test after each migration
- Keep git history clean

### Step 4: Cleanup
- Remove old patterns
- Update tests
- Update documentation

---

## Testing Strategy

### Unit Tests (Service Layer)
```javascript
describe('routerSyncService', () => {
  describe('syncDateInstalledFromClickUp', () => {
    it('should sync dates for all routers with locations', async () => {
      const result = await routerSyncService.syncDateInstalledFromClickUp();
      expect(result.summary.total).toBeGreaterThan(0);
    });
  });
});
```

### Integration Tests (Controller Layer)
```javascript
describe('POST /admin/sync-dates', () => {
  it('should return 200 and sync results', async () => {
    const response = await request(app)
      .post('/api/router/admin/sync-dates')
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(response.body.success).toBe(true);
  });
});
```

---

## Success Metrics

- ✅ Average route handler: < 30 lines (currently 36+ lines)
- ✅ No SQL queries in routes (currently 15+ direct queries)
- ✅ No hardcoded UUIDs in routes (currently 5+)
- ✅ Service functions testable without HTTP (currently 0%)
- ✅ Clear separation of concerns
- ✅ Code coverage > 80% for service layer

---

## Next Steps

1. Review and approve this plan
2. Create foundation files (constants, controllers directory)
3. Implement one example refactoring (sync-dates)
4. Review results and adjust pattern
5. Proceed with full migration

