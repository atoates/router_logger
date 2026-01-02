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
    // Teltonika sends: mac, ip, link-login, link-orig, error, etc.
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
        error             // Error message from router
    } = req.query;
    
    // Log all query params for debugging
    console.log('📥 Portal request params:', JSON.stringify(req.query, null, 2));

    // Fetch active ads for this page
    const ads = await getAdsForPage('portal', router_id);

    res.render('portal', {
        title: 'Guest WiFi Login',
        clientMac: mac,
        clientIp: ip,
        apMac: ap_mac,
        apName: ap_name,
        ssid: ssid || 'Guest WiFi',
        originalUrl: url || linkOrig,
        routerId: router_id,
        // Router login URL for post-auth redirect
        loginUrl: login_url || linkLogin || linkLoginOnly,
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

