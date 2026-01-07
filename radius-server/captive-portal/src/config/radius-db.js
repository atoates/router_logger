/**
 * RADIUS Database Connection
 * Shared MariaDB connection for RADIUS user management and accounting
 */

let radiusDb = null;

const RADIUS_DB_HOST = process.env.RADIUS_DB_HOST || 'radius-db';
const RADIUS_DB_USER = process.env.RADIUS_DB_USER || 'radius';
const RADIUS_DB_PASSWORD = process.env.RADIUS_DB_PASSWORD || 'radiuspass123';
const RADIUS_DB_NAME = process.env.RADIUS_DB_NAME || 'radius';

// Initialize MariaDB connection
async function initRadiusDb() {
    if (radiusDb) {
        return radiusDb;
    }
    
    try {
        const mysql = require('mysql2/promise');
        radiusDb = await mysql.createPool({
            host: RADIUS_DB_HOST,
            user: RADIUS_DB_USER,
            password: RADIUS_DB_PASSWORD,
            database: RADIUS_DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
        console.log('📦 Connected to RADIUS MariaDB database');
        return radiusDb;
    } catch (error) {
        console.warn('⚠️ Could not connect to RADIUS database:', error.message);
        console.warn('   RADIUS operations will be skipped');
        return null;
    }
}

function getRadiusDb() {
    return radiusDb;
}

module.exports = {
    initRadiusDb,
    getRadiusDb
};
