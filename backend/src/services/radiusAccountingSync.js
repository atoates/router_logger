/**
 * RADIUS Accounting Sync Service
 * 
 * Syncs accounting data from RADIUS MariaDB (radacct table) 
 * to RouterLogger PostgreSQL (wifi_guest_sessions table)
 * 
 * This allows the main dashboard to show real-time data usage
 * from the captive portal without querying the RADIUS database directly.
 */

const mysql = require('mysql2/promise');
const { pool: pgPool, logger } = require('../config/database');

// RADIUS database configuration (from environment)
const RADIUS_CONFIG = {
    host: process.env.RADIUS_DB_HOST || 'radius-db',
    port: parseInt(process.env.RADIUS_DB_PORT || '3306'),
    user: process.env.RADIUS_DB_USER || 'radius',
    password: process.env.RADIUS_DB_PASS,
    database: process.env.RADIUS_DB_NAME || 'radius'
};

let radiusPool = null;

/**
 * Initialize RADIUS database connection pool
 */
function initRadiusConnection() {
    if (!RADIUS_CONFIG.password) {
        logger.warn('RADIUS database password not configured - accounting sync disabled');
        return null;
    }

    try {
        radiusPool = mysql.createPool({
            ...RADIUS_CONFIG,
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0
        });
        logger.info('✅ RADIUS accounting sync service initialized');
        return radiusPool;
    } catch (error) {
        logger.error('Failed to initialize RADIUS connection:', error);
        return null;
    }
}

/**
 * Sync accounting data from RADIUS to RouterLogger for a specific user
 * @param {string} username - RADIUS username (e.g., "free-1767824504947-u2g922")
 * @returns {Promise<Object>} Updated session data
 */
async function syncAccountingForUser(username) {
    if (!radiusPool) {
        throw new Error('RADIUS connection not initialized');
    }

    try {
        // Get accounting data from RADIUS
        const [radiusRows] = await radiusPool.execute(`
            SELECT 
                username,
                callingstationid as mac_address,
                MIN(acctstarttime) as first_login,
                MAX(acctupdatetime) as last_update,
                SUM(acctinputoctets) as bytes_uploaded,
                SUM(acctoutputoctets) as bytes_downloaded,
                SUM(acctsessiontime) as total_seconds
            FROM radacct 
            WHERE username = ? 
            AND acctstarttime >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
            GROUP BY username, callingstationid
        `, [username]);

        if (!radiusRows || radiusRows.length === 0) {
            logger.debug(`No RADIUS accounting data found for ${username}`);
            return null;
        }

        const accountingData = radiusRows[0];
        const bytesTotal = (accountingData.bytes_uploaded || 0) + (accountingData.bytes_downloaded || 0);

        // Update RouterLogger session with accounting data
        const result = await pgPool.query(`
            UPDATE wifi_guest_sessions 
            SET 
                bytes_uploaded = $1,
                bytes_downloaded = $2,
                bytes_total = $3,
                session_duration_seconds = $4,
                last_accounting_update = NOW(),
                updated_at = NOW()
            WHERE username = $5 
            AND session_end IS NULL
            RETURNING id, username, email, bytes_total
        `, [
            accountingData.bytes_uploaded,
            accountingData.bytes_downloaded,
            bytesTotal,
            accountingData.total_seconds,
            username
        ]);

        if (result.rows.length > 0) {
            logger.info(`✅ Synced accounting data for ${username}: ${(bytesTotal / 1024 / 1024).toFixed(2)} MB`);
            return result.rows[0];
        }

        return null;
    } catch (error) {
        logger.error(`Error syncing accounting for ${username}:`, error);
        throw error;
    }
}

/**
 * Sync all active sessions (batch update)
 * Runs periodically to update all active guest sessions with latest accounting data
 */
