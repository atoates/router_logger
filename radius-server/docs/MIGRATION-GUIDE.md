# Migration Guide: IronWifi to Self-Hosted RADIUS

This guide covers migrating from IronWifi to your self-hosted RADIUS server.

## 📋 Pre-Migration Checklist

- [ ] Self-hosted RADIUS server deployed and tested
- [ ] Captive portal accessible and functional
- [ ] All routers documented with IPs and locations
- [ ] Current guest data exported (if needed)
- [ ] Maintenance window scheduled
- [ ] Rollback plan prepared

## 🔄 Migration Phases

### Phase 1: Parallel Operation (1-2 weeks)

Run both systems simultaneously to validate the new setup.

```
                    ┌─────────────────┐
                    │   Test Router   │
                    │   (Site A)      │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                              ▼
    ┌─────────────────┐           ┌─────────────────┐
    │  Self-Hosted    │           │    IronWifi     │
    │    RADIUS       │           │   (Existing)    │
    │   (Testing)     │           │                 │
    └─────────────────┘           └─────────────────┘
                                          ▲
                                          │
                    ┌─────────────────────┴───────────────────┐
                    │                                         │
           ┌────────┴────────┐                    ┌───────────┴───────┐
           │  Production     │                    │  Production       │
           │  Router B       │                    │  Router C         │
           └─────────────────┘                    └───────────────────┘
```

**Steps:**
1. Configure ONE test router to use self-hosted RADIUS
2. Monitor for 1-2 weeks
3. Compare session data with IronWifi
4. Fix any issues discovered

### Phase 2: Gradual Rollout (2-4 weeks)

Migrate routers in batches.

**Week 1-2:**
- Migrate 25% of routers (lowest traffic sites)
- Monitor closely
- Document any issues

**Week 3-4:**
- Migrate remaining 75%
- Keep IronWifi active as backup
- Verify all webhooks reaching RouterLogger

### Phase 3: Full Migration

1. Migrate all remaining routers
2. Update RouterLogger configuration
3. Disable IronWifi (but don't cancel yet)
4. Monitor for 1 week
5. Cancel IronWifi subscription

## 📊 Data Migration

### Export Guest Data from IronWifi

```javascript
// Script to export IronWifi guests
const ironwifiClient = require('./services/ironwifiClient');

async function exportGuests() {
    const guests = await ironwifiClient.getAllGuests({ maxPages: 100 });
    
    // Save to file
    const fs = require('fs');
    fs.writeFileSync('ironwifi-guests.json', JSON.stringify(guests, null, 2));
    
    console.log(`Exported ${guests.length} guests`);
    return guests;
}

exportGuests();
```

### Import to Self-Hosted RADIUS

```sql
-- Import guests from JSON export
-- Run this after exporting to ironwifi-guests.json

-- Example import (adjust based on your export format)
INSERT INTO radcheck (username, attribute, op, value)
SELECT 
    email,
    'Cleartext-Password',
    ':=',
    SUBSTRING(MD5(RAND()), 1, 12)  -- Generate random password
FROM imported_guests;

-- Add to guests group
INSERT INTO radusergroup (username, groupname, priority)
SELECT email, 'guests', 1
FROM imported_guests;
```

## 🔧 Router Migration Steps

### Per-Router Migration

For each router:

1. **Document Current Config**
   ```
   Router: Site-A-001
   IP: 203.0.113.100
   Current RADIUS: IronWifi (radius.ironwifi.com)
   Secret: ************
   ```

2. **Register in Self-Hosted RADIUS**
   ```sql
   INSERT INTO nas (nasname, shortname, type, secret, description)
   VALUES ('203.0.113.100', 'Site-A-001', 'other', 'new-secret', 'Site A Main');
   ```

3. **Update Router Configuration**
   - Change RADIUS server IP
   - Update shared secret
   - Update captive portal URL
   - Test authentication

4. **Verify Operation**
   - Test guest login
   - Check accounting data in RouterLogger
   - Verify session limits work

5. **Document Completion**
   ```
   Router: Site-A-001
   Migrated: 2026-01-15
   Status: ✅ Complete
   Notes: Working correctly
   ```

## 📝 Configuration Changes

### RouterLogger Backend

No changes needed! The webhook endpoint remains the same:
- `/api/ironwifi/webhook`

The self-hosted RADIUS sends data in the same format as IronWifi.

### Environment Variables

Add to RouterLogger backend (optional, for direct RADIUS queries):

```bash
# Self-hosted RADIUS (optional)
RADIUS_HOST=your-radius-server.com
RADIUS_DB_HOST=your-radius-server.com
RADIUS_DB_USER=radius
RADIUS_DB_PASSWORD=your-password
RADIUS_DB_NAME=radius
```

## ⚠️ Rollback Plan

If issues occur, rollback to IronWifi:

### Quick Rollback (per router)

1. SSH into router or access WebUI
2. Change RADIUS server back to IronWifi:
   ```
   Server: radius.ironwifi.com
   Port: 1812
   Secret: [original IronWifi secret]
   ```
3. Change captive portal URL back to IronWifi
4. Save and test

### Full Rollback

If major issues:
1. Rollback all routers to IronWifi
2. Document issues encountered
3. Fix self-hosted setup
4. Retry migration later

## 📊 Validation Checklist

After migration, verify:

### Authentication
- [ ] Email verification works
- [ ] SMS verification works (if enabled)
- [ ] Voucher codes work
- [ ] Session limits enforced

### Accounting
- [ ] Session start events logged
- [ ] Session updates received
- [ ] Session stop events logged
- [ ] Data usage tracked correctly

### RouterLogger Integration
- [ ] Webhooks received
- [ ] Guest sessions visible in dashboard
- [ ] Historical data accessible

### Performance
- [ ] Authentication response time < 2 seconds
- [ ] No timeout errors
- [ ] Captive portal loads quickly

## 🔍 Monitoring During Migration

### Key Metrics to Watch

```sql
-- Authentication success rate
SELECT 
    DATE(authdate) as date,
    reply,
    COUNT(*) as count
FROM radpostauth
WHERE authdate > DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY DATE(authdate), reply;

-- Session counts
SELECT 
    DATE(acctstarttime) as date,
    COUNT(*) as sessions
FROM radacct
WHERE acctstarttime > DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY DATE(acctstarttime);
```

### Alerts to Set Up

1. **Authentication failures spike** - More than 10% rejection rate
2. **No new sessions** - No sessions in 1 hour during business hours
3. **RADIUS server down** - Health check fails
4. **Webhook failures** - RouterLogger not receiving data

## 📅 Suggested Timeline

| Week | Activity |
|------|----------|
| 1 | Deploy and test self-hosted RADIUS |
| 2 | Configure test router, parallel operation |
| 3 | Migrate 25% of routers |
| 4 | Migrate next 25% |
| 5 | Migrate remaining 50% |
| 6 | Monitor, fix issues |
| 7 | Disable IronWifi |
| 8 | Cancel IronWifi subscription |

## 💡 Tips for Smooth Migration

1. **Start with low-traffic sites** - Easier to troubleshoot
2. **Migrate during off-hours** - Less user impact
3. **Keep IronWifi active** - Easy rollback option
4. **Document everything** - Helps with troubleshooting
5. **Test thoroughly** - Before each batch migration
6. **Communicate with users** - If any downtime expected

## 🆘 Getting Help

If you encounter issues:

1. Check FreeRADIUS logs: `docker-compose logs -f freeradius`
2. Check captive portal logs: `docker-compose logs -f captive-portal`
3. Verify database connectivity
4. Test with `radtest` command
5. Review RouterLogger webhook logs

