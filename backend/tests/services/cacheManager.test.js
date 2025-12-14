/**
 * Tests for Cache Manager Service
 */

const cacheManager = require('../../src/services/cacheManager');

describe('CacheManager', () => {
  beforeEach(() => {
    // Clear all caches before each test
    cacheManager.invalidateAllRouterCaches();
  });

  describe('Routers Cache', () => {
    const testRouters = [
      { router_id: 'R001', name: 'Test Router 1' },
      { router_id: 'R002', name: 'Test Router 2' }
    ];

    it('should return null when cache is empty', () => {
      const result = cacheManager.getRoutersCache();
      expect(result).toBeNull();
    });

    it('should store and retrieve routers from cache', () => {
      cacheManager.setRoutersCache(testRouters, 'test-etag');
      
      const cached = cacheManager.getRoutersCache();
      
      expect(cached.data).toEqual(testRouters);
      expect(cached.etag).toBe('test-etag');
    });

    it('should invalidate routers cache', () => {
      cacheManager.setRoutersCache(testRouters, 'test-etag');
      cacheManager.invalidateCache('routers');
      
      const cached = cacheManager.getRoutersCache();
      
      expect(cached).toBeNull();
    });
  });

  describe('Routers With Locations Cache', () => {
    const testLocations = [
      { router_id: 'R001', location_task_name: 'Location 1' }
    ];

    it('should return null when cache is empty', () => {
      const result = cacheManager.getRoutersWithLocationsCache();
      expect(result).toBeNull();
    });

    it('should store and retrieve locations cache', () => {
      cacheManager.setRoutersWithLocationsCache(testLocations);
      
      const cached = cacheManager.getRoutersWithLocationsCache();
      
      expect(cached).toEqual(testLocations);
    });
  });

  describe('Assignees Cache', () => {
    const testAssignees = {
      'John Doe': [{ router_id: 'R001' }],
      'Unassigned': [{ router_id: 'R002' }]
    };

    it('should return null when cache is empty', () => {
      const result = cacheManager.getAssigneesCache();
      expect(result).toBeNull();
    });

    it('should store and retrieve assignees cache', () => {
      cacheManager.setAssigneesCache(testAssignees);
      
      const cached = cacheManager.getAssigneesCache();
      
      expect(cached).toEqual(testAssignees);
    });

    it('should invalidate assignees cache', () => {
      cacheManager.setAssigneesCache(testAssignees);
      cacheManager.invalidateCache('assignees');
      
      const cached = cacheManager.getAssigneesCache();
      
      expect(cached).toBeNull();
    });
  });

  describe('invalidateAllRouterCaches', () => {
    it('should invalidate all caches', () => {
      cacheManager.setRoutersCache([{ router_id: 'R001' }], 'etag1');
      cacheManager.setAssigneesCache({ 'Test': [] });
      cacheManager.setRoutersWithLocationsCache([{ router_id: 'R001' }]);
      
      cacheManager.invalidateAllRouterCaches();
      
      expect(cacheManager.getRoutersCache()).toBeNull();
      expect(cacheManager.getAssigneesCache()).toBeNull();
      expect(cacheManager.getRoutersWithLocationsCache()).toBeNull();
    });
  });

  describe('invalidateCache', () => {
    it('should only invalidate specific cache when specified', () => {
      cacheManager.setRoutersCache([{ router_id: 'R001' }], 'etag1');
      cacheManager.setAssigneesCache({ 'Test': [] });
      
      cacheManager.invalidateCache('routers');
      
      expect(cacheManager.getRoutersCache()).toBeNull();
      expect(cacheManager.getAssigneesCache()).not.toBeNull();
    });

    it('should return true for valid cache name', () => {
      const result = cacheManager.invalidateCache('routers');
      expect(result).toBe(true);
    });

    it('should return false for invalid cache name', () => {
      const result = cacheManager.invalidateCache('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const stats = cacheManager.getCacheStats();
      
      expect(stats).toHaveProperty('routers');
      expect(stats).toHaveProperty('routersWithLocations');
      expect(stats).toHaveProperty('assignees');
    });

    it('should show cached data counts', () => {
      cacheManager.setRoutersCache([{ router_id: 'R001' }, { router_id: 'R002' }], 'etag');
      
      const stats = cacheManager.getCacheStats();
      
      expect(stats.routers.cached).toBe(true);
      expect(stats.routers.count).toBe(2);
    });
  });
});

