# Shared Database Setup

This guide explains how to connect the self-hosted RADIUS/Captive Portal to your existing RouterLogger PostgreSQL database on Railway.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RAILWAY                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    RouterLogger                              │    │
│  │  - Router monitoring & telemetry                            │    │
│  │  - ClickUp integration                                      │    │
│  │  - Guest session viewing                                    │    │
│  └───────────────────────────┬─────────────────────────────────┘    │
│                              │                                       │
│  ┌───────────────────────────▼─────────────────────────────────┐    │
│  │               PostgreSQL Database                            │    │
│  │  - Router data                                              │    │
│  │  - Guest sessions (ironwifi_sessions)                       │    │
│  │  - Verification codes                                       │    │
│  │  - Free tier tracking                                       │    │
│  │  - Ad configuration & tracking                              │    │
│  └───────────────────────────▲─────────────────────────────────┘    │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               │ DATABASE_URL (external connection)
                               │
┌──────────────────────────────┼──────────────────────────────────────┐
│                    DIGITALOCEAN DROPLET                              │
│  ┌───────────────────────────┴─────────────────────────────────┐    │
│  │              RADIUS Server + Captive Portal                  │    │
│  │  - Guest WiFi authentication                                │    │
│  │  - Stores sessions in Railway PostgreSQL                    │    │
│  │  - Sends webhooks to RouterLogger                           │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Step 1: Get Your Railway Database URL

1. Go to your Railway dashboard
2. Click on your PostgreSQL database service
3. Go to the **Variables** tab
4. Copy the `DATABASE_URL` value

It will look something like:
```
postgresql://postgres:PASSWORD@containers-us-west-XXX.railway.app:PORT/railway
```

## Step 2: Configure the Captive Portal

SSH into your DigitalOcean droplet and update the `.env` file:

```bash
ssh root@134.122.101.195
cd /opt/radius-server
nano .env
```

Add/update these variables:

```env
# Database Configuration
USE_DATABASE=true
DATABASE_URL=postgresql://postgres:PASSWORD@containers-us-west-XXX.railway.app:PORT/railway
DATABASE_SSL=true

# RouterLogger API (for webhooks)
ROUTERLOGGER_API_URL=https://your-routerlogger.railway.app

# Free tier settings
FREE_SESSION_DURATION=1800
FREE_COOLDOWN_HOURS=24

# Ads
SHOW_SAMPLE_ADS=false
```

## Step 3: Run Database Migration

The captive portal needs additional tables in your PostgreSQL database. Run this migration on Railway:

### Option A: Via Railway CLI

```bash
# Install Railway CLI if needed
npm install -g @railway/cli

# Login and link to your project
railway login
railway link

# Run the migration
railway run psql -f backend/database/migrations/023_add_captive_portal_fields.sql
```

### Option B: Via Railway Dashboard

1. Go to your PostgreSQL service in Railway
2. Click "Query" tab
3. Paste and run the contents of `backend/database/migrations/023_add_captive_portal_fields.sql`

### Option C: Via psql directly

```bash
psql "postgresql://postgres:PASSWORD@containers-us-west-XXX.railway.app:PORT/railway" \
  -f backend/database/migrations/023_add_captive_portal_fields.sql
```

## Step 4: Restart the Captive Portal

```bash
cd /opt/radius-server
docker compose down
docker compose up -d --build captive-portal
```

## Step 5: Verify Connection

Check the logs to confirm database connection:

```bash
docker compose logs captive-portal | grep -i database
```

You should see:
```
📦 Using PostgreSQL database for verification codes and free tier tracking
```

## Step 6: Configure RouterLogger to Accept Webhooks

The captive portal sends events to RouterLogger. Make sure your RouterLogger is configured to accept them.

The webhook endpoint is already implemented at:
```
POST /api/ironwifi/captive-portal/event
```

### Event Types

| Event | Description |
|-------|-------------|
| `free_access_granted` | Guest connected with free 30-min access |
| `guest_registration` | Guest registered with email/phone |
| `guest_login` | Guest logged in |
| `guest_logout` | Guest disconnected |
| `voucher_redemption` | Voucher code used |
| `session_expired` | Session timed out |

### Example Webhook Payload

```json
{
  "type": "guest_registration",
  "username": "guest@example.com",
  "email": "guest@example.com",
  "name": "John Smith",
  "mac_address": "aa:bb:cc:dd:ee:ff",
  "router_mac": "11:22:33:44:55:66",
  "router_id": "1234567890",
  "session_id": "uuid-here",
  "session_duration": 86400,
  "timestamp": "2026-01-01T12:00:00.000Z"
}
```

## Database Tables Created

### `captive_verification_codes`
Stores email/SMS verification codes (persistent across restarts)

### `captive_free_usage`
Tracks free tier usage to prevent abuse (24-hour cooldown)

### `captive_ad_impressions`
Tracks ad impressions for analytics

### `captive_ad_clicks`
Tracks ad clicks for analytics

### `captive_ads`
Stores ad configuration (images, promos, HTML)

## Viewing Guest Data in RouterLogger

Guest sessions are stored in the `ironwifi_sessions` table with additional fields:

- `session_type`: 'free', 'registered', 'voucher'
- `source`: 'self-hosted' (vs 'ironwifi')
- `email`, `phone`, `guest_name`: Contact info
- `voucher_code`: If voucher was used

You can view this data in the RouterLogger frontend's IronWifi/Guest section.

## Troubleshooting

### Connection Refused
- Ensure Railway database allows external connections
- Check that `DATABASE_SSL=true` is set
- Verify the DATABASE_URL is correct

### Migration Errors
- Make sure you're running against the correct database
- Check that `ironwifi_sessions` table exists first

### Webhooks Not Received
- Check RouterLogger logs for incoming webhook requests
- Verify `ROUTERLOGGER_API_URL` is correct
- Ensure RouterLogger is accessible from the internet

### Sessions Not Persisting
- Verify `USE_DATABASE=true` in .env
- Check captive-portal logs for database errors
- Ensure migration ran successfully

