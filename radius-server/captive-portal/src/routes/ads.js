/**
 * Ad Tracking Routes
 * 
 * Tracks impressions and clicks for captive portal ads
 */

const express = require('express');
const router = express.Router();

// Database connection (if using shared Railway database)
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
 * POST /api/ads/impression
 * Track ad impression
 */
router.post('/impression', async (req, res) => {
    try {
        const { adId, position, page } = req.body;
        
        if (!adId) {
            return res.status(400).json({ success: false, error: 'adId required' });
        }

        if (USE_DATABASE && dbPool) {
            await dbPool.query(`
                INSERT INTO captive_ad_impressions 
                (ad_id, ad_position, page, client_ip, user_agent, session_id)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                adId,
                position || 'unknown',
                page || 'unknown',
                req.ip,
                req.headers['user-agent'],
                req.session?.sessionId
            ]);

            // Update impression count on ad
            await dbPool.query(`
                UPDATE captive_ads SET impressions = impressions + 1 WHERE ad_id = $1
            `, [adId]);
        }

        console.log(`👁️ Ad impression: ${adId} on ${page}/${position}`);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Ad impression error:', error);
        res.status(500).json({ success: false });
    }
});

/**
 * POST /api/ads/click
 * Track ad click
 */
router.post('/click', async (req, res) => {
    try {
        const { adId, position, page } = req.body;
        
        if (!adId) {
            return res.status(400).json({ success: false, error: 'adId required' });
        }

        if (USE_DATABASE && dbPool) {
            await dbPool.query(`
                INSERT INTO captive_ad_clicks 
                (ad_id, ad_position, page, client_ip, user_agent, session_id)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                adId,
                position || 'unknown',
                page || 'unknown',
                req.ip,
                req.headers['user-agent'],
                req.session?.sessionId
            ]);

            // Update click count on ad
            await dbPool.query(`
                UPDATE captive_ads SET clicks = clicks + 1 WHERE ad_id = $1
            `, [adId]);
        }

        console.log(`🖱️ Ad click: ${adId} on ${page}/${position}`);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Ad click error:', error);
        res.status(500).json({ success: false });
    }
});

/**
 * GET /api/ads/active
 * Get active ads for a specific page/position
 */
router.get('/active', async (req, res) => {
    try {
        const { page, position, routerId } = req.query;

        if (!USE_DATABASE || !dbPool) {
            // Return sample ad if no database
            return res.json({
                success: true,
                ads: getSampleAds(page, position)
            });
        }

        const result = await dbPool.query(`
            SELECT * FROM captive_ads
            WHERE is_active = TRUE
              AND (start_date IS NULL OR start_date <= NOW())
              AND (end_date IS NULL OR end_date >= NOW())
              AND ($1 = ANY(pages) OR pages IS NULL OR array_length(pages, 1) IS NULL)
              AND ($2 = ANY(positions) OR positions IS NULL OR array_length(positions, 1) IS NULL)
              AND ($3 = ANY(router_ids) OR router_ids IS NULL OR array_length(router_ids, 1) IS NULL)
            ORDER BY priority DESC
            LIMIT 5
        `, [page, position, routerId]);

        const ads = result.rows.map(row => ({
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
        }));

        res.json({ success: true, ads });
    } catch (error) {
        console.error('Get active ads error:', error);
        res.json({ success: true, ads: getSampleAds(req.query.page, req.query.position) });
    }
});

/**
 * Get sample ads when database is not available
 */
function getSampleAds(page, position) {
    // Return empty or sample ads based on configuration
    if (process.env.SHOW_SAMPLE_ADS !== 'true') {
        return [];
    }

    return [{
        id: 'sample-promo-1',
        type: 'promo',
        title: 'Special Offer!',
        description: 'Get 20% off your first order with code WIFI20',
        cta: 'Shop Now',
        link: 'https://example.com/offer'
    }];
}

module.exports = router;

