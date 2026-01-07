# Teltonika Router RADIUS Configuration

This guide explains how to configure Teltonika RUT/RUTX series routers to use your self-hosted RADIUS server.

## 📋 Prerequisites

- Teltonika router with firmware 7.x or later
- Access to router WebUI
- RADIUS server IP address and shared secret
- Captive portal URL

## 🔧 Step 1: Access Router WebUI

1. Connect to the router's network
2. Open browser and go to `http://192.168.1.1` (or your router's IP)
3. Login with admin credentials

## 🌐 Step 2: Configure Hotspot (Captive Portal)

### Enable Hotspot

1. Go to **Services → Hotspot → General**
2. Enable **Hotspot**
3. Configure:

| Setting | Value |
|---------|-------|
| **Enable** | ✅ On |
| **Interface** | `lan` (or your guest interface) |
| **Authentication Mode** | External RADIUS |
| **Landing Page** | External |
| **Landing Page URL** | `http://your-server:8081/` |

### Hotspot Settings

```
┌─────────────────────────────────────────────────────────────┐
│ Hotspot Configuration                                        │
├─────────────────────────────────────────────────────────────┤
│ Enable:              [✓]                                     │
│ Interface:           [lan ▼]                                 │
│ Authentication:      [External RADIUS ▼]                     │
│                                                              │
│ Landing Page:        [External ▼]                            │
│ Landing Page URL:    [http://portal.yourdomain.com/]         │
│                                                              │
│ Session Timeout:     [1800] seconds (30 minutes)             │
│ Idle Timeout:        [300] seconds (5 minutes)               │
└─────────────────────────────────────────────────────────────┘
```

> **Note**: Set Session/Idle Timeout to `0` if you want RADIUS to fully control timeouts via Session-Timeout and Idle-Timeout attributes. The values above (1800/300) serve as fallback defaults if RADIUS doesn't return these attributes.
>
> To configure via CLI (SSH):
> ```bash
> uci set chilli.@chilli[0].defsessiontimeout='1800'
> uci set chilli.@chilli[0].defidletimeout='300'
> uci commit chilli
> /etc/init.d/chilli restart
> ```

## 📡 Step 3: Configure RADIUS Server

1. Go to **Services → Hotspot → RADIUS**
2. Click **Add** to create a new RADIUS server

### RADIUS Server Settings

| Setting | Value |
|---------|-------|
| **Enable** | ✅ On |
| **RADIUS Server** | Your VPS IP address |
| **Authentication Port** | 1812 |
| **Accounting Port** | 1813 |
| **Shared Secret** | Your RADIUS secret |
| **NAS Identifier** | Router name (e.g., "Router-001") |

### Example Configuration

```
┌─────────────────────────────────────────────────────────────┐
│ RADIUS Server                                                │
├─────────────────────────────────────────────────────────────┤
│ Enable:              [✓]                                     │
│                                                              │
│ Server Address:      [203.0.113.50]                          │
│ Authentication Port: [1812]                                  │
│ Accounting Port:     [1813]                                  │
│ Shared Secret:       [••••••••••••]                          │
│                                                              │
│ NAS Identifier:      [Router-Site-A]                         │
│ NAS IP Address:      [Auto ▼] or specify public IP           │
│                                                              │
│ Retry Count:         [3]                                     │
│ Retry Timeout:       [5] seconds                             │
└─────────────────────────────────────────────────────────────┘
```

## 🔄 Step 4: Configure Walled Garden

The walled garden allows certain URLs to be accessed before authentication.

1. Go to **Services → Hotspot → Walled Garden**
2. Add the following entries:

| URL/Domain | Description |
|------------|-------------|
| `portal.yourdomain.com` | Captive portal |
| `your-vps-ip` | RADIUS server |
| `fonts.googleapis.com` | Google Fonts |
| `fonts.gstatic.com` | Google Fonts |

### Walled Garden Configuration

```
┌─────────────────────────────────────────────────────────────┐
│ Walled Garden                                                │
├─────────────────────────────────────────────────────────────┤
│ [+] Add                                                      │
│                                                              │
│ 1. portal.yourdomain.com       [Edit] [Delete]               │
│ 2. 203.0.113.50                [Edit] [Delete]               │
│ 3. fonts.googleapis.com        [Edit] [Delete]               │
│ 4. fonts.gstatic.com           [Edit] [Delete]               │
└─────────────────────────────────────────────────────────────┘
```

## 📱 Step 5: Configure Captive Portal Detection

Modern devices detect captive portals automatically. Ensure these URLs redirect to your portal:

1. Go to **Services → Hotspot → General → Advanced**
2. Enable **Captive Portal Detection**

The router will intercept these URLs:
- `captive.apple.com` (iOS)
- `connectivitycheck.gstatic.com` (Android)
- `www.msftconnecttest.com` (Windows)

## 🔐 Step 6: Configure MAC Authentication (Optional)

For devices that should bypass the captive portal:

1. Go to **Services → Hotspot → MAC Auth**
2. Add MAC addresses to whitelist

```
┌─────────────────────────────────────────────────────────────┐
│ MAC Authentication                                           │
├─────────────────────────────────────────────────────────────┤
│ Enable:              [✓]                                     │
│ Mode:                [Whitelist ▼]                           │
│                                                              │
│ MAC Addresses:                                               │
│ [+] Add                                                      │
│                                                              │
│ 1. AA:BB:CC:DD:EE:FF   Staff Laptop    [Edit] [Delete]       │
│ 2. 11:22:33:44:55:66   IoT Device      [Edit] [Delete]       │
└─────────────────────────────────────────────────────────────┘
```

## ✅ Step 7: Test Configuration

### Test from Router CLI

SSH into the router and test RADIUS:

```bash
# Test authentication
radtest testuser testpass YOUR_RADIUS_IP 0 YOUR_SECRET

# Expected output for success:
# Received Access-Accept Id 123 from YOUR_RADIUS_IP:1812 to 0.0.0.0:0 length 32
```

### Test from Client Device

1. Connect to the guest WiFi
2. Open a browser - should redirect to captive portal
3. Authenticate with email/voucher
4. Verify internet access

## 🔍 Troubleshooting

### Portal Not Loading

**Symptoms**: Browser shows connection error or timeout

**Solutions**:
1. Check walled garden includes portal URL
2. Verify firewall allows outbound to portal
3. Check DNS resolution:
   ```bash
   nslookup portal.yourdomain.com
   ```

### RADIUS Authentication Failing

**Symptoms**: Login fails, "Authentication failed" message

**Solutions**:
1. Verify shared secret matches on both ends
2. Check RADIUS server is reachable:
   ```bash
   nc -vuz YOUR_RADIUS_IP 1812
   ```
3. Check router's NAS is registered in RADIUS server
4. Review FreeRADIUS logs:
   ```bash
   docker-compose logs -f freeradius
   ```

### Session Not Starting

**Symptoms**: Auth succeeds but no internet access

**Solutions**:
1. Check accounting is enabled on router
2. Verify accounting port (1813) is open
3. Check RADIUS accounting logs

### Captive Portal Detection Not Working

**Symptoms**: Device doesn't auto-open portal

**Solutions**:
1. Enable captive portal detection in router settings
2. Add detection URLs to walled garden
3. Clear device network settings and reconnect

## 📊 Monitoring

### View Active Sessions (Router)

1. Go to **Status → Hotspot**
2. View connected clients and session info

### View Sessions (RADIUS)

```sql
-- Active sessions
SELECT username, nasipaddress, acctstarttime, 
       (acctinputoctets + acctoutputoctets) / 1024 / 1024 as mb_used
FROM radacct 
WHERE acctstoptime IS NULL;
```

## 🔄 Multiple Routers Setup

For multiple sites, each router needs:

1. **Unique NAS Identifier** - e.g., "Site-A-Router", "Site-B-Router"
2. **Registered in RADIUS** - Add each router's IP to `nas` table
3. **Consistent Shared Secret** - Use same or per-router secrets

### Adding Router to RADIUS

```sql
INSERT INTO nas (nasname, shortname, type, secret, description, router_id)
VALUES (
    '203.0.113.100',      -- Router's public IP
    'Site-A',             -- Short name
    'other',              -- Type
    'your-shared-secret', -- Must match router config
    'Site A Main Router', -- Description
    'router_001'          -- RouterLogger router_id
);
```

## 📝 Configuration Backup

Always backup your router configuration:

1. Go to **System → Backup**
2. Click **Download** to save configuration
3. Store securely

## 🔗 Related Documentation

- [FreeRADIUS Documentation](https://freeradius.org/documentation/)
- [Teltonika Hotspot Wiki](https://wiki.teltonika-networks.com/view/Hotspot)
- [RouterLogger RADIUS README](../README.md)

