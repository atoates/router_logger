/**
 * Authentication Service
 * Handles user authentication, password management, and session tracking
 */

const bcrypt = require('bcrypt');
const { pool, logger } = require('../config/database');

const SALT_ROUNDS = 10;

class AuthService {
  /**
   * Create a new user
   */
  async createUser({ username, password, role, email, fullName, createdBy }) {
    try {
      // Validate role
      if (!['admin', 'guest'].includes(role)) {
        throw new Error('Role must be either "admin" or "guest"');
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      // Insert user
      const result = await pool.query(
        `INSERT INTO users (username, password_hash, role, email, full_name, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, username, role, email, full_name, is_active, created_at`,
        [username, passwordHash, role, email, fullName, createdBy]
      );

      logger.info(`User created: ${username} (${role})`, { createdBy });
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        throw new Error('Username already exists');
      }
      logger.error('Error creating user:', error);
      throw error;
    }
  }

  /**
   * Authenticate user with username and password
   */
  async authenticateUser(username, password, ipAddress, userAgent) {
    try {
      // Get user from database
      const result = await pool.query(
        `SELECT id, username, password_hash, role, email, full_name, is_active
         FROM users
         WHERE username = $1`,
        [username]
      );

      const user = result.rows[0];

      // Check if user exists
      if (!user) {
        // Log failed attempt
        await this.logLoginAttempt(null, ipAddress, userAgent, false);
        return null;
      }

      // Check if user is active
      if (!user.is_active) {
        logger.warn(`Login attempt for inactive user: ${username}`);
        await this.logLoginAttempt(user.id, ipAddress, userAgent, false);
        return null;
      }

      // Verify password
      const passwordMatch = await bcrypt.compare(password, user.password_hash);

      if (!passwordMatch) {
        await this.logLoginAttempt(user.id, ipAddress, userAgent, false);
        return null;
      }

      // Update last login time
      await pool.query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );

      // Log successful login
      await this.logLoginAttempt(user.id, ipAddress, userAgent, true);

      logger.info(`User logged in: ${username}`, { role: user.role });

      // Return user without password hash
      const { password_hash, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      logger.error('Error authenticating user:', error);
      throw error;
    }
  }

