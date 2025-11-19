# Error Handling & Logging

## Standardized Logging

All backend code now uses **Winston logger** instead of `console.log`.

### Usage

```javascript
const { logger } = require('./config/database');

// Log levels
logger.info('Normal operational message');
logger.warn('Warning - something might be wrong');
logger.error('Error occurred', { error: err, context: 'additional data' });
logger.debug('Verbose debugging info');
```

### Benefits

- ✅ Structured logging (JSON format in production)
- ✅ Log levels (info, warn, error, debug)
- ✅ Can pipe to external services (Datadog, CloudWatch, etc.)
- ✅ Persistent logs (written to files)
- ✅ Timestamps and metadata automatically included

### Migration from console.log

**Before:**
```javascript
console.log('Server started');
console.error('Failed:', error);
```

**After:**
```javascript
logger.info('Server started');
logger.error('Failed:', error);
```

## Async Error Handler

A new utility eliminates the need for `try/catch` in every route.

### Location

`backend/src/utils/asyncHandler.js`

### Usage

**Before:**
```javascript
router.get('/data', async (req, res) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (error) {
    logger.error('Failed to fetch data:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});
```

**After:**
```javascript
const asyncHandler = require('../utils/asyncHandler');

router.get('/data', asyncHandler(async (req, res) => {
  const data = await fetchData();
  res.json(data);
}));
```

Errors are automatically caught and passed to Express's error middleware.

### How It Works

The `asyncHandler` wraps your async function and catches any rejected promises:

```javascript
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
```

When an error is caught, it's passed to the error middleware in `server.js`:

```javascript
app.use((err, req, res, next) => {
  logger.error('Error caught by middleware:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(err.status || 500).json({
    error: isProduction ? 'Something went wrong!' : err.message,
    ...(isProduction ? {} : { stack: err.stack })
  });
});
```

## Best Practices

1. **Always use `logger`** instead of `console.log`
2. **Use `asyncHandler`** for async routes to avoid repetitive try/catch
3. **Include context** when logging errors:
   ```javascript
   logger.error('Failed to sync router', { routerId, error: err.message });
   ```
4. **Use appropriate log levels**:
   - `info` - Normal operations
   - `warn` - Potential issues
   - `error` - Actual failures
   - `debug` - Detailed troubleshooting (usually filtered out in production)

## Migration Path

To adopt async error handler in existing routes:

1. Import at top of route file:
   ```javascript
   const asyncHandler = require('../utils/asyncHandler');
   ```

2. Wrap async route handlers:
   ```javascript
   router.get('/path', asyncHandler(async (req, res) => {
     // Your code here - no try/catch needed
   }));
   ```

3. Remove manual try/catch blocks unless you need specific error handling

Note: This is **optional** - existing try/catch patterns still work fine. Use `asyncHandler` for new routes or when refactoring.

