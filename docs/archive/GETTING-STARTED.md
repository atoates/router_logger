# 🚀 Getting Started with RUT200 Router Logger

## What You Have Now

A complete, production-ready system for monitoring your RUT200 router network with:

✅ **Backend API Server** (Node.js/Express)
- MQTT & HTTPS telemetry ingestion
- PostgreSQL database with optimized schema
- Cell tower geolocation enrichment
- RESTful API for data retrieval
- Built-in rate limiting and security

✅ **Frontend Dashboard** (React)
- Real-time router monitoring
- Interactive charts (data usage, signal quality, uptime)
- Date range filtering
- CSV/PDF export functionality
- Responsive, modern UI

✅ **RMS Integration**
- Complete configuration guide for Teltonika RMS
- JSON payload templates
- MQTT and HTTPS setup instructions
- Batch firmware update procedures

✅ **Deployment Ready**
- Railway configuration files
- Environment variable templates
- Database migration scripts
- API testing tools

## 📁 Project Structure

```
RouterLogger/
├── backend/                 # Node.js API server
│   ├── src/
│   │   ├── config/         # Database & logger config
│   │   ├── database/       # Schema & migrations
│   │   ├── models/         # Database models
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # MQTT, telemetry processing, geo
│   │   └── server.js       # Main entry point
│   ├── package.json
│   ├── .env.example
│   └── railway.json
│
├── frontend/               # React dashboard
│   ├── public/
│   ├── src/
│   │   ├── components/    # UI components
│   │   │   ├── RouterList.js
│   │   │   ├── LogsTable.js
│   │   │   ├── UsageStats.js
│   │   │   ├── DataCharts.js
│   │   │   └── DateRangeFilter.js
│   │   ├── services/      # API client
│   │   ├── utils/         # Export utilities
│   │   ├── App.js
│   │   └── index.js
│   ├── package.json
│   ├── .env.example
│   └── railway.json
│
├── docs/                   # Documentation
│   ├── RMS-CONFIGURATION-GUIDE.md
│   ├── MQTT-SETUP-GUIDE.md
│   └── rut200-payload-example.json
│
├── README.md
├── DEPLOYMENT-CHECKLIST.md
└── test-api.sh
```

## 🎯 Next Steps

### 1. Local Development (Optional)

Test the system locally before deploying:

```bash
# 1. Set up backend
cd backend
npm install
cp .env.example .env
# Edit .env with your PostgreSQL credentials
npm run migrate
npm run dev

# 2. Set up frontend (in new terminal)
cd frontend
npm install
cp .env.example .env
# Edit .env with REACT_APP_API_URL=http://localhost:3001
npm start

# 3. Test API
chmod +x test-api.sh
./test-api.sh http://localhost:3001
```

### 2. Deploy to Railway

Follow `DEPLOYMENT-CHECKLIST.md`:

1. **Backend**:
   - Create Railway project
   - Add PostgreSQL database
   - Deploy backend
   - Run migrations
   - Note the URL

2. **Frontend**:
   - Add new service to project
   - Deploy frontend
   - Configure API URL
   - Generate public domain

### 3. Configure RUT200 Routers

Follow `docs/RMS-CONFIGURATION-GUIDE.md`:

1. **In Teltonika RMS**:
   - Create configuration profile
   - Enable "Data to Server"
   - Set endpoint to your Railway backend URL
   - Configure JSON payload template

2. **Pilot Deployment**:
   - Apply to 3-5 test routers
   - Verify data in dashboard
   - Monitor for 24 hours

3. **Full Rollout**:
   - Apply to all routers in batches
   - Monitor via RMS and dashboard

### 4. Optional Enhancements

- **Cell Geolocation**: Sign up for OpenCellID and add API key
- **MQTT Broker**: Set up for production scale (see `docs/MQTT-SETUP-GUIDE.md`)
- **Alerts**: Integrate with your alerting system
- **Backups**: Configure Railway database backups

## 🔑 Key Configuration Files

