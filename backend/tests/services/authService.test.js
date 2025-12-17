const authService = require('../../src/services/authService');
const { pool } = require('../../src/config/database');

// Mock the database pool
jest.mock('../../src/config/database', () => ({
  pool: {
    query: jest.fn(),
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('AuthService - Router Assignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('assignRouter', () => {
    it('should assign a router to a user', async () => {
      const userId = 1;
      const routerId = 'router-123';
      const assignedBy = 2;
      const notes = 'Test assignment';

      const mockResult = {
        rows: [{
          user_id: userId,
          router_id: routerId,
          assigned_by: assignedBy,
          notes: notes,
          assigned_at: new Date(),
        }],
      };

      pool.query.mockResolvedValue(mockResult);

      const result = await authService.assignRouter(userId, routerId, assignedBy, notes);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_router_assignments'),
        [userId, routerId, assignedBy, notes]
      );
      expect(result).toEqual(mockResult.rows[0]);
    });

    it('should throw error if user or router not found', async () => {
      const error = new Error('Foreign key violation');
      error.code = '23503';
      pool.query.mockRejectedValue(error);

      await expect(authService.assignRouter(1, 'invalid', 2, ''))
        .rejects.toThrow('User or router not found');
    });
  });

  describe('unassignRouter', () => {
    it('should unassign a router from a user', async () => {
      pool.query.mockResolvedValue({ rowCount: 1 });

      await authService.unassignRouter(1, 'router-123');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM user_router_assignments'),
        [1, 'router-123']
      );
    });
  });

  describe('getUserRouters', () => {
    it('should return list of assigned routers', async () => {
      const mockRouters = [
        { router_id: 'r1', name: 'Router 1' },
        { router_id: 'r2', name: 'Router 2' },
      ];
      pool.query.mockResolvedValue({ rows: mockRouters });

      const result = await authService.getUserRouters(1);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [1]
      );
      expect(result).toEqual(mockRouters);
    });
  });

  describe('hasRouterAccess', () => {
    it('should return true for admin', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ role: 'admin' }] });

      const result = await authService.hasRouterAccess(1, 'router-123');

      expect(result).toBe(true);
      expect(pool.query).toHaveBeenCalledTimes(1); // Only checks user role
    });

    it('should return true if guest is assigned', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ role: 'guest' }] }) // User check
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // Assignment check

      const result = await authService.hasRouterAccess(2, 'router-123');

      expect(result).toBe(true);
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it('should return false if guest is not assigned', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ role: 'guest' }] }) // User check
        .mockResolvedValueOnce({ rows: [] }); // Assignment check

      const result = await authService.hasRouterAccess(2, 'router-123');

      expect(result).toBe(false);
    });
  });
});
