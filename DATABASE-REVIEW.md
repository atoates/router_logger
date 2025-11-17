# Database Review & Recommendations

**Date**: 2025-01-XX  
**Reviewer**: Auto (AI Assistant)  
**Database**: PostgreSQL (RouterLogger)

---

## Executive Summary

The database is well-structured with good use of indexes, but there are several performance optimization opportunities and some missing constraints. The main issues are:

1. **N+1 Query Problem** in `getAllRouters()` - multiple subqueries per router
2. **Missing Indexes** on frequently queried columns
3. **Data Type Inconsistencies** (VARCHAR vs TEXT)
4. **Missing Foreign Key Constraints** in some tables
5. **Redundant Indexes** that could be consolidated

---

## Current Database Structure

### Tables Overview

| Table | Primary Purpose | Row Count (Est.) | Key Columns |
|-------|----------------|------------------|-------------|
| `routers` | Router metadata | ~100-200 | router_id, clickup_task_id, clickup_task_status |
| `router_logs` | Telemetry data | ~100K-1M+ | router_id, timestamp, status |
| `router_property_assignments` | Event log | ~500-1000 | router_id, event_type, event_date |
| `inspection_logs` | Inspections | ~100-500 | router_id, inspected_at |
| `users` | User accounts | ~10-50 | username, role |
| `user_router_assignments` | User-router mapping | ~100-500 | user_id, router_id |
| `oauth_tokens` | RMS OAuth | ~1-5 | user_id |
| `clickup_oauth_tokens` | ClickUp OAuth | ~1-5 | user_id |

---

## Critical Issues

### 1. ⚠️ N+1 Query Problem in `getAllRouters()`

**Location**: `backend/src/models/router.js:141-171`

**Problem**: The query uses 4 correlated subqueries for each router:
```sql
(SELECT COUNT(*) FROM router_logs WHERE router_id = r.router_id) as log_count,
(SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as current_status,
(SELECT imei FROM router_logs WHERE router_id = r.router_id AND imei IS NOT NULL ORDER BY timestamp DESC LIMIT 1) as imei,
(SELECT firmware_version FROM router_logs WHERE router_id = r.router_id AND firmware_version IS NOT NULL ORDER BY timestamp DESC LIMIT 1) as firmware_version
```

**Impact**: For 100 routers, this executes 400+ queries (4 per router)

**Solution**: Use LEFT JOINs or window functions:
```sql
SELECT 
  r.*,
  COUNT(l.id) as log_count,
  FIRST_VALUE(l.status) OVER (PARTITION BY r.router_id ORDER BY l.timestamp DESC) as current_status,
  FIRST_VALUE(l.imei) OVER (PARTITION BY r.router_id ORDER BY l.timestamp DESC) as imei,
  FIRST_VALUE(l.firmware_version) OVER (PARTITION BY r.router_id ORDER BY l.timestamp DESC) as firmware_version
FROM routers r
LEFT JOIN router_logs l ON l.router_id = r.router_id
GROUP BY r.id
ORDER BY r.last_seen DESC;
```

**Priority**: 🔴 HIGH

---

### 2. ⚠️ Missing Index on `routers.last_seen`

**Problem**: `getAllRouters()` orders by `r.last_seen DESC`, but no index exists

**Current State**: No index on `routers.last_seen`

**Impact**: Full table scan + sort for every router list query

**Solution**:
```sql
CREATE INDEX IF NOT EXISTS idx_routers_last_seen 
ON routers(last_seen DESC NULLS LAST);
```

**Priority**: 🔴 HIGH

---

### 3. ⚠️ Missing Indexes on `router_logs` for Common Filters

**Missing Indexes**:
- `status` - frequently filtered in queries
- `operator` - used in operator distribution queries
- `router_id + status` - composite for status queries per router

**Solution**:
```sql
CREATE INDEX IF NOT EXISTS idx_router_logs_status 
ON router_logs(status) WHERE status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_router_logs_operator 
ON router_logs(operator) WHERE operator IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_router_logs_router_status 
ON router_logs(router_id, status, timestamp DESC);
```

