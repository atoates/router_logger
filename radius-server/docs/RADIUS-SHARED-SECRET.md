# RADIUS Shared Secret Configuration

## Critical Configuration

**The FreeRADIUS shared secret MUST match the router's CoovaChilli secret.**

### Current Production Secret
```
lPvk2g6aQuMWpmAGnQrwQ
```

## Why This Matters

When the shared secret doesn't match:
- ✅ Portal loads and displays registration form
- ✅ User can register and RADIUS user is created
- ❌ CoovaChilli authentication **FAILS SILENTLY**
- ❌ User stays in "dnat" state instead of "pass" state
- ❌ No internet access granted
- ❌ FreeRADIUS logs show "invalid Message-Authenticator! (Shared secret is incorrect.)"

**Symptoms:**
```bash
# Users stuck in dnat state:
root@RUT200:~# chilli_query list
04-BF-D5-A6-AD-39 192.168.2.12 dnat ...  # Should be "pass"

# FreeRADIUS rejecting authentication:
Dropping packet without response because of error: Received packet from 
172.18.0.3 with invalid Message-Authenticator! (Shared secret is incorrect.)
```

## Configuration Locations

### 1. FreeRADIUS Server (Local Source)
**File:** `radius-server/config/freeradius/clients.conf`
```conf
client default {
    ipaddr = 0.0.0.0/0
    secret = lPvk2g6aQuMWpmAGnQrwQ  # MUST match router
    shortname = default
    nastype = other
    virtual_server = default
}
```

### 2. Router (Teltonika RUT200)
**Check current secret:**
```bash
ssh admin@192.168.3.254
su root
uci show chilli | grep radiussecret
```

**Output:**
```
chilli.@chilli[0].radiussecret='lPvk2g6aQuMWpmAGnQrwQ'
```

## Deployment Checklist

Every time you deploy FreeRADIUS:

1. **Verify local config is correct:**
   ```bash
   grep "secret = " radius-server/config/freeradius/clients.conf
   # Should show: secret = lPvk2g6aQuMWpmAGnQrwQ
   ```

2. **Deploy to server:**
   ```bash
   cd radius-server
   tar czf - config/ | ssh root@134.122.101.195 \
     "cd /opt/radius-server/radius-server && tar xzf -"
   ```

3. **Restart FreeRADIUS:**
   ```bash
   ssh root@134.122.101.195 \
     "cd /opt/radius-server/radius-server && docker compose restart freeradius"
   ```

4. **Verify on server:**
   ```bash
   ssh root@134.122.101.195 \
     "cat /opt/radius-server/radius-server/config/freeradius/clients.conf | grep secret"
   ```

## Testing Authentication

### 1. Check FreeRADIUS is ready:
```bash
ssh root@134.122.101.195 "docker logs freeradius --tail=5"
# Should show: Ready to process requests
```

### 2. Register a test user on the portal

### 3. Check authentication succeeded:
```bash
# On router:
chilli_query list
# Look for "pass" state, not "dnat"
```

### 4. Check FreeRADIUS logs:
```bash
ssh root@134.122.101.195 "docker logs freeradius --tail=50"
# Should NOT show "Shared secret is incorrect" errors
# Should show successful Access-Accept responses
```

## Troubleshooting

### If secrets don't match:

1. **Emergency fix on server (temporary):**
   ```bash
   ssh root@134.122.101.195 "cd /opt/radius-server/radius-server && \
     sed -i 's/secret = .*/secret = lPvk2g6aQuMWpmAGnQrwQ/' config/freeradius/clients.conf && \
     docker compose restart freeradius"
   ```

2. **Permanent fix (required):**
   - Update local `radius-server/config/freeradius/clients.conf`
   - Redeploy configuration to server
   - Never skip verification steps

### If router secret changes:

If you ever change the router's CoovaChilli secret:
```bash
# Update router:
uci set chilli.@chilli[0].radiussecret='NEW_SECRET_HERE'
uci commit chilli
/etc/init.d/chilli restart

# Update FreeRADIUS:
# 1. Edit radius-server/config/freeradius/clients.conf
# 2. Deploy and restart (see Deployment Checklist above)
```

## Additional Critical Configurations

### FreeRADIUS SQL Module

**File:** `radius-server/config/freeradius/mods-enabled/sql`

FreeRADIUS **does NOT support environment variable substitution** in configuration files. The SQL connection must use hardcoded values:

```conf
sql {
    driver = "rlm_sql_mysql"
    dialect = "mysql"
    
    # MUST be hardcoded - no ${ENV_VAR} support
    server = "radius-db"              # Docker service name
    port = 3306
    login = "radius"
    password = "lI5ST8a0WJ2GrvE5SSn1Vw"
    radius_db = "radius"
    # ... rest of config
}
```

**Symptoms if using `${RADIUS_DB_HOST}` syntax:**
```
/etc/freeradius/mods-enabled/sql[10]: Reference "${RADIUS_DB_HOST}" not found
Errors reading or parsing /etc/freeradius/radiusd.conf
```

FreeRADIUS will crash-loop and never start.

## History

**Jan 8, 2026:** Critical issues identified during deployment:

1. **Shared Secret Mismatch:** Redeployments reset shared secret to default `testing123` instead of production secret `lPvk2g6aQuMWpmAGnQrwQ`. This caused complete authentication failure where users appeared to register successfully but couldn't access the internet.

2. **SQL Environment Variables:** FreeRADIUS was crash-looping due to unsupported `${ENV_VAR}` syntax in SQL module configuration. FreeRADIUS doesn't support environment variable substitution.

**Root Cause:** Manual server-side fixes were never backported to local source files, so every deployment overwrote the correct configuration.

**Resolution:** 
- Updated local source configuration for both clients.conf and SQL module
- Created this documentation to prevent recurrence
- Hardcoded all critical values that were previously using environment variables
