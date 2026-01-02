/**
 * RouterLogger Captive Portal Server
 * 
 * Provides guest WiFi authentication with:
 * - Email/SMS verification
 * - Social login (optional)
 * - Voucher codes
 * - RADIUS integration
 */

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const radiusClient = require('./services/radiusClient');
const authRoutes = require('./routes/auth');
const portalRoutes = require('./routes/portal');
const adsRoutes = require('./routes/ads');

const app = express();
const PORT = process.env.PORT || 3000;

// ===========================================
// Security Middleware
// ===========================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            scriptSrc: ["'self'", "'unsafe-inline'"]
        }
    }
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // 10 auth attempts per 15 minutes
    message: { error: 'Too many authentication attempts. Please wait 15 minutes.' }
});
app.use('/api/auth/', authLimiter);

// ===========================================
// Session Configuration
// ===========================================
app.use(session({
    secret: process.env.SESSION_SECRET || 'change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// ===========================================
// Body Parsing
// ===========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===========================================
// View Engine
// ===========================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ===========================================
// Routes
// ===========================================

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Captive portal detection endpoints
// These are checked by devices to detect captive portals
app.get('/generate_204', (req, res) => res.status(204).send());
app.get('/gen_204', (req, res) => res.status(204).send());
app.get('/hotspot-detect.html', (req, res) => res.send('Success'));
app.get('/library/test/success.html', (req, res) => res.send('Success'));
app.get('/success.txt', (req, res) => res.send('success'));
app.get('/ncsi.txt', (req, res) => res.send('Microsoft NCSI'));
app.get('/connecttest.txt', (req, res) => res.send('Microsoft Connect Test'));

// Main portal routes
app.use('/', portalRoutes);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/ads', adsRoutes);

// RADIUS status endpoint
app.get('/api/radius/status', async (req, res) => {
    try {
        const status = await radiusClient.testConnection();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// Error Handling
// ===========================================
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : err.message
    });
});

// 404 handler
app.use((req, res) => {
    if (req.accepts('html')) {
        res.status(404).render('error', { 
            title: 'Page Not Found',
            message: 'The requested page could not be found.'
        });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// ===========================================
// Start Server
// ===========================================
app.listen(PORT, () => {
    console.log(`🌐 Captive Portal running on port ${PORT}`);
    console.log(`📡 RADIUS Server: ${process.env.RADIUS_HOST || 'localhost'}:${process.env.RADIUS_AUTH_PORT || 1812}`);
    console.log(`🔗 RouterLogger API: ${process.env.ROUTERLOGGER_API_URL || 'http://localhost:3001'}`);
});

module.exports = app;