**Priority**: 🟡 MEDIUM

---

### 4. ⚠️ Missing Index on `routers.clickup_task_status`

**Problem**: Frequently filtered in queries (`/routers/decommissioned`, `/routers/being-returned`)

**Current State**: No index

**Solution**:
```sql
CREATE INDEX IF NOT EXISTS idx_routers_task_status 
ON routers(clickup_task_status) WHERE clickup_task_status IS NOT NULL;
```

**Priority**: 🟡 MEDIUM

---

## Data Type Issues

### 1. Inconsistent VARCHAR/TEXT Usage

**Issue**: Mix of VARCHAR and TEXT for similar data:
- `routers.notes` → TEXT ✅
- `routers.clickup_task_url` → TEXT ✅
- `routers.name` → VARCHAR(255) ⚠️
- `routers.location` → VARCHAR(255) ⚠️

**Recommendation**: 
- Use TEXT for variable-length strings (no length limit)
- Use VARCHAR only when you need length constraints
- Current mix is acceptable but inconsistent

**Priority**: 🟢 LOW (cosmetic)

---

### 2. `date_installed` as BIGINT

**Issue**: Stored as Unix timestamp (milliseconds) instead of TIMESTAMP

**Current**: `date_installed BIGINT`

**Recommendation**: Consider TIMESTAMP for better queryability, but current format works fine

**Priority**: 🟢 LOW (works as-is)

---

## Missing Constraints

### 1. Foreign Key on `router_property_assignments.router_id`

**Current**: Has FK ✅

### 2. Check Constraints

**Missing**:
- No constraint ensuring `clickup_task_status` values are valid
- No constraint on `routers.current_state` (though migration 011 adds this)

**Recommendation**:
```sql
ALTER TABLE routers 
ADD CONSTRAINT check_task_status 
CHECK (clickup_task_status IN ('installed', 'ready', 'needs attention', 'being returned', 'decommissioned', NULL));
```

**Priority**: 🟡 MEDIUM

---

## Index Analysis

### ✅ Good Indexes (Keep)

1. `idx_router_logs_router_ts` - Composite (router_id, timestamp DESC) ✅
2. `idx_router_logs_timestamp` - For time-based queries ✅
3. `idx_router_logs_recent` - Partial index for recent data ✅
4. `idx_inspection_logs_router_ts` - For inspection history ✅
5. `idx_routers_clickup_task` - For ClickUp lookups ✅
6. `idx_routers_location_task` - Partial index ✅

### ⚠️ Redundant Indexes

**Issue**: Multiple overlapping indexes on `router_logs`:
- `idx_router_logs_router_id` (single column)
- `idx_router_logs_router_timestamp` (composite)
- `idx_router_logs_router_ts` (composite DESC)

**Analysis**: 
- `idx_router_logs_router_ts` (router_id, timestamp DESC) covers most use cases
- `idx_router_logs_router_id` is redundant if composite exists
- `idx_router_logs_router_timestamp` might be redundant

**Recommendation**: Keep `idx_router_logs_router_ts`, consider dropping others after testing

**Priority**: 🟢 LOW (indexes help, not hurt)

---

## Query Performance Issues

### 1. `getAllRouters()` - N+1 Problem

**See Critical Issue #1 above**

### 2. `getUsageStats()` - Complex Window Functions

**Location**: `backend/src/models/router.js:246-315`

**Analysis**: Uses multiple CTEs and window functions. This is complex but likely efficient with proper indexes.

**Recommendation**: Monitor query execution time. Consider materialized view if slow.

**Priority**: 🟢 LOW (likely fine with indexes)

### 3. `getTopRoutersByUsage()` - Multiple Window Functions

**Location**: `backend/src/models/router.js:518-573`

**Analysis**: Complex query with multiple CTEs. Should be efficient with `idx_router_logs_router_ts`.

**Recommendation**: Monitor performance as data grows.

**Priority**: 🟢 LOW

---

## Missing Tables/Features

