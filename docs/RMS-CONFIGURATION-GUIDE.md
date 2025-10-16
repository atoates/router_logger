# RUT200 RMS Configuration Guide

This document provides step-by-step instructions for configuring your RUT200 routers to send telemetry data to the Router Logger system using Teltonika RMS.

## Prerequisites

- Access to Teltonika RMS (https://rms.teltonika-networks.com/)
- RUT200 routers added to your RMS account
- Your Railway backend URL (or server IP/domain)

## Option 1: HTTPS Data to Server (Recommended for Getting Started)

### Step 1: Create RMS Configuration Profile

1. **Log in to Teltonika RMS**
2. **Navigate to**: Configuration → Profiles → Create New Profile

### Step 2: Configure Data to Server Settings

1. **General Settings**:
   - Profile Name: `Router Logger - HTTPS`
   - Description: `Send telemetry to Router Logger via HTTPS`

2. **Navigate to**: Services → Data to Server

3. **Enable Data to Server**: ON

4. **Server Configuration**:
   - **Type**: HTTP(S)
   - **URL**: `https://your-railway-app.up.railway.app/api/log`
   - **Method**: POST
   - **Content Type**: application/json
   - **Send Interval**: 300 seconds (5 minutes) - adjust as needed
   - **Enable**: ON

### Step 3: Configure JSON Payload

In the RMS Data to Server configuration, set up the JSON template:

```json
{
  "device_id": "%s",
  "imei": "%i",
  "timestamp": "%t",
  "name": "%d",
  "location": "YOUR_SITE_NAME",
  "site_id": "YOUR_SITE_ID",
  "wan_ip": "%I",
  "operator": "%o",
  "mcc": "%m",
  "mnc": "%n",
  "network_type": "%N",
  "cell": {
    "lac": "%L",
    "tac": "%T",
    "cid": "%C",
    "rsrp": %R,
    "rsrq": %Q,
    "sinr": %S
  },
  "counters": {
    "total_tx_bytes": %b,
    "total_rx_bytes": %B
  },
  "fw_version": "%f",
  "uptime": %u,
  "status": "online"
}
```

**RMS Variable Reference** (Teltonika specific):
- `%s` - Serial number / Device ID
- `%i` - IMEI
- `%t` - Timestamp (ISO 8601)
- `%d` - Device name
- `%I` - WAN IP address
- `%o` - Mobile operator name
- `%m` - MCC (Mobile Country Code)
- `%n` - MNC (Mobile Network Code)
- `%N` - Network type (LTE/3G/2G)
- `%L` - LAC (Location Area Code)
- `%T` - TAC (Tracking Area Code for LTE)
- `%C` - Cell ID
- `%R` - RSRP (LTE signal strength)
- `%Q` - RSRQ (LTE signal quality)
- `%S` - SINR (Signal to Interference plus Noise Ratio)
- `%b` - Data sent (bytes)
- `%B` - Data received (bytes)
- `%f` - Firmware version
- `%u` - Uptime (seconds)

### Step 4: Apply Profile to Routers

1. **Navigate to**: Devices → Select your routers
2. **Select multiple routers** (use checkboxes)
3. **Click**: Batch Actions → Apply Configuration Profile
4. **Select**: Router Logger - HTTPS
5. **Click**: Apply

The routers will download and apply the configuration automatically.

## Option 2: MQTT Data to Server (For Production/Scale)

### Step 1: Set Up MQTT Broker

You have several options:

**Option A: AWS IoT Core**
- Fully managed, scales automatically
- Follow AWS IoT Core setup guide

**Option B: Self-hosted EMQX/Mosquitto**
- Deploy on Railway or separate server
- More control, lower cost at scale

**Option C: HiveMQ Cloud**
- Managed MQTT service with free tier

### Step 2: Configure RMS for MQTT

1. **In RMS Configuration Profile**:
   - Navigate to: Services → Data to Server
   - **Type**: MQTT
   - **Broker URL**: `mqtt://your-mqtt-broker.com:1883` (or mqtts:// for SSL)
   - **Port**: 1883 (or 8883 for SSL)
   - **Client ID**: `%s` (uses serial number)
   - **Username**: your-mqtt-username
   - **Password**: your-mqtt-password
   - **QoS**: 1
   - **Keep Alive**: 60

2. **Topic Structure**:
   ```
   vacatad/rut200/${site_id}/%s/telemetry
   ```
   Replace `${site_id}` with your site identifier

3. **Payload**: Use the same JSON template as HTTPS option

### Step 3: Enable Cell Location Lookup (Optional)

1. **Sign up for OpenCellID API**:
   - Visit: https://opencellid.org/
   - Register for free API key

2. **Add to Railway Environment Variables**:
   ```
   OPENCELLID_API_KEY=your-api-key-here
   ENABLE_GEO_ENRICHMENT=true
   ```

This will automatically enrich telemetry with approximate GPS coordinates based on cell tower information.

## Firmware Updates via RMS

### Batch FOTA (Firmware Over The Air)

1. **Navigate to**: Firmware → FOTA Jobs
2. **Create New FOTA Job**:
   - **Name**: RUT200 Firmware Update Q4 2025
   - **Firmware Version**: Select latest stable version
   - **Target Devices**: Select device group or individual routers

3. **Scheduling**:
   - **Immediate**: Updates start now
   - **Scheduled**: Set date/time for update window
   - **Staged**: Roll out in batches (e.g., 10% → 50% → 100%)

4. **Rollback Plan**:
   - Enable automatic rollback on failure
   - Set success criteria (e.g., online within 5 minutes)

## Monitoring & Alerts

### RMS Monitoring

1. **Navigate to**: Monitoring → Dashboards
2. **Create alerts for**:
   - Device offline > 30 minutes
   - High data usage (threshold)
   - Firmware version mismatch
   - Poor signal quality (RSRP < -110 dBm)

### Router Logger Dashboard

Access your web dashboard at:
```
https://your-frontend.up.railway.app
```

Features:
- Real-time router status
- Data usage charts
- Signal quality graphs
- Export reports (CSV/PDF)
- Date range filtering

## Troubleshooting

### Router not sending data?

1. **Check RMS status**: Devices → Select router → Connection Status
2. **Verify configuration**: Ensure Data to Server is enabled
3. **Check logs**: System → Device Logs
4. **Test connectivity**: Ping your API endpoint from router (Diagnostic Tools)

### Missing data fields?

1. **Verify RMS variables** are correctly mapped in JSON template
2. **Check router firmware version** - older versions may not support all fields
3. **Review API logs** on Railway for errors

### MQTT connection issues?

1. **Verify broker URL and port**
2. **Check credentials** (username/password)
3. **Ensure SSL/TLS settings** match broker requirements
4. **Check firewall rules** - MQTT uses port 1883 (or 8883 for SSL)

## Best Practices

1. **Send Interval**: 
   - 5-15 minutes for normal monitoring
   - 1-5 minutes for critical sites
   - Longer intervals save mobile data

2. **Data Retention**:
   - Keep raw logs for 90 days
   - Aggregate older data for long-term trends

3. **Alerts**:
   - Set up email/SMS for critical alerts
   - Use Grafana + Prometheus for advanced monitoring

4. **Security**:
   - Use HTTPS/MQTTS for data transmission
   - Rotate API keys regularly
   - Limit API access by IP if possible

5. **Scaling**:
   - For 100+ routers, use MQTT instead of HTTPS
   - Consider time-series database for better performance
   - Implement data aggregation for dashboards

## Support

For RUT200 specific questions:
- Teltonika Wiki: https://wiki.teltonika-networks.com/
- RMS Support: support@teltonika-networks.com

For Router Logger issues:
- Check application logs on Railway
- Review API documentation in README.md
