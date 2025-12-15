const axios = require('axios');
const { logger } = require('../config/database');

// Simple in-memory cache for cell locations (avoids repeated API calls)
const cellLocationCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours - cell towers don't move

/**
 * Generate a cache key from cell info
 */
function getCacheKey(cellInfo) {
  const { mcc, mnc, lac, tac, cell_id } = cellInfo;
  const lacOrTac = tac || lac;
  return `${mcc}-${mnc}-${lacOrTac}-${cell_id}`;
}

/**
 * Detect radio type from network_type or EARFCN
 * LTE EARFCN: 0-65535 (but commonly 0-54999)
 * UMTS UARFCN: 0-16383
 * GSM ARFCN: 0-1023
 */
function detectRadioType(cellInfo) {
  const { network_type, earfcn } = cellInfo;
  
  // Try to detect from network_type string
  if (network_type) {
    const nt = network_type.toLowerCase();
    if (nt.includes('lte') || nt.includes('4g')) return 'lte';
    if (nt.includes('umts') || nt.includes('wcdma') || nt.includes('3g') || nt.includes('hspa')) return 'umts';
    if (nt.includes('gsm') || nt.includes('gprs') || nt.includes('edge') || nt.includes('2g')) return 'gsm';
    if (nt.includes('5g') || nt.includes('nr')) return 'lte'; // Unwired Labs uses 'lte' for 5G NSA
  }
  
  // Try to detect from EARFCN value
  if (earfcn) {
    const e = parseInt(earfcn, 10);
    if (e >= 0 && e <= 1023) return 'gsm';
    if (e >= 10000 && e <= 65535) return 'lte'; // LTE bands
    if (e >= 0 && e <= 16383) return 'umts'; // Could be UMTS
  }
  
  // Default to LTE for RUT200 (most common)
  return 'lte';
}

/**
 * Get location from cell tower using Unwired Labs API
 * API Docs: https://unwiredlabs.com/api
 * 
 * @param {Object} cellInfo - Cell tower information
 * @param {string} cellInfo.mcc - Mobile Country Code
 * @param {string} cellInfo.mnc - Mobile Network Code
 * @param {string} cellInfo.lac - Location Area Code (2G/3G)
 * @param {string} cellInfo.tac - Tracking Area Code (LTE)
 * @param {string} cellInfo.cell_id - Cell ID
 * @param {string} [cellInfo.network_type] - Network type for radio detection
 * @param {string} [cellInfo.earfcn] - EARFCN for radio detection
 * @param {number} [cellInfo.rsrp] - Signal strength (RSRP for LTE)
 * @param {number} [cellInfo.pci] - Physical Cell ID
 * @returns {Object|null} - Location data {latitude, longitude, accuracy}
 */
