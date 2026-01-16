# User Authentication Implementation Guide

## Overview

Complete user authentication system with role-based access control (Admin/Guest) for the RouterLogger application. Implementation is split into phases with safety mechanisms.

## Status: **Phase 1 & 2 COMPLETE** ✅

### Phase 1: Backend Foundation ✅
- Database schema (migration 008)
- Authentication service
- Enhanced session middleware
- Feature flag system

### Phase 2: API Routes & Protection ✅
- User management API routes
- Protected existing endpoints
- Role-based access control

### Phase 3: Frontend (TODO)
- Login page
- Auth context
- Users management tab
- Guest dashboard

## Feature Flag (CRITICAL)

**Default:** `ENABLE_AUTH=false` (authentication disabled)
**Enable:** Set environment variable `ENABLE_AUTH=true`

When disabled, all auth middleware passes through and acts as if user is admin. This ensures backwards compatibility and safe rollout.

## Database Schema

### Tables Created (Migration 008)

#### `users`
- `id` (serial, primary key)
- `username` (varchar(50), unique, not null)
- `password_hash` (varchar(255), not null)
- `role` (varchar(20), not null) - 'admin' or 'guest'
- `email` (varchar(255))
- `full_name` (varchar(100))
- `is_active` (boolean, default true)
- `last_login` (timestamp)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `created_by` (integer, references users)

#### `user_router_assignments`
- `id` (serial, primary key)
- `user_id` (integer, references users)
- `router_id` (varchar(50), references routers)
- `assigned_at` (timestamp)
- `assigned_by` (integer, references users)
- `notes` (text)
- **UNIQUE constraint** on (user_id, router_id)

#### `user_login_history`
- `id` (serial, primary key)
- `user_id` (integer, references users)
- `login_at` (timestamp)
- `ip_address` (varchar(45))
- `user_agent` (text)
- `success` (boolean)

## Default Admin Users

Created by `backend/seed_admins.js` script:

| Username | Password | Role |
|----------|----------|------|
| admin1 | VacatAd2025!Admin1 | admin |
| admin2 | VacatAd2025!Admin2 | admin |
| admin3 | VacatAd2025!Admin3 | admin |

**Override passwords:** Set environment variables:
- `ADMIN1_PASSWORD`
- `ADMIN2_PASSWORD`
- `ADMIN3_PASSWORD`

## Authentication Service (`backend/src/services/authService.js`)

### User Management
- `createUser({ username, password, role, email, fullName, createdBy })` - Create user with bcrypt hashed password
- `getUserById(userId)` - Get user by ID (no password)
- `getUserByUsername(username)` - Get user by username (no password)
- `listUsers({ includeInactive })` - Get all users
- `updateUser(userId, { email, full_name, is_active })` - Update user details
- `changePassword(userId, newPassword)` - Change user password
- `deactivateUser(userId)` - Soft delete (is_active=false)
- `reactivateUser(userId)` - Restore user (is_active=true)

### Authentication
- `authenticateUser(username, password, ipAddress, userAgent)` - Login user, returns user object or null
- `getLoginHistory(userId, limit)` - Get login attempts for auditing

### Router Access Control
- `getUserRouters(userId)` - Get assigned routers for guest user
- `assignRouter(userId, routerId, assignedBy, notes)` - Assign router to guest
- `unassignRouter(userId, routerId)` - Remove router assignment
- `hasRouterAccess(userId, routerId)` - Check if user can access router (admins=all, guests=assigned only)

## Session Middleware (`backend/src/routes/session.js`)

### Middleware Functions

#### `requireAuth(req, res, next)`
- Validates session exists
- Attaches `req.user` with `{ id, username, role }`
- Returns 401 if not authenticated
- **When AUTH_ENABLED=false:** Passes through with mock admin user

#### `requireAdmin(req, res, next)`
- Like `requireAuth` but checks `req.user.role === 'admin'`
- Returns 403 if not admin
- **When AUTH_ENABLED=false:** Passes through

#### `requireRouterAccess(req, res, next)`
- Checks if user can access specific router
- Extracts `routerId` from `req.params.routerId`, `req.body.router_id`, or `req.query.router_id`
- Admins: Always have access
- Guests: Checked via `authService.hasRouterAccess()`
- Returns 403 if no access
- **When AUTH_ENABLED=false:** Passes through

#### `requireSession(req, res, next)` (Backwards Compatible)
- Alias to `requireAuth()` for existing code
- Maintains backwards compatibility

### Login Endpoint

**POST /api/session/login**
```json
{
  "username": "admin1",
  "password": "VacatAd2025!Admin1"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "user": {
    "id": 1,
    "username": "admin1",
    "role": "admin",
    "email": "admin1@vacatracker.com",
    "fullName": "Admin User 1"
  }
}
```

Session stored server-side in Map with 7-day expiry. Session cookie: `sessionId`.

## User Management API Routes (`backend/src/routes/users.js`)

All routes require admin access except `/me`.

### Endpoints

#### `GET /api/users/me`
Get current authenticated user info.
- **Auth:** requireAuth (any authenticated user)

