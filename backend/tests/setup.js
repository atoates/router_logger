/**
 * Jest Test Setup
 * Runs before all tests
 */

// Set test environment
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/routerlogger_test';

// Increase timeout for integration tests
jest.setTimeout(10000);

// Mock Winston logger to reduce noise during tests
jest.mock('../src/config/database', () => {
  const originalModule = jest.requireActual('../src/config/database');
  return {
    ...originalModule,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }
  };
});

// Global cleanup
afterAll(async () => {
  // Close any open handles
  await new Promise(resolve => setTimeout(resolve, 100));
});

