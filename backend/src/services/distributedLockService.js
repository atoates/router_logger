/**
 * Distributed lock service using Postgres advisory locks.
 *
 * - Uses pg_try_advisory_lock(int,int) so it works across instances.
 * - Holds the lock for the lifetime of the acquired client connection.
 * - Automatically releases locks on process exit when the DB connection closes.
 */

const crypto = require('crypto');
const { pool, logger } = require('../config/database');

const heldLocks = new Map(); // name -> client

function nameToAdvisoryKeys(name) {
  // Deterministic 64-bit-ish mapping -> 2 x int32.
  const hash = crypto.createHash('sha256').update(String(name)).digest();
  const key1 = hash.readInt32BE(0);
  const key2 = hash.readInt32BE(4);
  return { key1, key2 };
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

    heldLocks.set(name, client);
    logger.info(`Acquired distributed lock: ${name}`);
    return true;
  } catch (error) {
    client.release();
    logger.warn(`Failed to acquire distributed lock: ${name}`, { error: error.message });
    return false;
  }
}

async function release(name) {
  const client = heldLocks.get(name);
  if (!client) return;

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

module.exports = {
  tryAcquire,
  release,
  releaseAll
};