### 1. Settings Table

**Status**: Created in `migrate.js` but not in schema.sql

**Issue**: Settings table exists but not documented in main schema

**Recommendation**: Add to schema.sql for documentation

**Priority**: 🟢 LOW

### 2. IronWifi Tables

**Status**: Referenced in migrations but not in main schema.sql

**Tables**: `ironwifi_sessions`, `router_user_stats`

**Recommendation**: Add to schema.sql or create separate schema file

**Priority**: 🟡 MEDIUM (for documentation)

---

## Recommendations Summary

### 🔴 High Priority (Do First)

1. **Fix N+1 Query in `getAllRouters()`**
   - Replace subqueries with JOINs or window functions
   - Expected improvement: 10-100x faster

2. **Add Index on `routers.last_seen`**
   - Critical for router list ordering
   - Expected improvement: 5-10x faster

### 🟡 Medium Priority (Do Soon)

3. **Add Index on `routers.clickup_task_status`**
   - For decommissioned/returned router queries
   - Expected improvement: 2-5x faster

4. **Add Indexes on `router_logs.status` and `router_logs.operator`**
   - For filtering and aggregation queries
   - Expected improvement: 2-5x faster

5. **Add Check Constraint on `clickup_task_status`**
   - Data integrity
   - Prevents invalid status values

6. **Document IronWifi Tables**
   - Add to schema.sql or create separate file

### 🟢 Low Priority (Nice to Have)

7. **Consolidate Redundant Indexes**
   - Review and potentially drop overlapping indexes
   - Test performance before dropping

8. **Standardize VARCHAR vs TEXT**
   - Use TEXT for variable-length strings
   - Cosmetic improvement

9. **Add Database Comments**
   - Document complex queries
   - Add table/column comments

---

## Migration Script

Create a new migration file: `014_database_optimizations.sql`

```sql
-- Migration 014: Database Performance Optimizations
-- Date: 2025-01-XX

-- 1. Add missing index on routers.last_seen (HIGH PRIORITY)
CREATE INDEX IF NOT EXISTS idx_routers_last_seen 
ON routers(last_seen DESC NULLS LAST);

-- 2. Add index on routers.clickup_task_status (MEDIUM PRIORITY)
CREATE INDEX IF NOT EXISTS idx_routers_task_status 
ON routers(clickup_task_status) 
WHERE clickup_task_status IS NOT NULL;

-- 3. Add indexes on router_logs for common filters (MEDIUM PRIORITY)
CREATE INDEX IF NOT EXISTS idx_router_logs_status 
ON router_logs(status) 
WHERE status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_router_logs_operator 
ON router_logs(operator) 
WHERE operator IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_router_logs_router_status 
ON router_logs(router_id, status, timestamp DESC);

-- 4. Add check constraint for clickup_task_status (MEDIUM PRIORITY)
ALTER TABLE routers 
DROP CONSTRAINT IF EXISTS check_task_status;

ALTER TABLE routers 
ADD CONSTRAINT check_task_status 
CHECK (clickup_task_status IN ('installed', 'ready', 'needs attention', 'being returned', 'decommissioned') OR clickup_task_status IS NULL);

-- 5. Analyze tables to update statistics
ANALYZE routers;
ANALYZE router_logs;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 014 complete: Database optimizations applied';
END $$;
```

---

## Query Optimization: `getAllRouters()`

### Current (Slow):
```sql
SELECT 
  r.*,
  (SELECT COUNT(*) FROM router_logs WHERE router_id = r.router_id) as log_count,
  (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as current_status,
  ...
FROM routers r
ORDER BY r.last_seen DESC;
```

