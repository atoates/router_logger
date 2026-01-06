# RUT200 Router Logger

A comprehensive logging and monitoring system for Teltonika RUT200 routers with centralized data collection, visualization, and reporting capabilities.

## 📚 Documentation

See `docs/README.md` for the documentation index.

## 🎯 Features

- **Real-time Telemetry Collection**: MQTT and HTTPS endpoints for RUT200 data ingestion
- **RMS API Integration**: Automatically pull device data directly from Teltonika RMS (no router config needed!)
- **Cell Tower Geolocation**: Approximate GPS coordinates from cell tower information
- **Data Usage Tracking**: Monitor data sent/received with delta calculations
- **Signal Quality Monitoring**: Track RSRP, RSRQ, RSSI, and SINR metrics
- **WiFi User Analytics**: Track connected users, session duration, and bandwidth per router
- **Interactive Dashboards**: Beautiful charts and graphs for data visualization
- **Export Capabilities**: Generate CSV and PDF reports for any date range
- **ClickUp Integration**: Property tracking and smart sync for work orders
- **Scalable Architecture**: Built to handle 100+ routers efficiently

## 📋 Architecture

```
RUT200 Routers (100+)
    ↓ (MQTT/HTTPS)
    ↓
Ingestion Layer (Node.js/Express)
    ↓
PostgreSQL Database
    ↓
REST API
    ↓
React Dashboard (Recharts visualization)
```

## 🚀 Quick Start

### Prerequisites

- Node.js 16+ and npm
- PostgreSQL database
- MQTT broker (optional, for MQTT ingestion)
- OpenCellID API key (optional, for geolocation)

### Backend Setup

1. **Navigate to backend directory**:
   ```bash
   cd backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your settings:
   ```env
   PORT=3001
   DATABASE_URL=postgresql://user:password@localhost:5432/routerlogger
   MQTT_BROKER_URL=mqtt://localhost:1883
   OPENCELLID_API_KEY=your-api-key
   ENABLE_GEO_ENRICHMENT=true
   ```

4. **Initialize database**:
   ```bash
   npm run migrate
   ```

5. **Start server**:
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

### Frontend Setup

1. **Navigate to frontend directory**:
   ```bash
   cd frontend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env`:
   ```env
   REACT_APP_API_URL=http://localhost:3001
   ```

4. **Start development server**:
   ```bash
   npm start
   ```

5. **Access dashboard**:
   Open browser to `http://localhost:3000`

## 🌐 Railway Deployment

### Deploy Backend

1. **Create new Railway project**
2. **Add PostgreSQL database**:
   - Click "New" → "Database" → "PostgreSQL"
   - Railway auto-sets `DATABASE_URL`

3. **Deploy backend**:
   ```bash
   cd backend
   railway up
   ```

4. **Set environment variables** in Railway dashboard:
   ```
   NODE_ENV=production
   MQTT_BROKER_URL=mqtt://your-broker:1883
   OPENCELLID_API_KEY=your-key
   ENABLE_GEO_ENRICHMENT=true
   FRONTEND_URL=https://your-frontend.up.railway.app
   ```

5. **Run migrations**:
   ```bash
   railway run npm run migrate
   ```

### Deploy Frontend

1. **Create new Railway service** in same project
2. **Deploy frontend**:
   ```bash
   cd frontend
   railway up
   ```

3. **Set environment variables**:
   ```
   REACT_APP_API_URL=https://your-backend.up.railway.app
   ```

4. **Generate domain** in Railway dashboard

## 📊 RUT200 Configuration

### Option 1: RMS OAuth Integration (Recommended - Full Access!)

**No router configuration needed!** The system pulls data directly from RMS with OAuth.

1. **Set up OAuth in RMS Developer Settings**
2. **Add to Railway environment**:
   ```env
   RMS_OAUTH_CLIENT_ID=your-client-id
   RMS_OAUTH_CLIENT_SECRET=your-client-secret
   RMS_OAUTH_REDIRECT_URI=https://your-backend.railway.app/api/auth/rms/callback
   RMS_SYNC_INTERVAL_MINUTES=5
   ```
3. **Done!** Data syncs automatically every 5 minutes with full monitoring access

See [RMS-OAUTH-SETUP.md](docs/RMS-OAUTH-SETUP.md) for detailed instructions.

### Option 2: Using Teltonika RMS (Router Push)

