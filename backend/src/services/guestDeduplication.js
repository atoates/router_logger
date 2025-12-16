/**
 * Guest Deduplication Service
 * 
 * Identifies and removes duplicate guest records from ironwifi_guests table.
 * Duplicates are identified by matching username OR email (case-insensitive).
 * 
 * When duplicates are found, the record with the most recent auth_date is kept,
 * and data from other records is merged (MAC addresses, router links, etc.).
 */

const { pool, logger } = require('../config/database');

// Scheduler reference
let deduplicationInterval = null;

/**
 * Find duplicate guests based on username or email
 * @returns {Promise<Array>} Array of duplicate groups
 */
async function findDuplicates() {
  // Find users with multiple records based on username
  const usernameResult = await pool.query(`
    SELECT 
      LOWER(username) as normalized_username,
      COUNT(*) as count,
      ARRAY_AGG(id ORDER BY auth_date DESC NULLS LAST, creation_date DESC NULLS LAST) as ids
    FROM ironwifi_guests
    WHERE username IS NOT NULL AND username != ''
    GROUP BY LOWER(username)
    HAVING COUNT(*) > 1
  `);
  
  // Find users with multiple records based on email (where username differs)
  const emailResult = await pool.query(`
    SELECT 
      LOWER(email) as normalized_email,
      COUNT(*) as count,
      ARRAY_AGG(id ORDER BY auth_date DESC NULLS LAST, creation_date DESC NULLS LAST) as ids
    FROM ironwifi_guests
    WHERE email IS NOT NULL AND email != ''
      AND LOWER(email) NOT IN (
        SELECT LOWER(username) FROM ironwifi_guests WHERE username IS NOT NULL
      )
    GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
  `);
  
  return {
    byUsername: usernameResult.rows,
    byEmail: emailResult.rows,
    totalDuplicateGroups: usernameResult.rows.length + emailResult.rows.length
  };
}

/**
 * Merge duplicate guest records
 * Keeps the record with the most recent auth_date, merges data from others
 * 
 * @param {Array<number>} ids - Array of duplicate record IDs (first is the one to keep)
 * @returns {Promise<{kept: number, removed: number}>}
 */
