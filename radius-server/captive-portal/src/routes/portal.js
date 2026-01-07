/**
 * Portal Routes
 * 
 * Serves the captive portal pages
 */

const express = require('express');
const router = express.Router();

// Database connection for ads (if using shared Railway database)
let dbPool = null;
const USE_DATABASE = process.env.USE_DATABASE === 'true';

if (USE_DATABASE) {
    const { Pool } = require('pg');
    dbPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
}

/**
 * Get active ads for a page/position
 */
async function getAdsForPage(page, routerId = null) {
    const ads = {
        topBanner: null,
        inCard: null,
        bottomBanner: null,
        squareGif: null
    };

    if (!USE_DATABASE || !dbPool) {
        // Return sample ads if configured
        if (process.env.SHOW_SAMPLE_ADS === 'true') {
            ads.inCard = {
                id: 'sample-promo-1',
                type: 'promo',
                title: 'Special Offer!',
                description: 'Get 20% off your first order with code WIFI20',
                cta: 'Shop Now',
                link: 'https://example.com/offer'
            };
        }
        return ads;
    }

    try {
        const result = await dbPool.query(`
            SELECT * FROM captive_ads
            WHERE is_active = TRUE
              AND (start_date IS NULL OR start_date <= NOW())
              AND (end_date IS NULL OR end_date >= NOW())
              AND ($1 = ANY(pages) OR pages IS NULL OR array_length(pages, 1) IS NULL)
              AND ($2 = ANY(router_ids) OR router_ids IS NULL OR array_length(router_ids, 1) IS NULL)
            ORDER BY priority DESC
        `, [page, routerId]);

        for (const row of result.rows) {
            const ad = {
                id: row.ad_id,
                type: row.ad_type,
                image: row.image_url,
                link: row.link_url,
                alt: row.alt_text,
                html: row.html_content,
                icon: row.promo_icon_url,
                title: row.promo_title,
                description: row.promo_description,
                cta: row.promo_cta
            };

            // Assign to first matching position
            if (row.positions?.includes('top-banner') && !ads.topBanner) {
                ads.topBanner = ad;
            } else if (row.positions?.includes('in-card') && !ads.inCard) {
                ads.inCard = ad;
            } else if (row.positions?.includes('bottom-banner') && !ads.bottomBanner) {
                ads.bottomBanner = ad;
            } else if (row.positions?.includes('success-square') && !ads.squareGif) {
                ads.squareGif = ad;
            }
        }
    } catch (error) {
        console.error('Error fetching ads:', error);
    }

    return ads;
}

/**
 * GET /
 * Main captive portal landing page
 */
router.get('/', async (req, res) => {
    // Check if already authenticated
    if (req.session.authenticated) {
        return res.redirect('/success');
    }

    // Extract query params that routers might send
    // Teltonika/CoovaChilli sends: challenge, uamip, uamport, mac, etc.
    const {
        mac,              // Client MAC address
        ip,               // Client IP
        ap_mac,           // Access point MAC
        ap_name,          // Access point name
        ssid,             // Network SSID
        url,              // Original URL the user was trying to access
        login_url,        // URL to redirect after login (generic)
        logout_url,       // URL for logout
        router_id,        // RouterLogger router ID
        // Teltonika-specific parameters
        'link-login': linkLogin,       // Teltonika login URL
        'link-orig': linkOrig,         // Original URL user tried to access
        'link-login-only': linkLoginOnly, // Login URL without orig redirect
        error,            // Error message from router
        // CoovaChilli/UAM parameters
        challenge,        // CHAP challenge from CoovaChilli
        uamip,            // UAM server IP (router IP)
        uamport,          // UAM port (usually 3990)
        called,           // Called-Station-Id (AP MAC)
        nasid,            // NAS Identifier
        userurl,          // Original URL user was trying to access
        md               // Message digest (optional)
    } = req.query;
    
    // Log all query params for debugging
    console.log('📥 Portal request params:', JSON.stringify(req.query, null, 2));
    
    // Build the CoovaChilli login URL if we have the required params
    let chilliLoginUrl = null;
    if (uamip && uamport) {
        chilliLoginUrl = `http://${uamip}:${uamport}/logon`;
        console.log('🔗 CoovaChilli login URL:', chilliLoginUrl);
    }

    // Fetch active ads for this page
    const ads = await getAdsForPage('portal', router_id);

    res.render('portal', {
        title: 'Guest WiFi Login',
        clientMac: mac || called,
        clientIp: ip,
        apMac: ap_mac || called,
        apName: ap_name,
        ssid: ssid || 'Guest WiFi',
        originalUrl: url || linkOrig || userurl,
        routerId: router_id || nasid,
        // Router login URL for post-auth redirect
        loginUrl: login_url || linkLogin || linkLoginOnly,
        // CoovaChilli/UAM parameters
        challenge: challenge || '',
        uamip: uamip || '',
        uamport: uamport || '',
        chilliLoginUrl: chilliLoginUrl || '',
        // Feature flags - simplified: only free access with email
        enableEmail: false,
        enableSms: false,
        enableVoucher: false,
        enableSocial: false,
        enableFreeAccess: true, // Always enabled
        // Error from router
        routerError: error,
        // Ads
        ads
    });
});

// In-memory token store for success page access (iOS captive portal workaround)
const successTokens = new Map();

/**
 * Store a success token (called after successful auth)
 */
function storeSuccessToken(token, sessionData) {
    successTokens.set(token, {
        ...sessionData,
        createdAt: Date.now()
    });
    // Clean up old tokens (older than 5 minutes)
    for (const [key, value] of successTokens.entries()) {
        if (Date.now() - value.createdAt > 5 * 60 * 1000) {
            successTokens.delete(key);
        }
    }
}

