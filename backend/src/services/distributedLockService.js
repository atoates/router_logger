/**
 * Distributed lock service using Postgres advisory locks with heartbeat-based stale detection.
 *
 * - Uses pg_try_advisory_lock(int,int) so it works across instances.
 * - Holds the lock for the lifetime of the acquired client connection.
 * - Automatically releases locks on process exit when the DB connection closes.
 * - Uses a heartbeat table to detect stale locks from dead containers
 * - Heartbeat updated every 30 seconds, stale after 2 minutes
 */

const crypto = require('crypto');
const { pool, logger } = require('../config/database');

const heldLocks = new Map(); // name -> { client, acquiredAt, heartbeatInterval }

// Heartbeat interval - how often to update the heartbeat
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.LOCK_HEARTBEAT_MS || '30000', 10); // 30 seconds

// Stale threshold - if heartbeat is older than this, consider the lock stale
const STALE_THRESHOLD_MS = parseInt(process.env.LOCK_STALE_THRESHOLD_MS || '120000', 10); // 2 minutes

// Instance ID for this process
const INSTANCE_ID = `${process.env.RAILWAY_DEPLOYMENT_ID || 'local'}-${process.pid}-${Date.now()}`;

function nameToAdvisoryKeys(name) {
  // Deterministic 64-bit-ish mapping -> 2 x int32.
  const hash = crypto.createHash('sha256').update(String(name)).digest();
  const key1 = hash.readInt32BE(0);
  const key2 = hash.readInt32BE(4);
  return { key1, key2 };
}

/**
 * Ensure the heartbeat table exists
 */
async function ensureHeartbeatTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS distributed_lock_heartbeats (
        lock_name VARCHAR(255) PRIMARY KEY,
        instance_id VARCHAR(255) NOT NULL,
        heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (error) {
    // Table might already exist, that's fine
    logger.debug('Heartbeat table check:', error.message);
  }
}

/**
 * Update heartbeat for a lock we hold
 */
async function updateHeartbeat(name) {
  try {
    await pool.query(`
      INSERT INTO distributed_lock_heartbeats (lock_name, instance_id, heartbeat_at, acquired_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (lock_name) DO UPDATE SET
        heartbeat_at = NOW(),
        instance_id = $2
    `, [name, INSTANCE_ID]);
  } catch (error) {
    logger.warn(`Failed to update heartbeat for lock "${name}":`, error.message);
  }
}

/**
 * Remove heartbeat entry when releasing a lock
 */
async function removeHeartbeat(name) {
  try {
    await pool.query('DELETE FROM distributed_lock_heartbeats WHERE lock_name = $1', [name]);
  } catch (error) {
    logger.warn(`Failed to remove heartbeat for lock "${name}":`, error.message);
  }
}

/**
 * Check if a lock is stale based on heartbeat
 * Returns { stale: boolean, heartbeatAge: number, instanceId: string } or null if no heartbeat
 */
async function checkHeartbeat(name) {
  try {
    const result = await pool.query(`
      SELECT instance_id, heartbeat_at, acquired_at,
             EXTRACT(EPOCH FROM (NOW() - heartbeat_at)) * 1000 as age_ms
      FROM distributed_lock_heartbeats
      WHERE lock_name = $1
    `, [name]);
    
    if (result.rows.length === 0) {
      return null; // No heartbeat record
    }
    
    const row = result.rows[0];
    const ageMs = parseFloat(row.age_ms);
    
    return {
      stale: ageMs > STALE_THRESHOLD_MS,
      heartbeatAgeMs: ageMs,
      instanceId: row.instance_id,
      acquiredAt: row.acquired_at
    };
  } catch (error) {
    logger.warn(`Failed to check heartbeat for lock "${name}":`, error.message);
    return null;
  }
}

/**
 * Check if a lock appears to be stale (held by a dead process)
 * Uses heartbeat table first, falls back to pg_stat_activity
 */