async function syncAllActiveSessions() {
    if (!radiusPool) {
        logger.debug('RADIUS sync skipped - not configured');
        return { synced: 0, errors: 0 };
    }

    try {
        // Get all active sessions from RouterLogger
        const { rows: activeSessions } = await pgPool.query(`
            SELECT username, email, session_start
            FROM wifi_guest_sessions 
            WHERE session_end IS NULL 
            AND username IS NOT NULL
            AND session_start >= NOW() - INTERVAL '48 hours'
            ORDER BY session_start DESC
        `);

        if (activeSessions.length === 0) {
            logger.debug('No active sessions to sync');
            return { synced: 0, errors: 0 };
        }

        logger.info(`Syncing ${activeSessions.length} active sessions...`);

        let synced = 0;
        let errors = 0;

        for (const session of activeSessions) {
            try {
                const result = await syncAccountingForUser(session.username);
                if (result) {
                    synced++;
                }
            } catch (error) {
                logger.error(`Failed to sync ${session.username}:`, error.message);
                errors++;
            }
        }

        logger.info(`✅ Accounting sync complete: ${synced} synced, ${errors} errors`);
        return { synced, errors, total: activeSessions.length };

    } catch (error) {
        logger.error('Error in batch accounting sync:', error);
        throw error;
    }
}

/**
 * Reset data usage for a specific session (admin action)
 * This clears the RADIUS accounting data and resets the session counters
 * @param {string} username - RADIUS username to reset
 * @param {string} adminUser - Admin who performed the reset (for audit)
 */
async function resetUserDataUsage(username, adminUser = 'system') {
    if (!radiusPool) {
        throw new Error('RADIUS connection not initialized');
    }

    try {
        // Clear RADIUS accounting data
        const [radiusResult] = await radiusPool.execute(`
            UPDATE radacct 
            SET 
                acctinputoctets = 0,
                acctoutputoctets = 0,
                acctsessiontime = 0,
                acctupdatetime = NOW()
            WHERE username = ? 
            AND acctstoptime IS NULL
        `, [username]);

        // Reset RouterLogger session data
        const pgResult = await pgPool.query(`
            UPDATE wifi_guest_sessions 
            SET 
                bytes_uploaded = 0,
                bytes_downloaded = 0,
                bytes_total = 0,
                session_duration_seconds = 0,
                last_accounting_update = NOW(),
                updated_at = NOW()
            WHERE username = $1 
            AND session_end IS NULL
            RETURNING id, username, email
        `, [username]);

        logger.info(`✅ Data usage reset for ${username} by ${adminUser}`, {
            radiusRowsAffected: radiusResult.affectedRows,
            pgRowsAffected: pgResult.rowCount
        });

        return {
            success: true,
            username,
            radiusRowsAffected: radiusResult.affectedRows,
            sessionRowsAffected: pgResult.rowCount,
            resetBy: adminUser,
            resetAt: new Date().toISOString()
        };

    } catch (error) {
        logger.error(`Error resetting data usage for ${username}:`, error);
        throw error;
    }
}

/**
 * Get real-time usage for a specific user (query RADIUS directly)
 * @param {string} username - RADIUS username
 * @returns {Promise<Object>} Current usage data
 */
async function getRealTimeUsage(username) {
    if (!radiusPool) {
        throw new Error('RADIUS connection not initialized');
    }

    try {
        const [rows] = await radiusPool.execute(`
            SELECT 
                username,
                callingstationid as mac_address,
                acctstarttime as session_start,
                acctupdatetime as last_update,
                acctinputoctets as bytes_uploaded,
                acctoutputoctets as bytes_downloaded,
                (acctinputoctets + acctoutputoctets) as bytes_total,
                acctsessiontime as session_seconds
            FROM radacct 
            WHERE username = ? 
            AND acctstoptime IS NULL
            ORDER BY acctstarttime DESC
            LIMIT 1
        `, [username]);

        return rows[0] || null;
    } catch (error) {
        logger.error(`Error getting real-time usage for ${username}:`, error);
        throw error;
    }
}

// Initialize connection on module load
initRadiusConnection();

module.exports = {
    syncAccountingForUser,
    syncAllActiveSessions,
    resetUserDataUsage,
    getRealTimeUsage,
    initRadiusConnection
};
