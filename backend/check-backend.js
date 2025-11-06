#!/usr/bin/env node
const fs = require('fs');
const propService = require('./src/services/propertyService');

console.log('\n🔍 COMPREHENSIVE BACKEND CHECK\n');
console.log('='.repeat(60));

console.log('\n✅ REQUIRED EXPORTS (should exist):');
console.log('  linkRouterToLocation:', typeof propService.linkRouterToLocation === 'function' ? '✅ EXISTS' : '❌ MISSING');
console.log('  unlinkRouterFromLocation:', typeof propService.unlinkRouterFromLocation === 'function' ? '✅ EXISTS' : '❌ MISSING');
console.log('  getCurrentLocation:', typeof propService.getCurrentLocation === 'function' ? '✅ EXISTS' : '❌ MISSING');

console.log('\n✅ REMOVED EXPORTS (should NOT exist):');
console.log('  storeRouterWith:', typeof propService.storeRouterWith === 'undefined' ? '✅ REMOVED' : '❌ ERROR - STILL EXISTS!');
console.log('  clearStoredWith:', typeof propService.clearStoredWith === 'undefined' ? '✅ REMOVED' : '❌ ERROR - STILL EXISTS!');
console.log('  assignRouterToProperty:', typeof propService.assignRouterToProperty === 'undefined' ? '✅ REMOVED' : '❌ ERROR - STILL EXISTS!');
console.log('  removeRouterFromProperty:', typeof propService.removeRouterFromProperty === 'undefined' ? '✅ REMOVED' : '❌ ERROR - STILL EXISTS!');
console.log('  getCurrentProperty:', typeof propService.getCurrentProperty === 'undefined' ? '✅ REMOVED' : '❌ ERROR - STILL EXISTS!');

console.log('\n✅ DELETED FILES (should NOT exist):');
console.log('  router-properties.js:', !fs.existsSync('src/routes/router-properties.js') ? '✅ DELETED' : '❌ ERROR - STILL EXISTS!');

console.log('\n✅ CRITICAL FILES (should exist):');
console.log('  server.js:', fs.existsSync('src/server.js') ? '✅' : '❌');
console.log('  router.js:', fs.existsSync('src/routes/router.js') ? '✅' : '❌');
console.log('  migrate.js:', fs.existsSync('src/database/migrate.js') ? '✅' : '❌');

console.log('\n' + '='.repeat(60));
console.log('✅ BACKEND CHECK COMPLETE!\n');
