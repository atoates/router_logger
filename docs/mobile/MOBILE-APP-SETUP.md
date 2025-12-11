# Mobile App Setup Guide

## ✅ What We've Created

A **separate mobile frontend** application optimized for field installers.

### Structure:
```
frontend-mobile/          # New mobile app
├── src/
│   ├── components/mobile/   # Mobile components (copied from desktop)
│   ├── pages/               # MobilePage
│   ├── services/api.js     # Lightweight API client
│   ├── utils/               # Utilities
│   └── App.js              # Main app
├── package.json            # Minimal dependencies
└── railway.json            # Railway config
```

## 📋 Next Steps

### 1. Install Dependencies

```bash
cd frontend-mobile
npm install
```

### 2. Test Locally

```bash
# Set environment variable
echo "REACT_APP_API_URL=http://localhost:3001" > .env

# Start dev server
npm start
```

### 3. Fix Any Import Issues

The mobile components were copied from desktop. Check for:
- ✅ Import paths (should be `../../services/api`)
- ✅ Missing dependencies
- ✅ Component dependencies

### 4. Railway Deployment

#### Option A: Separate Railway Service (Recommended)

1. **Create new service** in Railway dashboard
2. **Set root directory** to `frontend-mobile`
3. **Set environment variable:**
   ```
   REACT_APP_API_URL=https://your-backend.up.railway.app
   ```
4. **Deploy** - Railway will auto-detect React app

#### Option B: Manual Deploy

```bash
cd frontend-mobile
railway up
```

### 5. Update Backend CORS

The backend needs to allow the mobile app URL:

**Backend Environment Variable:**
```
FRONTEND_URL=https://your-mobile-app.up.railway.app
```

**OR** if you want both desktop and mobile:
- Backend CORS can accept multiple origins (you'll need to update the CORS config)
- Or use a wildcard subdomain pattern

## 🔧 Configuration

### Environment Variables

**Mobile App (.env or Railway):**
```
REACT_APP_API_URL=https://your-backend.up.railway.app
```

**Backend (Railway):**
```
FRONTEND_URL=https://your-mobile-app.up.railway.app
# OR if you want both:
# FRONTEND_URL=https://your-desktop-app.up.railway.app
```

## 📦 Bundle Size Comparison

| App | Bundle Size | Dependencies |
|-----|-------------|--------------|
| Desktop | ~2-3MB | Recharts, PDF, Date pickers, etc. |
| Mobile | ~500KB | Minimal (React, Axios, Toastify) |

## 🎯 Mobile App Features

- ✅ Router search and filtering
- ✅ Location tracking (ClickUp integration)
- ✅ Quick stats view
- ✅ Router assignment
- ✅ PDF installation reports
- ✅ 30-second auto-refresh

## 🔄 Differences from Desktop

| Feature | Desktop | Mobile |
|---------|---------|--------|
| Analytics dashboards | ✅ | ❌ |
| User management | ✅ | ❌ |
| Full charts | ✅ | ❌ |
| PDF reports | ✅ | ✅ |
| Router search | ✅ | ✅ |
| Location tracking | ✅ | ✅ |

## 🐛 Troubleshooting

### Import Errors

If you see import errors:
1. Check import paths in `src/components/mobile/*.js`
2. Verify `src/services/api.js` exists
3. Verify `src/utils/mobileApi.js` exists

### CORS Errors

If mobile app can't connect:
1. Check `REACT_APP_API_URL` is set correctly
2. Check backend `FRONTEND_URL` includes mobile URL
3. Or update backend CORS to accept multiple origins

### Build Errors

```bash
# Clear cache and rebuild
rm -rf node_modules package-lock.json
npm install
npm run build
```

## 📝 Notes

- Mobile app is **completely separate** from desktop
- Shares the same backend API
- Independent deployment
- Can be updated without affecting desktop

## 🚀 Ready to Deploy?

1. ✅ Install dependencies: `npm install`
2. ✅ Test locally: `npm start`
3. ✅ Fix any import issues
4. ✅ Deploy to Railway
5. ✅ Update backend CORS

---

**Status**: ✅ Structure created, ready for testing and deployment!

