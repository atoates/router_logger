# RouterLogger RADIUS Server

Self-hosted RADIUS server for guest WiFi authentication, replacing IronWifi.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         VPS (DigitalOcean/Vultr)                │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   FreeRADIUS    │  │   daloRADIUS    │  │ Captive Portal  │ │
│  │   (Auth/Acct)   │  │   (Admin UI)    │  │   (Guest UI)    │ │
│  │                 │  │                 │  │                 │ │
│  │  UDP 1812/1813  │  │    HTTP 8080    │  │   HTTP 8081     │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                    │          │
│           └────────────────────┼────────────────────┘          │
│                                │                               │
│                    ┌───────────▼───────────┐                   │
│                    │      MariaDB          │                   │
│                    │  (Users, Sessions)    │                   │
│                    └───────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Webhooks
                              ▼
                    ┌─────────────────────┐
                    │   RouterLogger      │
                    │   (Railway)         │
                    └─────────────────────┘
                              ▲
                              │ UDP 1812/1813
                              │
              ┌───────────────┴───────────────┐
              │                               │
     ┌────────┴────────┐             ┌────────┴────────┐
     │ Teltonika Router│             │ Teltonika Router│
     │    (Site A)     │             │    (Site B)     │
     └─────────────────┘             └─────────────────┘
```

## 📦 Components

| Component | Purpose | Port |
|-----------|---------|------|
| **FreeRADIUS** | RADIUS authentication & accounting | UDP 1812, 1813 |
| **daloRADIUS** | Web-based admin interface | HTTP 8080 |
| **Captive Portal** | Guest login page | HTTP 8081 |
| **MariaDB** | User database & session storage | 3306 (internal) |

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- VPS with public IP (DigitalOcean, Vultr, AWS Lightsail)
- Domain name (optional, for HTTPS)

### 1. Clone & Configure

```bash
# Clone the repository
git clone <your-repo>
cd radius-server

# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

### 2. Start Services

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Check status
docker-compose ps
```

### 3. Access Admin UI

- **URL**: http://your-server-ip:8080
- **Username**: administrator
- **Password**: radius

**⚠️ Change the default password immediately!**

### 4. Configure Routers

See [TELTONIKA-SETUP.md](./docs/TELTONIKA-SETUP.md) for router configuration.

## 🔧 Configuration

### Environment Variables

Create a `.env` file with:

```bash
# Database
RADIUS_DB_ROOT_PASSWORD=your-secure-root-password
RADIUS_DB_PASSWORD=your-secure-radius-password

# RADIUS
RADIUS_SECRET=your-shared-secret-for-routers

# RouterLogger Integration
ROUTERLOGGER_WEBHOOK_URL=https://your-backend.railway.app/api/ironwifi/webhook
ROUTERLOGGER_API_URL=https://your-backend.railway.app

# Captive Portal
SESSION_SECRET=your-session-secret
COMPANY_NAME=Your Company Name

# Optional: Email verification
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Optional: SMS verification (Twilio)
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

### Adding Routers (NAS Clients)

#### Via daloRADIUS UI:
1. Login to daloRADIUS
2. Go to **Management → NAS**
3. Click **New NAS**
4. Enter:
   - **NAS IP**: Router's public IP
   - **NAS Secret**: Shared secret (must match router config)
   - **NAS Type**: Other
   - **NAS Shortname**: Friendly name

#### Via SQL:
```sql
INSERT INTO nas (nasname, shortname, type, secret, description)
VALUES ('192.168.1.100', 'Router-001', 'other', 'your-secret', 'Site A Router');
```

### Creating Guest Users

#### Via daloRADIUS:
1. Go to **Management → Users**
2. Click **New User**
3. Enter username and password
4. Assign to "guests" group

#### Via SQL:
```sql
-- Add user
INSERT INTO radcheck (username, attribute, op, value)
VALUES ('guest@example.com', 'Cleartext-Password', ':=', 'guest123');

-- Add to guests group
INSERT INTO radusergroup (username, groupname, priority)
VALUES ('guest@example.com', 'guests', 1);
```

### Creating Voucher Codes