### Optimized (Fast):
```sql
SELECT 
  r.*,
  COALESCE(agg.log_count, 0) as log_count,
  agg.current_status,
  COALESCE(agg.latest_imei, r.imei) as imei,
  COALESCE(agg.latest_firmware, r.firmware_version) as firmware_version
FROM routers r
LEFT JOIN LATERAL (
  SELECT 
    COUNT(*) as log_count,
    (SELECT status FROM router_logs WHERE router_id = r.router_id ORDER BY timestamp DESC LIMIT 1) as current_status,
    (SELECT imei FROM router_logs WHERE router_id = r.router_id AND imei IS NOT NULL ORDER BY timestamp DESC LIMIT 1) as latest_imei,
    (SELECT firmware_version FROM router_logs WHERE router_id = r.router_id AND firmware_version IS NOT NULL ORDER BY timestamp DESC LIMIT 1) as latest_firmware
  FROM router_logs
  WHERE router_id = r.router_id
) agg ON true
ORDER BY r.last_seen DESC NULLS LAST;
```

**Better Alternative** (using window functions):
```sql
WITH latest_logs AS (
  SELECT DISTINCT ON (router_id)
    router_id,
    status as current_status,
    imei,
    firmware_version,
    timestamp
  FROM router_logs
  ORDER BY router_id, timestamp DESC
),
log_counts AS (
  SELECT 
    router_id,
    COUNT(*) as log_count
  FROM router_logs
  GROUP BY router_id
)
SELECT 
  r.*,
  COALESCE(lc.log_count, 0) as log_count,
  ll.current_status,
  COALESCE(ll.imei, r.imei) as imei,
  COALESCE(ll.firmware_version, r.firmware_version) as firmware_version
FROM routers r
LEFT JOIN latest_logs ll ON ll.router_id = r.router_id
LEFT JOIN log_counts lc ON lc.router_id = r.router_id
ORDER BY r.last_seen DESC NULLS LAST;
```

---

## Index Usage Analysis

### Most Used Indexes (Keep)
- `idx_router_logs_router_ts` - Used in almost every router query
- `idx_router_logs_timestamp` - Used in time-range queries
- `idx_routers_clickup_task` - Used in ClickUp sync operations

### Potentially Unused
- `idx_router_logs_router_id` - May be redundant with composite index
- `idx_router_logs_router_timestamp` - May be redundant with DESC version

**Recommendation**: Use `EXPLAIN ANALYZE` to verify index usage before dropping

---

## Data Growth Projections

### Current Estimates
- **router_logs**: Growing at ~100-500 rows/day (depending on router count and frequency)
- **routers**: Stable at ~100-200 rows
- **router_property_assignments**: Growing slowly (~10-50 events/month)

### Recommendations for Scale
1. **Partitioning**: Consider partitioning `router_logs` by month/year if > 10M rows
2. **Archiving**: Archive logs older than 2 years to separate table
3. **Materialized Views**: For complex aggregations (daily stats, operator distribution)

---

## Security Considerations

### ✅ Good Practices
- Foreign keys with CASCADE for data integrity
- Unique constraints where needed
- Check constraints for enum-like values

### ⚠️ Recommendations
1. **Row-Level Security**: Consider for multi-tenant scenarios
2. **Audit Logging**: Track who made changes (some fields have `linkedBy`, `unlinkedBy` but not all)
3. **Encryption**: OAuth tokens stored as TEXT (consider encryption at rest)

---

## Testing Recommendations

1. **Load Testing**: Test `getAllRouters()` with 500+ routers
2. **Query Analysis**: Run `EXPLAIN ANALYZE` on all major queries
3. **Index Usage**: Monitor index usage with `pg_stat_user_indexes`
4. **Slow Query Log**: Enable `log_min_duration_statement` to catch slow queries

---

## Conclusion

The database is well-designed but needs optimization for scale. The highest priority is fixing the N+1 query problem in `getAllRouters()` and adding the missing `last_seen` index. These two changes alone should provide significant performance improvements.

**Estimated Performance Gains**:
- `getAllRouters()`: 10-100x faster (after N+1 fix)
- Router list queries: 5-10x faster (after last_seen index)
- Status-filtered queries: 2-5x faster (after status indexes)

---

**Next Steps**:
1. Create migration 014 with recommended indexes
2. Optimize `getAllRouters()` query
3. Test performance improvements
4. Monitor query execution times in production

