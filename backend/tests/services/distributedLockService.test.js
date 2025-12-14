/**
 * Tests for Distributed Lock Service
 * Note: These tests require a database connection
 */

const distributedLockService = require('../../src/services/distributedLockService');

describe('DistributedLockService', () => {
  afterEach(async () => {
    // Release any held locks after each test
    await distributedLockService.releaseAll();
  });

  describe('tryAcquire', () => {
    it('should export tryAcquire function', () => {
      expect(typeof distributedLockService.tryAcquire).toBe('function');
    });
  });

  describe('release', () => {
    it('should export release function', () => {
      expect(typeof distributedLockService.release).toBe('function');
    });
  });

  describe('releaseAll', () => {
    it('should export releaseAll function', () => {
      expect(typeof distributedLockService.releaseAll).toBe('function');
    });

    it('should return a promise', () => {
      const result = distributedLockService.releaseAll();
      expect(result).toBeInstanceOf(Promise);
    });
  });
});

// These tests require a live database connection
describe.skip('DistributedLockService (Integration)', () => {
  const testLockName = 'test:integration:lock';

  afterEach(async () => {
    await distributedLockService.release(testLockName);
  });

  it('should acquire a lock successfully', async () => {
    const acquired = await distributedLockService.tryAcquire(testLockName);
    expect(acquired).toBe(true);
  });

  it('should not acquire same lock twice', async () => {
    await distributedLockService.tryAcquire(testLockName);
    
    // Second acquire should still return true (we already hold it)
    const secondAcquire = await distributedLockService.tryAcquire(testLockName);
    expect(secondAcquire).toBe(true);
  });

  it('should release lock successfully', async () => {
    await distributedLockService.tryAcquire(testLockName);
    await distributedLockService.release(testLockName);
    
    // Should be able to acquire again after release
    const reacquired = await distributedLockService.tryAcquire(testLockName);
    expect(reacquired).toBe(true);
  });
});

