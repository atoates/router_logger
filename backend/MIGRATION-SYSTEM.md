# Migration System

## Overview

The application now uses an **automatic migration system** that tracks which migrations have been applied and runs pending migrations on server startup.

## How It Works

1. **Migrations Table**: A `migrations` table tracks which migration files have been applied
2. **Auto-Discovery**: On startup, the system scans the `src/database/migrations/` directory
3. **Smart Execution**: Only runs migrations that haven't been applied yet
4. **Order**: Migrations run in alphabetical order (prefix with numbers: `005_`, `006_`, etc.)

## Migration File Formats

### SQL Migrations (`.sql`)

Simple SQL files that get executed directly:

```sql
-- 015_add_new_column.sql
ALTER TABLE routers ADD COLUMN IF NOT EXISTS new_field TEXT;
CREATE INDEX IF NOT EXISTS idx_new_field ON routers(new_field);
```

### JavaScript Migrations (`.js`)

More complex migrations with programmatic logic:

```javascript
// 016_complex_migration.js
const { logger } = require('../../config/database');

async function up(pool) {
  logger.info('Running complex migration...');
  
  // Your migration logic here
  await pool.query(`...`);
  
  logger.info('✓ Migration complete');
}

async function down(pool) {
  // Optional: rollback logic
  await pool.query(`...`);
}

module.exports = { up, down };
```

## Creating New Migrations

1. **Name** your file with a numeric prefix: `017_description.sql` or `017_description.js`
2. **Place** it in `backend/src/database/migrations/`
3. **Deploy** - the migration runs automatically on next server startup

## Migration Tracking

Check which migrations have been applied:

```sql
SELECT * FROM migrations ORDER BY applied_at DESC;
```

## Benefits

- ✅ **No manual tracking** - system knows what's been applied
- ✅ **No code edits** - just add migration files
- ✅ **Idempotent** - safe to restart server during deployment
- ✅ **Ordered** - migrations always run in correct sequence
- ✅ **Logged** - all migration activity logged via Winston

## Error Handling

- Duplicate object errors (tables/columns already exist) are safely ignored
- Other errors are logged but don't crash the server
- Failed migrations can be investigated via logs

## Testing Migrations Locally

To test migrations without deploying:

```bash
cd backend
node src/database/init.js
```

This runs the schema initialization + all pending migrations.