#### `GET /api/users`
List all users.
- **Auth:** requireAdmin
- **Query params:** `include_inactive=true` (optional)

#### `POST /api/users`
Create new user (admin or guest).
- **Auth:** requireAdmin
- **Body:** `{ username, password, role, email, fullName }`
- **Validation:** Username unique, role must be 'admin' or 'guest'

#### `GET /api/users/:userId`
Get user details.
- **Auth:** requireAdmin

#### `PATCH /api/users/:userId`
Update user details (email, full_name, is_active).
- **Auth:** requireAdmin
- **Body:** `{ email, fullName, isActive }`

#### `POST /api/users/:userId/password`
Change user password.
- **Auth:** requireAdmin
- **Body:** `{ newPassword }`
- **Validation:** Minimum 8 characters

#### `DELETE /api/users/:userId`
Deactivate user (soft delete).
- **Auth:** requireAdmin
- **Protection:** Cannot deactivate yourself

#### `POST /api/users/:userId/reactivate`
Reactivate deactivated user.
- **Auth:** requireAdmin

#### `GET /api/users/:userId/routers`
Get user's assigned routers.
- **Auth:** requireAdmin

#### `POST /api/users/:userId/routers/:routerId`
Assign router to user.
- **Auth:** requireAdmin
- **Body:** `{ notes }` (optional)

#### `DELETE /api/users/:userId/routers/:routerId`
Unassign router from user.
- **Auth:** requireAdmin

#### `GET /api/users/:userId/login-history`
Get user's login history.
- **Auth:** requireAdmin
- **Query params:** `limit=50` (optional)

## Protected Routes

### Admin Only (requireAdmin)
- All `/api/clickup/*` endpoints
- All `/api/rms/*` endpoints
- All `/api/auth/*` endpoints (OAuth)
- All `/api/monitoring/*` endpoints
- All `/api/users/*` endpoints (except `/me`)
- Router modification endpoints:
  - `POST /api/admin/sync-dates`
  - `POST /api/inspections/:routerId`
  - `POST /api/clear-clickup-tasks`
  - `POST /api/routers/:routerId/link-location`
  - `POST /api/routers/:routerId/unlink-location`
  - `POST /api/routers/:routerId/assign`
  - `POST /api/routers/:routerId/remove-assignees`
  - `PATCH /api/routers/:router_id/status`
  - `PATCH /api/routers/:router_id/notes`

### Public (No Auth Required)
- `POST /api/log` - MQTT telemetry ingestion
- `POST /api/guests/captive-portal/event` - Guest WiFi webhook (RADIUS/captive portal)
- `POST /api/ironwifi/webhook` - Guest WiFi webhook (deprecated, kept for compatibility)
- `GET /health` - Health check
- `GET /` - API info

### Guest Access (TODO - Phase 3)
Read-only router endpoints will be filtered by assigned routers:
- `GET /api/routers` - Filter to show only assigned routers
- `GET /api/logs` - Filter to assigned routers' logs
- `GET /api/routers/:routerId/*` - Use requireRouterAccess middleware

## Deployment Steps

### 1. Deploy Phase 1 & 2 (Backend)
```bash
# Already committed - push to Railway
git push origin main
```

Migration 008 will run automatically on server startup.

### 2. Seed Admin Users
```bash
# Option A: Default passwords
railway run node backend/seed_admins.js

# Option B: Custom passwords (recommended)
railway run -e ADMIN1_PASSWORD=YourSecurePassword1 \
            -e ADMIN2_PASSWORD=YourSecurePassword2 \
            -e ADMIN3_PASSWORD=YourSecurePassword3 \
            node backend/seed_admins.js
```

### 3. Test Authentication (Optional - Auth Disabled by Default)
```bash
# Enable auth in Railway dashboard
ENABLE_AUTH=true

# Test login with curl
curl -X POST https://your-backend.railway.app/api/session/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin1","password":"VacatAd2025!Admin1"}'

# Test protected endpoint
curl -X GET https://your-backend.railway.app/api/users \
  -H "Cookie: sessionId=YOUR_SESSION_ID"
```

### 4. Deploy Phase 3 (Frontend - TODO)
After implementing frontend login page and auth context:
```bash
git push origin main
```

### 5. Enable Authentication in Production
Set environment variable in Railway:
```bash
ENABLE_AUTH=true
```

## Rollback Plan

### Instant Disable
Set environment variable:
```bash
ENABLE_AUTH=false
```

All routes will work without authentication. Sessions are ignored.

### Complete Rollback
1. Set `ENABLE_AUTH=false`
2. No database rollback needed (tables are additive)
3. Frontend will continue to work (shows all content when auth fails)

## Security Considerations

### Password Security
- bcrypt with 10 salt rounds
- Passwords never logged or exposed in responses
- Minimum 8 character requirement

### Session Security
- HttpOnly cookies
- Secure flag in production
- SameSite=Lax (CSRF protection)
- 7-day expiry
- Server-side session storage (in-memory Map)
- Session ID: crypto.randomBytes(32)

