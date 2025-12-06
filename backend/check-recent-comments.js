#!/usr/bin/env node

/**
 * Recent ClickUp Comments Checker
 * 
 * This script searches application logs for recently posted ClickUp comments
 * to router tasks, showing what system actions have been logged.
 * 
 * Usage:
 *   node check-recent-comments.js [hours]
 * 
 * Example:
 *   node check-recent-comments.js        # Last 24 hours (default)
 *   node check-recent-comments.js 48     # Last 48 hours
 *   node check-recent-comments.js 1      # Last 1 hour
 */

const fs = require('fs');
const path = require('path');

const HOURS = parseInt(process.argv[2]) || 24;
const LOG_FILE = path.join(__dirname, 'combined.log');

// Comment types we track
const COMMENT_PATTERNS = [
  { pattern: /Added location assignment comment to router task/i, type: '🤖 Location Assignment' },
  { pattern: /Added unlink comment to router task/i, type: '🤖 Location Unlink' },
  { pattern: /Added assignment comment to router task/i, type: '👤 User Assignment' },
  { pattern: /Added unassignment comment to router task/i, type: '👤 User Unassignment' },
  { pattern: /Added status change comment to router task/i, type: '🔄 Status Change' },
  { pattern: /Added comment to ClickUp task.*for status change to (decommissioned|being returned)/i, type: '🗑️ Decommission/Return' }
];

function parseLogLine(line) {
  try {
    // Try to parse as JSON (winston format)
    const logEntry = JSON.parse(line);
    return {
      timestamp: new Date(logEntry.timestamp),
      level: logEntry.level,
      message: logEntry.message,
      metadata: logEntry
    };
  } catch {
    // Try to parse plain text format
    const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/);
    if (timestampMatch) {
      return {
        timestamp: new Date(timestampMatch[1]),
        level: 'info',
        message: line,
        metadata: { raw: line }
      };
    }
    return null;
  }
}

function extractRouterInfo(logEntry) {
  const metadata = logEntry.metadata;
  const message = logEntry.message;
  
  let routerId = null;
  let clickupTaskId = null;
  let details = {};
  
  // Extract router ID
  if (metadata.routerId) routerId = metadata.routerId;
  else {
    const routerMatch = message.match(/router[:\s]+(\d+)/i);
    if (routerMatch) routerId = routerMatch[1];
  }
  
  // Extract ClickUp task ID
  if (metadata.clickupTaskId) clickupTaskId = metadata.clickupTaskId;
  else {
    const taskMatch = message.match(/task[:\s]+([a-z0-9]+)/i);
    if (taskMatch) clickupTaskId = taskMatch[1];
  }
  
  // Extract additional details based on comment type
  if (metadata.locationTaskName) details.location = metadata.locationTaskName;
  if (metadata.locationTaskId) details.locationId = metadata.locationTaskId;
  if (metadata.assignees) details.assignees = metadata.assignees;
  if (metadata.previousStatus) details.previousStatus = metadata.previousStatus;
  if (metadata.newStatus) details.newStatus = metadata.newStatus;
  
  return { routerId, clickupTaskId, details };
}

async function checkRecentComments() {
  console.log('\n========================================');
  console.log('  Recent ClickUp Comments');
  console.log('========================================\n');
  console.log(`📅 Time window: Last ${HOURS} hour${HOURS !== 1 ? 's' : ''}`);
  console.log(`📁 Log file: ${LOG_FILE}\n`);
  
  // Check if log file exists
  if (!fs.existsSync(LOG_FILE)) {
    console.log('⚠️  Log file not found!');
    console.log(`   Expected: ${LOG_FILE}`);
    console.log('\n   Possible reasons:');
    console.log('   - Server hasn\'t been running');
    console.log('   - Logs are in a different location');
    console.log('   - This is a fresh installation\n');
    return;
  }
  
  // Read log file
  const logContent = fs.readFileSync(LOG_FILE, 'utf-8');
  const lines = logContent.split('\n').filter(line => line.trim());
  
  console.log(`📊 Scanning ${lines.length.toLocaleString()} log entries...\n`);
  
  // Calculate time threshold
  const now = new Date();
  const threshold = new Date(now.getTime() - (HOURS * 60 * 60 * 1000));
  
  const recentComments = [];
  
  // Parse log lines
  for (const line of lines) {
    const logEntry = parseLogLine(line);
    if (!logEntry || !logEntry.timestamp) continue;
    
    // Check if within time window
    if (logEntry.timestamp < threshold) continue;
    
    // Check if it's a comment-related log
    for (const { pattern, type } of COMMENT_PATTERNS) {
      if (pattern.test(logEntry.message)) {
        const { routerId, clickupTaskId, details } = extractRouterInfo(logEntry);
        
        recentComments.push({
          timestamp: logEntry.timestamp,
          type,
          routerId,
          clickupTaskId,
          details,
          message: logEntry.message
        });
        break;
      }
    }
  }
  
  // Sort by timestamp (newest first)
  recentComments.sort((a, b) => b.timestamp - a.timestamp);
  
  if (recentComments.length === 0) {
    console.log('ℹ️  No ClickUp comments found in the specified time window.');
    console.log('\n   This could mean:');
    console.log('   - No router actions have triggered comments recently');
    console.log('   - No status changes occurred');
    console.log('   - No location assignments/unassignments happened\n');
    return;
  }
  
  console.log(`✨ Found ${recentComments.length} comment${recentComments.length !== 1 ? 's' : ''}\n`);
  console.log('========================================\n');
  
  // Group by type
  const byType = {};
  for (const comment of recentComments) {
    if (!byType[comment.type]) byType[comment.type] = [];
    byType[comment.type].push(comment);
  }
  
  // Display summary
  console.log('📊 Summary by Type:\n');
  for (const [type, comments] of Object.entries(byType)) {
    console.log(`   ${type}: ${comments.length}`);
  }
  console.log('\n========================================\n');
  
  // Display detailed list
  console.log('📝 Recent Comments (newest first):\n');
  
  for (const comment of recentComments) {
    const timeAgo = getTimeAgo(comment.timestamp);
    console.log(`${comment.type}`);
    console.log(`   ⏰ ${comment.timestamp.toLocaleString()} (${timeAgo})`);
    
    if (comment.routerId) {
      console.log(`   🔌 Router: #${comment.routerId}`);
    }
    
    if (comment.clickupTaskId) {
      console.log(`   📋 ClickUp Task: ${comment.clickupTaskId}`);
    }
    
    if (Object.keys(comment.details).length > 0) {
      if (comment.details.location) {
        console.log(`   📍 Location: ${comment.details.location}`);
      }
      if (comment.details.assignees) {
        console.log(`   👤 Assignees: ${comment.details.assignees}`);
      }
      if (comment.details.previousStatus && comment.details.newStatus) {
        console.log(`   🔄 Status: ${comment.details.previousStatus} → ${comment.details.newStatus}`);
      }
    }
    
    console.log('');
  }
  
  console.log('========================================\n');
}

function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
}

// Run the checker
checkRecentComments().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});