1. **Create Configuration Profile** in RMS
2. **Configure Data to Server**:
   - Type: HTTPS POST or MQTT
   - URL: `https://your-backend.up.railway.app/api/log`
   - Interval: 300 seconds (5 minutes)
   - Format: JSON

3. **JSON Payload Template**:
   ```json
   {
     "device_id": "%s",
     "imei": "%i",
     "timestamp": "%t",
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

4. **Apply Profile** to your router fleet via RMS

See [RMS-CONFIGURATION-GUIDE.md](docs/RMS-CONFIGURATION-GUIDE.md) for detailed instructions.

### MQTT Topics

If using MQTT, routers should publish to:
```
vacatad/rut200/<site_id>/<device_id>/telemetry
```

## 📈 Dashboard Features

### Router List
- View all registered routers
- See online/offline status
- Quick access to router details

### Usage Statistics
- Total data sent/received
- Average signal quality (RSRP, RSSI)
- Average uptime
- WiFi client statistics

### Data Visualization
- Data usage over time (area charts)
- Signal quality trends (line charts)
- WiFi client counts (bar charts)
- Device uptime graphs

### Export & Reporting
- **CSV Export**: Raw logs with all telemetry data
- **PDF Reports**: Professional usage and uptime reports
- **Date Range Filtering**: Any custom date range
- **Quick Presets**: Last 24h, 7d, 30d, 90d

## 🔧 API Endpoints

### POST /api/log
Submit router telemetry data
```bash
curl -X POST https://your-api/api/log \
  -H "Content-Type: application/json" \
  -d @rut200-payload-example.json
```

### GET /api/routers
Get all registered routers

### GET /api/logs
Get logs with optional filters
```
?router_id=RUT200-001&start_date=2025-10-01&end_date=2025-10-16&limit=100
```

### GET /api/stats/usage
Get usage statistics for a router
```
?router_id=RUT200-001&start_date=2025-10-01&end_date=2025-10-16
```

### GET /api/stats/uptime
Get uptime data for a router

## 🗄️ Database Schema

### routers
- Router registration and metadata
- Device serial, IMEI, firmware version
- Last seen timestamp

### router_logs
- Comprehensive telemetry data
- Cell tower information (LAC/TAC/CID)
- Signal quality metrics (RSRP, RSRQ, RSSI, SINR)
- Data counters (TX/RX bytes)
- WiFi client information
- Geolocation (enriched from cell data)

## 🔐 Security Considerations

1. **HTTPS Only**: Always use HTTPS in production
2. **API Authentication**: Add API key validation (optional)
3. **Rate Limiting**: Built-in rate limiting (100 req/15min)
4. **CORS Configuration**: Restrict frontend origins
5. **Data Privacy**: Hash MAC addresses if needed
6. **Environment Variables**: Never commit `.env` files

## 📱 Supported Telemetry Fields

- **Device Info**: ID, IMEI, serial, firmware
- **Network**: Operator, MCC/MNC, network type, WAN IP
- **Cell Tower**: LAC/TAC, Cell ID, band information
- **Signal Quality**: RSRP, RSRQ, RSSI, SINR
- **Data Usage**: Cumulative TX/RX bytes
- **WiFi**: Connected clients with MAC, IP, RSSI
- **System**: Uptime, CPU, memory
- **Location**: Lat/Lon (enriched from cell info)

## 🌍 Cell Tower Geolocation

The system can approximate router location using cell tower information:

1. **Sign up** for OpenCellID (free): https://opencellid.org/
2. **Add API key** to environment variables
3. **Enable enrichment**: `ENABLE_GEO_ENRICHMENT=true`

Location accuracy varies (typically 100m-1km radius) depending on cell density.

## 📝 License

MIT

## 🤝 Support

For issues and questions:
- RUT200 Router: https://wiki.teltonika-networks.com/
- Teltonika RMS: support@teltonika-networks.com
- This Project: Open an issue on GitHub

## 🎯 Roadmap

- [ ] Grafana integration for advanced dashboards
- [ ] Alerting system (email/SMS/webhook)
- [ ] Multi-tenancy support
- [ ] Mobile app for monitoring
- [ ] Advanced analytics and predictions
- [ ] Integration with external CMDB systems
- [ ] GPS support for routers with GPS modules
- [ ] Historical data aggregation for long-term storage

---

**Built for scale** • **Production-ready** • **Easy to deploy**
