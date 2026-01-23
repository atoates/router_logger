/**
 * Performance Diagnostic Tool
 * Run with: node diagnose-performance.js
 */

const { pool, logger } = require('./src/config/database');

async function runDiagnostics() {
  console.log('\n========== DATABASE PERFORMANCE DIAGNOSTICS ==========\n');

  try {
    // 1. Total Database Size
    console.log('1. DATABASE SIZE');
    const dbSizeRes = await pool.query(`
      SELECT
        pg_database_size(current_database()) as db_bytes,
        pg_size_pretty(pg_database_size(current_database())) as db_size
    `);
    console.log('   Total DB Size:', dbSizeRes.rows[0].db_size, '(' + dbSizeRes.rows[0].db_bytes + ' bytes)');

    // 2. Top 10 Largest Tables (with indexes)
    console.log('\n2. LARGEST TABLES (Top 10)');
    const tablesRes = await pool.query(`
      SELECT
        c.relname AS table_name,
        pg_size_pretty(pg_table_size(c.oid)) AS table_size,
        pg_size_pretty(pg_indexes_size(c.oid)) AS indexes_size,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
        pg_total_relation_size(c.oid) as total_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY total_bytes DESC
      LIMIT 10
    `);
    tablesRes.rows.forEach(r => {
      console.log('   ' + r.table_name.padEnd(40) + ' Table: ' + r.table_size.padStart(12) + '  Indexes: ' + r.indexes_size.padStart(12) + '  Total: ' + r.total_size.padStart(12));
    });

    // 3. Row Counts for Key Tables
    console.log('\n3. ROW COUNTS (Key Tables)');
    const countRes = await pool.query(`
      SELECT
        'routers' as table_name, COUNT(*)::bigint as row_count FROM routers
      UNION ALL
      SELECT 'router_logs', COUNT(*)::bigint FROM router_logs
      UNION ALL
      SELECT 'router_current_status', COUNT(*)::bigint FROM router_current_status
      UNION ALL
      SELECT 'wifi_guest_sessions', COUNT(*)::bigint FROM wifi_guest_sessions
      UNION ALL
      SELECT 'user_sessions', COUNT(*)::bigint FROM user_sessions
      UNION ALL
      SELECT 'users', COUNT(*)::bigint FROM users
    `);
    countRes.rows.forEach(r => {
      const formatted = new Intl.NumberFormat().format(r.row_count);
      console.log('   ' + r.table_name.padEnd(30) + ' ' + formatted.padStart(15) + ' rows');
    });

    // 4. router_logs Partitions (if using partitioning)
    console.log('\n4. ROUTER_LOGS BREAKDOWN');
    const logsRes = await pool.query(`
      SELECT
        COUNT(*) as total_logs,
        MIN(timestamp) as oldest_log,
        MAX(timestamp) as newest_log,
        COUNT(DISTINCT router_id) as unique_routers,
        EXTRACT(DAY FROM (MAX(timestamp) - MIN(timestamp))) as days_of_data
      FROM router_logs
    `);
    if (logsRes.rows.length > 0) {
      const r = logsRes.rows[0];
      console.log('   Total Logs:', new Intl.NumberFormat().format(r.total_logs));
      console.log('   Unique Routers:', r.unique_routers);
      console.log('   Date Range:', r.oldest_log, 'to', r.newest_log);
      console.log('   Days of Data:', Math.floor(r.days_of_data));
      console.log('   Avg Logs/Day:', new Intl.NumberFormat().format(Math.floor(r.total_logs / Math.max(1, r.days_of_data))));
    }

    // 5. Index Usage Statistics
    console.log('\n5. INDEX USAGE (Top 10 most used)');
    const indexRes = await pool.query(`
      SELECT
        schemaname,
        tablename,
        indexname,
        idx_scan as scans,
        idx_tup_read as tuples_read,
        idx_tup_fetch as tuples_fetched,
        pg_size_pretty(pg_relation_size(indexrelid)) as size
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
      ORDER BY idx_scan DESC
      LIMIT 10
    `);
    console.log('   Index Name'.padEnd(50) + ' Scans'.padStart(10) + ' Size'.padStart(12));
    indexRes.rows.forEach(r => {
      console.log('   ' + r.indexname.padEnd(50) + ' ' + r.scans.toString().padStart(10) + ' ' + r.size.padStart(12));
    });

    // 6. Unused Indexes (never scanned)
    console.log('\n6. UNUSED INDEXES (Never scanned - candidates for removal)');
    const unusedRes = await pool.query(`
      SELECT
        schemaname,
        tablename,
        indexname,
        pg_size_pretty(pg_relation_size(indexrelid)) as size,
        pg_relation_size(indexrelid) as size_bytes
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public' AND idx_scan = 0
      ORDER BY size_bytes DESC
      LIMIT 10
    `);
    if (unusedRes.rows.length > 0) {
      unusedRes.rows.forEach(r => {
        console.log('   ' + r.indexname.padEnd(50) + ' ' + r.size.padStart(12) + ' (on ' + r.tablename + ')');
      });
    } else {
      console.log('   All indexes are being used!');
    }

    // 7. Database Activity
    console.log('\n7. DATABASE ACTIVITY (Live Stats)');
    const activityRes = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active') as active_queries,
        (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'idle') as idle_connections,
        (SELECT COUNT(*) FROM pg_stat_activity) as total_connections
    `);
    const act = activityRes.rows[0];
    console.log('   Active Queries:', act.active_queries);
    console.log('   Idle Connections:', act.idle_connections);
    console.log('   Total Connections:', act.total_connections);

    // 8. Test Query Performance
    console.log('\n8. QUERY PERFORMANCE TEST');
    console.log('   Testing: getStorageStats() COUNT(*) query...');
    const start1 = Date.now();
    const count1 = await pool.query('SELECT COUNT(*) FROM router_logs');
    const time1 = Date.now() - start1;
    console.log('   ✓ COUNT(*) on router_logs:', time1 + 'ms (' + new Intl.NumberFormat().format(count1.rows[0].count) + ' rows)');

    console.log('   Testing: Last 24h logs query...');
    const start2 = Date.now();
    const count2 = await pool.query(`
      SELECT COUNT(*) FROM router_logs
      WHERE timestamp >= NOW() - INTERVAL '24 hours'
    `);
    const time2 = Date.now() - start2;
    console.log('   ✓ Last 24h WHERE filter:', time2 + 'ms (' + new Intl.NumberFormat().format(count2.rows[0].count) + ' rows)');

    console.log('   Testing: Network usage rolling query (simplified)...');
    const start3 = Date.now();
    const usage3 = await pool.query(`
      SELECT
        date_trunc('hour', timestamp) as bucket,
        COUNT(*) as log_count
      FROM router_logs
      WHERE timestamp >= NOW() - INTERVAL '24 hours'
      GROUP BY bucket
      ORDER BY bucket
    `);
    const time3 = Date.now() - start3;
    console.log('   ✓ 24h bucketed aggregation:', time3 + 'ms (' + usage3.rows.length + ' buckets)');

    console.log('\n9. TABLE BLOAT CHECK');
    const bloatRes = await pool.query(`
      SELECT
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
        n_dead_tup as dead_tuples,
        n_live_tup as live_tuples,
        CASE WHEN n_live_tup > 0
          THEN ROUND(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 2)
          ELSE 0
        END as dead_pct
      FROM pg_stat_user_tables
      WHERE n_dead_tup > 1000
      ORDER BY n_dead_tup DESC
      LIMIT 5
    `);
    if (bloatRes.rows.length > 0) {
      console.log('   Tables with dead tuples (may need VACUUM):');
      bloatRes.rows.forEach(r => {
        console.log('   ' + r.tablename.padEnd(30) + ' Dead: ' + r.dead_tuples.toString().padStart(10) + ' (' + r.dead_pct + '%)  Size: ' + r.size);
      });
    } else {
      console.log('   No significant table bloat detected');
    }

    console.log('\n========== DIAGNOSTICS COMPLETE ==========\n');

  } catch (error) {
    console.error('Diagnostic error:', error);
  } finally {
    await pool.end();
  }
}

runDiagnostics();