async function isLockStale(name) {
  // First check heartbeat table
  const heartbeat = await checkHeartbeat(name);
  
  if (heartbeat) {
    if (heartbeat.stale) {
      logger.warn(`Lock "${name}" is stale - heartbeat ${Math.round(heartbeat.heartbeatAgeMs / 1000)}s old (threshold: ${STALE_THRESHOLD_MS / 1000}s), held by ${heartbeat.instanceId}`);
      return true;
    }
    logger.info(`Lock "${name}" has fresh heartbeat (${Math.round(heartbeat.heartbeatAgeMs / 1000)}s old) from ${heartbeat.instanceId}`);
    return false;
  }
  
  // Fallback: check pg_stat_activity for very old idle connections
  const { key1, key2 } = nameToAdvisoryKeys(name);
  
  try {
    const result = await pool.query(`
      SELECT l.pid, a.state, 
             EXTRACT(EPOCH FROM (NOW() - a.state_change)) as idle_seconds
      FROM pg_locks l
      JOIN pg_stat_activity a ON l.pid = a.pid
      WHERE l.locktype = 'advisory' 
        AND l.classid = $1 
        AND l.objid = $2
        AND l.granted = true
    `, [key1, key2]);
    
    if (result.rows.length === 0) {
      // No one holds the lock according to pg_locks
      return false;
    }
    
    const holder = result.rows[0];
    const idleSeconds = parseFloat(holder.idle_seconds) || 0;
    
    // Consider stale if idle for more than stale threshold
    if (holder.state === 'idle' && idleSeconds > STALE_THRESHOLD_MS / 1000) {
      logger.warn(`Lock "${name}" appears stale - PID ${holder.pid} idle for ${Math.round(idleSeconds)}s`);
      return true;
    }
    
    return false;
  } catch (error) {
    logger.warn(`Error checking lock staleness for "${name}":`, error.message);
    return false;
  }
}

/**
 * Force-release a stale lock by terminating the holding connection and clearing heartbeat
 */
async function forceReleaseStaleLock(name) {
  const { key1, key2 } = nameToAdvisoryKeys(name);
  
  try {
    // Clear the heartbeat entry first
    await removeHeartbeat(name);
    
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

  await ensureHeartbeatTable();
  
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

    // Record heartbeat immediately
    await updateHeartbeat(name);
    
    // Start heartbeat interval
    const heartbeatInterval = setInterval(() => {
      updateHeartbeat(name).catch(err => {
        logger.warn(`Heartbeat update failed for "${name}":`, err.message);
      });
    }, HEARTBEAT_INTERVAL_MS);

    heldLocks.set(name, { client, acquiredAt: Date.now(), heartbeatInterval });
    logger.info(`Acquired distributed lock: ${name} (instance: ${INSTANCE_ID})`);
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
  await ensureHeartbeatTable();
  
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

  const { client, heartbeatInterval } = lockInfo;
  const { key1, key2 } = nameToAdvisoryKeys(name);
  
  // Stop heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  // Remove heartbeat record
  await removeHeartbeat(name);
  
  try {
    await client.query('SELECT pg_advisory_unlock($1, $2)', [key1, key2]);
    logger.info(`Released distributed lock: ${name}`);
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
  
  try {
    // Check heartbeat table
    const heartbeats = await pool.query(`
      SELECT lock_name, instance_id, heartbeat_at, acquired_at,
             EXTRACT(EPOCH FROM (NOW() - heartbeat_at)) * 1000 as age_ms
      FROM distributed_lock_heartbeats
      ORDER BY lock_name
    `);
    
    // Check advisory locks
    const locks = await pool.query(`
      SELECT l.classid, l.objid, l.pid, a.state, 
             EXTRACT(EPOCH FROM (NOW() - a.state_change)) as idle_seconds
      FROM pg_locks l
      JOIN pg_stat_activity a ON l.pid = a.pid
      WHERE l.locktype = 'advisory' AND l.granted = true
    `);
    
    return {
      instanceId: INSTANCE_ID,
      heldByThisProcess: held,
      heartbeats: heartbeats.rows.map(r => ({
        lockName: r.lock_name,
        instanceId: r.instance_id,
        heartbeatAt: r.heartbeat_at,
        ageMs: Math.round(parseFloat(r.age_ms)),
        stale: parseFloat(r.age_ms) > STALE_THRESHOLD_MS
      })),
      advisoryLocks: locks.rows.map(r => ({
        classid: r.classid,
        objid: r.objid,
        pid: r.pid,
        state: r.state,
        idleSeconds: Math.round(parseFloat(r.idle_seconds) || 0)
      })),
      config: {
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        staleThresholdMs: STALE_THRESHOLD_MS
      }
    };
  } catch (error) {
    return {
      instanceId: INSTANCE_ID,
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
  nameToAdvisoryKeys,
  checkHeartbeat,
  INSTANCE_ID
};



