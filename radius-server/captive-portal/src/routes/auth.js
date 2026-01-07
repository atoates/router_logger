/**
 * Authentication Routes
 * 
 * Handles guest authentication via:
 * - Email + verification code
 * - SMS + verification code
 * - Voucher codes
 * - Direct password (for registered users)
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const validator = require('validator');
const radiusClient = require('../services/radiusClient');
const axios = require('axios');

// Will be set by server.js after portal routes are loaded
let storeSuccessToken = null;
router.setSuccessTokenStore = (fn) => { storeSuccessToken = fn; };

// Database connection (if using shared Railway database - PostgreSQL)
let dbPool = null;
const USE_DATABASE = process.env.USE_DATABASE === 'true';

if (USE_DATABASE) {
    const { Pool } = require('pg');
    dbPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
    console.log('📦 Using PostgreSQL database for verification codes and free tier tracking');
}

// MariaDB connection for RADIUS user management
let radiusDb = null;
const RADIUS_DB_HOST = process.env.RADIUS_DB_HOST || 'radius-db';
const RADIUS_DB_USER = process.env.RADIUS_DB_USER || 'radius';
const RADIUS_DB_PASSWORD = process.env.RADIUS_DB_PASSWORD || 'radiuspass123';
const RADIUS_DB_NAME = process.env.RADIUS_DB_NAME || 'radius';

// Initialize MariaDB connection
async function initRadiusDb() {
    try {
        const mysql = require('mysql2/promise');
        radiusDb = await mysql.createPool({
            host: RADIUS_DB_HOST,
            user: RADIUS_DB_USER,
            password: RADIUS_DB_PASSWORD,
            database: RADIUS_DB_NAME,
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0
        });
        console.log('📦 Connected to RADIUS MariaDB database');
    } catch (error) {
        console.warn('⚠️ Could not connect to RADIUS database:', error.message);
        console.warn('   RADIUS user creation will be skipped');
    }
}

// Try to initialize RADIUS DB connection
initRadiusDb();

/**
 * Create a temporary RADIUS user for guest access
 * Uses Auth-Type := Accept to bypass password verification
 * This is needed because CoovaChilli encrypts passwords before sending to RADIUS
 */
async function createRadiusUser(username, password, sessionTimeout = 1800) {
    if (!radiusDb) {
        console.warn('⚠️ RADIUS database not available, skipping user creation');
        return false;
    }
    
    try {
        // Delete any existing entries for this user
        await radiusDb.execute('DELETE FROM radcheck WHERE username = ?', [username]);
        await radiusDb.execute('DELETE FROM radreply WHERE username = ?', [username]);
        await radiusDb.execute('DELETE FROM radusergroup WHERE username = ?', [username]);
        
        // Set Auth-Type := Accept to skip password verification
        // This allows CoovaChilli's encrypted password to work
        await radiusDb.execute(
            'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
            [username, 'Auth-Type', ':=', 'Accept']
        );
        
        // Add session timeout
        await radiusDb.execute(
            'INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ?, ?)',
            [username, 'Session-Timeout', ':=', sessionTimeout.toString()]
        );
        
        // Add to free-tier group
        await radiusDb.execute(
            'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, ?)',
            [username, 'free-tier', 1]
        );
        
        console.log(`✅ Created RADIUS user: ${username} (timeout: ${sessionTimeout}s, Auth-Type: Accept)`);
        return true;
    } catch (error) {
        console.error('Error creating RADIUS user:', error);
        return false;
    }
}

// Fallback in-memory store (used when database is not configured)
const verificationCodes = new Map();
const freeAccessUsage = new Map();

const VERIFICATION_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const FREE_SESSION_DURATION = parseInt(process.env.FREE_SESSION_DURATION) || 30 * 60; // 30 minutes in seconds
const FREE_COOLDOWN_HOURS = parseInt(process.env.FREE_COOLDOWN_HOURS) || 24; // Hours before same device can get free access again

const ROUTERLOGGER_API_URL = process.env.ROUTERLOGGER_API_URL || 'http://localhost:3001';

// =============================================================================
// Database Helper Functions
// =============================================================================

/**
 * Store verification code in database or memory
 */
