/**
 * Cache Manager Service
 * Centralized cache management for router-related data
 */

const { logger } = require('../config/database');
const { CACHE_TTL } = require('../config/constants');

// In-memory caches
const caches = {
  routers: { data: null, etag: null, expiresAt: 0 },
  routersWithLocations: { data: null, timestamp: null, TTL: CACHE_TTL.ROUTERS_WITH_LOCATIONS },
  assignees: { data: null, timestamp: null, TTL: CACHE_TTL.ASSIGNEES }
};

/**
 * Get routers cache
 */
function getRoutersCache() {
  const now = Date.now();
  if (caches.routers.data && caches.routers.expiresAt > now) {
    return caches.routers;
  }
  return null;
}

/**
 * Set routers cache
 */
function setRoutersCache(data, etag, ttlSeconds = 60) {
  caches.routers = {
    data,
    etag,
    expiresAt: Date.now() + ttlSeconds * 1000
  };
  logger.debug('Routers cache updated', { 
    count: data?.length, 
    ttl: ttlSeconds 
  });
}

/**
 * Get routers with locations cache
 */
function getRoutersWithLocationsCache() {
  const now = Date.now();
  const cache = caches.routersWithLocations;
  
  if (cache.data && cache.timestamp && (now - cache.timestamp) < cache.TTL) {
    logger.debug('Routers with locations cache hit', {
      age: Math.round((now - cache.timestamp) / 1000),
      count: cache.data.length
    });
    return cache.data;
  }
  
  logger.debug('Routers with locations cache miss');
  return null;
}

/**
 * Set routers with locations cache
 */
function setRoutersWithLocationsCache(data) {
  caches.routersWithLocations.data = data;
  caches.routersWithLocations.timestamp = Date.now();
  
  logger.debug('Routers with locations cache updated', {
    count: data.length
  });
}

/**
 * Get assignees cache
 */
function getAssigneesCache() {
  const now = Date.now();
  const cache = caches.assignees;
  
  if (cache.data && cache.timestamp && (now - cache.timestamp) < cache.TTL) {
    logger.debug('Assignees cache hit');
    return cache.data;
  }
  
  logger.debug('Assignees cache miss');
  return null;
}

/**
 * Set assignees cache
 */
function setAssigneesCache(data) {
  caches.assignees.data = data;
  caches.assignees.timestamp = Date.now();
  
  logger.debug('Assignees cache updated');
}

/**
 * Invalidate specific cache
 */
function invalidateCache(cacheName) {
  if (caches[cacheName]) {
    caches[cacheName].data = null;
    caches[cacheName].timestamp = null;
    caches[cacheName].etag = null;
    caches[cacheName].expiresAt = 0;
    
    logger.info(`Cache invalidated: ${cacheName}`);
    return true;
  }
  
  logger.warn(`Unknown cache name: ${cacheName}`);
  return false;
}

/**
 * Invalidate all router-related caches
 */
function invalidateAllRouterCaches() {
  Object.keys(caches).forEach(cacheName => {
    caches[cacheName].data = null;
    caches[cacheName].timestamp = null;
    caches[cacheName].etag = null;
    caches[cacheName].expiresAt = 0;
  });
  
  logger.info('All router caches cleared', {
    caches: Object.keys(caches)
  });
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  const now = Date.now();
  
  return {
    routers: {
      cached: !!caches.routers.data,
      count: caches.routers.data?.length || 0,
      expiresIn: caches.routers.expiresAt ? Math.max(0, caches.routers.expiresAt - now) : 0
    },
    routersWithLocations: {
      cached: !!caches.routersWithLocations.data,
      count: caches.routersWithLocations.data?.length || 0,
      age: caches.routersWithLocations.timestamp 
        ? now - caches.routersWithLocations.timestamp 
        : null
    },
    assignees: {
      cached: !!caches.assignees.data,
      groups: caches.assignees.data ? Object.keys(caches.assignees.data).length : 0,
      age: caches.assignees.timestamp 
        ? now - caches.assignees.timestamp 
        : null
    }
  };
}

module.exports = {
  // Getters
  getRoutersCache,
  getRoutersWithLocationsCache,
  getAssigneesCache,
  
  // Setters
  setRoutersCache,
  setRoutersWithLocationsCache,
  setAssigneesCache,
  
  // Invalidation
  invalidateCache,
  invalidateAllRouterCaches,
  
  // Stats
  getCacheStats
};