### Rate Limiting
- Existing rate limiter applies to all API routes (100 req/15min default)
- Login endpoint included in rate limiting
- Protects against brute force attacks

### Audit Trail
- All login attempts logged (success/failure)
- IP address and user agent tracked
- Login history available for review
- Router assignments tracked with assigner_id

### Protection Against Common Attacks
- SQL injection: Parameterized queries throughout
- CSRF: SameSite cookies + server-side state validation
- XSS: No user input rendered directly in responses
- Timing attacks: bcrypt.compare handles timing-safe comparison

## TODO: Phase 3 - Frontend Implementation

### 3.1 Authentication Context (`frontend/src/contexts/AuthContext.js`)
```javascript
const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const login = async (username, password) => {
    // POST /api/session/login
    // Store session, set currentUser
  };
  
  const logout = async () => {
    // POST /api/session/logout
    // Clear currentUser
  };
  
  const checkAuth = async () => {
    // GET /api/users/me
    // Set currentUser if valid session
  };
  
  useEffect(() => {
    checkAuth();
  }, []);
  
  return (
    <AuthContext.Provider value={{ currentUser, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

### 3.2 Login Page (`frontend/src/components/LoginPage.js`)
- Username/password form
- Error handling
- Redirect to dashboard on success
- Redirect to guest dashboard if guest role

### 3.3 Protected Route Component (`frontend/src/components/ProtectedRoute.js`)
```javascript
function ProtectedRoute({ children, requireAdmin = false }) {
  const { currentUser, loading } = useAuth();
  
  if (loading) return <Loading />;
  if (!currentUser) return <Navigate to="/login" />;
  if (requireAdmin && currentUser.role !== 'admin') {
    return <Navigate to="/guest-dashboard" />;
  }
  
  return children;
}
```

### 3.4 App Router Updates (`frontend/src/App.js`)
```javascript
<AuthProvider>
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    
    <Route path="/admin/*" element={
      <ProtectedRoute requireAdmin>
        <AdminDashboard />
      </ProtectedRoute>
    } />
    
    <Route path="/guest/*" element={
      <ProtectedRoute>
        <GuestDashboard />
      </ProtectedRoute>
    } />
  </Routes>
</AuthProvider>
```

### 3.5 Users Management Tab (Admin Only)
- List all users (table)
- Create guest user (modal/form)
- Edit user details
- Deactivate/reactivate toggle
- Change password (modal)
- Router assignment UI (multi-select)
- View login history (modal)

### 3.6 Guest Dashboard
- Show only assigned routers
- Read-only router cards
- Simplified navigation (hide admin tabs)
- Router detail view (read-only)
- Last seen, status, usage stats

## Testing Checklist

### Backend Tests
- ✅ Migration 008 created
- ✅ Auth service functions
- ✅ Session middleware
- ✅ User management API routes
- ⏳ Migration 008 deployed
- ⏳ Admin users seeded
- ⏳ Test login endpoint
- ⏳ Test admin access to protected routes
- ⏳ Test 403 on admin routes without admin role
- ⏳ Test AUTH_ENABLED=false (bypass auth)

### Frontend Tests (TODO)
- ⏳ Login page renders
- ⏳ Login with admin1 succeeds
- ⏳ Login with wrong password fails
- ⏳ Protected routes redirect to login
- ⏳ Admin can access users management
- ⏳ Guest cannot access admin routes
- ⏳ Guest sees only assigned routers
- ⏳ Logout works correctly

### Integration Tests (TODO)
- ⏳ Create guest user from admin UI
- ⏳ Assign router to guest
- ⏳ Login as guest, verify can only see assigned router
- ⏳ Try to access unassigned router (should 403)
- ⏳ Deactivate user, verify login fails
- ⏳ Change password, verify old password fails
- ⏳ Login history tracking works

## Timeline

- **Phase 1:** Backend Foundation - **COMPLETE** ✅ (2 hours)
- **Phase 2:** API Routes & Protection - **COMPLETE** ✅ (3 hours)
- **Phase 3:** Frontend Login & Auth - TODO (4 hours)
- **Phase 4:** Users Management Tab - TODO (5 hours)
- **Phase 5:** Guest Dashboard - TODO (3 hours)
- **Testing & Fixes:** TODO (3 hours)

**Total Estimated:** 20 hours
**Completed:** 5 hours (Phase 1 & 2)
**Remaining:** 15 hours (Phase 3-5 + Testing)

## Support

For issues or questions:
1. Check if `ENABLE_AUTH=false` (default - auth disabled)
2. Check Railway logs for authentication errors
3. Verify migration 008 ran successfully
4. Verify admin users were seeded
5. Test with curl/Postman before frontend
6. Review login history for failed attempts

## References

- `backend/database/migrations/008_add_user_authentication.sql` - Database schema
- `backend/src/services/authService.js` - Authentication service
- `backend/src/routes/session.js` - Session middleware
- `backend/src/routes/users.js` - User management API
- `backend/seed_admins.js` - Admin seeding script
- `docs/USER-AUTH-ANALYSIS.md` - Feasibility analysis