async function mergeDuplicates(ids) {
  if (ids.length < 2) return { kept: ids[0], removed: 0 };
  
  const keepId = ids[0]; // First ID is the most recent (from ORDER BY)
  const removeIds = ids.slice(1);
  
  // Get all records to merge
  const records = await pool.query(`
    SELECT * FROM ironwifi_guests WHERE id = ANY($1)
  `, [ids]);
  
  const keepRecord = records.rows.find(r => r.id === keepId);
  const mergeRecords = records.rows.filter(r => r.id !== keepId);
  
  // Merge data from other records into the keeper
  // Priority: keep existing non-null values, but fill in gaps from duplicates
  const mergedData = {
    client_mac: keepRecord.client_mac,
    ap_mac: keepRecord.ap_mac,
    router_id: keepRecord.router_id,
    phone: keepRecord.phone,
    fullname: keepRecord.fullname,
    firstname: keepRecord.firstname,
    lastname: keepRecord.lastname,
    captive_portal_name: keepRecord.captive_portal_name,
    venue_id: keepRecord.venue_id,
    public_ip: keepRecord.public_ip,
    // Aggregate auth_count
    auth_count: keepRecord.auth_count || 1,
    // Keep earliest first_seen_at
    first_seen_at: keepRecord.first_seen_at
  };
  
  for (const record of mergeRecords) {
    // Fill in missing values
    if (!mergedData.client_mac && record.client_mac) mergedData.client_mac = record.client_mac;
    if (!mergedData.ap_mac && record.ap_mac) mergedData.ap_mac = record.ap_mac;
    if (!mergedData.router_id && record.router_id) mergedData.router_id = record.router_id;
    if (!mergedData.phone && record.phone) mergedData.phone = record.phone;
    if (!mergedData.fullname && record.fullname) mergedData.fullname = record.fullname;
    if (!mergedData.firstname && record.firstname) mergedData.firstname = record.firstname;
    if (!mergedData.lastname && record.lastname) mergedData.lastname = record.lastname;
    if (!mergedData.captive_portal_name && record.captive_portal_name) mergedData.captive_portal_name = record.captive_portal_name;
    if (!mergedData.venue_id && record.venue_id) mergedData.venue_id = record.venue_id;
    if (!mergedData.public_ip && record.public_ip) mergedData.public_ip = record.public_ip;
    
    // Sum auth_count from all records
    mergedData.auth_count += (record.auth_count || 1);
    
    // Keep earliest first_seen_at
    if (record.first_seen_at && (!mergedData.first_seen_at || record.first_seen_at < mergedData.first_seen_at)) {
      mergedData.first_seen_at = record.first_seen_at;
    }
  }
  
  // Update the keeper record with merged data
  await pool.query(`
    UPDATE ironwifi_guests SET
      client_mac = COALESCE($2, client_mac),
      ap_mac = COALESCE($3, ap_mac),
      router_id = COALESCE($4, router_id),
      phone = COALESCE($5, phone),
      fullname = COALESCE($6, fullname),
      firstname = COALESCE($7, firstname),
      lastname = COALESCE($8, lastname),
      captive_portal_name = COALESCE($9, captive_portal_name),
      venue_id = COALESCE($10, venue_id),
      public_ip = COALESCE($11, public_ip),
      auth_count = $12,
      first_seen_at = $13,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [
    keepId,
    mergedData.client_mac,
    mergedData.ap_mac,
    mergedData.router_id,
    mergedData.phone,
    mergedData.fullname,
    mergedData.firstname,
    mergedData.lastname,
    mergedData.captive_portal_name,
    mergedData.venue_id,
    mergedData.public_ip,
    mergedData.auth_count,
    mergedData.first_seen_at
  ]);
  
  // Delete the duplicate records
  await pool.query(`DELETE FROM ironwifi_guests WHERE id = ANY($1)`, [removeIds]);
  
  return { kept: keepId, removed: removeIds.length };
}

/**
 * Run the full deduplication process
 * @param {boolean} dryRun - If true, only report duplicates without removing them
 * @returns {Promise<object>} Deduplication results
 */
async function runDeduplication(dryRun = false) {
  const startTime = Date.now();
  
  try {
    logger.info(`Starting guest deduplication${dryRun ? ' (DRY RUN)' : ''}...`);
    
    // Find duplicates
    const duplicates = await findDuplicates();
    
    if (duplicates.totalDuplicateGroups === 0) {
      logger.info('No duplicates found');
      return {
        success: true,
        duplicatesFound: 0,
        recordsRemoved: 0,
        duration: `${Date.now() - startTime}ms`
      };
    }
    
    logger.info(`Found ${duplicates.totalDuplicateGroups} duplicate groups`);
    
    if (dryRun) {
      // Just report what would be done
      const details = [];
      
      for (const group of duplicates.byUsername) {
        details.push({
          type: 'username',
          value: group.normalized_username,
          count: group.count,
          ids: group.ids,
          wouldKeep: group.ids[0],
          wouldRemove: group.ids.slice(1)
        });
      }
      
      for (const group of duplicates.byEmail) {
        details.push({
          type: 'email',
          value: group.normalized_email,
          count: group.count,
          ids: group.ids,
          wouldKeep: group.ids[0],
          wouldRemove: group.ids.slice(1)
        });
      }
      
      return {
        success: true,
        dryRun: true,
        duplicateGroups: duplicates.totalDuplicateGroups,
        totalDuplicateRecords: details.reduce((sum, d) => sum + d.count, 0),
        recordsWouldRemove: details.reduce((sum, d) => sum + d.wouldRemove.length, 0),
        details: details.slice(0, 50), // Limit details to first 50
        duration: `${Date.now() - startTime}ms`
      };
    }
    
    // Actually merge and remove duplicates
    let totalRemoved = 0;
    const mergeResults = [];
    
    // Process username duplicates
    for (const group of duplicates.byUsername) {
      try {
        const result = await mergeDuplicates(group.ids);
        totalRemoved += result.removed;
        mergeResults.push({
          type: 'username',
          value: group.normalized_username,
          kept: result.kept,
          removed: result.removed
        });
      } catch (error) {
        logger.error(`Error merging username duplicates for ${group.normalized_username}:`, error.message);
      }
    }
    
    // Process email duplicates
    for (const group of duplicates.byEmail) {
      try {
        const result = await mergeDuplicates(group.ids);
        totalRemoved += result.removed;
        mergeResults.push({
          type: 'email',
          value: group.normalized_email,
          kept: result.kept,
          removed: result.removed
        });
      } catch (error) {
        logger.error(`Error merging email duplicates for ${group.normalized_email}:`, error.message);
      }
    }
    
    const duration = Date.now() - startTime;
    logger.info(`Deduplication complete: removed ${totalRemoved} duplicate records in ${duration}ms`);
    
    return {
      success: true,
      duplicateGroups: duplicates.totalDuplicateGroups,
      recordsRemoved: totalRemoved,
      mergeResults: mergeResults.slice(0, 50), // Limit to first 50
      duration: `${duration}ms`
    };
    
  } catch (error) {
    logger.error('Deduplication failed:', error.message);
    return {
      success: false,
      error: error.message,
      duration: `${Date.now() - startTime}ms`
    };
  }
}

/**
 * Get deduplication statistics
 * @returns {Promise<object>} Statistics about potential duplicates
 */
async function getDeduplicationStats() {
  const duplicates = await findDuplicates();
  
  // Count total records that would be removed
  let recordsToRemove = 0;
  for (const group of duplicates.byUsername) {
    recordsToRemove += group.count - 1; // Keep one, remove the rest
  }
  for (const group of duplicates.byEmail) {
    recordsToRemove += group.count - 1;
  }
  
  // Get total guest count
  const totalResult = await pool.query('SELECT COUNT(*) FROM ironwifi_guests');
  const totalGuests = parseInt(totalResult.rows[0].count);
  
  return {
    totalGuests,
    duplicateGroups: duplicates.totalDuplicateGroups,
    recordsToRemove,
    percentageDuplicates: totalGuests > 0 
      ? ((recordsToRemove / totalGuests) * 100).toFixed(2) + '%' 
      : '0%',
    byUsername: duplicates.byUsername.length,
    byEmail: duplicates.byEmail.length,
    topDuplicates: [
      ...duplicates.byUsername.slice(0, 5).map(g => ({ 
        type: 'username', 
        value: g.normalized_username, 
        count: g.count 
      })),
      ...duplicates.byEmail.slice(0, 5).map(g => ({ 
        type: 'email', 
        value: g.normalized_email, 
        count: g.count 
      }))
    ]
  };
}

/**
 * Start the daily deduplication scheduler
 * Runs at 3 AM by default
 * @param {number} hourOfDay - Hour to run (0-23, default 3)
 */
function startDailyDeduplication(hourOfDay = 3) {
  if (deduplicationInterval) {
    logger.warn('Deduplication scheduler already running');
    return;
  }
  
  // Calculate time until next run
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(hourOfDay, 0, 0, 0);
  
  // If the time has already passed today, schedule for tomorrow
  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  
  const msUntilFirstRun = nextRun.getTime() - now.getTime();
  
  logger.info(`Guest deduplication scheduled to run daily at ${hourOfDay}:00`);
  logger.info(`Next run in ${Math.round(msUntilFirstRun / 1000 / 60)} minutes`);
  
  // Schedule first run
  setTimeout(async () => {
    // Run deduplication
    await runDeduplication(false);
    
    // Then schedule to run every 24 hours
    deduplicationInterval = setInterval(async () => {
      try {
        await runDeduplication(false);
      } catch (error) {
        logger.error('Scheduled deduplication failed:', error.message);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours
    
  }, msUntilFirstRun);
}

/**
 * Stop the deduplication scheduler
 */
function stopDailyDeduplication() {
  if (deduplicationInterval) {
    clearInterval(deduplicationInterval);
    deduplicationInterval = null;
    logger.info('Guest deduplication scheduler stopped');
  }
}

/**
 * Check if deduplication scheduler is running
 */
function isSchedulerRunning() {
  return deduplicationInterval !== null;
}

module.exports = {
  findDuplicates,
  mergeDuplicates,
  runDeduplication,
  getDeduplicationStats,
  startDailyDeduplication,
  stopDailyDeduplication,
  isSchedulerRunning
};

