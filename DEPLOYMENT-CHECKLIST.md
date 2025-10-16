# Quick Deployment Checklist

## Prerequisites
- [ ] Railway account created
- [ ] RMS account with RUT200 routers registered
- [ ] OpenCellID API key (optional, for geolocation)
- [ ] MQTT broker (if using MQTT instead of HTTPS)

## Backend Deployment

- [ ] Create new Railway project
- [ ] Add PostgreSQL database to project
- [ ] Deploy backend code to Railway
- [ ] Set environment variables in Railway:
  - `NODE_ENV=production`
  - `MQTT_BROKER_URL` (if using MQTT)
  - `OPENCELLID_API_KEY` (if using geolocation)
  - `ENABLE_GEO_ENRICHMENT=true`
  - `FRONTEND_URL` (will set after frontend deployment)
- [ ] Run database migration: `railway run npm run migrate`
- [ ] Note backend URL for frontend configuration

## Frontend Deployment

- [ ] Create new service in same Railway project
- [ ] Deploy frontend code to Railway
- [ ] Set environment variable:
  - `REACT_APP_API_URL=<your-backend-url>`
- [ ] Generate public domain in Railway
- [ ] Update backend `FRONTEND_URL` with frontend URL
- [ ] Test dashboard access

## RUT200 Configuration (RMS)

- [ ] Log in to Teltonika RMS
- [ ] Create new Configuration Profile
- [ ] Enable "Data to Server" feature
- [ ] Configure endpoint:
  - URL: `https://<your-backend-url>/api/log`
  - Method: POST
  - Interval: 300 seconds (5 minutes)
- [ ] Set JSON payload template (see RMS-CONFIGURATION-GUIDE.md)
- [ ] Create router groups (by site/location)
- [ ] Apply configuration profile to pilot routers (3-5)
- [ ] Verify data is arriving in dashboard
- [ ] Apply to remaining routers in batches

## Testing

- [ ] Send test telemetry payload to API
- [ ] Verify router appears in dashboard
- [ ] Check logs are being recorded
- [ ] Verify charts are displaying data
- [ ] Test CSV export
- [ ] Test PDF report generation
- [ ] Test date range filtering

## Production Readiness

- [ ] Set up monitoring alerts
- [ ] Configure database backups
- [ ] Document API endpoints
- [ ] Create runbook for common issues
- [ ] Set up log rotation
- [ ] Plan data retention policy

## Scaling Considerations (for 100+ routers)

- [ ] Consider MQTT over HTTPS for reliability
- [ ] Monitor database size and performance
- [ ] Set up database indexes (already included)
- [ ] Configure Railway auto-scaling
- [ ] Implement data aggregation for old records
- [ ] Consider CDN for frontend