```sql
INSERT INTO captive_vouchers (code, session_timeout, valid_until)
VALUES ('WIFI2024', 86400, DATE_ADD(NOW(), INTERVAL 30 DAY));

-- Add as RADIUS user
INSERT INTO radcheck (username, attribute, op, value)
VALUES ('WIFI2024', 'Cleartext-Password', ':=', 'WIFI2024');
```

## 🔒 Security

### Firewall Rules

```bash
# Allow RADIUS from specific IPs only
ufw allow from YOUR_ROUTER_IP to any port 1812 proto udp
ufw allow from YOUR_ROUTER_IP to any port 1813 proto udp

# Allow web access (restrict in production)
ufw allow 8080/tcp  # daloRADIUS
ufw allow 8081/tcp  # Captive Portal

# Or use Cloudflare Tunnel for web services
```

### HTTPS Setup

For production, use a reverse proxy with SSL:

```bash
# Install Caddy
apt install caddy

# Edit /etc/caddy/Caddyfile
radius-admin.yourdomain.com {
    reverse_proxy localhost:8080
}

portal.yourdomain.com {
    reverse_proxy localhost:8081
}

# Restart Caddy
systemctl restart caddy
```

## 📊 Monitoring

### Check RADIUS Status

```bash
# View FreeRADIUS logs
docker-compose logs -f freeradius

# Test authentication
docker-compose exec freeradius radtest testuser testpass localhost 0 testing123
```

### Database Queries

```sql
-- Recent authentications
SELECT * FROM radpostauth ORDER BY authdate DESC LIMIT 20;

-- Active sessions
SELECT * FROM radacct WHERE acctstoptime IS NULL;

-- Session statistics
SELECT 
    DATE(acctstarttime) as date,
    COUNT(*) as sessions,
    SUM(acctinputoctets + acctoutputoctets) / 1024 / 1024 as total_mb
FROM radacct
GROUP BY DATE(acctstarttime)
ORDER BY date DESC;
```

## 🔄 RouterLogger Integration

The RADIUS server sends accounting data to RouterLogger via webhooks, maintaining compatibility with the existing IronWifi integration.

### Webhook Events

| Event | Endpoint | Data |
|-------|----------|------|
| Auth Success | `/api/ironwifi/webhook` | username, mac, router_mac, timestamp |
| Session Start | `/api/ironwifi/webhook` | session_id, username, start_time |
| Session Update | `/api/ironwifi/webhook` | session_id, bytes_in, bytes_out |
| Session End | `/api/ironwifi/webhook` | session_id, duration, total_bytes |

## 🛠️ Troubleshooting

### RADIUS Not Responding

```bash
# Check if FreeRADIUS is running
docker-compose ps freeradius

# Check logs for errors
docker-compose logs freeradius | grep -i error

# Test locally
docker-compose exec freeradius radtest testuser testpass 127.0.0.1 0 testing123
```

### Database Connection Issues

```bash
# Check MariaDB status
docker-compose ps radius-db

# Connect to database
docker-compose exec radius-db mysql -u radius -p radius
```

### Captive Portal Not Loading

```bash
# Check portal logs
docker-compose logs captive-portal

# Verify port is accessible
curl http://localhost:8081/health
```

## 📁 File Structure

```
radius-server/
├── docker-compose.yml          # Main orchestration
├── .env                        # Environment variables
├── config/
│   ├── freeradius/
│   │   ├── clients.conf        # NAS/router definitions
│   │   ├── mods-enabled/
│   │   │   ├── sql             # Database connection
│   │   │   └── rest            # Webhook configuration
│   │   ├── sites-enabled/
│   │   │   ├── default         # Main virtual server
│   │   │   └── inner-tunnel    # EAP inner auth
│   │   └── policy.d/
│   │       └── captive-portal  # Custom policies
│   └── mysql/
│       └── schema.sql          # Database schema
├── captive-portal/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js
│       ├── routes/
│       ├── services/
│       ├── views/
│       └── public/
└── docs/
    ├── TELTONIKA-SETUP.md
    └── MIGRATION-GUIDE.md
```

## 📄 License

MIT License - See LICENSE file for details.