async function storeVerificationCode(identifier, identifierType, code, expiresAt, metadata = {}) {
    if (USE_DATABASE && dbPool) {
        try {
            await dbPool.query(`
                INSERT INTO captive_verification_codes 
                (identifier, identifier_type, code, expires_at, guest_name, client_mac, router_mac, router_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (identifier, code) DO UPDATE SET
                    expires_at = EXCLUDED.expires_at,
                    attempts = 0
            `, [
                identifier, identifierType, code, expiresAt,
                metadata.name, metadata.client_mac, metadata.router_mac, metadata.router_id
            ]);
            return true;
        } catch (error) {
            console.error('Database error storing verification code:', error);
            // Fall through to in-memory
        }
    }
    
    // In-memory fallback
    verificationCodes.set(identifier, {
        code,
        expires: expiresAt.getTime(),
        attempts: 0,
        ...metadata
    });
    return true;
}

/**
 * Get and validate verification code
 */
async function getVerificationCode(identifier) {
    if (USE_DATABASE && dbPool) {
        try {
            const result = await dbPool.query(`
                SELECT * FROM captive_verification_codes
                WHERE identifier = $1 AND expires_at > NOW() AND verified_at IS NULL
                ORDER BY created_at DESC LIMIT 1
            `, [identifier]);
            
            if (result.rows.length > 0) {
                return {
                    code: result.rows[0].code,
                    expires: new Date(result.rows[0].expires_at).getTime(),
                    attempts: result.rows[0].attempts,
                    name: result.rows[0].guest_name,
                    client_mac: result.rows[0].client_mac,
                    router_mac: result.rows[0].router_mac,
                    router_id: result.rows[0].router_id,
                    id: result.rows[0].id
                };
            }
            return null;
        } catch (error) {
            console.error('Database error getting verification code:', error);
        }
    }
    
    return verificationCodes.get(identifier) || null;
}

/**
 * Increment verification attempts
 */
async function incrementVerificationAttempts(identifier, codeId) {
    if (USE_DATABASE && dbPool && codeId) {
        try {
            await dbPool.query(`
                UPDATE captive_verification_codes SET attempts = attempts + 1 WHERE id = $1
            `, [codeId]);
        } catch (error) {
            console.error('Database error incrementing attempts:', error);
        }
    } else {
        const stored = verificationCodes.get(identifier);
        if (stored) stored.attempts++;
    }
}

/**
 * Mark verification code as used
 */
async function markVerificationCodeUsed(identifier, codeId) {
    if (USE_DATABASE && dbPool && codeId) {
        try {
            await dbPool.query(`
                UPDATE captive_verification_codes SET verified_at = NOW() WHERE id = $1
            `, [codeId]);
        } catch (error) {
            console.error('Database error marking code used:', error);
        }
    }
    verificationCodes.delete(identifier);
}

/**
 * Check free tier usage
 */
async function checkFreeUsage(identifier) {
    if (USE_DATABASE && dbPool) {
        try {
            const result = await dbPool.query(`
                SELECT * FROM captive_free_usage
                WHERE identifier_type = 'email' AND identifier_value = $1
            `, [identifier]);
            
            if (result.rows.length > 0) {
                return {
                    lastUsed: result.rows[0].last_session_start,
                    sessionsUsed: result.rows[0].sessions_used,
                    nextFreeAvailable: result.rows[0].next_free_available
                };
            }
            return null;
        } catch (error) {
            console.error('Database error checking free usage:', error);
        }
    }
    
    return freeAccessUsage.get(identifier) || null;
}

/**
 * Record free tier usage
 */
async function recordFreeUsage(identifier, guestId) {
    const nextFreeAvailable = new Date();
    nextFreeAvailable.setHours(nextFreeAvailable.getHours() + FREE_COOLDOWN_HOURS);
    
    if (USE_DATABASE && dbPool) {
        try {
            await dbPool.query(`
                INSERT INTO captive_free_usage 
                (identifier_type, identifier_value, last_session_start, last_guest_id, next_free_available)
                VALUES ('email', $1, NOW(), $2, $3)
                ON CONFLICT (identifier_type, identifier_value) DO UPDATE SET
                    sessions_used = captive_free_usage.sessions_used + 1,
                    last_session_start = NOW(),
                    last_guest_id = EXCLUDED.last_guest_id,
                    next_free_available = EXCLUDED.next_free_available,
                    updated_at = NOW()
            `, [identifier, guestId, nextFreeAvailable]);
            return true;
        } catch (error) {
            console.error('Database error recording free usage:', error);
        }
    }
    
    // In-memory fallback
    const existing = freeAccessUsage.get(identifier);
    freeAccessUsage.set(identifier, {
        lastUsed: new Date().toISOString(),
        sessionsUsed: (existing?.sessionsUsed || 0) + 1,
        guestId,
        nextFreeAvailable: nextFreeAvailable.toISOString()
    });
    return true;
}

