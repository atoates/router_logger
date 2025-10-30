# ClickUp Integration - Quick Start Guide

## 🎉 What's Ready

Your RouterLogger dashboard now has **full ClickUp integration**! Here's what you can do:

### Features Implemented
- ✅ OAuth 2.0 authentication with ClickUp
- ✅ Link routers to existing ClickUp tasks
- ✅ Create new tasks directly from router dashboard
- ✅ Display task status, assignees, and due dates
- ✅ One-click access to tasks in ClickUp
- ✅ Secure token storage in database

---

## 🚀 Setup Steps

### Step 1: Add Environment Variables to Railway

**Backend Service - Add these 3 variables:**

```
CLICKUP_CLIENT_ID=JDZL8H4B6MAYI9VZ2BZVQE75ECYL18JX
CLICKUP_CLIENT_SECRET=UDQIT002THHK8ISMINDPVSM18EEISJQPWT765PSRU1HZMA80UNE5ADGUH80UYD9L
CLICKUP_REDIRECT_URI=https://YOUR-FRONTEND-URL/auth/clickup/callback
```

**Important:** Replace `YOUR-FRONTEND-URL` with your actual Railway frontend URL (e.g., `https://router-logger-frontend.up.railway.app`)

### Step 2: Update ClickUp OAuth App Redirect URL

1. Go to https://app.clickup.com/settings/apps
2. Click on "RouterLogger Dashboard"
3. Add your production URL to Redirect URLs:
   - `https://YOUR-FRONTEND-URL/auth/clickup/callback`
4. Save changes

### Step 3: Deploy & Test

Railway will automatically deploy the changes. Once deployed:

1. **Open Dashboard V3**
2. **Click "Connect ClickUp"** button (top right)
3. **Authorize** access to VacatAd workspace
4. **You'll be redirected back** - connection complete!

---

## 📖 How to Use

### Connecting to ClickUp

1. On Dashboard V3, click the **"Connect ClickUp"** button
2. You'll be redirected to ClickUp's authorization page
3. Click **"Authorize"** to grant access
4. You'll return to the dashboard with a green "Connected" status

### Linking a Router to a Task

1. **Open any router** from the dashboard (click router card or use header selector)
2. **Scroll down** to the "ClickUp Task" widget
3. Two options:

   **Option A: Link Existing Task**
   - Click **"Link Existing Task"**
   - Search for task in "Routers" list
   - Click task to link

   **Option B: Create New Task**
   - Click **"Create New Task"**
   - Edit task name (pre-filled with router info)
   - Click **"Create & Link"**
   - Task created in "Routers" list and linked automatically

### Viewing Linked Tasks

Once linked, the widget shows:
- ✅ Task name
- ✅ Current status (with color coding)
- ✅ Assigned team members
- ✅ Due date (if set)
- ✅ **"View in ClickUp"** button - opens task in new tab
- ✅ **"Unlink"** button - removes connection

---

## 🏗️ Architecture Overview

### Backend Components

**Services:**
- `clickupOAuthService.js` - OAuth flow management
- `clickupClient.js` - ClickUp API wrapper
  - Get workspaces
  - Find "Routers" list
  - Create/read tasks
  - Search tasks

**Routes:** (`/api/clickup/*`)
- `GET /auth/status` - Check connection
- `GET /auth/url` - Get OAuth URL
- `GET /auth/callback` - Handle OAuth callback
- `POST /auth/disconnect` - Disconnect ClickUp
- `GET /workspaces` - Get workspaces
- `GET /lists/:workspaceId` - Find Routers list
- `GET /tasks/:listId` - Get tasks
- `POST /tasks/:listId` - Create task
- `POST /link-router` - Link router to task
- `DELETE /link-router/:routerId` - Unlink
- `GET /router-task/:routerId` - Get linked task

**Database:**
- `routers` table:
  - `clickup_task_id` - Linked task ID
  - `clickup_task_url` - Direct task URL
  - `clickup_list_id` - List where task lives
- `clickup_oauth_tokens` table:
  - `user_id` - User identifier (default for single-user)
  - `access_token` - OAuth token
  - `workspace_id` - Workspace ID
  - `workspace_name` - Workspace name

### Frontend Components

- **ClickUpAuthButton** - OAuth connection button (Dashboard V3)
- **ClickUpCallback** - OAuth callback handler
- **ClickUpTaskWidget** - Task linking UI (Router Dashboard)

### OAuth Flow

```
User → Click "Connect" 
  → Redirect to ClickUp 
    → User authorizes 
      → Callback to /auth/clickup/callback 
        → Exchange code for token 
          → Store in database 
            → Redirect to dashboard 
              → Connection complete!
```

---

## 🔧 Troubleshooting

### "No ClickUp token found"
**Solution:** Click "Connect ClickUp" button and authorize

### "Routers list not found"
**Solution:** Ensure you have a List named "Routers" in your VacatAd workspace

### OAuth callback fails
**Solution:** 
1. Check `CLICKUP_REDIRECT_URI` matches exactly
2. Verify redirect URL in ClickUp OAuth app settings
3. Check Railway logs for errors

### Can't see Connect button
**Solution:** Switch to Dashboard V3 (not Router Log view)

---

## 🎯 Next Steps

### Recommended Workflow

1. **Connect ClickUp** (one-time setup)
2. **Create tasks** for router maintenance
3. **Link routers** to respective tasks
4. **Track progress** in ClickUp
5. **Monitor status** in dashboard

### Tips

- Use ClickUp's **custom fields** for additional router metadata
- Set up **automations** for status changes
- Create **templates** for common router tasks
- Use **tags** to categorize routers

---

## 📊 What's Stored

**In Your Database:**
- OAuth access token (secure)
- Task ID for each router
- Task URL for quick access

**In ClickUp:**
- Tasks in "Routers" list
- Router ID in task description
- Tagged with "router"

**Nothing else** - full privacy and control!

---

## 🔐 Security

- ✅ OAuth 2.0 with CSRF protection
- ✅ Tokens encrypted in database
- ✅ HTTPS only in production
- ✅ Client secret never exposed to frontend
- ✅ State parameter for callback verification

---

## 📞 Support

If you encounter issues:

1. Check Railway deployment logs
2. Verify environment variables are set
3. Confirm ClickUp OAuth app configuration
4. Review browser console for errors

**All systems ready!** 🚀

Enjoy your integrated RouterLogger + ClickUp dashboard! 🎉
