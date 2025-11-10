#!/usr/bin/env node
/**
 * IronWifi API Explorer
 * Tests various endpoints to understand the API structure
 */

const axios = require('axios');

const API_KEY = '779cfe99-f15d-4318-8d30-9fafeb46ed7d';
const BASE_URL = 'https://console.ironwifi.com/api';

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.ironwifi.v1+json'
  }
});

async function testEndpoint(path, method = 'GET') {
  try {
    console.log(`\n🔍 Testing: ${method} ${path}`);
    const response = await client.request({ method, url: path });
    console.log(`✅ Status: ${response.status}`);
    console.log(`📦 Data:`, JSON.stringify(response.data, null, 2).substring(0, 500));
    return { success: true, data: response.data };
  } catch (error) {
    console.log(`❌ Error: ${error.response?.status || 'No response'} - ${error.message}`);
    if (error.response?.data) {
      console.log(`   Details:`, error.response.data);
    }
    return { success: false, error: error.message };
  }
}

async function explore() {
  console.log('🚀 IronWifi API Explorer\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 20)}...`);
  
  // Common endpoints to test
  const endpoints = [
    '/networks',
    '/access-points',
    '/aps',
    '/captive-portals',
    '/portals',
    '/radius',
    '/radacct',
    '/accounting',
    '/sessions',
    '/users',
    '/clients',
    '/devices',
    '/statistics',
    '/stats',
    '/reports',
    '/splash-pages',
    '/locations',
    '/controllers'
  ];

  const results = [];
  for (const endpoint of endpoints) {
    const result = await testEndpoint(endpoint);
    results.push({ endpoint, ...result });
    await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit friendly
  }

  console.log('\n\n📊 Summary:');
  console.log('=' .repeat(50));
  results.forEach(r => {
    const status = r.success ? '✅' : '❌';
    console.log(`${status} ${r.endpoint}`);
  });

  const working = results.filter(r => r.success);
  if (working.length > 0) {
    console.log('\n\n🎉 Working Endpoints:');
    working.forEach(r => {
      console.log(`\n${r.endpoint}:`);
      console.log(JSON.stringify(r.data, null, 2).substring(0, 300));
    });
  }
}

explore().catch(console.error);
