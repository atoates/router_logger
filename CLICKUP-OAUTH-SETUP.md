# ClickUp OAuth Integration Setup Guide

## ✅ What's Been Completed

1. **Backend Services Created:**
   - `clickupOAuthService.js` - Handles OAuth flow and token management
   - `clickupClient.js` - ClickUp API wrapper for all operations
   - `routes/clickup.js` - API endpoints for OAuth and task management

2. **Database Schema:**
   - Added `clickup_task_id`, `clickup_task_url`, `clickup_list_id` columns to `routers` table
   - Created `clickup_oauth_tokens` table for storing OAuth tokens
   - Indexes created for performance

3. **API Endpoints Ready:**
   - `GET /api/clickup/auth/status` - Check if user is authorized
   - `GET /api/clickup/auth/url` - Get OAuth authorization URL
   - `GET /api/clickup/auth/callback` - Handle OAuth callback
   - `POST /api/clickup/auth/disconnect` - Disconnect ClickUp
   - `GET /api/clickup/workspaces` - Get authorized workspaces
   - `GET /api/clickup/lists/:workspaceId` - Find "Routers" list
   - `GET /api/clickup/tasks/:listId` - Get tasks from list
   - `POST /api/clickup/tasks/:listId` - Create new task
   - `POST /api/clickup/link-router` - Link router to task
   - `DELETE /api/clickup/link-router/:routerId` - Unlink router
   - `GET /api/clickup/router-task/:routerId` - Get linked task details

---

## 🔧 Required Setup Steps

### Step 1: Create ClickUp OAuth App

1. Go to https://app.clickup.com/settings/apps
2. Click **"Create new app"**
3. Fill in:
   - **App Name**: `RouterLogger Dashboard`
   - **Redirect URLs** (add BOTH):
     - Development: `http://localhost:3000/auth/clickup/callback`
     - Production: `https://YOUR-FRONTEND-URL.railway.app/auth/clickup/callback`
4. Click **Create**
5. Copy your credentials:
   - **Client ID** - (long string)
   - **Client Secret** - (keep this secure!)

### Step 2: Add Environment Variables

**Railway Backend Service:**

Add these environment variables:

```
CLICKUP_CLIENT_ID=your_client_id_here
CLICKUP_CLIENT_SECRET=your_client_secret_here
CLICKUP_REDIRECT_URI=https://YOUR-FRONTEND-URL.railway.app/auth/clickup/callback
```

**For Local Development (`.env` file):**

```
CLICKUP_CLIENT_ID=your_client_id_here
CLICKUP_CLIENT_SECRET=your_client_secret_here
CLICKUP_REDIRECT_URI=http://localhost:3000/auth/clickup/callback
```

### Step 3: Frontend Components Needed

I'll create these next once you provide the OAuth credentials:

1. **ClickUpAuthButton Component** - Initiates OAuth flow
2. **ClickUpTaskLinker Component** - Links routers to tasks
3. **ClickUpTaskBadge Component** - Displays linked task info
4. **CreateTaskModal Component** - Create tasks from router dashboard

---

## 📋 How It Will Work

### OAuth Flow:
1. User clicks "Connect ClickUp" button in dashboard
2. Redirected to ClickUp authorization page
3. User grants access to "VacatAd" workspace
4. Redirected back with authorization code
5. Backend exchanges code for access token
6. Token stored in database

### Linking Routers to Tasks:
1. On router dashboard, user can:
   - **Link to Existing Task** - Search "Routers" list and select task
   - **Create New Task** - Quick-create task with router context
2. Task info displayed on router card (status, assignees, due date)
3. Click task badge to open in ClickUp

### Task Creation:
- Auto-fills router name in task description
- Tags task with "router"
- Sets normal priority by default
- Creates in "Routers" list automatically

---

## 🎯 Next Steps

**Please provide:**
1. ✅ Your ClickUp OAuth **Client ID**
2. ✅ Your ClickUp OAuth **Client Secret**
3. ✅ Your production frontend URL (Railway deployment)

**Then I'll:**
1. Create frontend OAuth components
2. Add task linking UI to RouterDashboard
3. Build task creation modal
4. Test complete flow
5. Deploy to production

---

## 🔒 Security Notes

- OAuth tokens never expire (ClickUp design)
- Tokens stored encrypted in PostgreSQL
- CSRF protection via state parameter
- Uses your personal token (`pk_*`) for initial testing only
- Production uses OAuth for proper security

---

## 🎨 UI Preview (What We'll Build)

```
┌─────────────────────────────────────┐
│ Dashboard V3                        │
│ ┌─────────────────────────────────┐ │
│ │ ClickUp Status: Connected ✓     │ │
│ │ Workspace: VacatAd              │ │
│ │ [Disconnect]                    │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Router #9                           │
│ ┌─────────────────────────────────┐ │
│ │ ClickUp Task: Router Maintenance│ │
│ │ Status: In Progress 🟡          │ │
│ │ Due: Nov 5, 2025               │ │
│ │ Assignee: @john                │ │
│ │ [View Task] [Unlink]           │ │
│ └─────────────────────────────────┘ │
│ [Create New Task] [Link Existing]  │
└─────────────────────────────────────┘
```

Ready when you are! 🚀
