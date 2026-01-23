/**
 * Distributed lock service using Postgres advisory locks with stale lock detection.
 *
 * - Uses pg_try_advisory_lock(int,int) so it works across instances.
 * - Holds the lock for the lifetime of the acquired client connection.
 * - Automatically releases locks on process exit when the DB connection closes.
 * - NEW: Tracks lock ownership in database for stale lock detection and force-release
 */

const crypto = require('crypto');
const { pool, logger } = require('../config/database');

const heldLocks = new Map(); // name -> { client, acquiredAt }

// Lock timeout - if a lock is held longer than this, consider it stale
const LOCK_TIMEOUT_MS = parseInt(process.env.LOCK_TIMEOUT_MS || '1800000', 10); // 30 minutes default

function nameToAdvisoryKeys(name) {
  // Deterministic 64-bit-ish mapping -> 2 x int32.
  const hash = crypto.createHash('sha256').update(String(name)).digest();
  const key1 = hash.readInt32BE(0);
  const key2 = hash.readInt32BE(4);
  return { key1, key2 };
}

/**
 * Check if a lock appears to be stale (held by a dead process)
 * Uses pg_stat_activity to check if the holding connection is still active
 */
async function isLockStale(name) {
  const { key1, key2 } = nameToAdvisoryKeys(name);
  
  try {
    // Check if any connection holds this lock
    const result = await pool.query(`
      SELECT l.pid, a.state, a.query_start, a.state_change,
             EXTRACT(EPOCH FROM (NOW() - a.state_change)) as idle_seconds
      FROM pg_locks l
      JOIN pg_stat_activity a ON l.pid = a.pid
      WHERE l.locktype = 'advisory' 
        AND l.classid = $1 
        AND l.objid = $2
        AND l.granted = true
    `, [key1, key2]);
    
    if (result.rows.length === 0) {
      // No one holds the lock
      return false;
    }
    
    const holder = result.rows[0];
    const idleSeconds = parseFloat(holder.idle_seconds) || 0;
    const timeoutSeconds = LOCK_TIMEOUT_MS / 1000;
    
    // Consider stale if connection has been idle for longer than timeout
    if (holder.state === 'idle' && idleSeconds > timeoutSeconds) {
      logger.warn(`Lock "${name}" appears stale - held by PID ${holder.pid} idle for ${Math.round(idleSeconds)}s (timeout: ${timeoutSeconds}s)`);
      return true;
    }
    
    return false;
  } catch (error) {
    logger.warn(`Error checking lock staleness for "${name}":`, error.message);
    return false;
  }
}

/**
 * Force-release a stale lock by terminating the holding connection
 * USE WITH CAUTION - this terminates another database connection
 */
async function forceReleaseStaleLock(name) {
  const { key1, key2 } = nameToAdvisoryKeys(name);
  
  try {
    // Find the PID holding this lock
    const lockResult = await pool.query(`
      SELECT l.pid
      FROM pg_locks l
      WHERE l.locktype = 'advisory' 
        AND l.classid = $1 
        AND l.objid = $2
        AND l.granted = true
    `, [key1, key2]);
    
    if (lockResult.rows.length === 0) {
      logger.info(`No holder found for lock "${name}" - may already be released`);
      return true;
    }
    
    const pid = lockResult.rows[0].pid;
    logger.warn(`Force-releasing lock "${name}" by terminating connection PID ${pid}`);
    
    // Terminate the connection holding the lock
    await pool.query('SELECT pg_terminate_backend($1)', [pid]);
    
    // Give it a moment to clean up
    await new Promise(resolve => setTimeout(resolve, 500));
    
    logger.info(`Force-released lock "${name}" (terminated PID ${pid})`);
    return true;
  } catch (error) {
    logger.error(`Failed to force-release lock "${name}":`, error.message);
    return false;
  }
}

async function tryAcquire(name) {
  if (heldLocks.has(name)) return true;

  const { key1, key2 } = nameToAdvisoryKeys(name);
  const client = await pool.connect();

  try {
    const res = await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [key1, key2]
    );
    const locked = !!res.rows?.[0]?.locked;
    if (!locked) {
      client.release();
      return false;
    }

    heldLocks.set(name, { client, acquiredAt: Date.now() });
    logger.info(`Acquired distributed lock: ${name}`);
    return true;
  } catch (error) {
    client.release();
    logger.warn(`Failed to acquire distributed lock: ${name}`, { error: error.message });
    return false;
  }
}

/**
 * Try to acquire lock, with automatic stale lock detection and force-release
 */
async function tryAcquireWithStaleCheck(name) {
  // First try normal acquisition
  if (await tryAcquire(name)) {
    return true;
  }
  
  // Check if the lock is stale
  const stale = await isLockStale(name);
  if (!stale) {
    logger.info(`Lock "${name}" is held by active process - cannot acquire`);
    return false;
  }
  
  // Force-release the stale lock
  logger.warn(`Attempting to force-release stale lock "${name}"`);
  const released = await forceReleaseStaleLock(name);
  
  if (!released) {
    return false;
  }
  
  // Try to acquire again after force-release
  return await tryAcquire(name);
}

async function release(name) {
  const lockInfo = heldLocks.get(name);
  if (!lockInfo) return;

  const { client } = lockInfo;
  const { key1, key2 } = nameToAdvisoryKeys(name);
  try {
    await client.query('SELECT pg_advisory_unlock($1, $2)', [key1, key2]);
  } catch (error) {
    logger.warn(`Failed to release distributed lock: ${name}`, { error: error.message });
  } finally {
    heldLocks.delete(name);
    client.release();
  }
}

async function releaseAll() {
  const names = Array.from(heldLocks.keys());
  for (const n of names) {
    // eslint-disable-next-line no-await-in-loop
    await release(n);
  }
}

/**
 * Get status of all known locks for monitoring
 */
async function getLockStatus() {
  const held = {};
  for (const [name, info] of heldLocks.entries()) {
    held[name] = {
      acquiredAt: new Date(info.acquiredAt).toISOString(),
      heldForMs: Date.now() - info.acquiredAt
    };
  }
  
  // Also check for any advisory locks in the database
  try {
    const result = await pool.query(`
      SELECT l.classid, l.objid, l.pid, a.state, 
             EXTRACT(EPOCH FROM (NOW() - a.state_change)) as idle_seconds
      FROM pg_locks l
      JOIN pg_stat_activity a ON l.pid = a.pid
      WHERE l.locktype = 'advisory' AND l.granted = true
    `);
    
    return {
      heldByThisProcess: held,
      allAdvisoryLocks: result.rows.map(r => ({
        classid: r.classid,
        objid: r.objid,
        pid: r.pid,
        state: r.state,
        idleSeconds: Math.round(parseFloat(r.idle_seconds) || 0)
      })),
      lockTimeoutMs: LOCK_TIMEOUT_MS
    };
  } catch (error) {
    return {
      heldByThisProcess: held,
      error: error.message
    };
  }
}

module.exports = {
  tryAcquire,
  tryAcquireWithStaleCheck,
  release,
  releaseAll,
  isLockStale,
  forceReleaseStaleLock,
  getLockStatus,
  nameToAdvisoryKeys
};