// Export for use in auth routes
router.storeSuccessToken = storeSuccessToken;

/**
 * GET /success
 * Success page after authentication
 */
router.get('/success', async (req, res) => {
    let sessionData = null;
    
    // First, check for token in URL (iOS captive portal workaround)
    if (req.query.token) {
        sessionData = successTokens.get(req.query.token);
        if (sessionData) {
            // Token found - delete it (one-time use)
            successTokens.delete(req.query.token);
            // Also store in session for future requests
            req.session.authenticated = true;
            req.session.username = sessionData.username;
            req.session.sessionId = sessionData.sessionId;
            req.session.authenticatedAt = sessionData.authenticatedAt;
            req.session.guestName = sessionData.guestName;
            req.session.sessionType = sessionData.sessionType;
            req.session.sessionDuration = sessionData.sessionDuration;
            req.session.expiresAt = sessionData.expiresAt;
        }
    }
    
    // Fall back to session if no valid token
    if (!sessionData && req.session.authenticated) {
        sessionData = {
            username: req.session.username,
            sessionId: req.session.sessionId,
            authenticatedAt: req.session.authenticatedAt,
            guestName: req.session.guestName,
            sessionType: req.session.sessionType,
            sessionDuration: req.session.sessionDuration,
            expiresAt: req.session.expiresAt
        };
    }
    
    // If still no auth, redirect to portal
    if (!sessionData) {
        return res.redirect('/');
    }

    const isFreeSession = sessionData.sessionType === 'free' || req.query.type === 'free';
    const sessionDuration = sessionData.sessionDuration || (isFreeSession ? 1800 : 86400);

    // Fetch active ads for success page (including square GIF ad)
    const ads = await getAdsForPage('success', req.query.router_id);

    res.render('success', {
        title: 'Connected!',
        username: sessionData.username,
        sessionId: sessionData.sessionId,
        authenticatedAt: sessionData.authenticatedAt,
        guestName: sessionData.guestName,
        // Session type info
        isFreeSession,
        sessionDuration,
        expiresAt: sessionData.expiresAt || new Date(Date.now() + sessionDuration * 1000).toISOString(),
        // Ads
        ads
    });
});

/**
 * GET /terms
 * Terms and conditions page
 */
router.get('/terms', (req, res) => {
    res.render('terms', {
        title: 'Terms of Service',
        companyName: process.env.COMPANY_NAME || 'RouterLogger'
    });
});

/**
 * GET /usage
 * Data usage dashboard
 */
router.get('/usage', async (req, res) => {
    const { mac } = req.query;
    
    // Get session from query params or session
    const macAddress = mac || req.session?.macAddress;
    
    if (!macAddress) {
        return res.render('usage', {
            title: 'Data Usage',
            companyName: process.env.COMPANY_NAME || 'VacatAd',
            session: null
        });
    }
    
    try {
        // Query accounting data from RADIUS (if available)
        // For now, show session data from session storage
        const dataLimit = 500; // MB
        const sessionDuration = req.session?.sessionDuration || 86400;
        const authenticatedAt = new Date(req.session?.authenticatedAt || Date.now());
        const now = new Date();
        const elapsedSeconds = Math.floor((now - authenticatedAt) / 1000);
        const remainingSeconds = Math.max(0, sessionDuration - elapsedSeconds);
        
        // Mock data for now - in production, query from RADIUS accounting
        const downloadBytes = 50 * 1024 * 1024; // Example: 50 MB
        const uploadBytes = 10 * 1024 * 1024;   // Example: 10 MB
        const totalBytes = downloadBytes + uploadBytes;
        
        const downloadMB = (downloadBytes / 1024 / 1024).toFixed(1);
        const uploadMB = (uploadBytes / 1024 / 1024).toFixed(1);
        const usedMB = (totalBytes / 1024 / 1024).toFixed(1);
        const remainingMB = Math.max(0, dataLimit - parseFloat(usedMB)).toFixed(1);
        const usagePercent = Math.min(100, (parseFloat(usedMB) / dataLimit) * 100);
        
        const formatDuration = (seconds) => {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            if (hours > 0) return `${hours}h ${minutes}m`;
            return `${minutes}m`;
        };
        
        res.render('usage', {
            title: 'Data Usage',
            companyName: process.env.COMPANY_NAME || 'VacatAd',
            session: true,
            usedMB,
            limitMB: dataLimit,
            remainingMB,
            usagePercent: usagePercent.toFixed(1),
            downloadMB,
            uploadMB,
            sessionDuration: formatDuration(elapsedSeconds),
            remainingTime: formatDuration(remainingSeconds),
            macAddress
        });
    } catch (error) {
        console.error('Error fetching usage data:', error);
        res.render('usage', {
            title: 'Data Usage',
            companyName: process.env.COMPANY_NAME || 'VacatAd',
            session: null
        });
    }
});

/**
 * GET /privacy
 * Privacy policy page
 */
router.get('/privacy', (req, res) => {
    res.render('privacy', {
        title: 'Privacy Policy',
        companyName: process.env.COMPANY_NAME || 'RouterLogger'
    });
});

/**
 * GET /contact
 * Contact information page
 */
router.get('/contact', (req, res) => {
    res.render('terms', {
        title: 'Contact Information',
        companyName: process.env.COMPANY_NAME || 'VacatAd',
        content: `
            <h2>Contact Us</h2>
            <p>Need help or want to learn more about our advertisers?</p>
            <p>For support with VacatAd Wi-Fi, please contact us at:</p>
            <p><strong>Email:</strong> support@vacatad.com</p>
            <p><strong>Phone:</strong> +44 333 090 3594</p>
            <p>For advertising inquiries, please reach out to our advertising team.</p>
        `
    });
});

module.exports = router;

