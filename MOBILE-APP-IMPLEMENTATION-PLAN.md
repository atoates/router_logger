# Mobile App Implementation Plan

**Status**: 🚀 Ready to Build  
**Target**: Field installer mobile application  
**Timeline**: 8-10 hours of focused development

---

## 🎯 Core Features

### 1. Authentication System
- **Login Page**: Username + password form
- **Session Management**: Auto-include token, auto-logout on 401
- **Protected Routes**: Redirect to login if not authenticated

### 2. Main Pages (Tab Navigation)
- **Search**: Router search, filter, assignment status
- **Location**: ClickUp location linking, view current location
- **Stats**: 24h stats, uptime, data usage, PDF reports
- **Settings**: Logout, user info, app version

### 3. Mobile-Optimized UI
- Bottom tab navigation
- Touch-friendly buttons
- Fast loading states
- Error handling with retry

---

## 📋 Implementation Steps

### Phase 1: Authentication & Routing (2-3 hours)

#### Step 1.1: Create Auth Context
**File**: `frontend-mobile/src/contexts/AuthContext.js`
- Store current user state
- Login/logout functions
- Session verification
- Auto-redirect on 401

#### Step 1.2: Create Login Page
**File**: `frontend-mobile/src/pages/LoginPage.js`
- Username + password form
- Error handling
- Loading states
- Redirect after successful login

#### Step 1.3: Set Up Routing
**File**: `frontend-mobile/src/App.js`
- React Router setup
- Protected route wrapper
- Route structure:
  - `/login` - Login page
  - `/` - Main app (tabs)

---

### Phase 2: Core Pages (4-5 hours)

#### Step 2.1: Main Layout with Tabs
**File**: `frontend-mobile/src/components/MobileLayout.js`
- Bottom tab navigation
- Tab icons (Search, Location, Stats, Settings)
- Active tab highlighting

#### Step 2.2: Search Page
**File**: `frontend-mobile/src/pages/SearchPage.js`
- Router search input
- Filter by status (online/offline)
- Router cards with:
  - Router ID, name
  - Online/offline status
  - Assignment status
  - Quick actions (view details, assign)
- Pull-to-refresh

#### Step 2.3: Location Page
**File**: `frontend-mobile/src/pages/LocationPage.js`
- ClickUp location search
- Link router to location
- View current router location
- Unlink location (if needed)

#### Step 2.4: Stats Page
**File**: `frontend-mobile/src/pages/StatsPage.js`
- 24-hour stats summary
- Uptime percentage
- Data usage
- Installation report generation (PDF)
- Quick router status overview

#### Step 2.5: Settings Page
**File**: `frontend-mobile/src/pages/SettingsPage.js`
- Current user info
- Logout button
- App version
- About section

---

### Phase 3: UI Components & Polish (2-3 hours)

#### Step 3.1: Reusable Components
**Files**: `frontend-mobile/src/components/`
- `RouterCard.js` - Router display card
- `LoadingSpinner.js` - Loading indicator
- `ErrorMessage.js` - Error display with retry
- `Button.js` - Touch-friendly button
- `Input.js` - Form input

#### Step 3.2: Styling
**Files**: `frontend-mobile/src/`
- `App.css` - Global styles
- Component-specific CSS files
- Mobile-first responsive design
- Touch targets (min 44x44px)

#### Step 3.3: Error Handling
- Network error detection
- 401 auto-logout
- Retry mechanisms
- User-friendly error messages

---

## 🗂️ File Structure

```
frontend-mobile/src/
├── App.js                    # Main app with routing
├── App.css                   # Global styles
├── contexts/
│   └── AuthContext.js        # Authentication context
├── components/
│   ├── MobileLayout.js       # Main layout with tabs
│   ├── RouterCard.js         # Router display card
│   ├── LoadingSpinner.js    # Loading indicator
│   ├── ErrorMessage.js       # Error display
│   ├── Button.js             # Touch-friendly button
│   └── Input.js              # Form input
├── pages/
│   ├── LoginPage.js          # Login page
│   ├── SearchPage.js         # Router search
│   ├── LocationPage.js       # Location linking
│   ├── StatsPage.js          # Statistics
│   └── SettingsPage.js       # Settings
├── services/
│   └── api.js                # ✅ Already exists
└── utils/
    └── installationReport.js # ✅ Already exists (PDF)
```

---

## 🔌 API Endpoints Used

### Authentication
- `POST /api/session/login` - Login
- `GET /api/session/verify` - Verify session
- `POST /api/session/logout` - Logout

### Routers
- `GET /api/routers` - List routers (filtered by assignment for guests)
- `GET /api/routers/:id` - Router details
- `POST /api/routers/:id/assign` - Assign router (admin only)
- `PATCH /api/routers/:id/status` - Update status

### Location
- `POST /api/routers/:id/link-location` - Link to ClickUp location
- `GET /api/routers/:id/current-location` - Get current location

### ClickUp
- `GET /api/clickup/workspaces` - Get workspaces
- `GET /api/clickup/lists/:workspaceId` - Get lists
- `GET /api/clickup/tasks/:listId` - Search tasks

### Stats
- `GET /api/stats/usage` - Usage stats
- `GET /api/stats/uptime` - Uptime data

---

## 🎨 Design Principles

### Mobile-First
- Touch-friendly (min 44x44px targets)
- Large, readable text
- Bottom navigation (thumb-friendly)
- Fast loading (< 2s initial load)

### User Experience
- Clear error messages
- Loading indicators
- Pull-to-refresh
- Offline detection

### Security
- Token in localStorage (for now)
- Auto-logout on 401
- No sensitive data in logs

---

## ✅ Success Criteria

1. **Authentication**: Users can log in and stay logged in
2. **Navigation**: Smooth tab navigation between pages
3. **Search**: Fast router search and filtering
4. **Location**: Easy location linking workflow
5. **Stats**: Quick access to router statistics
6. **Offline**: Graceful handling of network errors
7. **Performance**: Fast page loads, smooth interactions

---

## 🚀 Next Steps

1. **Start with Phase 1**: Build authentication and routing foundation
2. **Then Phase 2**: Build core pages one by one
3. **Finally Phase 3**: Polish UI and error handling

**Ready to begin?** Let's start with Phase 1!




