/**
 * Router Maintenance Model
 * Contains maintenance, cleanup, and administrative functions for routers
 */

const { pool, logger } = require('../config/database');

/**
 * Merge duplicate routers that share the same name; prefer serial-like IDs (>=9 digits).
 * Moves all logs to the preferred router_id and deletes the others from routers table.
 * Returns a summary of changes.
 */
async function mergeDuplicateRouters() {
  const summary = { groupsChecked: 0, routersMerged: 0, logsMoved: 0, details: [] };
  try {
    // Get all routers with basic info
    const routersRes = await pool.query(`
      SELECT 
        router_id, 
        name, 
        last_seen,
        (SELECT COUNT(*) FROM router_logs WHERE router_id = r.router_id) as log_count
      FROM routers r
    `);
    const routers = routersRes.rows;
    
    const groups = new Map();
    for (const r of routers) {
      const key = (r.name || '').toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const isSerialLike = (id) => /^(\d){9,}$/.test(String(id || ''));

    for (const [nameKey, list] of groups.entries()) {
      if (list.length < 2) continue;
      summary.groupsChecked++;
      
      // Choose preferred: highest log_count; tie-break with serial-like; then most recent last_seen
      const preferred = list.slice().sort((a, b) => {
        const aLogs = Number(a.log_count || 0);
        const bLogs = Number(b.log_count || 0);
        if (aLogs !== bLogs) return bLogs - aLogs;
        const aSerial = isSerialLike(a.router_id) ? 1 : 0;
        const bSerial = isSerialLike(b.router_id) ? 1 : 0;
        if (aSerial !== bSerial) return bSerial - aSerial;
        const aSeen = a.last_seen ? new Date(a.last_seen).getTime() : 0;
        const bSeen = b.last_seen ? new Date(b.last_seen).getTime() : 0;
        return bSeen - aSeen;
      })[0];
      
      const others = list.filter(r => String(r.router_id) !== String(preferred.router_id));
      if (others.length === 0) continue;

      for (const o of others) {
        // Move logs
        const moveRes = await pool.query(
          'UPDATE router_logs SET router_id = $1 WHERE router_id = $2',
          [preferred.router_id, o.router_id]
        );
        summary.logsMoved += moveRes.rowCount || 0;
        // Delete other router row
        await pool.query('DELETE FROM routers WHERE router_id = $1', [o.router_id]);
        summary.routersMerged += 1;
        summary.details.push({ 
          name: preferred.name || nameKey, 
          kept: preferred.router_id, 
          removed: o.router_id, 
          movedLogs: moveRes.rowCount || 0 
        });
      }
    }
    return summary;
  } catch (error) {
    logger.error('Error merging duplicate routers:', error);
    throw error;
  }
}

/**
 * Get deduplication report without actually merging
 * Returns potential duplicates that could be merged
 */
async function getDeduplicationReport() {
  try {
    const routersRes = await pool.query(`
      SELECT 
        router_id, 
        name, 
        last_seen,
        device_serial,
        imei,
        (SELECT COUNT(*) FROM router_logs WHERE router_id = r.router_id) as log_count
      FROM routers r
      ORDER BY name, log_count DESC
    `);
    const routers = routersRes.rows;
    
    const groups = new Map();
    for (const r of routers) {
      const key = (r.name || '').toLowerCase().trim();
      if (!key) continue; // Skip routers without names
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    const duplicates = [];
    for (const [name, list] of groups.entries()) {
      if (list.length < 2) continue;
      duplicates.push({
        name,
        count: list.length,
        routers: list.map(r => ({
          router_id: r.router_id,
          device_serial: r.device_serial,
          imei: r.imei,
          log_count: Number(r.log_count || 0),
          last_seen: r.last_seen
        }))
      });
    }

    return {
      totalDuplicateGroups: duplicates.length,
      totalDuplicateRouters: duplicates.reduce((sum, g) => sum + g.count - 1, 0),
      duplicates
    };
  } catch (error) {
    logger.error('Error generating deduplication report:', error);
    throw error;
  }
}

/**
 * Archive old router logs to archive table
 * @param {Date} cutoffDate - Archive logs older than this date
 * @param {number} batchSize - Number of logs to move per batch
 */
async function archiveOldLogs(cutoffDate, batchSize = 10000) {
  try {
    let totalArchived = 0;
    let batchCount = 0;
    
    while (true) {
      const result = await pool.query(`
        WITH moved AS (
          DELETE FROM router_logs
          WHERE id IN (
            SELECT id FROM router_logs
            WHERE timestamp < $1
            ORDER BY timestamp ASC
            LIMIT $2
          )
          RETURNING *
        )
        INSERT INTO router_logs_archive 
        SELECT *, NOW() as archived_at FROM moved
        RETURNING id
      `, [cutoffDate, batchSize]);
      
      const movedCount = result.rowCount || 0;
      totalArchived += movedCount;
      batchCount++;
      
      logger.info(`Archive batch ${batchCount}: moved ${movedCount} logs, total: ${totalArchived}`);
      
      if (movedCount < batchSize) {
        break; // No more logs to archive
      }
    }
    
    logger.info(`Archival complete: ${totalArchived} logs archived in ${batchCount} batches`);
    return { totalArchived, batchCount };
  } catch (error) {
    logger.error('Error archiving old logs:', error);
    throw error;
  }
}

/**
 * Delete archived logs older than a certain date
 * @param {Date} cutoffDate - Delete archived logs older than this date
 */
async function purgeArchivedLogs(cutoffDate) {
  try {
    const result = await pool.query(
      'DELETE FROM router_logs_archive WHERE timestamp < $1',
      [cutoffDate]
    );
    
    logger.info(`Purged ${result.rowCount} archived logs older than ${cutoffDate.toISOString()}`);
    return { purgedCount: result.rowCount };
  } catch (error) {
    logger.error('Error purging archived logs:', error);
    throw error;
  }
}

/**
 * Clean up orphaned router logs (logs for routers that no longer exist)
 */
async function cleanupOrphanedLogs() {
  try {
    const result = await pool.query(`
      DELETE FROM router_logs
      WHERE router_id NOT IN (SELECT router_id FROM routers)
    `);
    
    logger.info(`Cleaned up ${result.rowCount} orphaned router logs`);
    return { deletedCount: result.rowCount };
  } catch (error) {
    logger.error('Error cleaning up orphaned logs:', error);
    throw error;
  }
}

/**
 * Auto-merge duplicates if any are found
 * Called automatically after RMS sync to prevent duplicate buildup
 * Only merges if duplicates are detected (safe to call frequently)
 * 
 * @returns {Object} Summary of any merges performed
 */
async function autoMergeDuplicatesIfNeeded() {
  try {
    // Quick check for duplicates first
    const checkResult = await pool.query(`
      SELECT COUNT(*) as dup_count FROM (
        SELECT LOWER(name) as name_lower
        FROM routers
        WHERE name IS NOT NULL AND name != ''
        GROUP BY LOWER(name)
        HAVING COUNT(*) > 1
      ) duplicates
    `);
    
    const dupCount = Number(checkResult.rows[0]?.dup_count || 0);
    
    if (dupCount === 0) {
      return { duplicatesFound: 0, merged: false };
    }
    
    logger.warn(`Found ${dupCount} duplicate router groups - auto-merging...`);
    const result = await mergeDuplicateRouters();
    logger.info(`Auto-merge complete: ${result.routersMerged} routers merged, ${result.logsMoved} logs moved`);
    
    return { 
      duplicatesFound: dupCount, 
      merged: true, 
      ...result 
    };
  } catch (error) {
    logger.error('Error in autoMergeDuplicatesIfNeeded:', error);
    // Don't throw - this is a background cleanup task
    return { duplicatesFound: 0, merged: false, error: error.message };
  }
}

module.exports = {
  mergeDuplicateRouters,
  getDeduplicationReport,
  archiveOldLogs,
  purgeArchivedLogs,
  cleanupOrphanedLogs,
  autoMergeDuplicatesIfNeeded
};