  /**
   * Log login attempt
   */
  async logLoginAttempt(userId, ipAddress, userAgent, success) {
    try {
      await pool.query(
        `INSERT INTO user_login_history (user_id, ip_address, user_agent, success)
         VALUES ($1, $2, $3, $4)`,
        [userId, ipAddress, userAgent, success]
      );
    } catch (error) {
      logger.error('Error logging login attempt:', error);
      // Don't throw - login should still work if logging fails
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId) {
    try {
      const result = await pool.query(
        `SELECT id, username, role, email, full_name, is_active, created_at, last_login
         FROM users
         WHERE id = $1`,
        [userId]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting user by ID:', error);
      throw error;
    }
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username) {
    try {
      const result = await pool.query(
        `SELECT id, username, role, email, full_name, is_active, created_at, last_login
         FROM users
         WHERE username = $1`,
        [username]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting user by username:', error);
      throw error;
    }
  }

  /**
   * List all users (admin only)
   */
  async listUsers({ includeInactive = false } = {}) {
    try {
      const query = includeInactive
        ? `SELECT id, username, role, email, full_name, is_active, created_at, last_login
           FROM users
           ORDER BY created_at DESC`
        : `SELECT id, username, role, email, full_name, is_active, created_at, last_login
           FROM users
           WHERE is_active = TRUE
           ORDER BY created_at DESC`;

      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error listing users:', error);
      throw error;
    }
  }

  /**
   * Update user
   */
  async updateUser(userId, updates) {
    try {
      const allowedFields = ['email', 'full_name', 'is_active'];
      const fields = [];
      const values = [];
      let paramCount = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          fields.push(`${key} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      }

      if (fields.length === 0) {
        return await this.getUserById(userId);
      }

      values.push(userId);

      const result = await pool.query(
        `UPDATE users
         SET ${fields.join(', ')}
         WHERE id = $${paramCount}
         RETURNING id, username, role, email, full_name, is_active, created_at, last_login`,
        values
      );

      logger.info(`User updated: ${userId}`, { fields: Object.keys(updates) });
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating user:', error);
      throw error;
    }
  }

  /**
   * Change user password
   */
  async changePassword(userId, newPassword) {
    try {
      const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

      await pool.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [passwordHash, userId]
      );

      logger.info(`Password changed for user: ${userId}`);
    } catch (error) {
      logger.error('Error changing password:', error);
      throw error;
    }
  }

  /**
   * Deactivate user (soft delete)
   */
  async deactivateUser(userId) {
    try {
      await pool.query(
        'UPDATE users SET is_active = FALSE WHERE id = $1',
        [userId]
      );

      logger.info(`User deactivated: ${userId}`);
    } catch (error) {
      logger.error('Error deactivating user:', error);
      throw error;
    }
  }

  /**
   * Reactivate user
   */
  async reactivateUser(userId) {
    try {
      await pool.query(
        'UPDATE users SET is_active = TRUE WHERE id = $1',
        [userId]
      );

      logger.info(`User reactivated: ${userId}`);
    } catch (error) {
      logger.error('Error reactivating user:', error);
      throw error;
    }
  }

  /**
   * Get user's assigned routers (for guests)
   */
  async getUserRouters(userId) {
    try {
      const result = await pool.query(
        `SELECT 
           r.router_id,
           r.name,
           r.imei,
           r.location,
           r.last_seen,
           ura.assigned_at,
           ura.notes as assignment_notes
         FROM user_router_assignments ura
         JOIN routers r ON ura.router_id = r.router_id
         WHERE ura.user_id = $1
         ORDER BY ura.assigned_at DESC`,
        [userId]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting user routers:', error);
      throw error;
    }
  }

  /**
   * Assign router to user
   */
  async assignRouter(userId, routerId, assignedBy, notes) {
    try {
      const result = await pool.query(
        `INSERT INTO user_router_assignments (user_id, router_id, assigned_by, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, router_id) 
         DO UPDATE SET assigned_by = $3, assigned_at = CURRENT_TIMESTAMP, notes = $4
         RETURNING *`,
        [userId, routerId, assignedBy, notes]
      );

      logger.info(`Router assigned: ${routerId} to user ${userId}`, { assignedBy });
      return result.rows[0];
    } catch (error) {
      if (error.code === '23503') { // Foreign key violation
        throw new Error('User or router not found');
      }
      logger.error('Error assigning router:', error);
      throw error;
    }
  }

  /**
   * Unassign router from user
   */
  async unassignRouter(userId, routerId) {
    try {
      await pool.query(
        'DELETE FROM user_router_assignments WHERE user_id = $1 AND router_id = $2',
        [userId, routerId]
      );

      logger.info(`Router unassigned: ${routerId} from user ${userId}`);
    } catch (error) {
      logger.error('Error unassigning router:', error);
      throw error;
    }
  }

  /**
   * Check if user has access to router
   */
  async hasRouterAccess(userId, routerId) {
    try {
      // Get user role
      const userResult = await pool.query(
        'SELECT role FROM users WHERE id = $1 AND is_active = TRUE',
        [userId]
      );

      const user = userResult.rows[0];
      if (!user) return false;

      // Admins have access to all routers
      if (user.role === 'admin') return true;

      // Guests only have access to assigned routers
      const assignmentResult = await pool.query(
        'SELECT 1 FROM user_router_assignments WHERE user_id = $1 AND router_id = $2',
        [userId, routerId]
      );

      return assignmentResult.rows.length > 0;
    } catch (error) {
      logger.error('Error checking router access:', error);
      return false;
    }
  }

  /**
   * Get login history for user
   */
  async getLoginHistory(userId, limit = 50) {
    try {
      const result = await pool.query(
        `SELECT id, login_at, ip_address, user_agent, success
         FROM user_login_history
         WHERE user_id = $1
         ORDER BY login_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting login history:', error);
      throw error;
    }
  }
}

module.exports = new AuthService();
