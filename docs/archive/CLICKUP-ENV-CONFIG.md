# ClickUp OAuth Environment Configuration

## Backend Environment Variables

Add these to your Railway backend service:

```bash
CLICKUP_CLIENT_ID=JDZL8H4B6MAYI9VZ2BZVQE75ECYL18JX
CLICKUP_CLIENT_SECRET=UDQIT002THHK8ISMINDPVSM18EEISJQPWT765PSRU1HZMA80UNE5ADGUH80UYD9L
CLICKUP_REDIRECT_URI=https://YOUR_FRONTEND_URL/auth/clickup/callback
```

**Important:** Replace `YOUR_FRONTEND_URL` with your actual Railway frontend deployment URL.

For example:
- Production: `https://router-logger-frontend.up.railway.app/auth/clickup/callback`
- Local Dev: `http://localhost:3000/auth/clickup/callback`

## Local Development (.env file)

Create or update `backend/.env`:

```bash
CLICKUP_CLIENT_ID=JDZL8H4B6MAYI9VZ2BZVQE75ECYL18JX
CLICKUP_CLIENT_SECRET=UDQIT002THHK8ISMINDPVSM18EEISJQPWT765PSRU1HZMA80UNE5ADGUH80UYD9L
CLICKUP_REDIRECT_URI=http://localhost:3000/auth/clickup/callback
```

## Security Notes

- ✅ Client Secret is included in this file for your reference
- ⚠️ **NEVER commit the `.env` file to git**
- ⚠️ Add `.env` to `.gitignore`
- ✅ Railway environment variables are stored securely

## OAuth App Configuration in ClickUp

Your OAuth app should have these redirect URLs configured:

1. **Development**: `http://localhost:3000/auth/clickup/callback`
2. **Production**: `https://YOUR_FRONTEND_URL/auth/clickup/callback`

To update redirect URLs:
1. Go to https://app.clickup.com/settings/apps
2. Click on "RouterLogger Dashboard" app
3. Update Redirect URLs
4. Save changes

## Testing the Integration

1. Deploy backend with environment variables set
2. Deploy frontend
3. Open dashboard
4. Click "Connect ClickUp" button
5. Authorize access to VacatAd workspace
6. You'll be redirected back to dashboard
7. Open any router details
8. See ClickUp Task widget
9. Create or link tasks!