/**
 * Send event to RouterLogger
 */
async function notifyRouterLogger(eventData) {
    try {
        console.log(`📤 Sending ${eventData.type} to RouterLogger:`, JSON.stringify(eventData, null, 2));
        await axios.post(`${ROUTERLOGGER_API_URL}/api/ironwifi/captive-portal/event`, eventData, {
            timeout: 5000,
            headers: { 'Content-Type': 'application/json' }
        });
        console.log(`✅ Sent ${eventData.type} event to RouterLogger`);
    } catch (error) {
        console.warn('Failed to notify RouterLogger:', error.message);
    }
}

/**
 * POST /api/auth/register
 * Register and grant free 30-minute access
 */
// UAM secret for CoovaChilli CHAP response calculation
const UAM_SECRET = process.env.UAM_SECRET || 'ChqPlbGB0RjyiM2c';

/**
 * Calculate CoovaChilli CHAP response
 * The response is: MD5(ident + password + challenge)
 * Where ident is 0x00 for initial login
 */
function calculateChapResponse(password, challenge) {
    // Convert hex challenge to buffer
    const challengeBuffer = Buffer.from(challenge, 'hex');
    // Create MD5 hash of: 0x00 + password + challenge
    const md5 = crypto.createHash('md5');
    md5.update(Buffer.from([0])); // ident = 0
    md5.update(password);
    md5.update(challengeBuffer);
    return md5.digest('hex');
}

/**
 * Calculate CoovaChilli CHAP password for PAP mode
 * For CoovaChilli PAP with UAM:
 * 1. Calculate nt_response = MD5(challenge (binary) + uamsecret)
 * 2. XOR the password with nt_response
 * 3. Return as hex string
 * 
 * Actually for Teltonika with UAM, simpler approach:
 * The response should be: MD5(0 + password + challenge)
 * But we're using PAP mode, so we just need username/password
 */
function calculateChilliPassword(password, challenge, uamSecret) {
    try {
        if (!challenge || challenge.length < 2) {
            console.warn('Invalid challenge:', challenge);
            return null;
        }
        
        // Convert hex challenge to bytes
        const challengeBytes = Buffer.from(challenge, 'hex');
        
        // Create the password hash: MD5(challenge + uamsecret)
        const md5 = crypto.createHash('md5');
        md5.update(challengeBytes);
        md5.update(uamSecret);
        const hashBytes = md5.digest();
        
        // XOR the password with the hash to create encrypted password
        const passwordBytes = Buffer.from(password, 'utf8');
        const encryptedBytes = Buffer.alloc(passwordBytes.length);
        
        for (let i = 0; i < passwordBytes.length; i++) {
            encryptedBytes[i] = passwordBytes[i] ^ hashBytes[i % hashBytes.length];
        }
        
        return encryptedBytes.toString('hex');
    } catch (error) {
        console.error('Error calculating Chilli password:', error);
        return null;
    }
}

/**
 * Simple CHAP response for CoovaChilli
 * response = MD5(ident + password + challenge)
 */
function calculateChapResponse(ident, password, challenge) {
    try {
        const md5 = crypto.createHash('md5');
        md5.update(Buffer.from([ident])); // ident byte
        md5.update(password);
        md5.update(Buffer.from(challenge, 'hex'));
        return md5.digest('hex');
    } catch (error) {
        console.error('Error calculating CHAP response:', error);
        return null;
    }
}

