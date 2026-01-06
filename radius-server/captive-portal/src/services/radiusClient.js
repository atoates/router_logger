/**
 * RADIUS Client Service
 * 
 * Handles communication with FreeRADIUS server for:
 * - User authentication
 * - Session management
 * - Connection testing
 */

const radius = require('radius');
const dgram = require('dgram');

const RADIUS_HOST = process.env.RADIUS_HOST || 'localhost';
const RADIUS_AUTH_PORT = parseInt(process.env.RADIUS_AUTH_PORT || '1812', 10);
const RADIUS_ACCT_PORT = parseInt(process.env.RADIUS_ACCT_PORT || '1813', 10);
const RADIUS_SECRET = process.env.RADIUS_SECRET || 'testing123';
const TIMEOUT_MS = 5000;

/**
 * Send a RADIUS packet and wait for response
 */
async function sendPacket(packet, port) {
    return new Promise((resolve, reject) => {
        const client = dgram.createSocket('udp4');
        let closed = false;
        
        const safeClose = () => {
            if (!closed) {
                closed = true;
                try { client.close(); } catch (e) { /* ignore */ }
            }
        };
        
        const timeout = setTimeout(() => {
            safeClose();
            reject(new Error('RADIUS request timed out'));
        }, TIMEOUT_MS);

        client.on('message', (msg) => {
            clearTimeout(timeout);
            try {
                const response = radius.decode({
                    packet: msg,
                    secret: RADIUS_SECRET
                });
                safeClose();
                resolve(response);
            } catch (error) {
                safeClose();
                reject(error);
            }
        });

        client.on('error', (err) => {
            clearTimeout(timeout);
            safeClose();
            reject(err);
        });

        const encoded = radius.encode(packet);
        client.send(encoded, 0, encoded.length, port, RADIUS_HOST);
    });
}

/**
 * Authenticate a user against RADIUS
 * 
 * @param {string} username - Username or email
 * @param {string} password - User password
 * @param {object} options - Additional options
 * @param {string} options.nasIp - NAS IP address (router IP)
 * @param {string} options.nasId - NAS identifier
 * @param {string} options.callingStationId - Client MAC address
 * @param {string} options.calledStationId - AP MAC address
 * @returns {Promise<{success: boolean, message: string, attributes?: object}>}
 */
async function authenticate(username, password, options = {}) {
    const packet = {
        code: 'Access-Request',
        secret: RADIUS_SECRET,
        identifier: Math.floor(Math.random() * 256),
        attributes: [
            ['User-Name', username],
            ['User-Password', password],
            ['NAS-IP-Address', options.nasIp || '127.0.0.1'],
            ['NAS-Identifier', options.nasId || 'captive-portal'],
            ['NAS-Port-Type', 'Wireless-802.11'],
            ['Service-Type', 'Login-User']
        ]
    };

    // Add optional attributes
    if (options.callingStationId) {
        packet.attributes.push(['Calling-Station-Id', options.callingStationId]);
    }
    if (options.calledStationId) {
        packet.attributes.push(['Called-Station-Id', options.calledStationId]);
    }
    if (options.framedIp) {
        packet.attributes.push(['Framed-IP-Address', options.framedIp]);
    }

    try {
        const response = await sendPacket(packet, RADIUS_AUTH_PORT);
        
        if (response.code === 'Access-Accept') {
            // Extract reply attributes
            const attributes = {};
            for (const attr of response.attributes) {
                const [name, value] = attr;
                attributes[name] = value;
            }
            
            return {
                success: true,
                message: attributes['Reply-Message'] || 'Authentication successful',
                attributes,
                sessionTimeout: attributes['Session-Timeout'],
                idleTimeout: attributes['Idle-Timeout']
            };
        } else if (response.code === 'Access-Reject') {
            const replyMessage = response.attributes.find(a => a[0] === 'Reply-Message');
            return {
                success: false,
                message: replyMessage ? replyMessage[1] : 'Authentication failed'
            };
        } else if (response.code === 'Access-Challenge') {
            return {
                success: false,
                message: 'Additional authentication required',
                challenge: true
            };
        }
        
        return {
            success: false,
            message: `Unexpected response: ${response.code}`
        };
    } catch (error) {
        console.error('RADIUS authentication error:', error);
        return {
            success: false,
            message: error.message
        };
    }
}

/**
 * Send accounting start packet
 */
async function accountingStart(sessionId, username, options = {}) {
    const packet = {
        code: 'Accounting-Request',
        secret: RADIUS_SECRET,
        identifier: Math.floor(Math.random() * 256),
        attributes: [
            ['Acct-Status-Type', 'Start'],
            ['Acct-Session-Id', sessionId],
            ['User-Name', username],
            ['NAS-IP-Address', options.nasIp || '127.0.0.1'],
            ['NAS-Identifier', options.nasId || 'captive-portal'],
            ['NAS-Port-Type', 'Wireless-802.11'],
            ['Acct-Authentic', 'RADIUS'],
            ['Event-Timestamp', new Date()]
        ]
    };

    if (options.callingStationId) {
        packet.attributes.push(['Calling-Station-Id', options.callingStationId]);
    }
    if (options.calledStationId) {
        packet.attributes.push(['Called-Station-Id', options.calledStationId]);
    }
    if (options.framedIp) {
        packet.attributes.push(['Framed-IP-Address', options.framedIp]);
    }

    try {
        const response = await sendPacket(packet, RADIUS_ACCT_PORT);
        return { success: response.code === 'Accounting-Response' };
    } catch (error) {
        console.error('Accounting start error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Send accounting stop packet
 */
async function accountingStop(sessionId, username, options = {}) {
    const packet = {
        code: 'Accounting-Request',
        secret: RADIUS_SECRET,
        identifier: Math.floor(Math.random() * 256),
        attributes: [
            ['Acct-Status-Type', 'Stop'],
            ['Acct-Session-Id', sessionId],
            ['User-Name', username],
            ['NAS-IP-Address', options.nasIp || '127.0.0.1'],
            ['NAS-Identifier', options.nasId || 'captive-portal'],
            ['Acct-Session-Time', options.sessionTime || 0],
            ['Acct-Input-Octets', options.inputOctets || 0],
            ['Acct-Output-Octets', options.outputOctets || 0],
            ['Acct-Terminate-Cause', options.terminateCause || 'User-Request'],
            ['Event-Timestamp', new Date()]
        ]
    };

    if (options.callingStationId) {
        packet.attributes.push(['Calling-Station-Id', options.callingStationId]);
    }
    if (options.calledStationId) {
        packet.attributes.push(['Called-Station-Id', options.calledStationId]);
    }

    try {
        const response = await sendPacket(packet, RADIUS_ACCT_PORT);
        return { success: response.code === 'Accounting-Response' };
    } catch (error) {
        console.error('Accounting stop error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Test RADIUS server connection
 */
async function testConnection() {
    try {
        // Try to authenticate with a known test user
        const result = await authenticate('__test__', '__test__', {
            nasId: 'connection-test'
        });
        
        // Even a rejection means the server is responding
        return {
            connected: true,
            host: RADIUS_HOST,
            port: RADIUS_AUTH_PORT,
            message: 'RADIUS server is responding'
        };
    } catch (error) {
        return {
            connected: false,
            host: RADIUS_HOST,
            port: RADIUS_AUTH_PORT,
            error: error.message
        };
    }
}

module.exports = {
    authenticate,
    accountingStart,
    accountingStop,
    testConnection
};

