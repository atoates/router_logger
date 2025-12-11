# IronWifi Report Analysis

## Report Type: RADIUS Authentication Logs

**Sample File**: `ironwifi-sample-report.csv`  
**Records**: 8,972 authentication events  
**Date Range**: November 6-11, 2025

## Data Structure

### CSV Fields
```
username                - User email (e.g., n.tanishakal@gmail.com)
innerusername          - Empty in most cases
display_username       - Same as username
result                 - Access-Accept or Access-Reject
rejectreason          - Reason if rejected
calling_station_id    - User device MAC (e.g., BC-54-51-47-FF-B0)
called_station_id     - AP MAC / Router MAC (e.g., 20-97-27-2D-01-71)
port                  - RADIUS port
authdate              - Authentication timestamp
Access_Request        - Full RADIUS request details
Request_Reply         - Full RADIUS reply details
request_id            - Unique request ID
```

### Key Findings

#### 1. **AP MAC Addresses (Router Identifiers)**
Found **50+ unique AP MAC addresses** in format: `20-97-27-XX-XX-XX`

Sample APs:
- `20-97-27-2D-01-71`
- `20-97-27-11-3E-30`
- `20-97-27-1F-A6-20`
- `20-97-27-24-43-4E`
- ... (50+ total)

**Format**: Uppercase with hyphens `XX-XX-XX-XX-XX-XX`

#### 2. **User Device MACs**
Sample user devices connecting:
- `BC-54-51-47-FF-B0`
- `EC-CA-E4-43-FD-B9`
- Multiple devices per user

#### 3. **Session Information Available**
From RADIUS Access_Request field:
- `Acct-Session-Id` - Unique session identifier
- `NAS-IP-Address` - Controller IP (192.168.3.254)
- `NAS-Identifier` - Network name ("guest")
- `Event-Timestamp` - Precise timestamp
- `Session-Timeout` - Timeout period (1796 seconds)

## Report Type: Authentication vs Accounting

### ⚠️ Current Report Type: **RADIUS Authentication**
- Shows when users **request access** (login attempts)
- Does NOT show session duration or bandwidth
- Does NOT show when sessions end
- Multiple records per user (re-authentication)

### ✅ Better Report Type: **RADIUS Accounting**
For full session tracking, you need:
- **Session Start** (Accounting-Start)
- **Session Stop** (Accounting-Stop)  
- **Bandwidth data** (bytes in/out)
- **Session duration**

## Recommended IronWifi Webhook Setup

### Current Setup (Authentication Report)
✅ **What it gives us:**
- User identification
- AP/Router MAC addresses
- Authentication timestamps
- Active user detection

❌ **What it's missing:**
- Session duration
- Bandwidth usage
- Session end times
- Connection quality

### Recommended Setup (Accounting Report)

**In IronWifi Console → Reports → Report Scheduler:**

1. **Report Type**: Choose **"RADIUS Accounting"** instead of "RADIUS Authentication"
2. **Frequency**: Hourly (recommended)
3. **Format**: CSV or JSON
4. **Webhook URL**: `https://your-backend.railway.app/api/ironwifi/webhook`
5. **Columns to include:**
   - username
   - calling_station_id (user device MAC)
   - called_station_id (AP MAC)
   - acct_session_id
   - acct_start_time
   - acct_stop_time
   - acct_session_time (duration)
   - acct_input_octets (bytes downloaded)
   - acct_output_octets (bytes uploaded)
   - nas_ip_address
   - framed_ip_address

## MAC Address Matching Strategy

### Current Database Format
Your routers likely have MACs in format: `aa:bb:cc:dd:ee:ff` (lowercase, colons)

### IronWifi Format
APs use format: `AA-BB-CC-DD-EE-FF` (uppercase, hyphens)

### Solution: Normalization
Our webhook handler normalizes all MACs to: `aa:bb:cc:dd:ee:ff`

Example:
- IronWifi sends: `20-97-27-2D-01-71`
- Normalized to: `20:97:27:2d:01:71`
- Matches router MAC: `20:97:27:2d:01:71`

## Next Steps

### 1. Update IronWifi Report Scheduler
- Change report type from "Authentication" to "Accounting"
- This will give you full session data with bandwidth

### 2. Verify Router MACs
Check if your routers have these AP MACs in the database:
```sql
SELECT router_id, name, mac_address 
FROM routers 
WHERE mac_address IN (
  '20:97:27:2d:01:71',
  '20:97:27:11:3e:30',
  '20:97:27:1f:a6:20'
);
```

### 3. Update Missing MACs
If routers don't have MACs, they need to be added:
```sql
-- Example: Update router with AP MAC
UPDATE routers 
SET mac_address = '20:97:27:2d:01:71' 
WHERE router_id = 'SERIAL_NUMBER';
```

### 4. Test the Webhook
Once accounting report is configured:
```bash
# Wait for next scheduled report
# Then check webhook stats
curl https://your-backend.railway.app/api/ironwifi/webhook/stats
```

## Current Integration Capabilities

### ✅ What Works Now (Authentication Reports)
- Detecting active users
- Identifying which APs they're connecting to
- Tracking authentication timestamps
- User identification

### 🔄 What Needs Accounting Reports
- Session duration tracking
- Bandwidth usage per session
- Session end detection
- Connection time analytics
- Data usage reporting

## Authentication vs Accounting Data Comparison

| Feature | Authentication | Accounting |
|---------|---------------|------------|
| User login detection | ✅ Yes | ✅ Yes |
| AP/Router MAC | ✅ Yes | ✅ Yes |
| User device MAC | ✅ Yes | ✅ Yes |
| Timestamp | ✅ Login time | ✅ Start + Stop |
| Session ID | ✅ Yes | ✅ Yes |
| Duration | ❌ No | ✅ Yes |
| Bandwidth | ❌ No | ✅ Yes (in/out) |
| Session end | ❌ No | ✅ Yes |
| Re-auth events | ✅ Yes (noise) | ❌ Filtered |

## Summary

📊 **What You Have**: 8,972 authentication events showing user logins across 50+ APs

🎯 **What You Need**: Switch to RADIUS Accounting reports for full session tracking

🔧 **Action Required**: 
1. Change IronWifi report type to "RADIUS Accounting"
2. Ensure router MACs match the AP MACs in the report
3. Wait for next hourly report delivery

✅ **Webhook is ready** - just needs the right data format!
