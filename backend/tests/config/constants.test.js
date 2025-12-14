/**
 * Tests for constants configuration
 */

const constants = require('../../src/config/constants');

describe('Constants', () => {
  describe('CLICKUP_FIELD_IDS', () => {
    it('should have all required field IDs', () => {
      expect(constants.CLICKUP_FIELD_IDS).toBeDefined();
      expect(constants.CLICKUP_FIELD_IDS.DATE_INSTALLED).toBeDefined();
      expect(constants.CLICKUP_FIELD_IDS.OPERATIONAL_STATUS).toBeDefined();
      expect(constants.CLICKUP_FIELD_IDS.ROUTER_MODEL).toBeDefined();
      expect(constants.CLICKUP_FIELD_IDS.FIRMWARE).toBeDefined();
      expect(constants.CLICKUP_FIELD_IDS.IMEI).toBeDefined();
      expect(constants.CLICKUP_FIELD_IDS.ROUTER_ID).toBeDefined();
    });

    it('should have UUID format for field IDs', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      
      Object.values(constants.CLICKUP_FIELD_IDS).forEach(id => {
        expect(id).toMatch(uuidRegex);
      });
    });
  });

  describe('CACHE_TTL', () => {
    it('should have positive TTL values', () => {
      expect(constants.CACHE_TTL.ROUTERS).toBeGreaterThan(0);
      expect(constants.CACHE_TTL.ROUTERS_WITH_LOCATIONS).toBeGreaterThan(0);
      expect(constants.CACHE_TTL.ASSIGNEES).toBeGreaterThan(0);
    });

    it('should have TTL values in milliseconds (reasonable ranges)', () => {
      // ROUTERS should be 1-5 minutes
      expect(constants.CACHE_TTL.ROUTERS).toBeGreaterThanOrEqual(30 * 1000);
      expect(constants.CACHE_TTL.ROUTERS).toBeLessThanOrEqual(10 * 60 * 1000);
      
      // ROUTERS_WITH_LOCATIONS should be 5-30 minutes
      expect(constants.CACHE_TTL.ROUTERS_WITH_LOCATIONS).toBeGreaterThanOrEqual(5 * 60 * 1000);
      expect(constants.CACHE_TTL.ROUTERS_WITH_LOCATIONS).toBeLessThanOrEqual(60 * 60 * 1000);
    });
  });

  describe('ROUTER_STATUS', () => {
    it('should have valid online status values', () => {
      expect(Array.isArray(constants.ROUTER_STATUS.ONLINE)).toBe(true);
      expect(constants.ROUTER_STATUS.ONLINE).toContain('online');
      expect(constants.ROUTER_STATUS.ONLINE).toContain('1');
    });

    it('should have valid task statuses', () => {
      expect(Array.isArray(constants.ROUTER_STATUS.VALID_TASK_STATUSES)).toBe(true);
      expect(constants.ROUTER_STATUS.VALID_TASK_STATUSES).toContain('installed');
      expect(constants.ROUTER_STATUS.VALID_TASK_STATUSES).toContain('decommissioned');
      expect(constants.ROUTER_STATUS.VALID_TASK_STATUSES).toContain('ready');
    });
  });

  describe('TASK_STATUS', () => {
    it('should have all task status constants', () => {
      expect(constants.TASK_STATUS.DECOMMISSIONED).toBe('decommissioned');
      expect(constants.TASK_STATUS.BEING_RETURNED).toBe('being returned');
      expect(constants.TASK_STATUS.INSTALLED).toBe('installed');
      expect(constants.TASK_STATUS.READY).toBe('ready');
      expect(constants.TASK_STATUS.NEEDS_ATTENTION).toBe('needs attention');
    });
  });

  describe('USER_ROLES', () => {
    it('should have admin and guest roles', () => {
      expect(constants.USER_ROLES.ADMIN).toBe('admin');
      expect(constants.USER_ROLES.GUEST).toBe('guest');
    });
  });

  describe('RATE_LIMITS', () => {
    it('should have reasonable rate limit values', () => {
      expect(constants.RATE_LIMITS.CLICKUP_API_DELAY_MS).toBeGreaterThan(0);
      expect(constants.RATE_LIMITS.CLICKUP_REQUESTS_PER_MINUTE).toBeGreaterThan(0);
      expect(constants.RATE_LIMITS.CLICKUP_REQUESTS_PER_MINUTE).toBeLessThanOrEqual(200);
    });
  });

  describe('INSPECTION', () => {
    it('should have valid inspection intervals', () => {
      expect(constants.INSPECTION.INTERVAL_DAYS).toBe(365);
      expect(constants.INSPECTION.WARNING_DAYS).toBe(30);
    });
  });

  describe('CLEANUP_INTERVALS', () => {
    it('should have cleanup intervals in milliseconds', () => {
      expect(constants.CLEANUP_INTERVALS.OAUTH_STATE).toBeGreaterThan(0);
      expect(constants.CLEANUP_INTERVALS.EXPIRED_SESSIONS).toBeGreaterThan(0);
    });
  });
});

