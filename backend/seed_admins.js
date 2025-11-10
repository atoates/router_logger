#!/usr/bin/env node

/**
 * Seed Admin Users
 * Creates 3 admin users with secure passwords
 * Run this after migration 008 to set up admin accounts
 */

const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const SALT_ROUNDS = 10;

async function seedAdmins() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔐 Seeding admin users...\n');

    // Default passwords (CHANGE THESE!)
    const admins = [
      {
        username: 'admin1',
        password: process.env.ADMIN1_PASSWORD || 'VacatAd2025!Admin1',
        fullName: 'Primary Administrator',
        email: 'admin1@vacatad.com'
      },
      {
        username: 'admin2',
        password: process.env.ADMIN2_PASSWORD || 'VacatAd2025!Admin2',
        fullName: 'Secondary Administrator',
        email: 'admin2@vacatad.com'
      },
      {
        username: 'admin3',
        password: process.env.ADMIN3_PASSWORD || 'VacatAd2025!Admin3',
        fullName: 'Tertiary Administrator',
        email: 'admin3@vacatad.com'
      }
    ];

    for (const admin of admins) {
      console.log(`Creating/updating user: ${admin.username}...`);

      // Hash password
      const passwordHash = await bcrypt.hash(admin.password, SALT_ROUNDS);

      // Upsert user
      const result = await pool.query(
        `INSERT INTO users (username, password_hash, role, email, full_name, is_active)
         VALUES ($1, $2, 'admin', $3, $4, TRUE)
         ON CONFLICT (username) 
         DO UPDATE SET 
           password_hash = $2,
           email = $3,
           full_name = $4,
           is_active = TRUE,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id, username, role, email, full_name`,
        [admin.username, passwordHash, admin.email, admin.fullName]
      );

      const user = result.rows[0];
      console.log(`✅ User: ${user.username}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Email: ${user.email || 'N/A'}`);
      console.log(`   Name: ${user.full_name || 'N/A'}`);
      console.log(`   Password: ${admin.password}`);
      console.log('');
    }

    console.log('✅ Admin users seeded successfully!\n');
    console.log('⚠️  IMPORTANT: Change these passwords after first login!');
    console.log('⚠️  You can set custom passwords via environment variables:');
    console.log('   - ADMIN1_PASSWORD');
    console.log('   - ADMIN2_PASSWORD');
    console.log('   - ADMIN3_PASSWORD\n');

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error seeding admins:', error.message);
    console.error(error);
    await pool.end();
    process.exit(1);
  }
}

seedAdmins();