router.post('/register', async (req, res) => {
    try {
        const { 
            name, phone, email, newsletter, client_mac, router_mac, router_id, login_url, original_url,
            // CoovaChilli parameters
            chilli_challenge, chilli_uamip, chilli_uamport, chilli_login_url
        } = req.body;
        
        // Validation
        if (!name || name.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Please enter your name'
            });
        }
        
        if (!phone || phone.trim().length < 10) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid phone number'
            });
        }
        
        if (!email || !validator.isEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }
        
        // Use email as identifier for cooldown tracking
        const identifier = email.toLowerCase().trim();
        
        // Check if this email has used free access recently
        const existingUsage = await checkFreeUsage(identifier);
        if (existingUsage && existingUsage.nextFreeAvailable) {
            const cooldownEnd = new Date(existingUsage.nextFreeAvailable);
            
            if (new Date() < cooldownEnd) {
                const hoursRemaining = Math.ceil((cooldownEnd - new Date()) / (1000 * 60 * 60));
                return res.status(429).json({
                    success: false,
                    message: `You've already used your free 30 minutes today. Available again in ${hoursRemaining} hour${hoursRemaining > 1 ? 's' : ''}.`,
                    nextFreeAccess: cooldownEnd.toISOString()
                });
            }
        }
        
        // Generate a temporary guest username and password
        const guestId = `free-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const guestPassword = guestId; // Use same as username for simplicity
        const sessionId = uuidv4();
        
        // Create RADIUS user so the router can authenticate this guest
        const radiusUserCreated = await createRadiusUser(guestId, guestPassword, FREE_SESSION_DURATION);
        if (radiusUserCreated) {
            console.log(`✅ RADIUS user created for guest: ${guestId}`);
        } else {
            console.warn(`⚠️ Could not create RADIUS user, WiFi auth may fail`);
        }
        
        // Record free access usage (database or in-memory) - using email as identifier
        await recordFreeUsage(identifier, guestId);
        
        // Store session
        req.session.authenticated = true;
        req.session.username = guestId;
        req.session.sessionId = sessionId;
        req.session.macAddress = client_mac;
        req.session.authenticatedAt = new Date().toISOString();
        req.session.sessionType = 'free';
        req.session.sessionDuration = FREE_SESSION_DURATION;
        req.session.expiresAt = new Date(Date.now() + FREE_SESSION_DURATION * 1000).toISOString();
        req.session.guestName = name.trim();
        req.session.guestEmail = email.trim();
        req.session.guestPhone = phone.trim();
        req.session.newsletter = newsletter || false;
        
        // Send accounting start with 30-minute limit
        try {
            await radiusClient.accountingStart(sessionId, guestId, {
                callingStationId: client_mac,
                calledStationId: router_mac,
                sessionTimeout: FREE_SESSION_DURATION
            });
        } catch (e) {
            console.warn('Accounting start failed (non-fatal):', e.message);
        }
        
        // Notify RouterLogger
        await notifyRouterLogger({
            type: 'registration_completed',
            guest_id: guestId,
            username: email,
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim(),
            newsletter: newsletter || false,
            mac_address: client_mac,
            router_mac,
            router_id,
            session_id: sessionId,
            session_duration: FREE_SESSION_DURATION,
            timestamp: new Date().toISOString()
        });
        
        // Generate a one-time token for success page (iOS captive portal workaround)
        const successToken = crypto.randomBytes(32).toString('hex');
        if (storeSuccessToken) {
            storeSuccessToken(successToken, {
                username: guestId,
                sessionId,
                authenticatedAt: req.session.authenticatedAt,
                guestName: name.trim(),
                sessionType: 'free',
                sessionDuration: FREE_SESSION_DURATION,
                expiresAt: req.session.expiresAt
            });
        }
        
        console.log(`✅ Registration successful for ${email} (token: ${successToken.substring(0, 8)}...)`);
        console.log(`📍 Login URL from router: ${login_url || 'none'}`);
        console.log(`📍 CoovaChilli challenge: ${chilli_challenge || 'none'}`);
        console.log(`📍 CoovaChilli login URL: ${chilli_login_url || 'none'}`);
        
        // Build the router login URL
        let routerLoginUrl = null;
        
        // Check for CoovaChilli/UAM authentication (Teltonika)
        if (chilli_challenge && chilli_uamip && chilli_uamport) {
            // For CoovaChilli with PAP mode, we need to:
            // 1. Calculate encrypted password using XOR with MD5(challenge + uamsecret)
            // 2. Send as password parameter
            
            // Use the guestId as the password (we use same for username/password)
            const password = guestId;
            const encryptedPassword = calculateChilliPassword(password, chilli_challenge, UAM_SECRET);
            
            if (encryptedPassword) {
                // Build the CoovaChilli login URL with encrypted password
                // Format: http://uamip:uamport/logon?username=xxx&password=xxx
                routerLoginUrl = `http://${chilli_uamip}:${chilli_uamport}/logon?username=${encodeURIComponent(guestId)}&password=${encryptedPassword}`;
                
                console.log(`🔗 CoovaChilli login URL: ${routerLoginUrl}`);
                console.log(`   Username: ${guestId}`);
                console.log(`   Challenge: ${chilli_challenge}`);
                console.log(`   Encrypted password: ${encryptedPassword}`);
            } else {
                // Fallback: try with plain password (some configs allow this)
                console.warn('⚠️ Failed to encrypt password, trying plain password');
                routerLoginUrl = `http://${chilli_uamip}:${chilli_uamport}/logon?username=${encodeURIComponent(guestId)}&password=${encodeURIComponent(guestId)}`;
                console.log(`🔗 CoovaChilli login URL (plain): ${routerLoginUrl}`);
            }
        } else if (login_url) {
            // Fallback to regular login URL
            try {
                const url = new URL(login_url);
                url.searchParams.set('username', guestId);
                url.searchParams.set('password', guestId);
                routerLoginUrl = url.toString();
                console.log(`🔗 Router login URL: ${routerLoginUrl}`);
            } catch (e) {
                console.warn('Failed to parse login URL:', e.message);
                routerLoginUrl = `${login_url}?username=${encodeURIComponent(guestId)}&password=${encodeURIComponent(guestId)}`;
            }
        }
        
        // If we have a CoovaChilli login URL, we need to redirect there first
        // The router will then handle granting access
        if (routerLoginUrl) {
            console.log(`🔀 Redirecting client to CoovaChilli: ${routerLoginUrl}`);
            // Return the router login URL - client MUST go there to activate WiFi
            // Also include it as a fallback in the success page URL
            const successUrlWithActivation = `/success?type=free&token=${successToken}&activate=${encodeURIComponent(routerLoginUrl)}`;
            
            const responseData = {
                success: true,
                message: 'Registration successful! Activating WiFi...',
                // Tell client to go to router login first
                redirect: routerLoginUrl,
                // Also provide success page URL with activation fallback
                successUrl: successUrlWithActivation,
                routerLoginUrl: routerLoginUrl,
                sessionDuration: FREE_SESSION_DURATION
            };
            console.log(`📤 Sending response:`, JSON.stringify(responseData, null, 2));
            return res.json(responseData);
        }
        
        // No router login URL - go directly to success page
        const responseData = {
            success: true,
            message: 'Registration successful!',
            redirect: `/success?type=free&token=${successToken}`,
            routerLoginUrl: null,
            sessionDuration: FREE_SESSION_DURATION
        };
        
        console.log(`📤 Sending response:`, JSON.stringify(responseData, null, 2));
        
        res.json(responseData);
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed. Please try again.'
        });
    }
});

