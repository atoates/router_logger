# IMPORTANT REMINDERS FOR AI ASSISTANT

## 🗄️ DATABASE ACCESS - CRITICAL REMINDER

### ⚠️ DO NOT USE `psql $DATABASE_URL` - IT WILL ALWAYS FAIL

The database is **NOT** running locally. It's hosted on **Railway**.

## ✅ CORRECT WAY TO ACCESS DATABASE:

```bash
railway connect postgres
```

This will open an interactive PostgreSQL session connected to the Railway-hosted database.

## Example Usage:

```bash
ato@MacBook-Air backend % railway connect postgres
psql (18.1, server 17.6 (Debian 17.6-2.pgdg13+1))
SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off, ALPN: postgresql)
Type "help" for help.

railway=# SELECT * FROM routers LIMIT 5;
```

## Why This Matters:

- The database runs on Railway's infrastructure
- No local PostgreSQL server is running
- DATABASE_URL points to a remote connection that requires Railway CLI authentication
- Direct psql connections fail because the socket/credentials are managed by Railway

## For Queries:

Always use: `railway connect postgres` then run SQL interactively
OR use the backend API/models if you need programmatic access

---
**REMEMBER THIS - STOP TRYING LOCAL PSQL CONNECTIONS!**

---

## 🐛 DEBUG ENDPOINTS

### ⚠️ `/api/clickup/debug/*` endpoints are DISABLED in production

All endpoints under `/api/clickup/debug/*` require the environment variable:
```
ENABLE_DEBUG_ENDPOINTS=true
```

This is **NOT set** on Railway production, so these endpoints return 404.

### ✅ Use Production-Safe Alternatives:

| ❌ Debug Endpoint (404 in prod) | ✅ Production Endpoint |
|----------------------------------|------------------------|
| `/api/clickup/debug/space-lists/:spaceId` | `/api/clickup/space-lists/:spaceId` |

**Example Fix Applied**: PropertySearchWidget was calling the debug endpoint and failing with "Failed to search properties". Fixed by changing to the non-debug version.

---
**CHECK THESE REMINDERS BEFORE DEBUGGING ISSUES!**