async function getCellLocation(cellInfo) {
  const { mcc, mnc, lac, tac, cell_id, rsrp, pci } = cellInfo;
  
  // Check for API key
  const apiKey = process.env.LOCATION_API;
  if (!apiKey) {
    logger.debug('LOCATION_API not configured - skipping cell geolocation');
    return null;
  }

  // Use LAC or TAC (LAC for 2G/3G, TAC for LTE)
  const lacOrTac = tac || lac;
  
  if (!mcc || !mnc || !lacOrTac || !cell_id) {
    logger.debug('Incomplete cell info for geolocation', { mcc, mnc, lacOrTac, cell_id });
    return null;
  }

  // Check cache first
  const cacheKey = getCacheKey(cellInfo);
  const cached = cellLocationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    logger.debug(`Cell location cache hit for ${cacheKey}`);
    return cached.data;
  }

  try {
    const radio = detectRadioType(cellInfo);
    
    // Build cell object with optional signal/pci for better accuracy
    const cellObject = {
      lac: parseInt(lacOrTac, 10),
      cid: parseInt(cell_id, 10)
    };
    
    // Add signal strength if available (improves accuracy)
    // LTE uses RSRP: -137 to -45 dBm
    if (rsrp && rsrp >= -137 && rsrp <= -45) {
      cellObject.signal = parseInt(rsrp, 10);
    }
    
    // Add Physical Cell ID if available (LTE/5G)
    if (pci && pci >= 0 && pci <= 503) {
      cellObject.psc = parseInt(pci, 10);
    }
    
    // Unwired Labs Geolocation API
    // https://unwiredlabs.com/api#geolocation
    // Using EU endpoint for better latency (routers are in UK)
    const url = 'https://eu1.unwiredlabs.com/v2/process';
    const payload = {
      token: apiKey,
      radio: radio,
      mcc: parseInt(mcc, 10),
      mnc: parseInt(mnc, 10),
      cells: [cellObject],
      address: 0 // Don't need address lookup (saves API credits)
    };

    logger.debug('Calling Unwired Labs API', { mcc, mnc, lac: lacOrTac, cell_id, radio });

    const response = await axios.post(url, payload, { 
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' }
    });
    
    // Check for successful response
    // status: "ok" = success, "error" = failure
    if (response.data && response.data.status === 'ok' && response.data.lat && response.data.lon) {
      const locationData = {
        latitude: parseFloat(response.data.lat),
        longitude: parseFloat(response.data.lon),
        accuracy: response.data.accuracy || 'unknown',
        source: 'unwiredlabs',
        fallback: response.data.fallback || null
      };
      
      // Cache the result
      cellLocationCache.set(cacheKey, { data: locationData, timestamp: Date.now() });
      
      logger.info(`Cell location resolved: ${locationData.latitude}, ${locationData.longitude} (accuracy: ${locationData.accuracy}m)`);
      return locationData;
    }
    
    // Log error response
    if (response.data && response.data.status === 'error') {
      logger.warn('Unwired Labs API error:', { 
        message: response.data.message,
        mcc, mnc, lac: lacOrTac, cell_id 
      });
    }
    
    return null;
  } catch (error) {
    // Don't spam logs for rate limits or network issues
    if (error.response?.status === 429) {
      logger.warn('Unwired Labs rate limit reached');
    } else if (error.code === 'ECONNABORTED') {
      logger.warn('Unwired Labs API timeout');
    } else {
      logger.error('Error fetching cell location from Unwired Labs:', { 
        message: error.message,
        status: error.response?.status 
      });
    }
    return null;
  }
}

/**
 * Clear the location cache (useful for testing or memory management)
 */
function clearLocationCache() {
  cellLocationCache.clear();
  logger.info('Cell location cache cleared');
}

/**
 * Get cache statistics
 */
function getLocationCacheStats() {
  return {
    size: cellLocationCache.size,
    maxAge: CACHE_TTL_MS
  };
}

/**
 * Get approximate location from IP address
 * @param {string} ip - IP address
 * @returns {Object} - Location data {latitude, longitude, city, region, country, org}
 */
async function getIpLocation(ip) {
  if (!ip || ip === '127.0.0.1' || ip === 'localhost') {
    return null;
  }

  // Strip CIDR suffix if present (e.g., "100.64.26.197/32" -> "100.64.26.197")
  const cleanIp = ip.split('/')[0];

  try {
    // Using ip-api.com (free for non-commercial, no key required for basic)
    // Note: Free endpoint is HTTP only, but we are in backend so it's fine.
    // Rate limit: 45 requests per minute
    const url = `http://ip-api.com/json/${cleanIp}`;
    const response = await axios.get(url, { timeout: 5000 });
    
    if (response.data && response.data.status === 'success') {
      return {
        latitude: response.data.lat,
        longitude: response.data.lon,
        city: response.data.city,
        region: response.data.regionName,
        country: response.data.country,
        org: response.data.isp || response.data.org
      };
    }
    
    return null;
  } catch (error) {
    logger.warn(`Error fetching IP location for ${ip}:`, error.message);
    return null;
  }
}

module.exports = {
  getCellLocation,
  getIpLocation,
  clearLocationCache,
  getLocationCacheStats
};
