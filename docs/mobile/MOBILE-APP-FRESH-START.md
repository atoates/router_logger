# Mobile App - Fresh Start Plan

## ✅ Cleanup Complete

**Removed from Desktop App:**
- ❌ MobilePage component and route
- ❌ Mobile redirect logic
- ❌ Mobile components directory
- ❌ Mobile API utilities

**Removed from Backend:**
- ❌ GET /api/session/login auto-login endpoint (security risk)

**Kept:**
- ✅ `frontend-mobile/` directory structure (ready for fresh build)
- ✅ Backend API endpoints (will create mobile-specific ones)

---

## 🎯 Fresh Mobile App Design

### Core Principles

1. **Security First**
   - Proper username/password authentication
   - Database-backed sessions (not in-memory)
   - Role-based access control
   - No admin endpoints exposed to mobile

2. **Mobile-Specific API**
   - `/api/mobile/v1/*` endpoints
   - Lean payloads (only what mobile needs)
   - Scoped data (only assigned routers)
   - Mobile-specific rate limits

3. **Field Installer Focus**
   - Router search (assigned routers only)
   - Installation tracking
   - Quick stats
   - Location linking
   - Inspection logging

4. **Proper Architecture**
   - Separate from desktop
   - Independent deployment
   - Clean codebase
   - No security shortcuts

---

## 📋 Implementation Plan

### Phase 1: Backend Mobile API (Week 1)

**1. Database Sessions**
- Create `sessions` table
- Move from in-memory Map to database
- Add session refresh tokens
- Add device tracking

**2. Mobile API Endpoints**
```
GET  /api/mobile/v1/routers          # Only assigned routers
GET  /api/mobile/v1/routers/:id      # Router details
GET  /api/mobile/v1/routers/:id/stats # Quick stats
POST /api/mobile/v1/routers/:id/install # Mark installed
POST /api/mobile/v1/routers/:id/inspect # Log inspection
GET  /api/mobile/v1/locations         # Available locations
POST /api/mobile/v1/routers/:id/link-location # Link router
```

**3. Role-Based Access**
- `field_tech` role (new)
- Can only see assigned routers
- Can mark installations
- Can log inspections
- Cannot assign/unassign routers
- Cannot access admin endpoints

**4. Authentication**
- POST /api/mobile/v1/auth/login (username + password)
- POST /api/mobile/v1/auth/refresh (refresh token)
- POST /api/mobile/v1/auth/logout
- GET  /api/mobile/v1/auth/me (current user)

### Phase 2: Mobile Frontend (Week 2)

**1. Clean React App**
- Fresh `frontend-mobile/` build
- Proper authentication flow
- Role-based UI
- Error handling

**2. Core Features**
- Login screen (username + password)
- Router list (assigned only)
- Router details
- Installation workflow
- Inspection logging
- Quick stats

**3. Mobile Optimizations**
- Touch-friendly UI
- Offline support (localStorage cache)
- Push notifications (future)
- Fast load times

### Phase 3: Testing & Deployment (Week 3)

**1. Security Testing**
- Authentication flow
- Role-based access
- Session management
- API security

**2. User Testing**
- Field installer workflow
- Installation process
- Inspection logging

**3. Deployment**
- Railway setup
- Environment variables
- CORS configuration
- Monitoring

---

## 🔐 Security Requirements

### Authentication
- ✅ Username + password (required)
- ✅ Database sessions (not in-memory)
- ✅ Refresh tokens
- ✅ Session expiry (7 days)
- ✅ Device tracking

### Authorization
- ✅ Role-based access (`field_tech` role)
- ✅ Router scoping (assigned only)
- ✅ No admin endpoints
- ✅ Audit logging

### API Security
- ✅ Rate limiting (mobile-specific)
- ✅ Input validation
- ✅ Error sanitization
- ✅ HTTPS only

---

## 📱 Mobile App Features

### Must Have (MVP)
1. **Authentication**
   - Login (username + password)
   - Session management
   - Logout

2. **Router Management**
   - View assigned routers
   - Search/filter routers
   - View router details
   - Quick stats

3. **Installation Workflow**
   - Mark router as installed
   - Link to location
   - Log inspection
   - Generate report

### Nice to Have (Future)
- Offline mode
- Push notifications
- Photo uploads
- GPS tracking
- Barcode scanning

---

## 🏗️ Architecture

```
Backend:
├── /api/mobile/v1/*          # Mobile-specific endpoints
├── Database sessions          # Proper session storage
└── Role-based middleware     # field_tech role

Frontend Mobile:
├── Authentication flow        # Login/logout
├── Router management         # Assigned routers only
├── Installation workflow     # Install/inspect
└── Clean, secure code        # No shortcuts
```

---

## 🚀 Next Steps

1. **Design mobile API endpoints** (document first)
2. **Implement database sessions** (backend)
3. **Create mobile API routes** (backend)
4. **Build fresh mobile frontend** (frontend-mobile/)
5. **Test end-to-end** (authentication → workflow)
6. **Deploy** (Railway)

---

## 📝 Notes

- **No shortcuts** - Proper security from day 1
- **Clean codebase** - No legacy mobile code
- **Mobile-first** - Designed for field installers
- **Scalable** - Can grow with needs

---

**Status**: ✅ Cleanup complete, ready for fresh start!