/**
 * POST /api/auth/free
 * Grant free 30-minute access (email required for cooldown tracking)
 */
router.post('/free', async (req, res) => {
    try {
        const { email, client_mac, router_mac, router_id } = req.body;
        
        // Email is required for tracking cooldown
        if (!email || !validator.isEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }
        
        // Use email as identifier for cooldown tracking
        const identifier = email.toLowerCase().trim();
        
        // Check if this email has used free access recently
        const existingUsage = await checkFreeUsage(identifier);
        if (existingUsage && existingUsage.nextFreeAvailable) {
            const cooldownEnd = new Date(existingUsage.nextFreeAvailable);
            
            if (new Date() < cooldownEnd) {
                const hoursRemaining = Math.ceil((cooldownEnd - new Date()) / (1000 * 60 * 60));
                return res.status(429).json({
                    success: false,
                    message: `You've already used your free 30 minutes today. Available again in ${hoursRemaining} hour${hoursRemaining > 1 ? 's' : ''}.`,
                    nextFreeAccess: cooldownEnd.toISOString()
                });
            }
        }
        
        // Generate a temporary guest username
        const guestId = `free-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const sessionId = uuidv4();
        
        // Record free access usage (database or in-memory) - using email as identifier
        await recordFreeUsage(identifier, guestId);
        
        // Store session
        req.session.authenticated = true;
        req.session.username = guestId;
        req.session.sessionId = sessionId;
        req.session.macAddress = client_mac;
        req.session.authenticatedAt = new Date().toISOString();
        req.session.sessionType = 'free';
        req.session.sessionDuration = FREE_SESSION_DURATION;
        req.session.expiresAt = new Date(Date.now() + FREE_SESSION_DURATION * 1000).toISOString();
        
        // Send accounting start with 30-minute limit
        try {
            await radiusClient.accountingStart(sessionId, guestId, {
                callingStationId: client_mac,
                calledStationId: router_mac,
                sessionTimeout: FREE_SESSION_DURATION
            });
        } catch (e) {
            console.warn('Accounting start failed (non-fatal):', e.message);
        }
        
        // Notify RouterLogger
        await notifyRouterLogger({
            type: 'free_access_granted',
            guest_id: guestId,
            username: email,
            email: email,
            mac_address: client_mac,
            router_mac,
            router_id,
            session_id: sessionId,
            session_duration: FREE_SESSION_DURATION,
            timestamp: new Date().toISOString()
        });
        
        console.log(`🆓 Free access granted to ${email} (session: ${sessionId})`);
        
        return res.json({
            success: true,
            message: 'Free access granted! You have 30 minutes.',
            sessionId,
            sessionDuration: FREE_SESSION_DURATION,
            expiresAt: req.session.expiresAt,
            redirect: '/success?type=free'
        });
    } catch (error) {
        console.error('Free access error:', error);
        return res.status(500).json({
            success: false,
            error: 'Unable to grant free access'
        });
    }
});

/**
 * POST /api/auth/email/request
 * Request verification code via email
 */
router.post('/email/request', async (req, res) => {
    try {
        const { email, name, client_mac, router_mac, router_id } = req.body;

        if (!email || !validator.isEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Valid email address is required'
            });
        }

        // Generate 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_MS);
        
        // Store code with expiry and additional info (database or in-memory)
        await storeVerificationCode(email, 'email', code, expiresAt, {
            name,
            client_mac,
            router_mac,
            router_id
        });

        // In production, send email via nodemailer/SendGrid/etc
        console.log(`📧 Verification code for ${email}: ${code}`);
        
        // TODO: Send actual email
        // await sendVerificationEmail(email, code);

        return res.json({
            success: true,
            message: 'Verification code sent to your email',
            expiresIn: VERIFICATION_EXPIRY_MS / 1000
        });
    } catch (error) {
        console.error('Email request error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to send verification code'
        });
    }
});

/**
 * POST /api/auth/email/verify
 * Verify email code and authenticate
 */
router.post('/email/verify', async (req, res) => {
    try {
        const { email, code, client_mac, router_mac, router_id } = req.body;

        if (!email || !code) {
            return res.status(400).json({
                success: false,
                message: 'Email and code are required'
            });
        }

        const stored = await getVerificationCode(email);

        if (!stored) {
            return res.status(400).json({
                success: false,
                message: 'No verification code found. Please request a new one.'
            });
        }

        if (Date.now() > stored.expires) {
            await markVerificationCodeUsed(email, stored.id);
            return res.status(400).json({
                success: false,
                message: 'Verification code expired. Please request a new one.'
            });
        }

        await incrementVerificationAttempts(email, stored.id);
        if (stored.attempts >= 5) {
            await markVerificationCodeUsed(email, stored.id);
            return res.status(429).json({
                success: false,
                message: 'Too many attempts. Please request a new code.'
            });
        }

        if (stored.code !== code) {
            return res.status(400).json({
                success: false,
                message: 'Invalid verification code'
            });
        }

        // Code verified - clean up
        await markVerificationCodeUsed(email, stored.id);

        // Generate session
        const sessionId = uuidv4();
        const sessionDuration = 86400; // 24 hours for email-verified users

        // Store session
        req.session.authenticated = true;
        req.session.username = email;
        req.session.sessionId = sessionId;
        req.session.macAddress = client_mac || stored.client_mac;
        req.session.guestName = stored.name;
        req.session.authenticatedAt = new Date().toISOString();
        req.session.sessionType = 'email';
        req.session.sessionDuration = sessionDuration;

        // Send accounting start
        try {
            await radiusClient.accountingStart(sessionId, email, {
                callingStationId: client_mac || stored.client_mac,
                calledStationId: router_mac || stored.router_mac,
                sessionTimeout: sessionDuration
            });
        } catch (e) {
            console.warn('Accounting start failed (non-fatal):', e.message);
        }

        // Notify RouterLogger
        await notifyRouterLogger({
            type: 'guest_registration',
            username: email,
            email,
            name: stored.name,
            mac_address: client_mac || stored.client_mac,
            router_mac: router_mac || stored.router_mac,
            router_id: router_id || stored.router_id,
            session_id: sessionId,
            session_duration: sessionDuration,
            timestamp: new Date().toISOString()
        });

        console.log(`✅ Email verified for ${email} (session: ${sessionId})`);

        return res.json({
            success: true,
            message: 'Verification successful. You are now connected.',
            sessionId,
            sessionDuration,
            redirect: '/success'
        });
    } catch (error) {
        console.error('Email verify error:', error);
        return res.status(500).json({
            success: false,
            message: 'Verification failed'
        });
    }
});

/**
 * POST /api/auth/login
 * Authenticate with username/password
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password, mac_address, router_mac } = req.body;

        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username and password are required' 
            });
        }

        const result = await radiusClient.authenticate(username, password, {
            callingStationId: mac_address,
            calledStationId: router_mac
        });

        if (result.success) {
            // Generate session ID
            const sessionId = uuidv4();
            
            // Store session
            req.session.authenticated = true;
            req.session.username = username;
            req.session.sessionId = sessionId;
            req.session.macAddress = mac_address;
            req.session.authenticatedAt = new Date().toISOString();

            // Send accounting start
            await radiusClient.accountingStart(sessionId, username, {
                callingStationId: mac_address,
                calledStationId: router_mac
            });

            // Notify RouterLogger
            try {
                await axios.post(`${ROUTERLOGGER_API_URL}/api/ironwifi/webhook`, {
                    type: 'guest_login',
                    username,
                    mac_address,
                    router_mac,
                    session_id: sessionId,
                    timestamp: new Date().toISOString()
                });
            } catch (e) {
                console.warn('Failed to notify RouterLogger:', e.message);
            }

            return res.json({
                success: true,
                message: result.message,
                session_id: sessionId,
                session_timeout: result.sessionTimeout || 86400
            });
        }

        return res.status(401).json({
            success: false,
            error: result.message
        });
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({
            success: false,
            error: 'Authentication service unavailable'
        });
    }
});

/**
 * POST /api/auth/request-code
 * Request verification code via email or SMS
 */
router.post('/request-code', async (req, res) => {
    try {
        const { email, phone, method } = req.body;

        if (method === 'email') {
            if (!email || !validator.isEmail(email)) {
                return res.status(400).json({
                    success: false,
                    error: 'Valid email address is required'
                });
            }

            // Generate 6-digit code
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            
            // Store code with expiry
            verificationCodes.set(email, {
                code,
                expires: Date.now() + VERIFICATION_EXPIRY_MS,
                attempts: 0
            });

            // In production, send email via nodemailer
            console.log(`📧 Verification code for ${email}: ${code}`);
            
            // TODO: Send actual email
            // await sendVerificationEmail(email, code);

            return res.json({
                success: true,
                message: 'Verification code sent to your email',
                expires_in: VERIFICATION_EXPIRY_MS / 1000
            });
        } else if (method === 'sms') {
            if (!phone) {
                return res.status(400).json({
                    success: false,
                    error: 'Phone number is required'
                });
            }

            // Generate 6-digit code
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            
            // Store code with expiry
            verificationCodes.set(phone, {
                code,
                expires: Date.now() + VERIFICATION_EXPIRY_MS,
                attempts: 0
            });

            // In production, send SMS via Twilio
            console.log(`📱 Verification code for ${phone}: ${code}`);
            
            // TODO: Send actual SMS
            // await sendVerificationSMS(phone, code);

            return res.json({
                success: true,
                message: 'Verification code sent to your phone',
                expires_in: VERIFICATION_EXPIRY_MS / 1000
            });
        }

        return res.status(400).json({
            success: false,
            error: 'Invalid verification method'
        });
    } catch (error) {
        console.error('Request code error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to send verification code'
        });
    }
});

/**
 * POST /api/auth/verify-code
 * Verify code and authenticate
 */
router.post('/verify-code', async (req, res) => {
    try {
        const { email, phone, code, mac_address, router_mac, name } = req.body;
        const identifier = email || phone;

        if (!identifier || !code) {
            return res.status(400).json({
                success: false,
                error: 'Email/phone and code are required'
            });
        }

        const stored = verificationCodes.get(identifier);

        if (!stored) {
            return res.status(400).json({
                success: false,
                error: 'No verification code found. Please request a new one.'
            });
        }

        if (Date.now() > stored.expires) {
            verificationCodes.delete(identifier);
            return res.status(400).json({
                success: false,
                error: 'Verification code expired. Please request a new one.'
            });
        }

        stored.attempts++;
        if (stored.attempts > 5) {
            verificationCodes.delete(identifier);
            return res.status(429).json({
                success: false,
                error: 'Too many attempts. Please request a new code.'
            });
        }

        if (stored.code !== code) {
            return res.status(400).json({
                success: false,
                error: 'Invalid verification code'
            });
        }

        // Code verified - clean up
        verificationCodes.delete(identifier);

        // Create guest user in RADIUS (or verify existing)
        const username = identifier;
        const password = uuidv4().slice(0, 12); // Temporary password

        // Generate session
        const sessionId = uuidv4();

        // Store session
        req.session.authenticated = true;
        req.session.username = username;
        req.session.sessionId = sessionId;
        req.session.macAddress = mac_address;
        req.session.guestName = name;
        req.session.authenticatedAt = new Date().toISOString();

        // Send accounting start
        await radiusClient.accountingStart(sessionId, username, {
            callingStationId: mac_address,
            calledStationId: router_mac
        });

        // Notify RouterLogger
        try {
            await axios.post(`${ROUTERLOGGER_API_URL}/api/ironwifi/webhook`, {
                type: 'guest_registration',
                username,
                email,
                phone,
                name,
                mac_address,
                router_mac,
                session_id: sessionId,
                timestamp: new Date().toISOString()
            });
        } catch (e) {
            console.warn('Failed to notify RouterLogger:', e.message);
        }

        return res.json({
            success: true,
            message: 'Verification successful. You are now connected.',
            session_id: sessionId,
            session_timeout: 86400 // 24 hours
        });
    } catch (error) {
        console.error('Verify code error:', error);
        return res.status(500).json({
            success: false,
            error: 'Verification failed'
        });
    }
});

/**
 * POST /api/auth/voucher
 * Authenticate with voucher code
 */
router.post('/voucher', async (req, res) => {
    try {
        const { voucher_code, mac_address, router_mac, name } = req.body;

        if (!voucher_code) {
            return res.status(400).json({
                success: false,
                error: 'Voucher code is required'
            });
        }

        // Authenticate voucher as username with same as password
        const result = await radiusClient.authenticate(voucher_code.toUpperCase(), voucher_code.toUpperCase(), {
            callingStationId: mac_address,
            calledStationId: router_mac
        });

        if (result.success) {
            const sessionId = uuidv4();

            req.session.authenticated = true;
            req.session.username = `voucher:${voucher_code}`;
            req.session.sessionId = sessionId;
            req.session.macAddress = mac_address;
            req.session.guestName = name;
            req.session.authenticatedAt = new Date().toISOString();

            await radiusClient.accountingStart(sessionId, voucher_code, {
                callingStationId: mac_address,
                calledStationId: router_mac
            });

            // Notify RouterLogger
            try {
                await axios.post(`${ROUTERLOGGER_API_URL}/api/ironwifi/webhook`, {
                    type: 'voucher_redemption',
                    voucher_code,
                    name,
                    mac_address,
                    router_mac,
                    session_id: sessionId,
                    timestamp: new Date().toISOString()
                });
            } catch (e) {
                console.warn('Failed to notify RouterLogger:', e.message);
            }

            return res.json({
                success: true,
                message: 'Voucher accepted. You are now connected.',
                session_id: sessionId,
                session_timeout: result.sessionTimeout || 86400
            });
        }

        return res.status(401).json({
            success: false,
            error: 'Invalid or expired voucher code'
        });
    } catch (error) {
        console.error('Voucher auth error:', error);
        return res.status(500).json({
            success: false,
            error: 'Voucher validation failed'
        });
    }
});

/**
 * POST /api/auth/logout
 * End session
 */
router.post('/logout', async (req, res) => {
    try {
        if (req.session.authenticated && req.session.sessionId) {
            // Send accounting stop
            await radiusClient.accountingStop(
                req.session.sessionId,
                req.session.username,
                {
                    callingStationId: req.session.macAddress,
                    terminateCause: 'User-Request'
                }
            );

            // Notify RouterLogger
            try {
                await axios.post(`${ROUTERLOGGER_API_URL}/api/ironwifi/webhook`, {
                    type: 'guest_logout',
                    username: req.session.username,
                    session_id: req.session.sessionId,
                    mac_address: req.session.macAddress,
                    timestamp: new Date().toISOString()
                });
            } catch (e) {
                console.warn('Failed to notify RouterLogger:', e.message);
            }
        }

        req.session.destroy();
        
        return res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('Logout error:', error);
        return res.status(500).json({
            success: false,
            error: 'Logout failed'
        });
    }
});

/**
 * GET /api/auth/status
 * Check authentication status
 */
router.get('/status', (req, res) => {
    if (req.session.authenticated) {
        return res.json({
            authenticated: true,
            username: req.session.username,
            session_id: req.session.sessionId,
            authenticated_at: req.session.authenticatedAt
        });
    }

    return res.json({
        authenticated: false
    });
});

module.exports = router;

