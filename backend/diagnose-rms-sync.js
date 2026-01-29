#!/usr/bin/env node
/**
 * RMS Sync Diagnostic Script
 * Checks all common failure modes for RMS sync
 * 
 * Usage: node diagnose-rms-sync.js
 * (Requires DATABASE_URL environment variable)
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

const log = {
  error: (msg) => console.log(`${COLORS.red}❌ ${msg}${COLORS.reset}`),
  success: (msg) => console.log(`${COLORS.green}✅ ${msg}${COLORS.reset}`),
  warn: (msg) => console.log(`${COLORS.yellow}⚠️  ${msg}${COLORS.reset}`),
  info: (msg) => console.log(`${COLORS.blue}ℹ️  ${msg}${COLORS.reset}`),
  header: (msg) => console.log(`\n${COLORS.bold}=== ${msg} ===${COLORS.reset}`)
};

async function diagnose() {
  let issues = [];
  
  console.log('\n🔍 RMS Sync Diagnostic Tool');
  console.log('─'.repeat(50));
  console.log(`Server time: ${new Date().toISOString()}\n`);

  try {
    // 1. Check Database Connection
    log.header('DATABASE CONNECTION');
    try {
      const dbResult = await pool.query('SELECT NOW() as time, current_database() as db');
      log.success(`Connected to database: ${dbResult.rows[0].db}`);
      log.info(`Database time: ${dbResult.rows[0].time}`);
    } catch (e) {
      log.error(`Database connection failed: ${e.message}`);
      issues.push('Database connection failed');
      return; // Can't continue without DB
    }

    // 2. Check OAuth Token
    log.header('OAUTH TOKEN STATUS');
    const tokenResult = await pool.query(`
      SELECT user_id, expires_at, updated_at,
             CASE WHEN expires_at > NOW() THEN 'valid' ELSE 'expired' END as status,
             EXTRACT(EPOCH FROM (expires_at - NOW())) / 60 as minutes_until_expiry
      FROM oauth_tokens 
      WHERE user_id = 'default_rms_user'
    `);
    
    if (tokenResult.rows.length === 0) {
      log.error('No OAuth token found for RMS!');
      log.info('You need to re-authenticate with RMS OAuth');
      issues.push('No OAuth token - need to re-authenticate');
    } else {
      const token = tokenResult.rows[0];
      const minsLeft = parseFloat(token.minutes_until_expiry);
      
      if (token.status === 'expired') {
        log.error(`OAuth token EXPIRED at ${token.expires_at}`);
        log.info('The token should auto-refresh, but if refresh_token is also invalid, you need to re-authenticate');
        issues.push('OAuth token expired');
      } else if (minsLeft < 60) {
        log.warn(`OAuth token expires soon: ${minsLeft.toFixed(0)} minutes left`);
      } else {
        log.success(`OAuth token valid - expires in ${(minsLeft / 60).toFixed(1)} hours`);
      }
    }

    // 3. Check PAT Fallback
    log.header('PERSONAL ACCESS TOKEN (FALLBACK)');
    const hasPAT = !!process.env.RMS_ACCESS_TOKEN;
    if (hasPAT) {
      log.success('RMS_ACCESS_TOKEN is set (fallback available)');
    } else {
      log.warn('RMS_ACCESS_TOKEN not set - no fallback if OAuth fails');
    }

    // 4. Check Distributed Locks
    log.header('DISTRIBUTED LOCKS');
    const locksResult = await pool.query(`
      SELECT lock_name, instance_id, heartbeat_at, acquired_at,
             EXTRACT(EPOCH FROM (NOW() - heartbeat_at)) as heartbeat_age_seconds
      FROM distributed_lock_heartbeats
      ORDER BY acquired_at DESC
    `);
    
    if (locksResult.rows.length === 0) {
      log.info('No distributed locks currently held');
    } else {
      for (const lock of locksResult.rows) {
        const ageSeconds = parseFloat(lock.heartbeat_age_seconds);
        const ageMins = (ageSeconds / 60).toFixed(1);
        
        if (lock.lock_name.includes('rms_sync')) {
          if (ageSeconds > 120) { // Stale after 2 minutes
            log.error(`STALE LOCK: ${lock.lock_name}`);
            log.info(`  Instance: ${lock.instance_id}`);
            log.info(`  Heartbeat age: ${ageMins} minutes (STALE - threshold is 2 min)`);
            log.info(`  Acquired: ${lock.acquired_at}`);
            issues.push(`Stale lock: ${lock.lock_name} - needs force release`);
          } else {
            log.success(`Lock active: ${lock.lock_name}`);
            log.info(`  Instance: ${lock.instance_id}`);
            log.info(`  Heartbeat: ${ageMins} minutes ago`);
          }
        } else {
          log.info(`Other lock: ${lock.lock_name} (${ageMins}m old)`);
        }
      }
    }

    // 5. Check Recent Router Logs
    log.header('RECENT SYNC ACTIVITY');
    const recentLogs = await pool.query(`
      SELECT MAX(timestamp) as latest, MIN(timestamp) as earliest, COUNT(*) as count
      FROM router_logs
      WHERE timestamp > NOW() - INTERVAL '1 hour'
    `);
    
    const allTimeLogs = await pool.query(`SELECT MAX(timestamp) as latest FROM router_logs`);
    
    const recentCount = parseInt(recentLogs.rows[0].count || 0);
    const latestLog = allTimeLogs.rows[0]?.latest;
    
    if (!latestLog) {
      log.error('No router logs found in database at all!');
      issues.push('No router logs in database');
    } else {
      const minsAgo = (Date.now() - new Date(latestLog).getTime()) / 60000;
      
      if (minsAgo > 60) {
        log.error(`Last log was ${minsAgo.toFixed(0)} minutes ago (${latestLog})`);
        issues.push(`No logs for ${minsAgo.toFixed(0)} minutes`);
      } else if (minsAgo > 30) {
        log.warn(`Last log was ${minsAgo.toFixed(0)} minutes ago - sync may be delayed`);
      } else {
        log.success(`Last log: ${minsAgo.toFixed(0)} minutes ago`);
      }
      
      log.info(`Logs in last hour: ${recentCount}`);
    }

    // 6. Check Router Status Summary
    log.header('ROUTER STATUS');
    const routerStatus = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE current_status = 'online') as online,
        COUNT(*) FILTER (WHERE current_status != 'online' OR current_status IS NULL) as offline
      FROM routers
    `);
    
    const stats = routerStatus.rows[0];
    log.info(`Total routers: ${stats.total}`);
    log.info(`Online: ${stats.online}`);
    log.info(`Offline: ${stats.offline}`);

    // 7. Summary
    log.header('DIAGNOSIS SUMMARY');
    if (issues.length === 0) {
      log.success('No critical issues detected!');
      log.info('If sync still seems stuck, try:');
      log.info('  1. Check Railway logs for errors');
      log.info('  2. Try manual sync: POST /api/rms/sync');
      log.info('  3. Check RMS API status at rms.teltonika-networks.com');
    } else {
      log.error(`Found ${issues.length} issue(s):`);
      issues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue}`);
      });
      
      console.log('\n🔧 RECOMMENDED FIXES:');
      
      if (issues.some(i => i.includes('OAuth'))) {
        console.log('  → Re-authenticate OAuth: Visit /api/rms/oauth/start');
      }
      
      if (issues.some(i => i.includes('Stale lock'))) {
        console.log('  → Force-release lock: POST /api/rms/locks/force-release/rms_sync');
        console.log('    (requires admin auth)');
      }
      
      if (issues.some(i => i.includes('No logs'))) {
        console.log('  → Check if backend is deployed and running');
        console.log('  → Verify RMS_SYNC_INTERVAL_MINUTES env var');
      }
    }

  } catch (error) {
    log.error(`Diagnostic failed: ${error.message}`);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

diagnose().catch(console.error);
