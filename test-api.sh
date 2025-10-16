#!/bin/bash

# Quick test script to verify API is working
# Usage: ./test-api.sh <API_URL>

API_URL=${1:-"http://localhost:3001"}

echo "Testing Router Logger API at $API_URL"
echo "========================================"

# Test root endpoint
echo -e "\n1. Testing root endpoint..."
curl -s "$API_URL/" | jq .

# Test routers endpoint
echo -e "\n2. Testing /api/routers endpoint..."
curl -s "$API_URL/api/routers" | jq .

# Send test telemetry data
echo -e "\n3. Sending test telemetry data..."
curl -X POST "$API_URL/api/log" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "TEST-RUT200-001",
    "imei": "352123456789012",
    "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
    "name": "Test Router",
    "location": "Test Site",
    "site_id": "test_site_001",
    "wan_ip": "203.0.113.42",
    "operator": "Test Operator",
    "mcc": "234",
    "mnc": "15",
    "network_type": "LTE",
    "cell": {
      "lac": "12345",
      "tac": "12345",
      "cid": "67890",
      "rsrp": -95,
      "rsrq": -9,
      "sinr": 10
    },
    "counters": {
      "total_tx_bytes": 1234567890,
      "total_rx_bytes": 9876543210
    },
    "fw_version": "RUT2_R_00.07.04.5",
    "uptime": 86400,
    "status": "online"
  }' | jq .

# Get logs for test router
echo -e "\n4. Retrieving logs for test router..."
curl -s "$API_URL/api/logs?router_id=TEST-RUT200-001&limit=5" | jq .

echo -e "\n========================================"
echo "API test complete!"
