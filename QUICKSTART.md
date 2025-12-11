# 🚀 RouterLogger Quick Start Guide

Complete setup guide for getting your RouterLogger system running in production.

---

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [Initial Setup](#initial-setup)
3. [ClickUp Integration](#clickup-integration)
4. [RMS OAuth Setup](#rms-oauth-setup)
5. [Property Management](#property-management)
6. [Local Development](#local-development)
7. [Troubleshooting](#troubleshooting)

---

## 🎯 System Overview

### What You Have

A complete production system for monitoring RUT200 routers with:

- ✅ **Backend API** - Node.js/Express with PostgreSQL
- ✅ **Frontend Dashboard** - React with real-time monitoring
- ✅ **RMS Integration** - Teltonika RMS data sync (15-60 min intervals)
- ✅ **ClickUp Integration** - Task management & router assignments
- ✅ **MQTT/HTTPS Ingestion** - Real-time telemetry processing
- ✅ **Location Tracking** - Router-to-property assignments

### Project Structure

```
RouterLogger/
├── backend/                # Node.js API server
│   ├── src/
│   │   ├── config/        # Database & logger config
│   │   ├── database/      # Schema & migrations (auto-run)
│   │   ├── models/        # Data models
│   │   ├── routes/        # API endpoints
│   │   └── services/      # Business logic & sync services
│   └── package.json
│
├── frontend/              # React dashboard
│   ├── src/
│   │   ├── components/   # UI components
│   │   └── services/     # API client
│   └── package.json
│
├── docs/                  # Documentation
│   ├── archive/          # Completed setup guides
│   ├── ENVIRONMENT-VARIABLES.md
│   ├── MQTT-SETUP-GUIDE.md
│   └── RMS-*.md
│
└── README.md
```

---

## 🔧 Initial Setup

### Prerequisites

- Railway account with deployed services
- ClickUp account (VacatAd workspace)
- Teltonika RMS account
- PostgreSQL database (Railway provides)

### Environment Variables

**Backend Service (Railway):**

```env
# Database (Auto-configured by Railway)
DATABASE_URL=postgresql://...

# RMS Integration
RMS_API_KEY=your_rms_personal_access_token

# ClickUp Integration (see ClickUp section)
CLICKUP_CLIENT_ID=...
CLICKUP_CLIENT_SECRET=...
CLICKUP_REDIRECT_URI=https://your-frontend-url/auth/clickup/callback

# RMS OAuth (see RMS OAuth section)
RMS_OAUTH_CLIENT_ID=...
RMS_OAUTH_CLIENT_SECRET=...
RMS_OAUTH_REDIRECT_URI=https://your-backend-url/api/auth/rms/callback

# Server Config
PORT=3001
NODE_ENV=production
```

**Frontend Service (Railway):**

```env
REACT_APP_API_URL=https://your-backend-url
```

### Database Migrations

✅ **Automatic**: Migrations run automatically on server startup via `src/database/migrate.js`

Current migrations:
- `005_add_oauth_tokens.sql` - OAuth token storage
- `006_add_performance_indexes.sql` - Query optimization
- `007_add_clickup_integration.sql` - ClickUp fields
- `008_add_property_tracking.sql` - Property assignments
- `009_add_out_of_service.sql` - Out-of-service tracking
- `010_add_stored_with_to_property_assignments.sql` - Storage assignments
- `011_convert_to_event_based_tracking.sql` - Event system
- `012_add_location_task_tracking.sql` - Location task links
- `013_add_date_installed.sql` - Installation date tracking

---

## 🔗 ClickUp Integration

### Step 1: Environment Variables

Add to **Backend Service** in Railway:

```env
CLICKUP_CLIENT_ID=JDZL8H4B6MAYI9VZ2BZVQE75ECYL18JX
CLICKUP_CLIENT_SECRET=UDQIT002THHK8ISMINDPVSM18EEISJQPWT765PSRU1HZMA80UNE5ADGUH80UYD9L
CLICKUP_REDIRECT_URI=https://YOUR-FRONTEND-URL/auth/clickup/callback
```

⚠️ Replace `YOUR-FRONTEND-URL` with your actual Railway frontend URL

### Step 2: Update ClickUp OAuth App

1. Go to https://app.clickup.com/settings/apps
2. Click "RouterLogger Dashboard"
3. Add redirect URL: `https://YOUR-FRONTEND-URL/auth/clickup/callback`
4. Save changes

### Step 3: Connect & Use

1. Open Dashboard V3
2. Click **"Connect ClickUp"** button (top right)
3. Authorize access to VacatAd workspace
4. You're connected!

### Features Available

- ✅ Link routers to existing ClickUp tasks
- ✅ Create new router tasks
- ✅ View task status, assignees, due dates
- ✅ One-click access to tasks in ClickUp
- ✅ Automatic router data sync to custom fields (30-min intervals)

### Custom Fields Synced

The system automatically syncs these fields to ClickUp every 30 minutes:

- **Operational Status** - Current router state
- **Firmware** - Current firmware version
- **IMEI** - Device identifier
- **Serial Number** - Hardware serial
- **Last Online** - Last seen timestamp
- **Router Dashboard** - Link to router details

---

## 🔐 RMS OAuth Setup

### Step 1: Create RMS OAuth Application

1. Go to https://rms.teltonika-networks.com/
2. Login → Profile → Developer Settings → OAuth Applications
3. Click **"New Application"**
4. Configure:
   - **Name**: `Router Logger`
   - **Redirect URI**: `https://YOUR-BACKEND-URL/api/auth/rms/callback`
   - **Scopes**: 
     - ✅ `devices:read`
     - ✅ `monitoring:read`
     - ✅ `statistics:read`
5. Click "Create"
6. **Copy Client ID and Client Secret**

### Step 2: Add Environment Variables

Add to **Backend Service** in Railway:

```env
RMS_OAUTH_CLIENT_ID=your_client_id
RMS_OAUTH_CLIENT_SECRET=your_client_secret
RMS_OAUTH_REDIRECT_URI=https://YOUR-BACKEND-URL/api/auth/rms/callback
```

### Step 3: Connect RMS

1. Open frontend dashboard
2. Look for RMS connection section
3. Click **"Connect with RMS"**
4. Login and authorize
5. Connected! Data will sync automatically

### Data Sync

- **RMS Sync**: Runs every 15-60 minutes (adaptive based on data)
- **ClickUp Sync**: Runs every 30 minutes
- Syncs: Router status, firmware, signal quality, network usage

---

## 🏠 Property Management

### Overview

Assign routers to properties using ClickUp tasks with Task Type = "Property".

### Setup Properties in ClickUp

1. Create tasks for your properties
2. Set **Task Type** to "Property"
3. Name: e.g., "Beach House #1"
4. Add custom fields (Address, Beds, etc.)

See `docs/archive/CLICKUP-PROPERTY-TYPE-SETUP.md` for detailed setup.

### Assign Router to Property

**Via Dashboard:**
1. Open router dashboard
2. Scroll to "Location Assignment" widget
3. Search for property by name
4. Select property and assign

**Via API:**
```bash
POST /api/router-properties/assign
{
  "routerId": "6001747099",
  "propertyTaskId": "abc123",
  "installedBy": "John"
}
```

### Key Features

- ✅ Search properties by name
- ✅ Validate Task Type = "Property"
- ✅ Track installation dates
- ✅ Calculate uninstall dates (install + 92 days)
- ✅ View routers by location (Installed Routers tab)
- ✅ View stored routers (Stored With tab)
- ✅ Track who has routers

---

## 💻 Local Development

### Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your credentials
npm run dev
```

### Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env
# Edit .env: REACT_APP_API_URL=http://localhost:3001
npm start
```

### Test API

```bash
# Check health
curl http://localhost:3001/health

# Get routers
curl http://localhost:3001/api/routers

# Get router by ID
curl http://localhost:3001/api/routers/6001747099
```

---

## 🔍 Troubleshooting

### ClickUp Issues

**"No ClickUp token found"**
- Solution: Click "Connect ClickUp" and authorize

**"Routers list not found"**
- Solution: Ensure you have a ClickUp list named "Routers" in VacatAd workspace

**Custom fields not updating**
- Solution: Wait 30 minutes for next sync, or restart backend to trigger immediate sync

### RMS Issues

**"Not connected to RMS"**
- Solution: Complete RMS OAuth setup and click "Connect with RMS"

**Data not syncing**
- Check backend logs for RMS sync errors
- Verify OAuth scopes include `devices:read`, `monitoring:read`, `statistics:read`
- Trigger manual sync: `POST /api/rms/sync`

### Property Assignment Issues

**"Task has Task Type 'X' but needs to be 'Property'"**
- Solution: Change the ClickUp task's Task Type to "Property"

**"Router already assigned to Y"**
- Solution: Unlink from current property first, or use move endpoint

### Date Display Issues

**"Invalid Date" or "Date not set"**
- Dates are stored as Unix timestamps (milliseconds)
- Frontend converts to UK format (DD/MM/YYYY)
- If date shows as "Date not set", run sync: `POST /api/admin/sync-dates`

### General Issues

**Backend not starting**
- Check Railway logs for errors
- Verify all environment variables are set
- Ensure DATABASE_URL is configured

**Frontend 404 errors**
- Verify REACT_APP_API_URL points to correct backend URL
- Check CORS settings in backend

---

## 📚 Additional Documentation

- **Architecture**: `docs/architecture/LOCATION-TRACKING-ARCHITECTURE.md`
- **Property Search**: `docs/guides/PROPERTY-SEARCH-GUIDE.md`
- **Environment Variables**: `docs/ENVIRONMENT-VARIABLES.md`
- **MQTT Setup**: `docs/MQTT-SETUP-GUIDE.md`
- **RMS Configuration**: `docs/RMS-CONFIGURATION-GUIDE.md`
- **Archived Setup Guides**: `docs/archive/`

---

## 🎯 Production URLs

- **Frontend**: https://routerlogger-frontend-production.up.railway.app
- **Backend**: https://routerlogger-production.up.railway.app
- **API Docs**: https://routerlogger-production.up.railway.app/health

---

## 🚀 System Status

✅ **Backend**: Deployed on Railway  
✅ **Frontend**: Deployed on Railway  
✅ **Database**: PostgreSQL on Railway  
✅ **Migrations**: Auto-run on deployment  
✅ **RMS Sync**: Active (15-60 min intervals)  
✅ **ClickUp Sync**: Active (30 min intervals)  
✅ **MQTT Ingestion**: Active  
✅ **Location Tracking**: Active  

---

**Need Help?** Check the docs or review Railway logs for detailed error messages.