### Backend `.env`
```env
PORT=3001
NODE_ENV=production
DATABASE_URL=<from-railway>
FRONTEND_URL=https://your-frontend.up.railway.app
OPENCELLID_API_KEY=<optional>
ENABLE_GEO_ENRICHMENT=true
MQTT_BROKER_URL=mqtt://your-broker:1883
```

### Frontend `.env`
```env
REACT_APP_API_URL=https://your-backend.up.railway.app
```

### RMS JSON Template
See `docs/RMS-CONFIGURATION-GUIDE.md` section "Step 3: Configure JSON Payload"

## 📊 Expected Data Flow

1. **Router** sends telemetry every 5 minutes via RMS
2. **Backend** receives data (HTTPS POST to `/api/log`)
3. **Processor** enriches with geolocation (if enabled)
4. **Database** stores telemetry in `router_logs` table
5. **Dashboard** displays real-time data via REST API
6. **User** views charts, exports reports

## 🧪 Testing

### Test API Manually
```bash
curl -X POST https://your-backend.up.railway.app/api/log \
  -H "Content-Type: application/json" \
  -d @docs/rut200-payload-example.json
```

### Check Logs
```bash
# Railway CLI
railway logs

# Or view in Railway dashboard
```

### Verify Dashboard
1. Open frontend URL
2. Should see test router appear in list
3. Click "View" to see details
4. Check charts populate with data

## 📈 Scaling Notes

**Current capacity**: Handles 100+ routers easily

For larger deployments:
- Use MQTT instead of HTTPS (more reliable)
- Consider TimescaleDB extension for PostgreSQL
- Implement data aggregation for old logs
- Add caching layer (Redis)
- Set up monitoring (Grafana/Prometheus)

## 🆘 Troubleshooting

### Routers not sending data?
1. Check RMS configuration profile is applied
2. Verify router has internet connection
3. Check RMS device logs
4. Test API endpoint with curl

### Dashboard not showing data?
1. Check browser console for errors
2. Verify API_URL in frontend .env
3. Check backend logs
4. Verify CORS settings

### Database errors?
1. Check DATABASE_URL is set correctly
2. Run migrations: `railway run npm run migrate`
3. Check Railway PostgreSQL logs

## 📚 Documentation

- `README.md` - Main documentation
- `DEPLOYMENT-CHECKLIST.md` - Step-by-step deployment
- `docs/RMS-CONFIGURATION-GUIDE.md` - RUT200 setup
- `docs/MQTT-SETUP-GUIDE.md` - MQTT broker options
- `docs/rut200-payload-example.json` - Sample data

## 🎓 Learning Resources

- [Teltonika RUT200 Wiki](https://wiki.teltonika-networks.com/view/RUT200)
- [RMS Documentation](https://wiki.teltonika-networks.com/view/RMS)
- [Railway Documentation](https://docs.railway.app/)
- [OpenCellID](https://opencellid.org/)

## ✅ Success Criteria

You'll know it's working when:
- ✅ Routers appear in dashboard after sending first telemetry
- ✅ Charts populate with data over time
- ✅ Signal quality metrics are visible
- ✅ Data usage is being tracked
- ✅ You can export CSV/PDF reports
- ✅ Date filtering works correctly

## 🚀 Launch Checklist

Before going live with all 100+ routers:

- [ ] Backend deployed and accessible
- [ ] Frontend deployed and accessible
- [ ] Database initialized with schema
- [ ] RMS configuration profile created
- [ ] Pilot group (3-5 routers) configured and sending data
- [ ] Dashboard showing pilot router data
- [ ] Charts displaying correctly
- [ ] Export functionality tested
- [ ] Documentation reviewed
- [ ] Backup strategy in place
- [ ] Monitoring/alerting configured (optional)

---

**You're all set!** 🎉

This system is production-ready and designed to scale. Start with a pilot deployment, verify everything works, then roll out to your full fleet.

Questions? Check the documentation or review the inline code comments.

Happy monitoring! 📡
